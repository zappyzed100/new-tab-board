// MiniCalendar.tsx — 小型カレンダー(月グリッド+GCal URL連携。SPEC.md §4.9)
// カレンダーのデータは拡張に取り込まない。日クリックはGoogleカレンダーへのURL遷移のみ(一方向)。
// Radix Themesに月カレンダーグリッド相当のコンポーネントは無いため、<table>構造・
// 円形の日付ピル自体は自前CSSのまま温存し、周辺のボタン/ラベルのみRadix化している。
import { useState } from "react";
import { Button, Card, Flex, Text } from "@radix-ui/themes";
import { buildGCalUrl, buildMonthGrid } from "../../../lib/display/calendarMonth";
import { now } from "../../../lib/runtime/clock";

export function MiniCalendar() {
  const today = new Date(now());
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const weeks = buildMonthGrid(year, month, today);

  function goPrevMonth() {
    if (month === 0) {
      setYear(year - 1);
      setMonth(11);
    } else {
      setMonth(month - 1);
    }
  }

  function goNextMonth() {
    if (month === 11) {
      setYear(year + 1);
      setMonth(0);
    } else {
      setMonth(month + 1);
    }
  }

  return (
    <Card
      data-testid="mini-calendar"
      title="日付をクリックするとGoogleカレンダーのその日を新しいタブで開きます"
    >
      <Flex className="calendar-nav" align="center" justify="between" mb="2">
        <Button
          type="button"
          variant="soft"
          data-testid="calendar-prev-month"
          title="前の月を表示する"
          onClick={goPrevMonth}
        >
          ← 前月
        </Button>
        <Text as="span" weight="bold" data-testid="calendar-month-label">
          {year}年{month + 1}月
        </Text>
        <Button
          type="button"
          variant="soft"
          data-testid="calendar-next-month"
          title="次の月を表示する"
          onClick={goNextMonth}
        >
          翌月 →
        </Button>
      </Flex>
      <table>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((day) => (
                <td key={day.timestamp}>
                  <a
                    data-testid={`calendar-day-${day.timestamp}`}
                    href={buildGCalUrl(day.timestamp)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-current={day.isToday}
                    aria-disabled={!day.isCurrentMonth}
                  >
                    {day.date}
                  </a>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
