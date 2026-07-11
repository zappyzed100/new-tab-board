// BookmarkGrid.tsx — ブックマークグリッド(SPEC.md §3・§4.1)
// 数字キー1-9でのジャンプはApp.tsxのshortcuts.ts単一レジストリ側に統合済み(SPEC.md §4.6)。
// D&D並べ替えは自前のHTML5 native drag-and-dropロジック(Radixに代替が無いため温存)。
import { useState } from "react";
import { Button, Flex, Grid, IconButton, Text, TextField } from "@radix-ui/themes";
import {
  addBookmark,
  createBookmark,
  removeBookmark,
  reorderBookmarks,
  sortedBookmarks,
  updateBookmark,
} from "../../../lib/entities/bookmarks";
import type { Bookmark } from "../../../types";

type Props = {
  bookmarks: Bookmark[];
  openIn: "same" | "new";
  onBookmarksChange: (bookmarks: Bookmark[]) => void;
};

export function BookmarkGrid({ bookmarks, openIn, onBookmarksChange: onChange }: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const sorted = sortedBookmarks(bookmarks);

  function openBookmark(bookmark: Bookmark) {
    if (openIn === "new") {
      window.open(bookmark.url, "_blank");
    } else {
      window.location.href = bookmark.url;
    }
  }

  function handleDrop(toIndex: number) {
    if (dragIndex !== null && dragIndex !== toIndex) {
      onChange(reorderBookmarks(bookmarks, dragIndex, toIndex));
    }
    setDragIndex(null);
  }

  return (
    <Grid data-testid="bookmark-grid" columns="repeat(auto-fill, 64px)" gap="2">
      {sorted.map((bookmark, index) => (
        <div
          key={bookmark.id}
          draggable
          data-testid={`bookmark-cell-${bookmark.id}`}
          onDragStart={() => setDragIndex(index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(index)}
        >
          {editingId === bookmark.id ? (
            <BookmarkEditForm
              bookmark={bookmark}
              onSave={(patch) => {
                onChange(updateBookmark(bookmarks, bookmark.id, patch));
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <Flex direction="column" align="center" gap="1">
              <IconButton
                type="button"
                variant="soft"
                data-testid={`bookmark-open-${bookmark.id}`}
                title={`${bookmark.label}を開く(${bookmark.url})`}
                onClick={() => openBookmark(bookmark)}
              >
                <BookmarkIcon bookmark={bookmark} />
              </IconButton>
              <Text as="span" size="1" data-testid={`bookmark-label-${bookmark.id}`}>
                {bookmark.label}
              </Text>
              <Flex className="bookmark-actions" gap="1">
                <IconButton
                  type="button"
                  variant="ghost"
                  size="1"
                  data-testid={`bookmark-edit-${bookmark.id}`}
                  title="このブックマークを編集する"
                  onClick={() => setEditingId(bookmark.id)}
                >
                  ✏️
                </IconButton>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="1"
                  color="red"
                  data-testid={`bookmark-remove-${bookmark.id}`}
                  title="このブックマークを削除する"
                  onClick={() => onChange(removeBookmark(bookmarks, bookmark.id))}
                >
                  🗑️
                </IconButton>
              </Flex>
            </Flex>
          )}
        </div>
      ))}

      {adding ? (
        <BookmarkEditForm
          onSave={({ url, label, alias }) => {
            if (!url || !label) return;
            onChange(addBookmark(bookmarks, createBookmark(url, label, sorted.length, alias)));
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Flex direction="column" align="center" gap="1" className="bookmark-cell-add">
          <IconButton
            type="button"
            variant="soft"
            data-testid="bookmark-add"
            title="新しいブックマークを追加する"
            onClick={() => setAdding(true)}
          >
            +
          </IconButton>
          <Text as="span" size="1">
            サイトを追加
          </Text>
        </Flex>
      )}
    </Grid>
  );
}

function BookmarkIcon({ bookmark }: { bookmark: Bookmark }) {
  if (bookmark.icon.type === "emoji" && bookmark.icon.value) {
    return <span aria-hidden>{bookmark.icon.value}</span>;
  }
  if (bookmark.icon.type === "image" && bookmark.icon.value) {
    return <img src={bookmark.icon.value} alt="" width={24} height={24} />;
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${safeHostname(bookmark.url)}&sz=32`}
      alt=""
      width={24}
      height={24}
    />
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function BookmarkEditForm({
  bookmark,
  onSave,
  onCancel,
}: {
  bookmark?: Bookmark;
  onSave: (patch: { url: string; label: string; alias?: string }) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(bookmark?.url ?? "");
  const [label, setLabel] = useState(bookmark?.label ?? "");
  const [alias, setAlias] = useState(bookmark?.alias ?? "");
  const testIdBase = bookmark ? `bookmark-edit-form-${bookmark.id}` : "bookmark-add-form";

  return (
    <form
      data-testid={testIdBase}
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ url, label, alias: alias || undefined });
      }}
    >
      <Flex direction="column" gap="1">
        <TextField.Root
          aria-label="URL"
          data-testid={`${testIdBase}-url`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <TextField.Root
          aria-label="名称"
          data-testid={`${testIdBase}-label`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <TextField.Root
          aria-label="エイリアス"
          data-testid={`${testIdBase}-alias`}
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
        />
        <Flex gap="1">
          <Button type="submit" variant="solid" data-testid={`${testIdBase}-save`}>
            保存
          </Button>
          <Button
            type="button"
            variant="soft"
            data-testid={`${testIdBase}-cancel`}
            onClick={onCancel}
          >
            キャンセル
          </Button>
        </Flex>
      </Flex>
    </form>
  );
}
