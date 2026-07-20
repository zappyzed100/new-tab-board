// googleAuth.ts — chrome.identity.getAuthTokenによるOAuthアクセストークン取得の唯一の入出口(SPEC.md §2・§8)
//
// 【2026-07-20: launchWebAuthFlow(implicit)からgetAuthTokenへ戻した経緯】
// 2026-07-16時点では「chrome.identity.getAuthTokenはChrome拡張機能型OAuthクライアントだと、
// ブラウザ本体が未サインインの環境で旧カスタムURIスキーム経路(GeneralOAuthFlow)へフォール
// バックし、2023-10のGoogleセキュリティ変更でブロックされる」ためlaunchWebAuthFlow +
// 「ウェブアプリケーション」型クライアント + implicitフロー(response_type=token)を採用していた。
//
// しかしimplicitフローには更新トークンが無く、アクセストークンは約1時間で失効する。しかも
// トークンキャッシュはモジュール変数だったため新しいタブを開くたびに空から始まり、毎回
// launchWebAuthFlow({interactive:false})が走って`User interaction required`で失敗していた。
// getAuthTokenはこれをnullへ握り潰し、呼び出し側(App.tsxの突合effect・background.ts)は
// 「未接続だから静かに何もしない」と解釈するため、**Drive連携が丸2日間まるごと停止していても
// 誰も気づけなかった**(2026-07-18〜20の実害: 削除したノートがDriveのactive/に残り続けた)。
//
// 復帰できた理由は、記録されていた2つの失敗が別々の制約だったこと:
//   - pickerOAuth.tsの「Chrome拡張機能型はchromiumapp.orgリダイレクトと非互換」は
//     **launchWebAuthFlowの制約**。getAuthTokenはchromiumapp.orgリダイレクトを使わず
//     Chrome内部のトークンサービスを叩くため、この制約に当たらない。
//   - 上記の「カスタムURIスキーム経路へ落ちる」は**ブラウザ未サインイン時**の条件。
//     Chromeが当該Googleアカウントへサインイン済みなら発生しない(2026-07-20に実機確認)。
// getAuthTokenはChrome自身がトークンの更新を担うので、1時間ごとの再認可が構造的に消える。
//
// なおPickerフロー(pickerOAuth.ts)は引き続きlaunchWebAuthFlow + chromiumapp.orgのため
// 「Chrome拡張機能」型では動かない——**別クライアント(ウェブアプリケーション型)を使う**。
// client_idの共有をやめた理由はpickerOAuth.tsのヘッダーを参照。
import { logOp } from "../runtime/log";

/** chrome.identity.getAuthTokenの戻り値。Chromeのバージョンによりトークン文字列を直接返す
 * 実装と{token, grantedScopes}を返す実装があるため、両方を受けられる形で扱う。 */
type AuthTokenResult = string | { token?: string } | undefined;

function extractToken(result: AuthTokenResult): string | null {
  if (typeof result === "string") return result || null;
  return result?.token ?? null;
}

/** OAuth2アクセストークンを取得する(manifest.jsonのoauth2セクションのclient_id/scopesを使う)。
 * トークンのキャッシュと失効前の更新はChromeが行うため、この層はキャッシュを持たない
 * (モジュール変数キャッシュがタブ単位で消え、毎回の再認可を招いていた——ヘッダー参照)。
 * interactive=falseで失敗した場合はnullを返す(未サインイン・未許可時に静かに諦めるため)。 */
export async function getAuthToken(interactive = true): Promise<string | null> {
  try {
    const result = (await chrome.identity.getAuthToken({ interactive })) as AuthTokenResult;
    const token = extractToken(result);
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
    const result = (await chrome.identity.getAuthToken({ interactive })) as AuthTokenResult;
    const token = extractToken(result);
    logOp("googleAuth", "getAuthToken", `interactive=${interactive} ok=${token !== null}`);
    return { token, error: token === null ? "トークンが空でした" : null };
  } catch (err) {
    logOp("googleAuth", "getAuthToken-error", `interactive=${interactive}`, { error: err });
    return { token: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 失効したトークンをChromeのキャッシュから外し、次回getAuthTokenで新しいトークンを取れる
 * ようにする(401を受けた呼び出し側が使う)。 */
export async function invalidateToken(token: string): Promise<void> {
  try {
    await chrome.identity.removeCachedAuthToken({ token });
    logOp("googleAuth", "invalidateToken", "token removed from chrome cache");
  } catch (err) {
    // 失効済みトークンの除去に失敗しても次回取得は妨げられない(Chromeが期限切れとして扱う)。
    logOp("googleAuth", "invalidateToken-error", "", { error: err });
  }
}
