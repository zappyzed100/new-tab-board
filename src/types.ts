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
  /** ⭐スター(スペシャルへ保管)。ノートがボードにある間、スペシャル一覧に追従表示される
   * (ユーザー指示)。ノートを削除すると凍結され SpecialItem として残る。 */
  special?: boolean;
  /** スペシャル内のフォルダパス(例: "仕事/2026")。未設定はルート。NAS/Driveの special/<folder>/ に対応。 */
  specialFolder?: string;
};

/** スペシャル(⭐)の凍結項目。元ノートが削除された時点の内容のスナップショット(ユーザー指示:
 * 「ノートがある間は追従・削除で凍結」)。ノートがまだある間はNote(special=true)側で表示し、
 * 削除された分だけこの配列に凍結して残す。id は元ノートのidを引き継ぐ。 */
export type SpecialItem = {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  folder?: string;
  createdAt?: number;
  updatedAt?: number;
  /** ノート削除で凍結された時刻(epoch ms)。 */
  frozenAt: number;
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
  /** 日次メンテ(Drive日付フォルダ格納 + SQLite再生成)を最後に実行した日 "YYYY/M/D"。
   * 同じ日には二重実行しないためのガード(background.ts の runDailyMaintenance)。 */
  lastDailyMaintenanceDay?: string;
  /** タブ↔NAS active の世代同期で、このタブが最後に同期した世代番号(ユーザー指示)。
   * NASの現在世代がこれより大きければ他セッションが新しい→pull。永続化して再読込後も比較できる。 */
  nasGeneration?: number;
  /** Drive版の世代カウンタ(nasGenerationと対。ユーザー指示: NAS/Driveどちらかへの接続が
   * 失敗しても、接続できた方の世代だけを進めることで抜けの無い情報受け渡しの土台にする)。
   * 現状はpull経路が無く単調増加を記録するだけ(将来のマルチデバイス対応に備えた布石)。 */
  driveGeneration?: number;
  /** スペシャル(⭐)の凍結項目(削除されたスター済みノートのスナップショット)。 */
  specialItems?: SpecialItem[];
  /** スペシャルのフォルダ一覧(パス文字列。例: ["仕事", "仕事/2026"])。 */
  specialFolders?: string[];
  /** NASへ最後に保存した各ノートの保存フィンガープリント(id→ハッシュ)。同じなら再保存しない
   * (ユーザー指示: ハッシュで保存済みか判定して無駄な再保存を避ける)。再読込後も比較できるよう永続化。 */
  nasSavedHashes?: Record<string, string>;
  /** Driveのactiveへ最後に保存した各ノートの保存フィンガープリント(id→ハッシュ)。
   * nasSavedHashesのDrive版(「Driveへ退避」の即時push専用。ユーザー指示: 変更が
   * 無いノートは送るな・ハッシュで確認しろ)。定期同期(useDriveSyncの5分debounce)は
   * このハッシュを見ない(既存の挙動を変えない)。 */
  driveActiveSavedHashes?: Record<string, string>;
  /** 予定前アラームを最後にスケジュール/発火させた対象イベントの startsAt。次のポーリング
   * (15分毎)でも同じ予定であれば再スケジュールしない——alarmTimeが既に過去だと
   * resolveAlarmTimeがnowへ丸めるため、対策が無いとポーリングのたびに何度も鳴っていた
   * (2026-07-16 是正)。予定が変わる/無くなれば undefined に戻す。 */
  preEventAlarmFor?: number;
  /** スマホのバッテリー低下警告(GAS Web App中継。gas/README.md参照)が現在鳴動中か。
   * 予定前アラームとオフスクリーンのループ音声を共用するため、どちらの「停止」でも
   * もう片方が鳴っていれば音声は止めない(background.tsのfireAlarm/stopAlarm参照)。 */
  batteryAlarmActive?: boolean;
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
