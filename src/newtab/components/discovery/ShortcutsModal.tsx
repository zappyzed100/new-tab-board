// ShortcutsModal.tsx — `?`キーで開くショートカット一覧モーダル(SPEC.md §4.6。単一レジストリ駆動)
// Radix Dialogはoverlay(背景)要素を内部にカプセル化しており、外部からdata-testidを
// 付与するAPIが無い(dialog.jsソース確認済み)。「外側クリックで閉じる」動作自体は
// Radixが標準機能として提供するため、E2E側はoverlay要素をクラスセレクタ
// (.rt-DialogOverlay)経由で参照するよう更新する(shortcuts-theme-calendar.spec.ts)。
//
// 性質の異なるショートカット群(全般操作・ノートへのジャンプ・ブックマークを開く・
// エディタ内操作)を1つの見出し+フラットなリストへ詰め込んでいると見づらい
// (ユーザー指摘)——グループごとに独立したCardへ分けている。
import { Card, Dialog, Flex, Heading, IconButton } from "@radix-ui/themes";
import { comboLabel, EDITOR_SHORTCUTS, type ShortcutDef } from "../../../lib/shortcuts/shortcuts";

type Props = {
  registry: ShortcutDef[];
  onClose: () => void;
};

type DisplayItem = { testId: string; label: string; description: string };

function ShortcutGroupCard({ title, items }: { title: string; items: DisplayItem[] }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <Heading as="h3" size="3" className="panel-title" mb="2">
        {title}
      </Heading>
      <ul>
        {items.map((item) => (
          <li key={item.testId} data-testid={item.testId}>
            <span>{item.label}</span> — <span>{item.description}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ShortcutsModal({ registry, onClose }: Props) {
  const general = registry.filter(
    (d) => !d.id.startsWith("noteJump-") && !d.id.startsWith("bookmarkJump-"),
  );
  const noteJumps = registry.filter((d) => d.id.startsWith("noteJump-"));
  const bookmarkJumps = registry.filter((d) => d.id.startsWith("bookmarkJump-"));

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
        <Flex direction="column" gap="3">
          <ShortcutGroupCard
            title="全般"
            items={general.map((d) => ({
              testId: `shortcut-entry-${d.id}`,
              label: comboLabel(d.combo),
              description: d.description,
            }))}
          />
          <ShortcutGroupCard
            title="ノートへジャンプ"
            items={noteJumps.map((d) => ({
              testId: `shortcut-entry-${d.id}`,
              label: comboLabel(d.combo),
              description: d.description,
            }))}
          />
          <ShortcutGroupCard
            title="ブックマークを開く"
            items={bookmarkJumps.map((d) => ({
              testId: `shortcut-entry-${d.id}`,
              label: comboLabel(d.combo),
              description: d.description,
            }))}
          />
          <ShortcutGroupCard
            title="ノート編集中(テキストエディタ)"
            items={EDITOR_SHORTCUTS.map((s, i) => ({
              testId: `editor-shortcut-${i}`,
              label: s.keys,
              description: s.description,
            }))}
          />
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
