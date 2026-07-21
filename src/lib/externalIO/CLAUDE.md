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

## NAS/Driveの統一構造: active/<タイトル> (id8桁).txt + YYYY/M/D/<id>.md(中身はmd+front matter)(2026-07-13、拡張子は2026-07-16改定)

正本は `writeNoteToNasStructure(note, now)`——各ノートを **`active/<タイトル> (id8桁).txt`**
(`activeNasFilenameFor`)と **`<YYYY/M/D>/<id>.md`**(日付フォルダ)の両方へ、`noteToMarkdown` の
md(YAML front matter: id/title/tags/created_at/updated_at、AI要約は source_note_id/generated_by)
で書く。**NAS と Google Drive で構造・ファイル名・内容を完全一致**させる(ユーザー設計。Drive側は
`src/lib/drive/`)。front matterのYAMLスカラーは yamlScalar() で最小限クォートし、読み側
(native-host/build_index.py)と規則を合わせる。索引(SQLite)は native-host 側で .md/.txt から
**日次**再生成する(`background.ts` の runDailyMaintenance)。

**active/ 直下にはノート以外の .txt も同居する——pull は必ずノートだけ選り分ける**
(2026-07-22 是正): `active/todos.txt`(`writeTodosToNasActive`。front matter は `kind: todos` で
**id を持たない**)がノートと同じ `active/` 直下にある。`pullActiveFromNas` はここを `.txt` 全部
`markdownToNote` に通していたため、id 無し=乱数id・title 無し=空の「(名称未設定)」幻ノートが
毎回 order=0(ASCII名の todos.txt が日本語タイトルより前に並ぶ)で左上に生成され、しかも
updatedAt を持たない(=時刻0)ため内容が食い違うと `mergeNoteCollections` が競合コピーを量産して
いた。**front matter に非空の id: を持つファイルだけ**を `isNoteMarkdown`(`nasArchive.ts`)で
取り込む。Drive 側 `pullActiveFromDrive` は appProperties.noteId 持ちだけを列挙して最初から
同じ選り分けをしている——**active/ に新たな非ノートファイルを足すときは、この pull フィルタが
効くこと(=id を持たないファイルであること)を必ず確認する**。

**active/ だけ拡張子が.txt(日付フォルダ・special/は.md据え置き)**(ユーザー指示・2026-07-16):
スマホのDriveアプリ/ホーム画面ショートカット経由でactive/を直接閲覧する用途(README「擬似持ち出し」
節参照)で、.mdより.txtの方がテキストビューア/アプリでの開封性が高いための変更。**中身の形式
(front matter+Markdown)自体は無変更**——`noteToMarkdown`はそのまま、拡張子だけが違う。連動して
変える必要があった箇所(見落とすと壊れる):
- `activeNasFilenameFor`/Drive側`activeFilenameFor`: 末尾を`.md`→`.txt`
- `writeTodosToNasActive`/Drive側`TODOS_FILENAME`: `active/todos.md`→`active/todos.txt`
- `idFragmentFromActiveFilename`の正規表現: `.md$`→`.txt$`(旧`.md`ファイルは非マッチ→
  `reconcileActiveNotesOnNas`で「保持対象なし」判定され自然に削除される。移行用の別処理は不要)
- `native-host/nas_bridge.py`の`handle_read_active`(pull用の読み取り): `.md`→`.txt`フィルタ
- `native-host/nas_bridge.py`の`handle_list_tree`: active(.txt)とspecial(.md)の両方が使う汎用
  列挙なので、**`.md`と`.txt`の両方**を対象にする(片方に寄せると他方の突合削除が壊れる)
- `native-host/build_index.py`: `active/*.md`グロブ→`active/*.txt`(日付フォルダ側`*/*/*/*.md`は
  無変更)

**書式変更時は`noteSaveFingerprint`のバージョンを上げる**(2026-07-16是正・ユーザー報告
「ドライブに退避でactiveにファイルが出力されない」): `nasSavedHashes`/`driveActiveSavedHashes`
(いずれもsaveLocalData経由でセッションをまたいで永続化される)は本文が無変更なら再書き込み
しない仕組みのため、この`.txt`拡張子変更のように**本文は変えずファイル名/構造だけ変える**
書式変更をしても、既存ノートは「保存済み」判定でスキップされ続け、新形式のファイルが
一切書かれない。`nasActiveSync.ts`の`noteSaveFingerprint`は`ACTIVE_FILE_FORMAT_VERSION`を
ハッシュへ連結しており、書式を変えるたびにこの定数を上げて全ノートを一度だけ強制再同期
させる(以後はまた内容ベースの差分検知に戻る)。

- **ハッシュで保存済み判定(無駄な再保存を避ける)**(ユーザー指示): `pushActiveToNas` は各ノートの
  `noteSaveFingerprint`(= `contentHash(noteToMarkdown(note))` + 書式バージョン)を前回保存時の
  ハッシュ(`nasSavedHashes`・localDataに永続)と比べ、**同じなら書かない**。これで①同じノートの
  無駄な再保存が消え②日付フォルダは「その日に変わったノート」だけになる(毎日の全コピー重複を
  解消)。タグ付けは別途 `taggedHash`(content
  ハッシュ)で `needsRetag` が抑制(タイトル/タグ付け回数の削減)。
- **NAS active への書き込みは「世代同期(5分毎の push)」に一本化**(`nasActiveSync.ts`・App)。各ペインの
  `SnapshotScheduler`(更新5分/200字/blur/paste)は**自動タグ付け(analyzeNote)だけ**を行い、タグは
  notes state に反映される。push はその state を読むので「タグ確定後に書く」も自然に満たす(NoteEditorPane
  からは NAS へ直接書かない)。空・junk は push 側(`pushActiveToNas`)で除外。
- **消えたら消す・リネームで孤立した旧ファイルも消す**: `reconcileActiveNotesOnNas(notes)` が active/ を
  list-tree で列挙し、現在の非空・非junkノートに無い `active/<タイトル> (id8桁).txt` を delete-file で
  消す(`pushActiveToNas` が push のたびに呼ぶ)。**同じid断片のファイルが複数残っている場合**(タイトル
  変更で旧ファイル名が孤立した状態)は、現在の正本ファイル名が実際に存在することを確認してから、それ以外を
  削除する(2026-07-16是正——正本がまだ書かれていない/書き込み失敗時は何も消さず、最後の1コピーを
  誤って消す事故を防ぐ)。この分岐が無かった旧実装では「ノートidが今も存在するか」しか見ておらず、
  リネームのたびにファイルが積み上がり続け、`pullActiveFromNas`が同じidの複数Noteを生成→盤面に
  同じノートが複数枚表示され、削除(id一致で全件除去)すると全部消える不具合になっていた。
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
設計根拠は`PLAN.md`の「設計判断の記録」内「native-host/」節を参照。
