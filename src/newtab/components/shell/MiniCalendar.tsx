// MiniCalendar.tsx — 小型カレンダー(react-day-picker + GCal URL連携。SPEC.md §4.9)
// カレンダーのデータは拡張に取り込まない。日クリックはGoogleカレンダーへのURL遷移のみ(一方向)。
// 月グリッド自体の描画だけをreact-day-picker(OSS)に任せ、前月/翌月ボタン・月ラベルは
// 完全に自前のコンパクトな1行Flexで組む(hideNavigation+MonthCaption無効化でDayPicker
// 組み込みのNav/Captionを消す)。componentsでNav/Captionだけ差し替える方式は、
// DayPicker既定のNavがposition:absoluteで右端に固定される挙動と噛み合わず、
// 見出しとボタンが重なる/離れすぎるレイアウト崩れを起こしたため採用しない。
import { useState } from "react";
import { Button, Card, Flex, Text } from "@radix-ui/themes";
import { DayPicker } from "react-day-picker";
import { ja } from "react-day-picker/locale";
import "react-day-picker/style.css";
import { buildGCalMonthUrl, buildGCalUrl } from "../../../lib/display/calendarMonth";
import { now } from "../../../lib/runtime/clock";

export function MiniCalendar() {
  const today = new Date(now());
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  function goPrevMonth() {
    setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
  }

  function goNextMonth() {
    setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1));
  }

  function openGCalDay(day: Date) {
    window.open(buildGCalUrl(day.getTime()), "_blank", "noopener,noreferrer");
  }

  return (
    <Card
      data-testid="mini-calendar"
      title="日付をクリックするとGoogleカレンダーのその日を新しいタブで開きます"
    >
      <Flex align="center" justify="between" gap="1" mb="1">
        <Button
          type="button"
          variant="soft"
          size="1"
          data-testid="calendar-prev-month"
          title="前の月を表示する"
          onClick={goPrevMonth}
        >
          ←
        </Button>
        <Text asChild size="1" weight="bold">
          <a
            data-testid="calendar-month-label"
            href={buildGCalMonthUrl(month.getFullYear(), month.getMonth())}
            target="_blank"
            rel="noopener noreferrer"
            title="Googleカレンダーでこの月を開く"
          >
            {month.getFullYear()}年{month.getMonth() + 1}月
          </a>
        </Text>
        <Button
          type="button"
          variant="soft"
          size="1"
          data-testid="calendar-next-month"
          title="次の月を表示する"
          onClick={goNextMonth}
        >
          →
        </Button>
      </Flex>
      <DayPicker
        month={month}
        onMonthChange={setMonth}
        hideNavigation
        showOutsideDays
        locale={ja}
        today={today}
        onDayClick={openGCalDay}
        components={{
          // hideNavigationはNavボタンのみを隠す仕様で、月キャプション自体は消えない
          // ため、自前のヘッダー行と二重表示にならないようこちらも明示的に消す。
          MonthCaption: () => <></>,
        }}
      />
    </Card>
  );
}
