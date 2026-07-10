// Clock.tsx — 時計・日付表示(SPEC.md §4.8)
import { useEffect, useState } from "react";
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
    <div data-testid="clock">
      <span data-testid="clock-time">{time}</span>
      <span data-testid="clock-date">{date}</span>
    </div>
  );
}
