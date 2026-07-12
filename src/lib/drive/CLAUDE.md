# src/lib/drive/ — フォルダ固有の知見

## Google Drive のノートミラーは2系統(役割が別物)

1. **per-note active ミラー**(`driveSync.ts` + `useDriveSync.ts` + `drive.ts`)
   各ペインが自分のノートを debounce して Drive の **`app/New Tab Board/active/`** フォルダへ
   1ノート=1ファイル(`<title>.md`)で上げる。ペインの「同期済」バッジはこれ。
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
- **日付フォルダにも格納**: 同じ effect が **`app/New Tab Board/YY/MM/DD/`**(2桁年・ゼロ埋め。
  例 `26/07/13`)へその日のコピーを入れる(NASの日付フォルダと同様)。

## appProperties で active と 日付 のファイルを区別する

同じ `noteId` でも「active フォルダのファイル」と「日付フォルダのファイル」が両方できるため、
`appProperties.ntbKind`(`"active"` / `"date:26/07/13"`)で区別する。`findFileForNote` は
第4引数 `kind` で絞り込める。`resolveFolderPath` はセッション内でフォルダIDをキャッシュする
(`resetDriveFolderCacheForTests` で解除)。

## Drive未接続(トークン無し)なら静かに何もしない

`getAuthToken(false)`(非対話)が null を返す=未接続。App の突合 effect も per-note 同期も、
未接続なら黙って終わる(日常編集でOAuthポップアップを出さない)。テストは全ての fetch/
folder/upload/delete を DI で差し替えて実APIを叩かない。
