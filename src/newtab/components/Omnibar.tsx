// Omnibar.tsx — クイック検索バー(ブックマーク/アプリ起動/検索エンジンの順で解決。SPEC.md §4.4)
import { useState, type FormEvent } from "react";
import { resolveOmnibarQuery } from "../../lib/omnibar";
import type { AppLaunch, Bookmark, Settings } from "../../types";

type Props = {
  bookmarks: Bookmark[];
  appLaunches: AppLaunch[];
  settings: Settings;
};

export function Omnibar({ bookmarks, appLaunches, settings }: Props) {
  const [query, setQuery] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;
    const result = resolveOmnibarQuery(query, bookmarks, appLaunches, settings);
    if (result.type === "bookmark" && result.openIn === "new") {
      window.open(result.url, "_blank", "noopener");
    } else {
      window.location.href = result.url;
    }
    setQuery("");
  }

  return (
    <form data-testid="omnibar-form" onSubmit={handleSubmit}>
      <input
        type="text"
        data-testid="omnibar-input"
        placeholder="サイト名・アプリ・検索語を入力"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </form>
  );
}
