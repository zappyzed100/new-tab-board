// CommandPalette.tsx — Cmd+Kのモーダル。ノート切替/ブックマーク遷移/アプリ起動の単一入口(SPEC.md §4.5)
import { useMemo, useState, type KeyboardEvent } from "react";
import { Dialog, Flex, TextField } from "@radix-ui/themes";
import {
  buildCommandItems,
  filterCommandItems,
  type CommandItem,
} from "../../../lib/shortcuts/commandPalette";
import type { AppLaunch, Bookmark, Note, Settings } from "../../../types";

type Props = {
  notes: Note[];
  bookmarks: Bookmark[];
  appLaunches: AppLaunch[];
  openIn: Settings["openIn"];
  onSelectNote: (noteId: string) => void;
  onOpenFile: () => void;
  onClose: () => void;
};

const ACTIONS = [{ id: "open-file", label: "ファイルを開く" }];

export function CommandPalette({
  notes,
  bookmarks,
  appLaunches,
  openIn,
  onSelectNote,
  onOpenFile,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const items = useMemo(
    () => buildCommandItems(notes, bookmarks, appLaunches, ACTIONS),
    [notes, bookmarks, appLaunches],
  );
  const filtered = useMemo(() => filterCommandItems(items, query), [items, query]);

  function runItem(item: CommandItem) {
    if (item.type === "note") {
      onSelectNote(item.id);
    } else if (item.type === "bookmark") {
      if (openIn === "new") window.open(item.url, "_blank", "noopener");
      else window.location.href = item.url;
    } else if (item.type === "action") {
      if (item.id === "open-file") onOpenFile();
    } else {
      window.location.href = item.url;
    }
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[activeIndex];
      if (item) runItem(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content data-testid="command-palette">
        <Dialog.Title style={{ display: "none" }}>コマンドパレット</Dialog.Title>
        <TextField.Root
          type="text"
          data-testid="command-palette-input"
          autoFocus
          placeholder="ノート・ブックマーク・アプリ起動を検索"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <ul data-testid="command-palette-list">
          {filtered.map((item, i) => (
            <li
              key={`${item.type}-${item.id}`}
              data-testid={`command-palette-item-${item.type}-${item.id}`}
            >
              <Flex asChild width="100%">
                <button
                  type="button"
                  data-testid={`command-palette-run-${item.type}-${item.id}`}
                  aria-pressed={i === activeIndex}
                  onClick={() => runItem(item)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  {item.label}
                  <span> ({item.type})</span>
                </button>
              </Flex>
            </li>
          ))}
        </ul>
      </Dialog.Content>
    </Dialog.Root>
  );
}
