# src/lib/drive/ — フォルダ固有の知見

## Google Drive のノートミラーは2系統(役割が別物)

1. **per-note active ミラー**(`driveSync.ts` + `useDriveSync.ts` + `drive.ts`)
   各ペインが自分のノートを debounce して Drive の **`app/New Tab Board/active/`** フォルダへ
   1ノート=1ファイル(中身はMarkdown+front matter)で上げる。ペインの「同期済」バッジはこれ。
   ファイル内容は NAS の `active/<タイトル> (id8桁).txt` と完全一致(2026-07-13)。**ファイル名は
   Driveのactiveフォルダに限り `<タイトル> (idの先頭8桁).txt`**(`activeFilenameFor`。ユーザー指示:
   Drive上で見て分かる名前にしたい・2026-07-16。**拡張子も同日にNAS側と合わせて.mdから.txtへ
   変更**——スマホのDriveアプリ/テキストビューアで開きやすくするため。中身の形式は無変更。
   詳細・連動箇所は`src/lib/externalIO/CLAUDE.md`参照)——NAS/日付フォルダ/specialは今までどおり
   `<id>.md` 固定(ファイル探索・突合はappProperties.noteIdで行うため、表示名を変えても
   壊れない)。タイトルが変わるたびDrive上のファイル名も追従する(`uploadNote`は既存ファイル
   の更新でも毎回nameを送り直す)。同名タイトルが複数あってもidの断片で衝突しない。
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
第4引数 `kind` で絞り込める。

## resolveFolderPath はフォルダIDをIndexedDBへ永続化する(ユーザー設計・2026-07-16)

以前はセッション内メモリキャッシュ(`folderIdCache`)しか持たず、タブを閉じて開き直す
たびに名前+親での検索(`getOrCreateFolder`)をやり直していた。複数タブ/複数セッションが
ほぼ同時に「検索→未発見→作成」を行うと、Driveが同名フォルダの重複作成を防がないため
`app`や`New Tab Board`フォルダが複製される実害があった(ユーザー報告)。

対策としてユーザーが指定した優先順位で `resolveSegment` を書き直した:
①`db.ts`の`getDriveFolderIds()`(IndexedDB永続)に保存済みのIDがあれば、名前検索すら
せずそれを使う ②無ければ名前+親フォルダで検索(`getOrCreateFolder`。検索条件は
`name=... and mimeType=... and '<parentId>' in parents and trashed=false`) ③見つかれば
`saveDriveFolderId(path, id)`で永続化 ④無ければ新規作成して同様に永続化 ⑤以後はこの
セッションはもちろん、次回以降のセッションもIDで直接アクセスし、名前検索をしない。

`folderIdCache`(メモリ)は「同じタブが動いている間」の高速パスとして残置(IndexedDB読み取り
すら省く)。`folderResolvePromiseCache`(同時呼び出しの単一化)は引き続き同一セッション内の
競合(Cmd/Ctrl+Sで全ペインがほぼ同時に呼ぶ等)を防ぐ。テストでは
`resetDriveFolderCache`(async化済み)でメモリ+永続の両方をクリアする。

**既知の残存リスク**(ユーザー確認済み・対応は現状スコープ外): 2つの別アプリ/セッションが
永続キャッシュも空の状態で完全に同時に初回起動すると、どちらも「存在しない」と判断して
2個作る競合が残る。最も確実な回避策は、最初から共通フォルダを手動で1つ作り、そのIDを
両アプリへ設定すること(現状、手動ID入力UIは無い)。

## active/のmimeTypeはtext/plain(2026-07-16是正)——.txt拡張子だけでは不十分

active/のファイル拡張子を`.md`→`.txt`へ変更した際(2026-07-16)、`uploadNote`の
`metadata.mimeType`と多重パートボディの`Content-Type`ヘッダは`text/markdown`のまま
据え置いていた(「中身は変えない」という当時の指示の解釈)。しかし実機でiPhoneの
Google Driveアプリから開くと「サポートされていないファイル形式です」になった
(ユーザー報告)——Driveアプリの内蔵ビューアはファイル名の拡張子ではなく`mimeType`
メタデータで開けるかどうかを判定するため、`.txt`にリネームしただけでは
`text/markdown`のままのファイルは開けない。

`uploadNote`に`opts.mimeType`(既定`"text/markdown"`)を追加し、`driveSync.ts`の
`syncNoteToDrive`(per-noteのactiveミラー)と`driveActiveMirror.ts`の
`pushTodosToDriveActive`(active/todos.txt)の両方が`"text/plain"`を明示するよう
修正した。日付フォルダ(`copyNotesToDriveDateFolder`)・special(`driveSpecial.ts`)は
`.md`のままなので`opts.mimeType`を渡さず既定の`text/markdown`を使う。

**新規作成(POST)だけでなく既存ファイルの更新(PATCH)でもmimeTypeを送る**——`filename`
と同じ理由(ファイル名がリネームに追従する仕組みを流用)。以前`text/markdown`で
作成済みだった既存のDriveファイルも、次回の同期(PATCH)で自動的に`text/plain`へ
是正される。Drive APIの`files.update`は非Google-native形式間のmimeType変更を許容する
(Google Docs等への変換とは別の話)。

## Drive未接続(トークン無し)なら静かに何もしない

`getAuthToken(false)`(非対話)が null を返す=未接続。App の突合 effect も per-note 同期も、
未接続なら黙って終わる(日常編集でOAuthポップアップを出さない)。テストは全ての fetch/
folder/upload/delete を DI で差し替えて実APIを叩かない。
