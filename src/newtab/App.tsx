// App.tsx — 新しいタブのルートコンポーネント(SPEC.md準拠の再構築中。M1以降で機能を積み上げる)
import { useEffect, useState } from "react";
import { loadLocalData, loadSyncData } from "../lib/storage";

export function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSyncData(), loadLocalData()]).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <div data-testid="app-loading">読み込み中…</div>;
  }

  return <main data-testid="app-root">New Tab Board</main>;
}
