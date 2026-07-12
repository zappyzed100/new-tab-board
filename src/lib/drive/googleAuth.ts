// googleAuth.ts — launchWebAuthFlowによるOAuthアクセストークン取得の唯一の入出口(SPEC.md §2・§8)
// chrome.identity.getAuthTokenは「Chrome拡張機能」型OAuthクライアントだと、ブラウザ本体が
// 未サインインの環境で旧カスタムURIスキーム経路(GeneralOAuthFlow)へフォールバックし、
// 2023-10のGoogleセキュリティ変更でブロックされる(invalid_request: Custom URI scheme is
// not supported on Chrome apps。GitHub GoogleChrome/developer.chrome.com#7434)。
// そこで環境非依存なlaunchWebAuthFlow(https://<id>.chromiumapp.org/へのリダイレクト。
// カスタムURIスキームを使わない)へ移行した。OAuthクライアントは「ウェブ アプリケーション」型で、
// 承認済みリダイレクトURIに上記chromiumapp.orgのURLを登録しておく必要がある。
import { logOp } from "../runtime/log";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/auth";
// implicitフロー(response_type=token)は更新トークンが無く1時間ほどで失効するため、
// 取得したトークンを期限付きでキャッシュし、失効前に再取得する。通信途中の失効を避けるため
// 期限判定に少し余裕(スキュー)を持たせる。
const EXPIRY_SKEW_MS = 60_000;

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | null = null;

type OAuthConfig = { clientId: string; scopes: string[] };

function readOAuthConfig(): OAuthConfig {
  const manifest = chrome.runtime.getManifest() as unknown as {
    oauth2?: { client_id?: string; scopes?: string[] };
  };
  const oauth2 = manifest.oauth2 ?? {};
  return { clientId: oauth2.client_id ?? "", scopes: oauth2.scopes ?? [] };
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
  const redirectUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive });
  if (!redirectUrl) return null;
  return parseTokenFromRedirect(redirectUrl);
}

/** 有効なキャッシュがあればそれを返し、無ければlaunchWebAuthFlowで取得してキャッシュする。 */
async function acquireToken(interactive: boolean): Promise<string | null> {
  if (cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now()) return cached.token;
  cached = await fetchToken(interactive);
  return cached?.token ?? null;
}

/** OAuth2アクセストークンを取得する(manifest.jsonのoauth2セクションのclient_id/scopesを使う)。
 * interactive=falseで失敗した場合はnullを返す(未サインイン・未許可時に静かに諦めるため)。 */
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

/** 失効したトークンをキャッシュから外し、次回getAuthTokenで新しいトークンを取れるようにする。 */
export async function invalidateToken(token: string): Promise<void> {
  if (cached?.token === token) cached = null;
  logOp("googleAuth", "invalidateToken", "token removed from cache");
}
