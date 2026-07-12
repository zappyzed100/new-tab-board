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
  /** 全データJSONバックアップ(jsonBackup.ts)のDrive上のファイルID。一度作成した後は
   * 同じファイルへ上書きし続けるためのキャッシュ(chrome.storage.syncに乗るため複数端末で共有される)。 */
  jsonBackupFileId?: string;
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

/** ノート本文とは独立したシンプルなTODOリスト(TodoMVC相当。ノートのチェックボックス
 * 横断集約とは別物——ユーザーフィードバックにより横断集約は撤去し単体リストへ差し替え)。 */
export type Todo = {
  id: string;
  text: string;
  done: boolean;
  order: number;
};

export type LocalData = {
  notes: Note[];
  todos?: Todo[];
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
  /** 履歴一覧で本文を展開せずに中身を判別するための一文サマリ(変更箇所 or 本文の最初)。
   * このフィールド追加前の既存スナップショットではundefined(一覧では非表示)。 */
  summary?: string;
};

export type IndexEntry = {
  token: string;
  refs: string[];
};
