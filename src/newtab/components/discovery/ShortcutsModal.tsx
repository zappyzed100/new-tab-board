// ShortcutsModal.tsx — `?`キーで開くショートカット一覧モーダル(SPEC.md §4.6。単一レジストリ駆動)
// Radix Dialogはoverlay(背景)要素を内部にカプセル化しており、外部からdata-testidを
// 付与するAPIが無い(dialog.jsソース確認済み)。「外側クリックで閉じる」動作自体は
// Radixが標準機能として提供するため、E2E側はoverlay要素をクラスセレクタ
// (.rt-DialogOverlay)経由で参照するよう更新する(shortcuts-theme-calendar.spec.ts)。
import { Dialog, Heading, IconButton } from "@radix-ui/themes";
import { comboLabel, EDITOR_SHORTCUTS, type ShortcutDef } from "../../../lib/shortcuts/shortcuts";

type Props = {
  registry: ShortcutDef[];
  onClose: () => void;
};

export function ShortcutsModal({ registry, onClose }: Props) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content data-testid="shortcuts-modal">
        <Dialog.Title>⌨️ キーボードショートカット一覧</Dialog.Title>
        <IconButton
          type="button"
          data-testid="shortcuts-modal-close"
          className="modal-close-circle"
          variant="ghost"
          title="閉じる"
          onClick={onClose}
        >
          ×
        </IconButton>
        <Heading as="h3" size="3" className="panel-title">
          アプリ全体
        </Heading>
        <ul>
          {registry.map((def) => (
            <li key={def.id} data-testid={`shortcut-entry-${def.id}`}>
              <span>{comboLabel(def.combo)}</span> — <span>{def.description}</span>
            </li>
          ))}
        </ul>
        <Heading as="h3" size="3" className="panel-title">
          ノート編集中(テキストエディタ)
        </Heading>
        <ul>
          {EDITOR_SHORTCUTS.map((s, i) => (
            <li key={s.keys} data-testid={`editor-shortcut-${i}`}>
              <span>{s.keys}</span> — <span>{s.description}</span>
            </li>
          ))}
        </ul>
      </Dialog.Content>
    </Dialog.Root>
  );
}
