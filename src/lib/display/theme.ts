// theme.ts — テーマ設定(light/dark/auto)の解決(純関数。SPEC.md §4.8)
import type { Settings } from "../../types";

/** "auto"はOS/ブラウザのprefers-color-schemeで解決し、それ以外は設定値をそのまま使う。 */
export function resolveTheme(theme: Settings["theme"], prefersDark: boolean): "light" | "dark" {
  if (theme === "auto") return prefersDark ? "dark" : "light";
  return theme;
}
