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
  driveFileId?: string;
  lastSyncedAt?: number;
};

export type LocalData = {
  notes: Note[];
  nextEventCache?: {
    title: string;
    startsAt: number;
    fetchedAt: number;
  };
  alarmActive?: boolean;
};

export type Snapshot = {
  id: string;
  noteId: string;
  timestamp: number;
  /** gzip圧縮した本文。NAS排出後はローカルから削除されundefinedになりうる(SPEC.md §4.3・§5)。 */
  content?: string;
  /** true = NAS本archiveへ排出済み(本体はNAS)。既存データ(このフィールド追加前)はfalse扱い。 */
  archived: boolean;
  /** NAS上のファイルパス(排出後のみ)。 */
  archivePath?: string;
};

export type IndexEntry = {
  token: string;
  refs: string[];
};
