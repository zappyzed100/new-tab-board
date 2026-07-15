// batteryStatus.ts — スマホのバッテリー低下警告(GAS Web App中継)の拡張側クライアント。
// gas/battery-webhook.gs の doGet を叩き、最新のバッテリー残量を取得する(契約はgas/README.md)。
import { logOp } from "../runtime/log";

export type FetchLike = typeof fetch;

export type BatteryStatus = { level: number; updatedAt: string | null };

/** GAS Web AppのURLへ ?token=<共有トークン> で問い合わせ、最新のバッテリー残量を取得する。
 * 未報告(levelが無い)・トークン不一致・HTTPエラー・ネットワーク不通はnull
 * (呼び出し側は静かにスキップする——NAS/Driveの他の外部I/Oクライアントと同じ方針)。 */
export async function fetchBatteryStatus(
  url: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<BatteryStatus | null> {
  try {
    const sep = url.includes("?") ? "&" : "?";
    const res = await fetchImpl(`${url}${sep}token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      logOp("batteryStatus", "fetch-error", `HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      ok?: boolean;
      level?: number | null;
      updatedAt?: string | null;
    };
    if (!data.ok || data.level === null || data.level === undefined) return null;
    return { level: data.level, updatedAt: data.updatedAt ?? null };
  } catch (err) {
    logOp("batteryStatus", "fetch-error", "", { error: err });
    return null;
  }
}
