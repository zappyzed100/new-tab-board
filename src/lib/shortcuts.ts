// shortcuts.ts — キーボードショートカットの単一レジストリ(SPEC.md §4.6・§6)
//
// ここで定義したShortcutDef[]が実際のキーバインド(useGlobalShortcuts.ts)と
// `?`のチートシートモーダル(ShortcutsModal.tsx)の両方の唯一の情報源になる。
// バインドを1箇所追加すればチートシートは自動で追随する。
export type ShortcutCombo = {
  key: string;
  /** trueならCtrl(Windows/Linux)またはMeta(Mac)のどちらかが押されていることを要求する */
  ctrlOrMeta?: boolean;
  shift?: boolean;
};

export type ShortcutDef = {
  id: string;
  combo: ShortcutCombo;
  description: string;
};

export const SHORTCUT_REGISTRY: ShortcutDef[] = [
  {
    id: "commandPalette",
    combo: { key: "k", ctrlOrMeta: true },
    description: "コマンドパレットを開く",
  },
  {
    id: "toggleSearch",
    combo: { key: "f", ctrlOrMeta: true },
    description: "全文検索を開く/閉じる",
  },
  {
    id: "immediateSnapshot",
    combo: { key: "s", ctrlOrMeta: true },
    description: "今すぐスナップショット保存",
  },
  { id: "cheatSheet", combo: { key: "?" }, description: "ショートカット一覧を表示" },
];

type MinimalKeyboardEvent = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

/** キー入力イベントが指定のコンボに一致するかを判定する(純関数。DOM非依存)。 */
export function matchesCombo(combo: ShortcutCombo, event: MinimalKeyboardEvent): boolean {
  if (event.key.toLowerCase() !== combo.key.toLowerCase()) return false;
  const modPressed = event.ctrlKey || event.metaKey;
  if (combo.ctrlOrMeta && !modPressed) return false;
  if (!combo.ctrlOrMeta && modPressed) return false;
  if (combo.shift && !event.shiftKey) return false;
  return true;
}

/** ノート切替(Cmd/Ctrl+1..9)のショートカット定義を件数に応じて動的生成する。 */
export function buildNoteJumpShortcuts(noteCount: number): ShortcutDef[] {
  const count = Math.min(noteCount, 9);
  return Array.from({ length: count }, (_, i) => ({
    id: `noteJump-${i}`,
    combo: { key: String(i + 1), ctrlOrMeta: true },
    description: `${i + 1}番目のノートに切替`,
  }));
}

/** ブックマークジャンプ(1..9、エディタ非フォーカス時)のショートカット定義を動的生成する。 */
export function buildBookmarkJumpShortcuts(bookmarkCount: number): ShortcutDef[] {
  const count = Math.min(bookmarkCount, 9);
  return Array.from({ length: count }, (_, i) => ({
    id: `bookmarkJump-${i}`,
    combo: { key: String(i + 1) },
    description: `${i + 1}番目のブックマークを開く`,
  }));
}

/** コンボを人間可読な表示文字列にする(チートシート表示用)。 */
export function comboLabel(combo: ShortcutCombo): string {
  const parts: string[] = [];
  if (combo.ctrlOrMeta) parts.push("Cmd/Ctrl");
  if (combo.shift) parts.push("Shift");
  parts.push(combo.key.toUpperCase());
  return parts.join("+");
}
