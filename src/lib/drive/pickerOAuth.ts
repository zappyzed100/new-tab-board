// pickerOAuth.ts — Google Picker「デスクトップ・モバイル向けフロー」のOAuth実装(認可コード+PKCE)。
// JS版Picker(gapi)はMV3のcontent_security_policy.extension_pagesがscript-srcを'self'以外へ
// 緩められず、https://apis.google.com からの読み込みが不可能と実機で判明した(2026-07-16)。
// 代わりにGoogle公式の「デスクトップ・モバイル向けPicker」方式を使う: OAuth認可URLに
// trigger_onepick等のパラメータを付けてブラウザタブでPickerを開き、選択結果を
// リダイレクトURLのpicked_file_idsで受け取る(JS Pickerライブラリ自体を読み込まない
// ためCSP制約に触れない)。
//
// この方式はresponse_type=code(認可コード)を使い、コード交換には通常client_secretが
// 要るが、Chrome拡張機能型のOAuthクライアント(installed app=public client)はPKCEで
// 代替でき、client_secretを使わない(Google公式)。メインのログイン(googleAuth.ts・
// ウェブアプリ型client_id)とは別の、Picker専用のChrome拡張機能型client_idを使う
// ——drive.fileスコープ単体でなければならない制約があるため(メインはdrive.file+
// calendar.readonlyを同時要求している)。
import { logOp } from "../runtime/log";

// Cloud Consoleで作成した「Chrome拡張機能」型OAuthクライアント(ユーザー作成・2026-07-16)。
// installed app(public client)のclient_idはclient_secretと違い秘匿情報ではないため、
// ソースへ埋め込んでよい(Google公式)。
const PICKER_CLIENT_ID = "872015431238-9lbkplb85gmm7ob0imgu1vkccde29soo.apps.googleusercontent.com";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const PICKER_SCOPE = "https://www.googleapis.com/auth/drive.file";

export type PickedFolder = { id: string; name: string | null };

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCEのcode_verifier(暗号乱数由来のbase64url文字列)を作る。 */
function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** code_verifierからcode_challenge(S256)を作る。 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function buildAuthUrl(redirectUri: string, codeChallenge: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", PICKER_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PICKER_SCOPE);
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("trigger_onepick", "true");
  url.searchParams.set("allow_folder_selection", "true");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** リダイレクトURLから picked_file_ids(先頭1件をフォルダIDとして採用)・code・errorを取り出す。 */
function parseRedirect(redirectUrl: string): {
  code: string | null;
  folderId: string | null;
  error: string | null;
} {
  const params = new URL(redirectUrl).searchParams;
  const pickedIds = params.get("picked_file_ids");
  return {
    code: params.get("code"),
    folderId: pickedIds ? (pickedIds.split(",")[0] ?? null) : null,
    error: params.get("error"),
  };
}

/** 認可コードをアクセストークンへ交換する(client_secret不使用・PKCEのcode_verifierのみ)。 */
async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: PICKER_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    logOp("pickerOAuth", "token-exchange-error", `status=${res.status}`);
    return null;
  }
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

/** 選ばれたフォルダの表示名をDrive APIで取得する(確認メッセージ用。失敗は致命的でないのでnull)。 */
async function fetchFolderName(
  folderId: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${FILES_URL}/${folderId}?fields=name`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string };
    return data.name ?? null;
  } catch {
    return null;
  }
}

export type PickerOAuthDeps = {
  launchWebAuthFlow?: (details: {
    url: string;
    interactive: boolean;
  }) => Promise<string | undefined>;
  getRedirectURL?: (path?: string) => string;
  fetchImpl?: typeof fetch;
};

/** Picker「デスクトップ・モバイル向けフロー」を開き、ユーザーが選んだフォルダの{id,name}を返す
 * (キャンセル/失敗はnull)。drive.fileスコープ単体・Chrome拡張機能型クライアント・PKCEで
 * client_secret無しに完結する(ユーザー設計・2026-07-16)。 */
export async function pickSharedFolderViaOAuth(
  deps: PickerOAuthDeps = {},
): Promise<PickedFolder | null> {
  const _launch = deps.launchWebAuthFlow ?? ((d) => chrome.identity.launchWebAuthFlow(d));
  const _getRedirectURL = deps.getRedirectURL ?? ((path) => chrome.identity.getRedirectURL(path));
  const _fetch = deps.fetchImpl ?? fetch;

  // 引数無しで呼ぶ(https://<拡張ID>.chromiumapp.org/ のみ)。パス付き(例:"drive-picker")だと
  // 別URIになり、「Chrome拡張機能」型クライアント(Item ID登録のみ・パス無し完全一致でしか
  // 許可されない)ではredirect_uri_mismatchで400になる(実機確認・2026-07-16。メインの
  // googleAuth.tsも同じ理由で引数無しで呼んでいる)。
  const redirectUri = _getRedirectURL();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const authUrl = buildAuthUrl(redirectUri, codeChallenge);

  logOp("pickerOAuth", "pick-start", "");
  const redirectUrl = await _launch({ url: authUrl, interactive: true });
  if (!redirectUrl) {
    logOp("pickerOAuth", "pick-no-redirect", "");
    return null;
  }
  const { code, folderId, error } = parseRedirect(redirectUrl);
  if (error || !code || !folderId) {
    logOp("pickerOAuth", "pick-cancel-or-error", `error=${error ?? "none"}`);
    return null;
  }
  const token = await exchangeCodeForToken(code, codeVerifier, redirectUri, _fetch);
  if (!token) {
    logOp("pickerOAuth", "pick-exchange-failed", `folderId=${folderId}`);
    return null;
  }
  const name = await fetchFolderName(folderId, token, _fetch);
  logOp("pickerOAuth", "pick-done", `folderId=${folderId} name=${name ?? "unknown"}`);
  return { id: folderId, name };
}
