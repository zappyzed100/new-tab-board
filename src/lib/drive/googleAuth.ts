// googleAuth.ts — chrome.identityによるOAuthトークン取得の唯一の入出口(SPEC.md §2・§8)
import { logOp } from "../runtime/log";

/** OAuth2アクセストークンを取得する(manifest.jsonのoauth2セクションのスコープを使う)。
 * interactive=falseで失敗した場合はnullを返す(未サインイン・未許可時に静かに諦めるため)。 */
export async function getAuthToken(interactive = true): Promise<string | null> {
  try {
    const result = await chrome.identity.getAuthToken({ interactive });
    const token = result.token ?? null;
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
    const result = await chrome.identity.getAuthToken({ interactive });
    const token = result.token ?? null;
    logOp("googleAuth", "getAuthToken", `interactive=${interactive} ok=${token !== null}`);
    return { token, error: token === null ? "トークンが空でした" : null };
  } catch (err) {
    logOp("googleAuth", "getAuthToken-error", `interactive=${interactive}`, { error: err });
    return { token: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 失効したトークンをキャッシュから外し、次回getAuthTokenで新しいトークンを取れるようにする。 */
export async function invalidateToken(token: string): Promise<void> {
  await chrome.identity.removeCachedAuthToken({ token });
  logOp("googleAuth", "invalidateToken", "token removed from cache");
}
