// App.tsx — 新しいタブのルートコンポーネント(SPEC.md準拠の再構築中。M2以降で機能を積み上げる)
import { useEffect, useState } from "react";
import { BookmarkGrid } from "./components/BookmarkGrid";
import { loadSyncData, saveSyncData } from "../lib/storage";
import type { AppLaunch, Bookmark, Settings } from "../types";

type SyncState = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };

export function App() {
  const [sync, setSync] = useState<SyncState | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSyncData().then((data) => {
      if (!cancelled) setSync(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateBookmarks(bookmarks: Bookmark[]) {
    if (!sync) return;
    const next = { ...sync, bookmarks };
    setSync(next);
    void saveSyncData(next);
  }

  if (!sync) {
    return <div data-testid="app-loading">読み込み中…</div>;
  }

  return (
    <main data-testid="app-root">
      <BookmarkGrid
        bookmarks={sync.bookmarks}
        openIn={sync.settings.openIn}
        onBookmarksChange={updateBookmarks}
      />
    </main>
  );
}
