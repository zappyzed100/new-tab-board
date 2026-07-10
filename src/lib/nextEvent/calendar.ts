// calendar.ts — Google Calendar API(読み取り専用)から次の予定を取得する(SPEC.md §4.9)
// カレンダーの中身を拡張へ取り込むのは次の予定1件のみ(キャッシュ済み)。一方向・最小限。
import { logOp } from "../runtime/log";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export type FetchLike = typeof fetch;

export type NextEvent = {
  title: string;
  startsAt: number; // epoch ms
};

type GCalEvent = {
  summary?: string;
  start?: { dateTime?: string; date?: string };
};

/** 次の予定(終日を除く直近の1件)を取得する。予定が無ければnull。 */
export async function fetchNextEvent(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<NextEvent | null> {
  const params = new URLSearchParams({
    timeMin: new Date().toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "10",
  });
  const res = await fetchImpl(`${EVENTS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    logOp("calendar", "fetch-error", `status=${res.status}`);
    throw new Error(`Calendar取得失敗: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { items?: GCalEvent[] };
  const items = data.items ?? [];
  // start.dateTimeが無く start.date のみ = 終日予定(SPEC.md §4.9で対象外)
  const next = items.find((e) => e.start?.dateTime);
  if (!next?.start?.dateTime) {
    logOp("calendar", "fetchNextEvent", "予定なし(終日除く)");
    return null;
  }
  logOp("calendar", "fetchNextEvent", `title=${next.summary ?? "(無題)"}`);
  return {
    title: next.summary ?? "(無題の予定)",
    startsAt: new Date(next.start.dateTime).getTime(),
  };
}
