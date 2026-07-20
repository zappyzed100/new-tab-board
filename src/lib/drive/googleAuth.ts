// googleAuth.ts — launchWebAuthFlowによるOAuthアクセストークン取得の唯一の入出口(SPEC.md §2・§8)
//
// 【なぜchrome.identity.getAuthTokenを使わないのか — 2回踏んだ袋小路】
// chrome.identity.getAuthTokenは「Chrome拡張機能」型OAuthクライアントだと旧カスタムURIスキーム
// 経路(GeneralOAuthFlow)へフォールバックし、2023-10のGoogleセキュリティ変更でブロックされる
// (エラー400 invalid_request: Custom URI scheme is not supported on Chrome apps。
// GitHub GoogleChrome/developer.chrome.com#7434)。
// 2026-07-16に一度この結論へ達し、2026-07-20に「ブラウザ本体がサインイン済みなら内部トークン
// サービスが使われるので回避できるはず」という仮説で再挑戦したが、**ブラウザ・プロフィール
// ともにサインイン済みの実機で同じエラーが再現した**。仮説は誤りで、この道は条件を問わず
// 閉じている。三度目を試さないこと。
//
// 【1時間ごとの再認可を消すための2点 — 2026-07-20】
// implicitフロー(response_type=token)には更新トークンが無く、アクセストークンは約1時間で失効
// する。以前はこの再取得が毎回失敗し、Drive連携が丸2日間まるごと停止していたのに無症状だった
// (2026-07-18〜20の実害: 拡張機能から削除したノート3件がDriveのactive/に残り続けた)。
// 原因は2つあり、両方を潰している:
//
//   (1) トークンキャッシュがモジュール変数だったため、新しいタブを開くたびに空から始まり、
//       毎回サイレント認可が走っていた → chrome.storage.localへ永続化し、タブ・
//       service worker をまたいで共有する。
//   (2) launchWebAuthFlowの`abortOnLoadForNonInteractive`は**既定がtrue**で、認証ページが
//       読み込まれた瞬間に打ち切る。Googleのサイレント認可は複数回リダイレクトするため、
//       既定のままでは必ず途中で切られ`User interaction required`になっていた
//       (このエラーメッセージ自体がabortOnLoadForNonInteractive/timeoutMsForNonInteractiveの
//       指定を示唆していた) → 非対話時はfalse＋タイムアウト指定でリダイレクト連鎖を完走させる。
//
// OAuthクライアントは「ウェブ アプリケーション」型で、承認済みリダイレクトURIに
// https://<拡張ID>.chromiumapp.org/ を登録しておく必要がある。
import { logOp } from "../runtime/log";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/auth";
// 通信途中の失効を避けるため、期限判定に少し余裕(スキュー)を持たせる。
const EXPIRY_SKEW_MS = 60_000;
// 非対話フローでリダイレクト連鎖を待つ上限。長すぎると画面表示を待たせるため短めにする。
const NON_INTERACTIVE_TIMEOUT_MS = 8_000;
// トークンの永続先(chrome.storage.local)。sync側はクォータ制約が厳しく、そもそも端末間で
// 共有すべき値でもないためlocalに置く(AGENTS.md §11)。
const TOKEN_STORAGE_KEY = "driveAccessToken";

type CachedToken = { token: string; expiresAt: number };

// 同一コンテキスト内の高速パス。永続層(chrome.storage.local)の読み取りすら省く。
let cached: CachedToken | null = null;
// 同時呼び出しの単一化。全ペインがほぼ同時に同期を始めると認可フローが多重に走るため
// (todos.txtが同時刻に2つ作られたcheck-then-actレースと同じ型の事故を認可側で防ぐ)。
let inFlight: Promise<CachedToken | null> | null = null;

type OAuthConfig = { clientId: string; scopes: string[] };

function readOAuthConfig(): OAuthConfig {
  const manifest = chrome.runtime.getManifest() as unknown as {
    oauth2?: { client_id?: string; scopes?: string[] };
  };
  const oauth2 = manifest.oauth2 ?? {};
  return { clientId: oauth2.client_id ?? "", scopes: oauth2.scopes ?? [] };
}

/** manifest.jsonのoauth2.client_id(「ウェブ アプリケーション」型・chromiumapp.orgリダイレクト
 * 対応済み)を返す公開ゲッター。スコープは呼び出し側がフローごとに変えられるよう含めない。 */
export function getOAuthClientId(): string {
  return readOAuthConfig().clientId;
}

function isFresh(entry: CachedToken | null): entry is CachedToken {
  return entry !== null && entry.expiresAt - EXPIRY_SKEW_MS > Date.now();
}

/** 永続化したトークンを読む。壊れていれば無視する(次の取得で上書きされる)。 */
async function readStoredToken(): Promise<CachedToken | null> {
  try {
    const stored = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
    const entry = stored?.[TOKEN_STORAGE_KEY] as CachedToken | undefined;
    // NO-LOG: トークン本体は秘匿対象(AGENTS.md §7)。取得可否は呼び出し元のgetAuthTokenが記録する。
    if (!entry || typeof entry.token !== "string" || typeof entry.expiresAt !== "number") {
      return null;
    }
    return entry;
  } catch (err) {
    logOp("googleAuth", "token-read-error", "永続トークンの読み取りに失敗(再取得へ)", {
      error: err,
    });
    return null;
  }
}

/** トークンを永続化する。失敗しても取得自体は成功しているので握りつぶす(次回再取得になるだけ)。 */
async function writeStoredToken(entry: CachedToken | null): Promise<void> {
  try {
    if (entry) await chrome.storage.local.set({ [TOKEN_STORAGE_KEY]: entry });
    else await chrome.storage.local.remove(TOKEN_STORAGE_KEY);
    // NO-LOG: トークン本体は秘匿対象(AGENTS.md §7)。書き込み事実だけの記録は雑音になるため出さない。
  } catch (err) {
    logOp("googleAuth", "token-write-error", "永続トークンの保存に失敗(次回再取得)", {
      error: err,
    });
  }
}

function buildAuthUrl(config: OAuthConfig, redirectUri: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  return url.toString();
}

/** launchWebAuthFlowの戻り値URL(フラグメントに#access_token=...&expires_in=...を含む)を解析する。 */
function parseTokenFromRedirect(redirectUrl: string): CachedToken | null {
  const hash = redirectUrl.split("#")[1] ?? "";
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  if (!token) return null;
  const expiresIn = Number(params.get("expires_in") ?? "3600");
  return { token, expiresAt: Date.now() + expiresIn * 1000 };
}

async function fetchToken(interactive: boolean): Promise<CachedToken | null> {
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = buildAuthUrl(readOAuthConfig(), redirectUri);
  const details: Parameters<typeof chrome.identity.launchWebAuthFlow>[0] = {
    url: authUrl,
    interactive,
  };
  // 非対話時のみabortOnLoadForNonInteractive/timeoutMsForNonInteractiveを付ける(ヘッダー(2))。
  // @types/chromeの型にまだ無いオプションのため、Object.assignで後付けする
  // (オブジェクトリテラルに直接書くと超過プロパティ検査で弾かれる)。
  if (!interactive) {
    Object.assign(details, {
      abortOnLoadForNonInteractive: false,
      timeoutMsForNonInteractive: NON_INTERACTIVE_TIMEOUT_MS,
    });
  }
  const redirectUrl = await chrome.identity.launchWebAuthFlow(details);
  if (!redirectUrl) return null;
  return parseTokenFromRedirect(redirectUrl);
}

/** メモリ→永続→認可フローの順に辿ってトークンを得る。同時呼び出しは1本に束ねる。 */
async function acquireToken(interactive: boolean): Promise<string | null> {
  if (isFresh(cached)) return cached.token;

  const stored = await readStoredToken();
  if (isFresh(stored)) {
    cached = stored;
    return stored.token;
  }

  if (!inFlight) {
    inFlight = (async () => {
      try {
        const fetched = await fetchToken(interactive);
        cached = fetched;
        await writeStoredToken(fetched);
        return fetched;
      } finally {
        inFlight = null;
      }
    })();
  }
  const result = await inFlight;
  return result?.token ?? null;
}

/** OAuth2アクセストークンを取得する(manifest.jsonのoauth2セクションのclient_id/scopesを使う)。
 * interactive=falseで失敗した場合はnullを返す(未サインイン・未許可時に静かに諦めるため)。
 * 「静かに諦める」ため失敗が無症状になりやすい——DataPanelの未接続表示が最後の砦になっている。 */
export async function getAuthToken(interactive = true): Promise<string | null> {
  try {
    const token = await acquireToken(interactive);
    logOp("googleAuth", "getAuthToken", `interactive=${interactive} ok=${token !== null}`);
    return token;
  } catch (err) {
    logOp("googleAuth", "getAuthToken-error", `interactive=${interactive}`, { error: err });
    return null;
  }
}

/** getAuthTokenと同じだが、失敗理由を握りつぶさずそのまま返す
 * (「GDrive設定」ボタンの手動接続診断専用——失敗しても「失敗しました」としか
 * 出ないと原因の手がかりが一切残らないため、DataPanel.tsxのメッセージに含める)。 */
export async function getAuthTokenWithError(
  interactive = true,
): Promise<{ token: string | null; error: string | null }> {
  try {
    const token = await acquireToken(interactive);
    logOp("googleAuth", "getAuthToken", `interactive=${interactive} ok=${token !== null}`);
    return { token, error: token === null ? "トークンが空でした" : null };
  } catch (err) {
    logOp("googleAuth", "getAuthToken-error", `interactive=${interactive}`, { error: err });
    return { token: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 失効したトークンをメモリ・永続の両方から外し、次回getAuthTokenで取り直せるようにする。 */
export async function invalidateToken(token: string): Promise<void> {
  if (cached?.token === token) cached = null;
  const stored = await readStoredToken();
  if (stored?.token === token) await writeStoredToken(null);
  logOp("googleAuth", "invalidateToken", "token removed from memory and storage");
}
