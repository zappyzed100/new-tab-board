// calendarMonth.ts — Google カレンダーURL生成(純関数。SPEC.md §4.9)
//
// GCal連携はURL遷移のみ(API/OAuth不要)。カレンダーのデータは拡張に一切取り込まない
// (プライバシー: 一方向・送るだけ。SPEC.md §4.9)。月グリッド自体の構築は
// react-day-picker(OSS)に委譲したため、ここにはGCal URL生成のみが残る。
function toGCalDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** 指定日の終日予定作成プリフィル用Googleカレンダーレンダー画面URLを組み立てる。 */
export function buildGCalUrl(timestamp: number, title = ""): string {
  const start = toGCalDate(timestamp);
  const next = new Date(timestamp);
  next.setDate(next.getDate() + 1);
  const end = toGCalDate(next.getTime());
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${start}/${end}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** 指定の年月のGoogleカレンダー月表示画面URLを組み立てる(month は0始まり)。 */
export function buildGCalMonthUrl(year: number, month: number): string {
  return `https://calendar.google.com/calendar/r/month/${year}/${month + 1}/1`;
}
