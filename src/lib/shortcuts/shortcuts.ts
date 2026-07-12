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
    id: "toggleSearch",
    combo: { key: "f", ctrlOrMeta: true },
    description: "全文検索欄にフォーカス",
  },
  {
    id: "immediateSnapshot",
    combo: { key: "s", ctrlOrMeta: true },
    description: "今すぐスナップショット保存",
  },
  { id: "cheatSheet", combo: { key: "?" }, description: "ショートカット一覧を表示" },
];

// エディタ内(CM6)のテキスト編集ショートカット(SPEC.md §4.6の対象外)。
// useGlobalShortcuts.tsのwindowキー監視ではなく、Notepad.tsxのCM6キーマップとして
// 直接バインドされている(エディタにフォーカスがある時だけ効く)。matchesComboの対象外の
// 単なる表示用データ——チートシートに載せるため、Notepad.tsxのキーマップと2箇所を
// 同時に更新すること。VSCode等でよく使われる操作のうち代表的なものを収録。
export type EditorShortcut = { keys: string; description: string };

export const EDITOR_SHORTCUTS: EditorShortcut[] = [
  { keys: "Cmd/Ctrl+Z", description: "元に戻す(undo)" },
  { keys: "Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y", description: "やり直す(redo)" },
  { keys: "Cmd/Ctrl+A", description: "全選択" },
  { keys: "Cmd/Ctrl+X / C / V", description: "切り取り / コピー / 貼り付け" },
  { keys: "Tab / Shift+Tab", description: "インデント / インデント解除" },
  { keys: "Cmd/Ctrl+Backspace / Delete", description: "単語単位で削除" },
  { keys: "Home / End", description: "行頭 / 行末へ移動" },
  { keys: "Cmd/Ctrl+Home / End", description: "文書の先頭 / 末尾へ移動" },
  { keys: "Alt+↑ / Alt+↓", description: "行を上 / 下へ移動" },
  { keys: "Shift+Alt+↑ / Shift+Alt+↓", description: "行を上 / 下へ複製" },
  { keys: "Cmd/Ctrl+Shift+K", description: "行を削除" },
  { keys: "Cmd/Ctrl+D", description: "次の一致箇所を選択に追加(複数カーソル)" },
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
