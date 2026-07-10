// ThemeToggle.tsx — テーマ(light/dark/auto)切替(SPEC.md §4.8)
import type { Settings } from "../../../types";

type Props = {
  theme: Settings["theme"];
  onThemeChange: (theme: Settings["theme"]) => void;
};

export function ThemeToggle({ theme, onThemeChange }: Props) {
  return (
    <select
      aria-label="テーマ"
      data-testid="theme-select"
      value={theme}
      onChange={(e) => onThemeChange(e.target.value as Settings["theme"])}
    >
      <option value="light">ライト</option>
      <option value="dark">ダーク</option>
      <option value="auto">自動</option>
    </select>
  );
}
