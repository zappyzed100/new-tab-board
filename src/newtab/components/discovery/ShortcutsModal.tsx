// ShortcutsModal.tsx — `?`キーで開くショートカット一覧モーダル(SPEC.md §4.6。単一レジストリ駆動)
import { comboLabel, EDITOR_SHORTCUTS, type ShortcutDef } from "../../../lib/shortcuts/shortcuts";

type Props = {
  registry: ShortcutDef[];
  onClose: () => void;
};

export function ShortcutsModal({ registry, onClose }: Props) {
  return (
    <div data-testid="shortcuts-modal" role="dialog">
      <h2 className="panel-title">⌨️ キーボードショートカット一覧</h2>
      <button type="button" data-testid="shortcuts-modal-close" onClick={onClose}>
        閉じる
      </button>
      <h3 className="panel-title">アプリ全体</h3>
      <ul>
        {registry.map((def) => (
          <li key={def.id} data-testid={`shortcut-entry-${def.id}`}>
            <span>{comboLabel(def.combo)}</span> — <span>{def.description}</span>
          </li>
        ))}
      </ul>
      <h3 className="panel-title">ノート編集中(テキストエディタ)</h3>
      <ul>
        {EDITOR_SHORTCUTS.map((s, i) => (
          <li key={s.keys} data-testid={`editor-shortcut-${i}`}>
            <span>{s.keys}</span> — <span>{s.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
