// calendarMonth.ts — 小型カレンダーの月グリッド構築 + Google カレンダーURL生成(純関数。SPEC.md §4.9)
//
// GCal連携はURL遷移のみ(API/OAuth不要)。カレンダーのデータは拡張に一切取り込まない
// (プライバシー: 一方向・送るだけ。SPEC.md §4.9)。
export type CalendarDay = {
  date: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  /** UTC日付比較を避けるための、その日のローカルタイムスタンプ(その日の0時0分) */
  timestamp: number;
};

/** year/month(0始まり)の月グリッドを日曜始まり6週固定で構築する。 */
export function buildMonthGrid(year: number, month: number, today: Date): CalendarDay[][] {
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);

  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    days.push({
      date: d.getDate(),
      isCurrentMonth: d.getMonth() === month,
      isToday:
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate(),
      timestamp: d.getTime(),
    });
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

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
