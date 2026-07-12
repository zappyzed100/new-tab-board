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
  /** ノート本文(エディタ)の文字サイズ(px)。A-/A+で一括調整する(ユーザー指示)。
   * 未設定なら既定13px。ノート以外のUI文字には影響しない。 */
  noteFontSize?: number;
  /** タグ候補(ユーザーが手で並べる語彙)。LLMのタグ推定時に「優先的に選ぶ候補」として渡す
   * (ユーザー指示)。TODOリストの下で管理する。syncに乗り・Driveバックアップにも含まれる。 */
  tagCandidates?: string[];
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
  /** Geminiが付けたタグ(自動タグ付け機能)。 */
  tags?: string[];
  /** 最後にタグを付けた時点の本文のハッシュ。現在の本文のハッシュと一致すれば
   * 「タグ付け以降に変更なし」なので再タグ付けをスキップする(ユーザー指示)。 */
  taggedHash?: string;
  /** Geminiがタグ付け時に「ゴミ(無意味・落書き)」と判定したノート。NASアーカイブから除外する
   * (ユーザー指示)。判定が曖昧な場合はfalse(=NASに残す。データを誤って捨てない)。 */
  junk?: boolean;
  /** 作成時刻(epoch ms)。NASの.md front matterのcreated_atに出す。既存ノートはundefined。 */
  createdAt?: number;
  /** 最終更新時刻(epoch ms)。本文編集時に更新。front matterのupdated_atに出す。 */
  updatedAt?: number;
  /** AI要約ノートの場合の元ノートID(front matterのsource_note_id)。 */
  sourceNoteId?: string;
  /** AI生成ノートの生成元(front matterのgenerated_by。例: "gemini")。 */
  generatedBy?: string;
  /** 「対応済み」チェック(ユーザー指示。名称なしのcheckボタンでノートを済み扱いにする)。
   * 済みのノートはボード上で淡色表示になる(削除はしない——見返せるよう残す)。 */
  done?: boolean;
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
