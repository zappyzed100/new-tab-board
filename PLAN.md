<!-- PLAN.md — New Tab Board の全体計画・アーキテクチャ・技術選定理由の正本 -->
# PLAN.md — New Tab Board 全体計画

## 目的

自分専用のChrome新しいタブページ拡張機能(Manifest V3)。ノート・ブックマーク・TODO・
次の予定のカウントダウン・タグ検索を1画面に集約し、NAS(ローカルファイルサーバー)と
Google Driveへ自動的にバックアップ・同期する。バックエンドサーバーは持たない——
`chrome.storage`/IndexedDBのみでローカル完結し、外部連携(NAS・Drive・Gemini・GAS)は
すべて任意設定(未設定でも新しいタブ本体の機能は動く)。

## アーキテクチャ

```text
src/newtab/                UI(React + Vite。拡張の新しいタブページ本体)
  ↓ 依存してよい
src/lib/                   シーム(外部I/O・時刻・ログの唯一の入出口)
  storage/storage.ts       chrome.storage低水準I/O + Web Locks排他read-modify-write
  storage/local-data-repository.ts  ノート差分コマンドを最新状態へコミットする唯一のrepository
  ↕ chrome.storage / native messaging / HTTP 経由で疎結合に連携（互いに直接importしない）
src/background/            service worker（予定ポーリング・予定前/バッテリー低下アラーム・日次メンテ）
src/offscreen/              chrome.offscreen（service workerが再生できないループ音声の専用ページ）
native-host/                NASブリッジ（Python。Native MessagingでローカルNASへ読み書き+SQLite索引）
gas/                        Google Apps Script（スマホのバッテリー低下警告の中継。Web App）
```

依存方向は `src/lib` → `src/newtab` の一方向のみ（`src/lib` が `src/newtab` を import することは
禁止・`scripts/repo_scan.py` の layer-violation 検査で機械強制。AGENTS.md §5）。
`background`/`offscreen`/`native-host`/`gas` は互いに直接依存せず、`chrome.storage`・
Native Messaging・HTTPを介して疎結合に連携する。

## 技術選定理由

- **TypeScript + React + Vite**: 拡張機能のUI本体。ビルドは`npm run build`で
  Manifest V3の`dist/`一式を出力する。詳細な選定理由・ハイブリッド構成は`docs/stack.md`。
- **`chrome.storage.local` + IndexedDB（バックエンド無し）**: 個人用途で常時起動サーバーを
  持つ理由が無く、ブラウザ内で完結させる。IndexedDBは履歴スナップショット・全文検索索引・
  貼り付け画像・秘匿設定（NASパス・APIキー等）の保存に使う（`src/lib/storage/`）。
- **Radix UI Themes**: UIコンポーネントの標準として全面採用（2026-07-11。詳細は
  「設計判断の記録」参照）。
- **Native Messaging（`native-host/`）**: `showDirectoryPicker()`のChromium既知バグ
  （拡張機能ページから呼ぶと選択後もAbortErrorになる）を回避してNASへ読み書きする唯一の方法。
  PC側に常駐する自作Pythonプログラムと標準入出力でJSON通信する。
- **Google Apps Script（`gas/`）**: スマホと拡張機能という別デバイス間を橋渡しする軽量な中継。
  スマホ側の自動化アプリ（Tasker/ショートカット）がOAuth設定無しで素朴なHTTPを送るだけで済み、
  拡張機能側もGoogleアカウントの追加スコープ無しで`fetch()`できる。

## 運用

- ビルド: `npm run build`(本番)/`npm run build -- --watch`(開発)。手順の詳細はAGENTS.md §9。
- NAS/Drive同期間隔: active（編集中ノート）はNAS側5分毎の世代同期、Drive側5分debounce。
  日付フォルダへのコピー・SQLite索引再生成は`background.ts`の`daily-maintenance`アラームで
  1日1回（1時間おきに起こし、日付が変わっていれば実行。起動時も未実行なら補完）。
- 予定前アラーム: Googleカレンダーの次の予定を15分毎にポーリングし、開始10分前に1回だけ鳴らす
  （同じ予定に対して再発火しない）。
- バッテリー低下警告: GAS Web Appを1時間毎にポーリングする（2026-07-18に15分から変更）。
  GAS側がconsume-on-read（読んだら即削除）のため、値が返るたびに1回鳴らす。
  予定前アラームとオフスクリーンのループ音声を共用する。

## ロードマップ

- 日次アーカイブ(`date_notes`)を全文検索・タグ検索の対象にも含めるか検討する
  （現状は期間検索でのみアーカイブを合流させている）。
- 2台のPCでの相互同期を実機で確認する（コードは2026-07-20に完成。NAS優先・Drive従の構成）。

## タスク（機械可読 — 外部ツール「Progress Proof」がこの節を正規表現でパースする想定）

書式:
- `- [ ] タイトル` … 未完了。行末に `` `状態タグ` `` が無ければ `backlog` 扱い
- `- [x] タイトル` … 完了。行末にタグが無ければ `done` 扱い
- 状態を明示したい時だけ行末にタグを付ける: `` `next` `` / `` `in_progress` `` /
  `` `blocked` `` / `` `cancelled` ``（`done`/`backlog` はチェック状態で表せるため省略可）

- [x] スマホのバッテリー低下警告をNew Tab Boardに表示する（GAS Web App中継・10/20/50%閾値）
- [ ] gas/battery-webhook.gs を script.google.com へデプロイする `next`
- [ ] スマホ側の自動化アプリ（Tasker/ショートカット）でバッテリー低下時のPOSTを設定する `next`
- [ ] NAS/Google Driveを手動削除した後、再送信で正しく復元されるか実機確認する `backlog`
- [x] マルチデバイス対応時、Drive側にもpush/pull判定ロジックを追加する
- [x] Drive世代同期をApp.tsxへ配線する（tick+初回pull+編集時bump）
- [x] Driveの突合（削除）を所有権ゲートの下へ移す（2台目が相手のノートを消す事故の防止）
- [ ] 2台のPCで実機の相互同期を確認する `next`
- [x] 複数タブの全体スナップショット相互書き戻しを廃止し、排他差分コミットへ再設計する

## 設計判断の記録（過去の主な設計判断・新規ディレクトリの根拠）

### 手動タグは「本文の `#タグ名`」を正本にする(専用フィールドを作らない・2026-07-23)

ユーザー指示「`#タグ名` と書いたらタグとして認識する仕組みにしよう」。`Note` に手動タグ用の
フィールドは**足さない**——Geminiの自動タグ(`note.tags`)は `analyzeNote` の結果で毎回**全置換**
されるため、同じ配列へ混ぜると自動タグ付けのたびに手動分が消える。本文を正本にすれば構造的に
消えようがない(手動タグを消すのは本文からその語を消したときだけ)。

合流点は `src/lib/entities/tags.ts` の `resolveNoteTags(note)` 一本(本文の手動タグ→自動タグの順で
重複除去)。表示(`NoteEditorPane`)・タグ検索(`search/tagSearch.ts`)・NAS/Driveのfront matter
(`externalIO/nasArchive.ts` の `noteToMarkdown`)・⭐スペシャル(`entities/special.ts`)・Geminiへ渡す
語彙(`buildTagVocabulary`)はすべてこれを通す。front matter へ出すのは、SQLite索引
(`native-host/build_index.py`)が front matter しか読まないため——ここで合流させないと外部の
タグ検索から手動タグが見えない。

`extractTags` は Markdown と食い違わないよう、コードフェンス/インラインコード内を除外し、
`#` は行頭・空白・開き括弧の直後だけをタグの開始と見なす(`###見出し` の2つ目以降の `#` や
`http://…#frag` を拾わない)。`# 見出し` は CommonMark が `#` の後に空白を要求するため元から
一致しない=行頭 `#タグ` は見出しにならず、タグ解釈と描画が矛盾しない。

### ノートプレビューの数式描画(KaTeX)とバンドラのサロゲート潰し(2026-07-23)

ユーザー指示で `$…$` / `$$…$$` / ```` ```math ```` の数式描画を追加(`katex` +
`@vscode/markdown-it-katex`)。CDNは使わずバンドルするのでMV3のCSPに抵触しない。DOMPurifyの既定
プロファイルはMathMLの `semantics`/`annotation` を許可しないため、そのままだと要素だけ剥がれて
中のLaTeXソースが本文として残る(読み上げが数式を二重に読む)——`ADD_TAGS` で明示許可する。

**バンドラ由来の落とし穴を2つ踏んだ。どちらも本番ビルドでしか出ない**(vitestは通る):

1. `@vscode/markdown-it-katex` は `__esModule` + `exports.default` のCJS。interop次第で default が
   名前空間オブジェクトのまま渡り、markdown-it の `plugin.apply(...)` が
   `e.apply is not a function` で落ちて**Reactツリーごと白画面**になる。`typeof === "function"`
   で受け直す。
2. `katex/dist/katex.js` は正規表現の材料として**単独サロゲート**のエスケープを文字列に持つ。
   バンドラはこれを実文字へ解釈してから出力をUTF-8で書くため U+FFFD へ潰れ、KaTeXの
   `tokenRegex` の文字クラスが壊れて `\frac` が `\f`+`rac` に分解される(数式が赤いエラー表示)。
   minify無効でも同じ=出力段では情報が失われており `renderChunk` では直せないため、
   `vite.config.ts` の `keepKatexSurrogatesEscaped` プラグインが**入力段**で
   JS文字列のエスケープを正規表現パターン内のエスケープへ書き換える(意味は同一・katex限定)。

回帰は `e2e/specs/note-katex.spec.ts`(実ビルドを貫通し、組版結果を `getBoundingClientRect` で
数値検証する)。単体テスト(`MarkdownPreview.test.tsx`)はsanitize設定を守る側の門。

### src/lib/images/ — ノート添付画像はNASにだけ置き、ブラウザ側は揮発キャッシュ(2026-07-23)

ユーザー指示: 「ノートに画像を紐づけて保存する。画像はNASにだけ保存する。画像は揮発(しかしNASに
保存)で10MB制限から外す。起動時にNASから取ってくる。NASが未登録だったらノートに表示しない」。

- **保存先はNASのみ**。`chrome.storage.local`(10MBクォータ・AGENTS.md §11)にもIndexedDBにも
  画像実体を置かない。ブラウザ側にあるのは起動時にNASから読み直すメモリ上のobject URLだけで、
  タブを閉じれば消える(=クォータを一切消費しない)。
- **添付の操作**はノート本文への Ctrl+V もしくは画像のドラッグ&ドロップ。CM6は既定でバイナリを
  無視するため `EditorView.domEventHandlers` の paste/drop/dragover を奪って処理する。
- **本文の参照は `![alt](nas:images/<noteId>/<id>.<ext>)`**(ユーザー選択)。Markdown標準の画像
  記法なので、NASの `.md`/`.txt` を他のエディタで開いても「ここに画像がある」ことが読み取れる。
- **NAS未登録/未接続なら画像を表示しない**。プレビューのimageレンダラが `nas:` を解決できない時は
  `<img>` を出さず alt だけを残す(壊れた画像アイコンを出さない)。保存側も同じ判断で、保存に
  失敗したら**本文へ参照を書かない**——表示できない参照だけが残る事故を作らない。

**貼り付けた画像の内容はノート下部のサムネイル帯で確認する**(2026-07-23・ユーザー指示)。編集中は
本文に `![](nas:…)` という参照テキストしか見えないため、中身を見るのにプレビューへ切り替える必要が
あった。`NoteImageStrip.tsx` が本文とタグ行の間へ 96px のサムネイルを並べる(クリックで別タブに原寸)。
プレビュー中は本文内に実物が描画されるので二重に出さず、編集中だけ表示する。並べる対象は
**本文の参照ではなく保存先フォルダ `images/<noteId>/`**——本文から参照テキストを消しても画像は
NASに残るため、参照だけを見ると「貼ったのに確認できない」画像が生まれる(順序は本文の参照順が先、
未参照は末尾)。

新規ディレクトリ `src/lib/images/` の根拠: 「NAS上の画像実体 ↔ 本文のテキスト参照 ↔ 揮発キャッシュ」
という独立した関心事で、`externalIO/`(NASの生I/O)にも `entities/`(I/Oを持たない純粋ロジック)にも
収まらない(`drive/`・`gemini/` と同じ「特定の連携単位で1ディレクトリ」の流儀)。内訳は参照記法の
純粋ロジック(`noteImages.ts`)・NAS入出力(`nasImageStore.ts`)・Reactの揮発キャッシュ
(`useNoteImages.ts`)。native-host 側は `write-binary`/`read-binary`/`list-images` を追加した
(契約は `docs/nas-native-messaging-protocol.md`)。

**旧「貼り付け画像パネル」は削除した**(ユーザー判断)。Ctrl+Vの画像をIndexedDB(`pastedImages`)へ
貯めてサイドに並べる機能で、どのノートにも属さず・NASにも出ず・ブラウザ内に画像が積み上がる
一時置き場だった。画像は「ノートに添付してNASへ置く」へ一本化し、DBは v4 で `pastedImages`
ストアごと削除する(溜まっていた画像も一緒に捨てる——NASへ移す価値のある一時データではない)。

### src/newtab/components/clipboard/(貼り付け画像の一次保存・2026-07-13)
**(2026-07-23に削除済み——上の「src/lib/images/」節を参照)**
Ctrl+Vで貼り付けた画像を一次保存し、ノート類の下で一覧/クリップボードへコピー/削除する
(ユーザー指示。NASへは出さずローカルのみ)。ノート/検索とは独立した「クリップボード由来の一時
データ」という関心事のため `src/newtab/components/clipboard/` を新設。保存は既存の
IndexedDBシーム(`src/lib/storage/db.ts`)へ `pastedImages` ストア(DB v3)を足して集約する
——画像もsnapshot等と同じくブラウザ内ローカルに閉じる(sync/Drive/NASには乗せない)。

### ノートボードのmasonry(全件表示+ピン/並べ替え/末尾空3つ・2026-07-12、2026-07-13にアルゴリズム変更)
「最大3件を横並び+チェックボックス選択」を廃し、ノート全件を1枚のボードで常時表示する。
当初は `i%列数` の「列固定・安定」方式だったが、2026-07-13にユーザー選択で**実測masonry(最密)**へ
変更——各ペインの実高さを ResizeObserver で測り、`sortedNotes`(ピン→order)順に「その時点で一番低い
列」へ入れる greedy 最密詰め。列高さがほぼ揃う(バランス保証: 差<最大ノート高さ)。列幅一定ゆえ列を
移っても高さは不変で、再配置は内容変更時のみ(タイプ中のチラつきはこの範囲=ユーザー了承済みの割り切り)。
論理順序は列レイアウトから復元できないため各セルに `data-linear-index` を出す(E2E/デバッグ用)。
各ペインにピン/一つ上へ/ドラッグ交換を持たせ、末尾には常に空ノートを3つ確保する。設計詳細と
ハマりどころは `src/newtab/components/notes/CLAUDE.md`。

### native-host/ (NASブリッジ native messaging host・2026-07-12)
NASフォルダへの書き込みは`showDirectoryPicker()`を使っていたが、Chrome拡張機能の
ページから呼ぶと選択後もAbortErrorになる既知バグ(WICG/file-system-access#314、
crbug.com/issues/40240444)が実機で再現し続け、エラーメッセージ表示以上の対応が
できなかった(ユーザー指示により本格対応)。拡張機能はサンドボックスの都合上
任意のファイルパスを直接読み書きできないため、Native Messaging(PC側に常駐する
別プログラムと標準入出力でJSON通信する)以外に確実な方法が無い。

Flow Launcher連携(`docs/native-messaging-protocol.md`)は「host本体は別リポジトリで
実装する」設計だったが、あちらは既存の第三者ツール(Flow Launcherのフォーク)を
統合する話であるのに対し、こちらは本アプリ専用の自作ブリッジのため、本リポジトリ
直下に`native-host/`として同梱する(Google公式のnative messaging Pythonサンプルを
下敷きにした最小実装。外部ライブラリへの依存追加はしていない)。契約は
`docs/nas-native-messaging-protocol.md`に記載。拡張側クライアントは
`src/lib/externalIO/nasNativeHost.ts`。

### UI層をRadix Themesへ全面移行 (2026-07-11)
「最小依存・自前実装優先」の方針(docs/stack.md)から転換し、`@radix-ui/themes`を
UIコンポーネントの標準として全面採用した(ユーザー指示)。詳細な根拠・ハイブリッド
構成(Radixに置き換えた部分/自前CSSを残した部分/生radix-uiを使った1ファイル)は
docs/stack.mdの該当節を参照。新規ディレクトリは作っていない(既存コンポーネント
ファイルの内部実装差し替えのみ)。

### src/offscreen/ (M12・2026-07-11)
予定前アラーム(SPEC.md §4.11)はMV3のservice workerが音声を再生できないため、
`chrome.offscreen`(reason: AUDIO_PLAYBACK)でオフスクリーンドキュメントを作り、
その中の`<audio loop>`でループ再生する。newtab/lib一方向のレイヤーとは別に
「拡張機能が生成する隠しページ」という第三のエントリポイントが必要なため、
`src/newtab/`と並ぶ`src/offscreen/`として新設した(background.tsと同じ思想で、
vite.config.tsに専用ビルドエントリを追加する)。

### src/background/ (Step 8b・2026-07-08)
E2Eテストが拡張機能IDを解決するには service worker の存在が必要(Manifest V3では
`context.serviceWorkers()` / `waitForEvent("serviceworker")` でIDを取得する)。
本アプリは新しいタブ上書きのみで機能的にはbackgroundを必要としないが、E2E観察の
ためだけに最小限のno-opに近いservice worker(`background.ts`)を追加した
(インストール時に`logOp`で1行ログを出す以外は何もしない)。

### src/lib/gemini/ (Gemini連携の土台・2026-07-12)
ノートの自動タグ付け・要約・TODO抽出(ユーザー要望)は、いずれもGoogle Gemini APIの
`generateContent`を呼ぶ共通の土台を必要とする。drive/(Google Drive)と同じく「特定の
外部サービス連携」という独立した関心事なので、`src/lib/`直下に専用ディレクトリ
`src/lib/gemini/`を新設した(seamは`gemini.ts`の`callGemini`一本。fetchを依存注入で
差し替えテスト可能)。APIキーは秘匿情報のため、syncにもDriveの全データJSONバックアップにも
乗らないIndexedDBの設定ストア(db.tsの`getGeminiApiKey`/`setGeminiApiKey`)へ保存する。
無料枠に収まりやすいflashモデル(gemini-2.0-flash)を既定にする。

### タグ検索: Markdown+front matter正本 + SQLite再生成インデックス (2026-07-12)
ユーザー設計を採用。正本はNAS上の「1ノート=1つの .md + YAML front matter」
(id/title/tags/created_at/updated_at、AI要約は source_note_id/generated_by)。
書き出しはnative-host(nas_bridge.py)経由。**ブラウザ拡張からSQLiteは直接使えない**ため、
アプリ内のタグ検索はメモリ内フィルタ＋既存IndexedDB(search.ts)で行う(ノートは最大501件・
全件メモリ上なので索引不要で一瞬)。「外部ツールでSQL検索したい」用途のため、native-host側に
Python(標準ライブラリのsqlite3のみ)で notes/*.md → data/index.db を再生成するツール
(build_index.py)を別途置く。index.dbは消えても.mdから再生成できる(正本は.md)。
front matterのパースは形式を自前で制御しているため最小の自前パーサで済ませPyYAML依存は持たない。

### 同一PC即時反映 + Driveのlossless和集合同期 (2026-07-22)
世代番号で盤面全体を置換する2026-07-20方式は廃止した。片方にノートが無いことだけでは
「削除済み」と「まだ取得していない」を区別できず、2台目が1台目の新規ノートを消し得たため。

- 同一PCのタブ間は`chrome.storage.onChanged`を`storage.ts`のseam経由で購読し、repositoryが
  コミットした確定状態を即時反映する。別タブをリロードする必要はない。
- Drive通信はbackground service workerの`drive-note-sync`アラーム1本へ集約し、5分ごとに実行する。
  各ペインの`useDriveSync`は明示保存と状態表示だけを担当し、タブ数に比例した定期通信をしない。
- pullは盤面全体を置換せず、`mergeNoteCollections`でID単位にマージする。片側だけのIDは必ず残す。
  同じIDは`updatedAt`が新しい方、同時刻で内容が違う場合は片方を「競合コピー」として残す。
- 削除は`LocalData.noteTombstones`とDrive
  `app/New Tab Board/sync/v2/tombstones/<noteId>.json`に明示記録する。`active/`に無いだけでは削除しない。
- `active/`の削除突合は、remote note/tombstoneとローカルをマージした**後**だけ実行する。初回移行は
  tombstoneが無いため常に和集合になり、旧activeファイルを欠落扱いで消さない。

`active/`は引き続きスマホ等から読む人間向けミラーで、履歴は従来どおりDriveへ送らない。

### localDataの単一コミット境界（複数タブ競合の構造是正・2026-07-22）

`chrome.storage.local`の`localData`を各タブ・backgroundが「読んだ全体→後で全体保存」していた
構造を廃止した。さらに、`storage.onChanged`を受けたタブがローカル状態とマージして再保存していたため、
タブごとにマージ結果が異なると通知→保存→通知のフィードバックループになり、React再描画と
CodeMirror再マウントまで連鎖してブラウザrendererを過負荷にする設計欠陥があった。

新構造では`storage.ts`の`updateLocalData`だけがWeb Locks排他区間内でread-modify-writeし、
通常フィールドは`patchLocalData`、ノートは`local-data-repository.ts`の`commitNoteMutation`で
before/afterから抽出したupsert・削除tombstoneだけを最新永続状態へ適用する。Drive/NAS結果も
`commitMergedNotes`で保存時点の最新ローカル状態と再マージする。`storage.onChanged`の購読側は
単調増加`storageRevision`付きの確定状態を画面へ反映するだけで、通知への応答では保存しない。
これを不変条件とし、タブ数や操作順を個別に列挙する回帰テストではなく、並行した異種フィールド更新、
2タブからの追加、削除と追加の競合がいずれも欠落しないrepositoryテストで固定する。

### タブ↔NAS active の世代同期 / ⭐スペシャル(保管棚) (2026-07-13)
- **世代同期**(ユーザー指示): タブとNAS activeを世代番号(NAS `data/generation.txt`)で突き合わせる。
  人間の初回編集で `bump-generation`→所有権取得。5分毎+ロード時に、所有者で同世代なら push
  (active上書き+日付追記+削除突合)、NASが新しければ pull(NAS activeでノートを丸ごと上書き=最終
  操作者優先)。native host に read/bump-generation・read-active を追加、md↔Note逆パーサ
  (`markdownToNote`)で pull を復元。NAS active への per-note 書き込みは廃し 5分 push へ一本化。
- **⭐スペシャル**(ユーザー指示): ノート見出しの ☆/⭐ で「保管棚」へ。ボードにある間は追従、削除で凍結
  (`SpecialItem`)して残る。サイドバーの SpecialPanel(TODOの下/タグ候補の上)でフォルダ作成・移動・
  開く・外す。NAS/Drive の `special/<folder>/<id>.md` へ書き出す(`specialSync`/`driveSpecial`)。
  純粋ロジックは `src/lib/entities/special.ts`。

### NAS/Drive/SQLite保存構造の統一 + タグ/本文/期間検索 + 検索結果の貼り付け (2026-07-13)
ユーザーが「保存(NAS/Drive/SQLite)」と「検索UI」を一体設計として指定。**検索を先(Phase A)**、
保存構造の大移行(Phase B)を後、という順で入れた——検索は既存の `notes` スキーマ
(id/title/tags/created_at)で完結し独立に価値が出て低リスクだったため。

- **Phase A(検索+貼り付け)**: native-host に `top-tags`(頻度降順タグ)/`search-notes`
  (タグAND/OR + 本文LIKE + `created_at` の**半開区間** `>= from AND < to` + 本文全文返却)を追加。
  UI(`TagSearchPanel`)はNAS上位タグのチップ + 自由入力タグ + 期間プリセット/カスタム + 結果を
  10件/ページで表示し、チェック/全件をノート末尾へ貼り付け(白紙は上書き=`pasteResultsIntoNotes`)。
  **日本語本文はFTS5でなくLIKE**を採用(FTS5+unicode61は連続日本語を1トークン化し部分一致を
  取りこぼすため。文書数増で遅くなったら分かち書き+FTS5へ移行)。
- **Phase B(構造統一)**: NASとGoogle Driveを**完全一致**させる——ルート下に `active/<id>.md`
  (今ブラウザにある非空ノート・消えたら削除)+ 日付フォルダ `YYYY/M/D/<id>.md`。ファイルは
  Markdown+front matter(`writeNoteToNasStructure` / Drive `driveSync`+`copyNotesToDriveDateFolder`)。
- **保存タイミング**(ユーザー指示): NAS active+日付は「更新5分 or 200字以上、かつ非空」で書く
  (履歴スナップショットと同じ節度)。Drive active は5分debounce。**Drive日付フォルダとSQLite索引は
  日次**(`background.ts` の `daily-maintenance` アラーム: 1時間おきに起こし日付が変われば一度だけ、
  前日フォルダへDrive格納 + `rebuild-index`。起動時も補完)。旧経路(`notes/<id>.md`・
  `active/New Tab Board.txt`)は残置・未配線(既存ファイルは消さない)。

### UIの一括リデザイン(トークン化+アイコン化+レイアウト再構成・2026-07-16)
ユーザーが `.claude/skills/` へUI/UXスキル群を導入し、「見た目だけでなくレイアウト構造も含めて
全面作り変え」を指示。新しく入れたスキル(`ui-ux-pro-max`)の推奨に従う方針とし、
`--design-system`クエリの結果(フラットデザイン・青系プライマリ+緑アクセント・
絵文字ではなくSVGアイコンを使う)を採用した。`ui-styling`(Tailwind/shadcn前提)は
本プロジェクトが素のCSS+Radix UI Themesのため不採用、`brand`/`design`はロゴ・マーケ資料生成用で
対象外——詳細な採否判断は `.claude/plans/radiant-hatching-starlight.md` 参照。

新設 `src/newtab/styles/`(`tokens.css`/`layout.css`/`components.css`): 従来1ファイル(788行)
だった `styles.css` をトークン層(primitive→semantic)+レイアウト+コンポーネント別に分割し、
色調を刷新(影を排したフラットデザインへ)。数値スケール(spacing/radius)は既存E2Eのジオメトリ
前提を壊さないよう据え置いた。マソンリー配置アルゴリズム自体(`App.tsx`・
`src/newtab/components/notes/CLAUDE.md`記載の不変条件)は無変更——見た目のみの変更。
絵文字アイコン(🗑✨🏷️⭐🧹⬆️⌨️等)は新規依存 `lucide-react` のSVGアイコンへ全置換。
サイドバー各パネルの見出しサイズがバラバラだった(size2/size4混在)のを
`src/newtab/components/shell/PanelCard.tsx`(新設)で統一した。

### スマホのバッテリー低下警告(GAS Web App中継・2026-07-16、consume-on-readへ改定2026-07-18)
ユーザーが「スマホの充電が少なくなっている時にNew Tab Boardへ警告を出したい」と指示。
スマホと拡張機能は別デバイスなので、GAS(Google Apps Script) Web Appを中継に採用
(`gas/battery-webhook.gs`。doPost=スマホ側自動化アプリからの残量報告、doGet=拡張機能からの
読み取り。共有トークンで簡易認証)。既存の予定前アラーム(`background.ts`のfireAlarm/stopAlarm・
オフスクリーンのループ音声)を再利用する。
接続設定(URL+共有トークン)はDataPanelからGemini APIキーと同じ「秘匿情報として画面に
出さない」パターンで保存。

**設計改定(2026-07-18・ユーザー指摘)**: 当初は「10/20/50%の閾値を新たに下回った時だけ発火・
51%を超えて回復したら発火済み記録をリセット」という`decideBatteryAlarm`(chrome側の
`src/lib/battery/`に実装、`batteryFiredThresholds`をchrome.storageへ永続化)で管理していた。
しかしユーザーの実際のスマホ側自動化(iOSショートカット)は「50/20/10%を**下回った時**」の
3トリガーのみで、**充電完了・回復を報告するトリガーが無い**構成だったため、GASの`level`が
51%を超えて報告されることが構造上あり得ず、「回復でリセット」条件が実運用で永遠に
成立しない=各閾値が生涯最大1回しか鳴らないワンショット化していた欠陥をユーザーが発見。

対策として、閾値の再武装判断をchrome側の状態管理から**GAS側のconsume-on-read**に
一本化した: `doGet`は読んだ値を同じ実行内で即座に削除する(`LockService`で`doPost`との
競合を防ぐ)。GASに値がある=スマホが新たに閾値を下回った未処理イベント、という
1回限りのメールボックスとして機能するため、「いつ再武装してよいか」をchrome側で
判断する必要が無くなる。これにより`src/lib/battery/`(`decideBatteryAlarm`とその閾値集合
管理)・`LocalData.batteryFiredThresholds`は不要になり削除、`pollBatteryStatus`は
「GASから値が返れば常に鳴らす」まで単純化した。既知のトレードオフ: GASの
「読み取り成功→削除」に対する応答がネットワーク不調でchromeに届かない場合、
そのイベントは黙って失われる(低頻度の個人利用では許容——GUARDRAILS.md的な冪等性
保証までは踏み込まない判断)。

### NAS/Driveのactive/だけ拡張子を.txtへ変更(2026-07-16)

ユーザーがスマホのホーム画面ショートカットからGoogle Driveの`active/`フォルダを直接開く
運用(README「外部連携のセットアップ」§1「擬似持ち出し」節)を始めたのに合わせ、「.mdより
.txtの方がスマホのDriveアプリ/テキストビューアで開きやすい」との指示で、**active/フォルダの
ファイルだけ**拡張子を`.md`→`.txt`へ変更した(日付フォルダ`YYYY/M/D/<id>.md`・special/は
現状維持)。中身(front matter+Markdown)は無変更——`noteToMarkdown`自体はそのまま。

変更はNAS(`nasArchive.ts`の`activeNasFilenameFor`/`writeTodosToNasActive`)とDrive
(`driveSync.ts`の`activeFilenameFor`/`driveActiveMirror.ts`の`TODOS_FILENAME`)双方の
ファイル名生成に加え、native-host側(別言語ランタイム)の読み取り経路も連動が必須だった:
`nas_bridge.py`の`handle_read_active`(pull用)を`.txt`フィルタへ、`handle_list_tree`
(active/special共用の汎用列挙)を`.md`と`.txt`の両対応へ、`build_index.py`の索引取り込み
グロブを`active/*.txt`へ。詳細・見落とし防止の一覧は`src/lib/externalIO/CLAUDE.md`参照。
旧`.md`のactiveファイルは移行スクリプト無しで残置——`reconcileActiveNotesOnNas`の
ファイル名正規表現が新拡張子のみ一致するため、次回の突合で自然に「保持対象なし」判定され
削除される(既存の類似移行と同じ設計)。

### NAS書き込み/Drive退避の前に全ノートへGeminiをかける(2026-07-16)

ユーザー指示: 「NASへの書き込み」ボタン(`pushNasActiveNow`)・「Driveへ退避」ボタン
(`handleBackupToDrive`→内部で`pushDriveActiveNow`)が実行される前に、まず空でない全ノート
へGeminiでタグ付けしてから書き込み・退避を行ってほしい(タグ未確定のまま保存されるのを
避けたい、という意図)。共通処理`tagAllNotes()`(App.tsx)を新設し、既存の`needsRetag`
フィルタ+`analyzeNote`ループ(元々「🏷️ タグをふる」ボタン=`handleTagAll`が持っていた
ロジック)をそこへ集約。`pushNasActiveNow`・`pushDriveActiveNow`はどちらも先頭で
`tagAllNotes()`を呼んでから本来の処理へ進む(`pushNasActiveNow`はNAS世代同期tick・ボタン
どちらの呼び出し元にも効く——両方から一律にタグ確定後の保存を保証する設計)。

副作用として`handleBackupToDrive`のJSONバックアップ本体も修正: `backupJson`は`useMemo`
(依存`notes`)のため、`tagAllNotes()`のタグ更新(`updateNotes`経由の再レンダー)を
クロージャ内の`backupJson`は拾えず古いスナップショットのままになる。`notesRef.current`
等のrefから`buildExportPayload`を組み直して送る形に変更し、退避内容に最新タグを含める。

`handleTagAll`(「🏷️ タグをふる」ボタン)自体も、タグ付け後に`pushNasActiveNow`/
`pushDriveActiveNow`を呼んで即座に保存する(前段のユーザー指示「タグ付けボタンを押した
ものは待たずに保存対象にしてほしい」と対になる設計)。相互に呼び合っても`needsRetag`が
二重タグ付けを防ぐため、無限ループや二重コストにはならない。

### タグ候補の初期値をGitHub全リポジトリのREADMEから選定(2026-07-17)

ユーザー指示: 「タグ候補の初期値を決めて、distから取ってきたその時点で既に入っているように
してほしい。GitHubの全リポジトリのREADMEだけ読んで作って」。従来`tagCandidates`は空配列が
既定で、ユーザーが手で1件ずつ追加するまで何も無かった。`gh api repos/{owner}/{repo}/readme`で
`zappyzed100`の全17リポジトリ(公開・非公開含む。`kindless`はREADME無し)のREADMEを取得して
読み、繰り返し登場する技術/ドメインから18件を選定して`src/lib/storage/storage.ts`の
`DEFAULT_SETTINGS.tagCandidates`へ設定した(Python/TypeScript/Rust/Flutter/Chrome拡張/LLM/
ガードレール/Playwright/データエンジニアリング/最適化/UI・UX/睡眠記録/Google Apps Script/
Google Drive連携/自動化/ポートフォリオ/ドットファイル/メディアプレイヤー)。選定はREADMEの
内容のみを根拠にした一度きりの作業で、以後の追加リポジトリを自動追随する仕組みは無い
(必要になれば再度同じ手順で見直す)。ユーザーは引き続き「タグ候補」パネルから自由に
追加・削除できる(既定値は初回のみの下敷き)。
