# src/lib/externalIO/ — フォルダ固有の知見

## showDirectoryPicker()のChromium既知バグでNASはNative Messaging方式へ移行済み(2026-07-12)

NAS二層アーカイブ(`nasArchive.ts`)は元々`window.showDirectoryPicker()`で得た
`FileSystemDirectoryHandle`を使っていたが、Chrome拡張機能のページから呼ぶと
**ユーザーが実際にフォルダを選択してもAbortErrorで即座に失敗する**という
Chromium側の既知バグ(WICG/file-system-access#314、crbug.com/issues/40240444。
拡張機能コンテキスト特有・Chromeバージョンによって再現したりしなかったりする)が
実機で解消できず(エラーメッセージすら出ない完全な無反応だった)、ユーザー指示に
より`native-host/nas_bridge.py`(NASブリッジ・Native Messaging host。このリポジトリに
同梱)経由のパス文字列方式へ移行した。契約は
`docs/nas-native-messaging-protocol.md`、拡張側クライアントは`nasNativeHost.ts`。

`fileSystem.ts`にも元々showDirectoryPickerを使う「フォルダへ書き出し」機能が
あったが、同じ理由でボタンごと撤去した。「ファイルを開く」だけは
`<input type="file">`へ置き換え済み(この既知バグの対象は`showDirectoryPicker`の
方だけで`showOpenFilePicker`は影響を受けない)。

## NAS上はプレーンテキスト＋年/月/日フォルダ。getSnapshotBodyは圧縮base64を返す契約

NASへ書くファイルは「そのままエディタで開いて読めるプレーンテキスト」(ユーザー指示)。
IndexedDB側の`snapshot.content`はgzip+base64だが、`flushSnapshotToNas`が書く直前に
`gzipDecompress`して生テキストにする。レイアウトは`年/月/日/<noteId>-<timestamp>-<id>.txt`
(月・日はゼロ埋めしない)。親フォルダはネイティブホストが自動生成する。

**重要な非対称**: `getSnapshotBody`は呼び出し側(SearchPanel/HistoryPanel)が
`gzipDecompress`する契約なので、**圧縮base64**を返さねばならない。ローカル(content有り)は
そのまま圧縮base64を返し、NAS読み戻し(新形式`.txt`=生テキスト)は`gzipCompress`し直して
正規化する。旧形式`.snapshot`(旧コードが圧縮base64のまま書いていた)は`.txt`拡張子判定で
そのまま返す(後方互換)。この分岐を壊すと履歴プレビュー/diffがdecompressで例外になる。

## NAS/Driveの統一構造: active/<id>.md + YYYY/M/D/<id>.md(md+front matter)(2026-07-13)

正本は `writeNoteToNasStructure(note, now)`——各ノートを **`active/<id>.md`** と
**`<YYYY/M/D>/<id>.md`**(日付フォルダ)の両方へ、`noteToMarkdown` の md(YAML front matter:
id/title/tags/created_at/updated_at、AI要約は source_note_id/generated_by)で書く。**NAS と
Google Drive で構造・ファイル名・内容を完全一致**させる(ユーザー設計。Drive側は
`src/lib/drive/`)。front matterのYAMLスカラーは yamlScalar() で最小限クォートし、読み側
(native-host/build_index.py)と規則を合わせる。索引(SQLite)は native-host 側で .md から
**日次**再生成する(`background.ts` の runDailyMaintenance)。

- **保存タイミング + 「必ずタグ確定後に書く」**(NoteEditorPane.handleSaveMoment): 各ペインの
  `SnapshotScheduler`(= useSnapshotScheduler。更新5分/200字/blur/paste が唯一の発火源)から
  「自動タグ付け(analyzeNote)→ タグ確定 → NASへ書く」を**1本の非同期で直列化**する。時間依存の
  待ち(例: API後に3秒)は入れず、analyzeNote の戻り値を `applyAutoTagToNote`(entities/notes.ts)で
  手元合成して書く=再レンダ待ちの競合が原理的に起きない。空・junk は書かない。App側はNAS書き込みを
  持たず削除突合(`reconcileActiveNotesOnNas`)だけを担う。
- **消えたら消す**: `reconcileActiveNotesOnNas(notes)` が active/ を list-tree で列挙し、現在の
  非空・非junkノートに無い `active/<id>.md` を delete-file で消す(ブラウザで消したらNASからも消える)。
- **旧経路は残置**: 旧 `notes/<id>.md`(`writeNoteMarkdownToNas`)は**現在未配線**(active/<id>.md へ
  移行済み)。関数と `noteToMarkdown` は残すが呼び出していない。既存の旧ファイルはNAS上に残置する。

## active/New Tab Board.txt(出先で確認用の単一ミラー)は削除済み(2026-07-13・ユーザー判断「不要」)

旧 `writeActiveNotesToNas`(全ノートを `active/New Tab Board.txt` の単一ファイルへ連結)は、統一構造
(active/ を per-note の `<id>.md` にする)への移行で不要になり**削除した**(ユーザー確認済み)。
現在 active/ にあるのは per-note の `active/<id>.md` のみ。もし将来「出先で1ファイルで全ノートを
読む」用途が再度必要になったら、別名(例 `active-all.md`)で単一連結ミラーを新設する
(git履歴に旧実装あり)。

## nasArchive.test.ts / nasNativeHost.test.tsはNASブリッジをフェイクに差し替える

`nasArchive.ts`の関数群(`flushAllToNas`/`readArchivedSnapshot`/`getSnapshotBody`)は
`getNasFolderPath`/`probeNasPath`/`writeFileToNas`/`readFileFromNas`を依存注入で
受け取れる形になっている——テストでは実IndexedDB・実native messagingを経由しない
フェイク関数を直接渡す。`nasNativeHost.ts`自体のテストは`connectNative`を差し替え、
フェイク`chrome.runtime.Port`の`onMessage`/`onDisconnect`を手動発火させる
(`nativeMessaging.test.ts`と同じパターン)。

## fake-indexeddbの状態は同一テストファイル内で永続する

同じ`.test.ts`ファイル内の複数テスト間で`fake-indexeddb`の状態はリセットされない
(ファイルをまたぐと別インスタンスになりリセットされる)。前のテストの後始末が
次のテストの集計件数に混入するバグを`nasArchive.test.ts`で実際に踏んだ——集計件数の
比較ではなく、特定IDの状態を個別にassertする形で回避すること。

## nativeMessaging.ts / nasNativeHost.tsのテスト

`chrome.runtime.connectNative`は`Port`を返す同期API。テストでは`connectNative`を
引数として差し替え可能にし(`ConnectNativeFn`)、フェイクPortの`onMessage`/`onDisconnect`
リスナーを手動で発火させる形でチャンク分割・再結合・エラー処理を検証する
(`nativeMessaging.test.ts`のパターンを踏襲)。`nasNativeHost.ts`はFlow Launcher連携と
違い各操作が接続→1メッセージ送信→1メッセージ受信→切断の1往復で完結するため、
チャンク分割のテストは無い。

## native-host/(Pythonのnative messaging host本体)は別ディレクトリ

`native-host/`はこのフォルダ(`src/lib/externalIO/`)とは別に、リポジトリ直下に
同梱している(TypeScript/Reactのレイヤー構成とは独立した第三の言語ランタイム)。
テストは`native-host/test_nas_bridge.py`(pytest)。導入手順は`native-host/README.md`、
設計根拠は`plan.md`の「native-host/」節を参照。
