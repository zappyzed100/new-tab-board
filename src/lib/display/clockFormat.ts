// clockFormat.ts — 時計/日付表示用のフォーマット(純関数。SPEC.md §4.8)
export function formatClock(timestamp: number): { time: string; date: string } {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}(${weekday})`;
  return { time, date };
}
