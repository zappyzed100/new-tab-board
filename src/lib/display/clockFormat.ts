// clockFormat.ts — 時計/日付表示用のフォーマット(純関数。SPEC.md §4.8)
// 秒は表示しない(分単位で十分なため撤去——Clock.tsxも分境界での更新に変更済み)。
import { format } from "date-fns";
import { ja } from "date-fns/locale";

export function formatClock(timestamp: number): { time: string; date: string } {
  const d = new Date(timestamp);
  const time = format(d, "HH:mm");
  const date = format(d, "yyyy-MM-dd'('E')'", { locale: ja });
  return { time, date };
}
