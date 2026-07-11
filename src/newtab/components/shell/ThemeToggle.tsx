// ThemeToggle.tsx — テーマ(light/dark/auto)切替(SPEC.md §4.8)
// RadixのSelectは独自のポップオーバー実装(ボタン+portal)でネイティブ<select>では
// ないため、E2Eの操作もselectOption()からクリックベースへ変更が必要(既知の副作用。
// shortcuts-theme-calendar.spec.ts側で対応済み)。
import { Flex, Select } from "@radix-ui/themes";
import type { Settings } from "../../../types";

type Props = {
  theme: Settings["theme"];
  onThemeChange: (theme: Settings["theme"]) => void;
};

export function ThemeToggle({ theme, onThemeChange }: Props) {
  return (
    <Flex title="配色テーマ(ライト/ダーク/自動)を切り替える" gap="2" align="center" asChild>
      <label>
        🌗
        <Select.Root
          value={theme}
          onValueChange={(value) => onThemeChange(value as Settings["theme"])}
        >
          <Select.Trigger aria-label="テーマ" data-testid="theme-select" />
          <Select.Content>
            <Select.Item value="light">ライト</Select.Item>
            <Select.Item value="dark">ダーク</Select.Item>
            <Select.Item value="auto">自動</Select.Item>
          </Select.Content>
        </Select.Root>
      </label>
    </Flex>
  );
}
