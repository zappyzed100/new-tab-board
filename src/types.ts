// types.ts — アプリ全体で共有するデータモデル(SPEC.md §5)
export type Bookmark = {
  id: string;
  url: string;
  label: string;
  alias?: string;
  icon: { type: "favicon" | "emoji" | "image"; value?: string };
  order: number;
};

export type AppLaunch = {
  id: string;
  alias: string;
  scheme: string;
};

export type Settings = {
  openIn: "same" | "new";
  theme: "light" | "dark" | "auto";
  searchEngine: string;
};

export type SyncData = {
  bookmarks: Bookmark[];
  appLaunches: AppLaunch[];
  settings: Settings;
};

export type Note = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  order: number;
};

export type LocalData = {
  notes: Note[];
};

export type Snapshot = {
  id: string;
  noteId: string;
  timestamp: number;
  content: string;
};

export type IndexEntry = {
  token: string;
  refs: string[];
};
