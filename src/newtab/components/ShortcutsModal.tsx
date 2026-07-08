// ShortcutsModal.tsx — `?`キーで開くショートカット一覧モーダル(SPEC.md §4.6。単一レジストリ駆動)
import { comboLabel, type ShortcutDef } from "../../lib/shortcuts";

type Props = {
  registry: ShortcutDef[];
  onClose: () => void;
};

export function ShortcutsModal({ registry, onClose }: Props) {
  return (
    <div data-testid="shortcuts-modal" role="dialog">
      <button type="button" data-testid="shortcuts-modal-close" onClick={onClose}>
        閉じる
      </button>
      <ul>
        {registry.map((def) => (
          <li key={def.id} data-testid={`shortcut-entry-${def.id}`}>
            <span>{comboLabel(def.combo)}</span> — <span>{def.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
