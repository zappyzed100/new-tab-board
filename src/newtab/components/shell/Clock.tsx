// Clock.tsx — 時計・日付表示(SPEC.md §4.8)
import { useEffect, useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { formatClock } from "../../../lib/display/clockFormat";
import { msUntilNextInterval, now } from "../../../lib/runtime/clock";

export function Clock() {
  const [ts, setTs] = useState(() => now());

  useEffect(() => {
    // setInterval(fn, 60000)は実行の遅延やバックグラウンドタブでのスロットリングで
    // 少しずつズレが蓄積し、表示の更新が飛んだり止まって見えたりする実害があった。
    // 毎回「次の分の境界」までの残り時間を実時刻から再計算して setTimeout し直す
    // ことで、遅延が起きても次回のスケジュールが自己補正される。
    let timeoutId: ReturnType<typeof setTimeout>;
    function tick() {
      setTs(now());
      timeoutId = setTimeout(tick, msUntilNextInterval(now(), 60000));
    }
    tick();
    return () => clearTimeout(timeoutId);
  }, []);

  const { time, date } = formatClock(ts);

  return (
    <Flex direction="column" data-testid="clock">
      <Text data-testid="clock-time" size="6" weight="bold">
        {time}
      </Text>
      <Text data-testid="clock-date" size="2" color="gray">
        {date}
      </Text>
    </Flex>
  );
}
