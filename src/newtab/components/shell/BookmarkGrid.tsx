// BookmarkGrid.tsx — ブックマークグリッド(SPEC.md §3・§4.1)
// 数字キー1-9でのジャンプはApp.tsxのshortcuts.ts単一レジストリ側に統合済み(SPEC.md §4.6)。
import { useState } from "react";
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
    <div data-testid="bookmark-grid">
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
            <>
              <button
                type="button"
                data-testid={`bookmark-open-${bookmark.id}`}
                title={`${bookmark.label}を開く(${bookmark.url})`}
                onClick={() => openBookmark(bookmark)}
              >
                <BookmarkIcon bookmark={bookmark} />
              </button>
              <span data-testid={`bookmark-label-${bookmark.id}`}>{bookmark.label}</span>
              <div className="bookmark-actions">
                <button
                  type="button"
                  data-testid={`bookmark-edit-${bookmark.id}`}
                  title="このブックマークを編集する"
                  onClick={() => setEditingId(bookmark.id)}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  data-testid={`bookmark-remove-${bookmark.id}`}
                  title="このブックマークを削除する"
                  onClick={() => onChange(removeBookmark(bookmarks, bookmark.id))}
                >
                  🗑️
                </button>
              </div>
            </>
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
        <div className="bookmark-cell-add">
          <button
            type="button"
            data-testid="bookmark-add"
            title="新しいブックマークを追加する"
            onClick={() => setAdding(true)}
          >
            +
          </button>
          <span>サイトを追加</span>
        </div>
      )}
    </div>
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
      <input
        aria-label="URL"
        data-testid={`${testIdBase}-url`}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <input
        aria-label="名称"
        data-testid={`${testIdBase}-label`}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        aria-label="エイリアス"
        data-testid={`${testIdBase}-alias`}
        value={alias}
        onChange={(e) => setAlias(e.target.value)}
      />
      <button type="submit" data-testid={`${testIdBase}-save`}>
        保存
      </button>
      <button type="button" data-testid={`${testIdBase}-cancel`} onClick={onCancel}>
        キャンセル
      </button>
    </form>
  );
}
