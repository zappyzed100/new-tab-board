// Clock.tsx — 時計・日付表示(SPEC.md §4.8)
import { useEffect, useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { formatClock } from "../../../lib/display/clockFormat";
import { now } from "../../../lib/runtime/clock";

export function Clock() {
  const [ts, setTs] = useState(() => now());

  useEffect(() => {
    const interval = setInterval(() => setTs(now()), 1000);
    return () => clearInterval(interval);
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
