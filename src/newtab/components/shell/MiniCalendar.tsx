// MiniCalendar.tsx — 小型カレンダー(react-day-picker + GCal URL連携。SPEC.md §4.9)
// カレンダーのデータは拡張に取り込まない。日クリックはGoogleカレンダーへのURL遷移のみ(一方向)。
// 月グリッド自体はreact-day-picker(OSS)に委譲し、前月/翌月ボタン・月ラベルはRadix見た目+
// 既存のtestidを保つため、componentsオーバーライドでDayPicker組み込みのNav/Captionを
// 差し替えている(単純にhideNavigationで隠して自前ラベルを別途置くと見出しが二重に出るため)。
import { useState } from "react";
import { Button, Card, Text } from "@radix-ui/themes";
import { DayPicker } from "react-day-picker";
import { ja } from "react-day-picker/locale";
import "react-day-picker/style.css";
import { buildGCalUrl } from "../../../lib/display/calendarMonth";
import { now } from "../../../lib/runtime/clock";

export function MiniCalendar() {
  const today = new Date(now());
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  function openGCalDay(day: Date) {
    window.open(buildGCalUrl(day.getTime()), "_blank", "noopener,noreferrer");
  }

  return (
    <Card
      data-testid="mini-calendar"
      title="日付をクリックするとGoogleカレンダーのその日を新しいタブで開きます"
    >
      <DayPicker
        month={month}
        onMonthChange={setMonth}
        showOutsideDays
        locale={ja}
        today={today}
        onDayClick={openGCalDay}
        components={{
          // DayPickerが渡すpropsをそのままspreadすると(childrenやcolorなど)
          // Radixコンポーネントの型と衝突するため、必要なもの(クリックハンドラ等)
          // だけを明示的に取り出す。
          PreviousMonthButton: ({ onClick, disabled }) => (
            <Button
              type="button"
              variant="soft"
              data-testid="calendar-prev-month"
              title="前の月を表示する"
              onClick={onClick}
              disabled={disabled}
            >
              ← 前月
            </Button>
          ),
          NextMonthButton: ({ onClick, disabled }) => (
            <Button
              type="button"
              variant="soft"
              data-testid="calendar-next-month"
              title="次の月を表示する"
              onClick={onClick}
              disabled={disabled}
            >
              翌月 →
            </Button>
          ),
          CaptionLabel: () => (
            <Text as="span" weight="bold" data-testid="calendar-month-label">
              {month.getFullYear()}年{month.getMonth() + 1}月
            </Text>
          ),
        }}
      />
    </Card>
  );
}
