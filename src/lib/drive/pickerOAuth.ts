// pickerOAuth.ts — Google Picker「デスクトップ・モバイル向けフロー」のOAuth実装。
// JS版Picker(gapi)はMV3のcontent_security_policy.extension_pagesがscript-srcを'self'以外へ
// 緩められず使用不能と判明(2026-07-16)。代わりにGoogle公式の「デスクトップ・モバイル向け
// Picker」方式を使う: OAuth認可URLにtrigger_onepick等のパラメータを付けてブラウザタブで
// Pickerを開き、選択結果をリダイレクトURLのpicked_file_idsで受け取る(JS Pickerライブラリ
// 自体を読み込まないためCSP制約に触れない)。
//
// 当初はresponse_type=code(認可コード+PKCE)で、Picker専用の「Chrome拡張機能」型OAuth
// クライアントを使う設計だったが、実機でHTTP 400 redirect_uri_mismatch(詳細:
// flowName=GeneralOAuthFlow)になった。これはgoogleAuth.tsのヘッダーコメントに記録した
// 「chrome.identity.getAuthTokenがChrome拡張機能型クライアントで旧カスタムURIスキーム経路
// (GeneralOAuthFlow)に落ちてブロックされる」のと同一のGoogle側制約で、Chrome拡張機能型
// クライアントはhttps://<拡張ID>.chromiumapp.org/形式のリダイレクトと原理的に非互換と判明。
// 一方「デスクトップアプリ」型はloopback(http://127.0.0.1:port)かcustom URIスキーム
// (非推奨)しか対応せず、これも使えない。https://…chromiumapp.org/を受け付けると実証済み
// なのは、メインログイン(googleAuth.ts)が使う「ウェブアプリケーション」型クライアントのみ
// ——ただしこの型はPKCEを使ってもclient_secretが必須というGoogle独自仕様のため、
// response_type=codeのままでは詰む。
//
// 解決策: response_type=token(インプリシットフロー。メインログインと同じ仕組み)を使う。
// アクセストークンをredirectで直接受け取るためコード交換自体が不要になり、client_secret
// 問題が消える。クライアントIDはgoogleAuth.tsのgetOAuthClientId()で共有し(スコープだけ
// drive.file単体に絞る——Picker専用フローの制約: 他スコープと同時要求不可)、新規クライアント
// は使わない(2026-07-16 設計変更)。
import { logOp } from "../runtime/log";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const PICKER_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Picker専用のOAuthクライアントID(「ウェブアプリケーション」型)。
 *
 * 以前はmanifest.jsonのoauth2.client_idをgoogleAuth.tsのgetOAuthClientId()経由で共有していたが、
 * 2026-07-20にメインログインをchrome.identity.getAuthTokenへ戻した際、manifest側のclient_idは
 * 「Chrome拡張機能」型へ差し替わった(googleAuth.tsのヘッダー参照)。**「Chrome拡張機能」型は
 * https://<id>.chromiumapp.org/リダイレクトと原理的に非互換**(本ファイル冒頭に記録した
 * redirect_uri_mismatch/GeneralOAuthFlowの制約)のため、launchWebAuthFlowを使うこのPickerフローが
 * manifest側のIDを引き継ぐと確実に壊れる。よってPickerは従来の「ウェブアプリケーション」型
 * クライアントを定数として保持し続ける(承認済みリダイレクトURIに上記chromiumapp.orgを登録済み)。
 * client_idは秘密情報ではない(client_secretは使わない——冒頭の設計判断を参照)。 */
const PICKER_CLIENT_ID = "872015431238-8ul2vrsn7crorkdqsh1s6f47hffejdnb.apps.googleusercontent.com";

/** Pickerフローが使うOAuthクライアントID(「ウェブアプリケーション」型)を返す。 */
export function getPickerClientId(): string {
  return PICKER_CLIENT_ID;
}

export type PickedFolder = { id: string; name: string | null };

function buildAuthUrl(clientId: string, redirectUri: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("scope", PICKER_SCOPE);
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("trigger_onepick", "true");
  url.searchParams.set("allow_folder_selection", "true");
  return url.toString();
}

/** リダイレクトURLから access_token・picked_file_ids(先頭1件)・errorを取り出す。
 * このPickerフロー固有パラメータの返却位置(クエリ文字列かフラグメントか)はGoogle公式
 * ドキュメントに明記が無いため、両方を見る(implicitフローの通常挙動はフラグメント)。 */
function parseRedirect(redirectUrl: string): {
  accessToken: string | null;
  folderId: string | null;
  error: string | null;
} {
  const url = new URL(redirectUrl);
  const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const fragmentParams = new URLSearchParams(fragment);
  const get = (key: string) => url.searchParams.get(key) ?? fragmentParams.get(key);
  const pickedIds = get("picked_file_ids");
  return {
    accessToken: get("access_token"),
    folderId: pickedIds ? (pickedIds.split(",")[0] ?? null) : null,
    error: get("error"),
  };
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
  getRedirectURL?: () => string;
  getClientId?: () => string;
  fetchImpl?: typeof fetch;
};

/** Picker「デスクトップ・モバイル向けフロー」を開き、ユーザーが選んだフォルダの{id,name}を返す
 * (キャンセル/失敗はnull)。response_type=token(インプリシットフロー)で「ウェブアプリケーション」型
 * クライアント(PICKER_CLIENT_ID)を使い、drive.fileスコープ単体で要求する(ユーザー設計・2026-07-16。
 * メインログインとのclient_id共有は2026-07-20に解消——PICKER_CLIENT_IDのコメント参照)。 */
export async function pickSharedFolderViaOAuth(
  deps: PickerOAuthDeps = {},
): Promise<PickedFolder | null> {
  const _launch = deps.launchWebAuthFlow ?? ((d) => chrome.identity.launchWebAuthFlow(d));
  const _getRedirectURL = deps.getRedirectURL ?? (() => chrome.identity.getRedirectURL());
  const _getClientId = deps.getClientId ?? getPickerClientId;
  const _fetch = deps.fetchImpl ?? fetch;

  const redirectUri = _getRedirectURL();
  const authUrl = buildAuthUrl(_getClientId(), redirectUri);

  logOp("pickerOAuth", "pick-start", "");
  const redirectUrl = await _launch({ url: authUrl, interactive: true });
  if (!redirectUrl) {
    logOp("pickerOAuth", "pick-no-redirect", "");
    return null;
  }
  const { accessToken, folderId, error } = parseRedirect(redirectUrl);
  if (error || !accessToken || !folderId) {
    logOp(
      "pickerOAuth",
      "pick-cancel-or-error",
      `error=${error ?? "none"} hasToken=${accessToken !== null} hasFolder=${folderId !== null}`,
    );
    return null;
  }
  const name = await fetchFolderName(folderId, accessToken, _fetch);
  logOp("pickerOAuth", "pick-done", `folderId=${folderId} name=${name ?? "unknown"}`);
  return { id: folderId, name };
}
