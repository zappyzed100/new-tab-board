# src/lib/drive/ — フォルダ固有の知見

## Google Drive のノートミラーは2系統(役割が別物)

1. **per-note active ミラー**(`driveSync.ts` + `useDriveSync.ts` + `drive.ts`)
   各ペインが自分のノートを debounce して Drive の **`app/New Tab Board/active/`** フォルダへ
   1ノート=1ファイル(**`<id>.md`**・Markdown+front matter)で上げる。ペインの「同期済」バッジはこれ。
   ファイル名とファイル内容(front matter付き md)は NAS の `active/<id>.md` と完全一致(2026-07-13)。
2. **全データJSONバックアップ**(`jsonBackup*.ts` + `useJsonBackupSync.ts`)
   ブックマーク/ノート/設定/TODO を1つのJSONにして上げる(データ管理の「☁️ Driveへ退避/復元」)。

この2つは別物。「退避/復元」ボタン=②、ペインの同期=①。

## active/ ミラーの3つの約束(ユーザー指示・2026-07-13)

- **空ノートは上げない**: `syncNoteToDrive` は本文が空白のみなら `skipped-empty` で即返す
  (アップロードしない)。`useDriveSync` はこれを idle(バッジ無し)に落とす。
- **編集中のファイル一覧を反映(消えたら消す)**: `driveActiveMirror.ts` の
  `reconcileDriveActive` が App の debounce effect から走り、active/ を列挙して**現在の非空ノートに
  無いファイル(=ブラウザで削除された/空になった)を削除**する。per-note 側は削除を担当しない
  ——削除は必ず board 側の突合で行う(ペインが unmount した削除ノートは per-note 経由では消せない)。
  `reconcileDriveActive` は**active/ の削除だけ**を行う(日付フォルダには触れない)。
- **日付フォルダは日次ジョブで格納**: `copyNotesToDriveDateFolder(notes, dayMs, token)` が
  **`app/New Tab Board/YYYY/M/D/`**(4桁年・非ゼロ埋め。例 `2026/7/13`)へコピー(`<id>.md`)を入れる。
  **NASの日付フォルダと完全一致**。呼ぶのは `background.ts` の `runDailyMaintenance`(一日一回・
  **前日**分・ユーザー指示: Drive日付フォルダは一日一回0:30くらいに前日データ)——App の編集
  effect からは呼ばない。同じジョブが NAS の SQLite 索引(`rebuild-index`)も日次で再生成する。

## appProperties で active と 日付 のファイルを区別する

同じ `noteId` でも「active フォルダのファイル」と「日付フォルダのファイル」が両方できるため、
`appProperties.ntbKind`(`"active"` / `"date:2026/7/13"`)で区別する。`findFileForNote` は
第4引数 `kind` で絞り込める。`resolveFolderPath` はセッション内でフォルダIDをキャッシュする
(`resetDriveFolderCacheForTests` で解除)。

## Drive未接続(トークン無し)なら静かに何もしない

`getAuthToken(false)`(非対話)が null を返す=未接続。App の突合 effect も per-note 同期も、
未接続なら黙って終わる(日常編集でOAuthポップアップを出さない)。テストは全ての fetch/
folder/upload/delete を DI で差し替えて実APIを叩かない。
