# plan.md — 設計根拠

## src/newtab/components/clipboard/(貼り付け画像の一次保存・2026-07-13)
Ctrl+Vで貼り付けた画像を一次保存し、ノート類の下で一覧/クリップボードへコピー/削除する
(ユーザー指示。NASへは出さずローカルのみ)。ノート/検索とは独立した「クリップボード由来の一時
データ」という関心事のため `src/newtab/components/clipboard/` を新設。保存は既存の
IndexedDBシーム(`src/lib/storage/db.ts`)へ `pastedImages` ストア(DB v3)を足して集約する
——画像もsnapshot等と同じくブラウザ内ローカルに閉じる(sync/Drive/NASには乗せない)。

## ノートボードのmasonry(全件表示+ピン/並べ替え/末尾空3つ・2026-07-12、2026-07-13にアルゴリズム変更)
「最大3件を横並び+チェックボックス選択」を廃し、ノート全件を1枚のボードで常時表示する。
当初は `i%列数` の「列固定・安定」方式だったが、2026-07-13にユーザー選択で**実測masonry(最密)**へ
変更——各ペインの実高さを ResizeObserver で測り、`sortedNotes`(ピン→order)順に「その時点で一番低い
列」へ入れる greedy 最密詰め。列高さがほぼ揃う(バランス保証: 差<最大ノート高さ)。列幅一定ゆえ列を
移っても高さは不変で、再配置は内容変更時のみ(タイプ中のチラつきはこの範囲=ユーザー了承済みの割り切り)。
論理順序は列レイアウトから復元できないため各セルに `data-linear-index` を出す(E2E/デバッグ用)。
各ペインにピン/一つ上へ/ドラッグ交換を持たせ、末尾には常に空ノートを3つ確保する。設計詳細と
ハマりどころは `src/newtab/components/notes/CLAUDE.md`。

## native-host/ (NASブリッジ native messaging host・2026-07-12)
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

## UI層をRadix Themesへ全面移行 (2026-07-11)
「最小依存・自前実装優先」の方針(docs/stack.md)から転換し、`@radix-ui/themes`を
UIコンポーネントの標準として全面採用した(ユーザー指示)。詳細な根拠・ハイブリッド
構成(Radixに置き換えた部分/自前CSSを残した部分/生radix-uiを使った1ファイル)は
docs/stack.mdの該当節を参照。新規ディレクトリは作っていない(既存コンポーネント
ファイルの内部実装差し替えのみ)。

## src/offscreen/ (M12・2026-07-11)
予定前アラーム(SPEC.md §4.11)はMV3のservice workerが音声を再生できないため、
`chrome.offscreen`(reason: AUDIO_PLAYBACK)でオフスクリーンドキュメントを作り、
その中の`<audio loop>`でループ再生する。newtab/lib一方向のレイヤーとは別に
「拡張機能が生成する隠しページ」という第三のエントリポイントが必要なため、
`src/newtab/`と並ぶ`src/offscreen/`として新設した(background.tsと同じ思想で、
vite.config.tsに専用ビルドエントリを追加する)。

## src/background/ (Step 8b・2026-07-08)
E2Eテストが拡張機能IDを解決するには service worker の存在が必要(Manifest V3では
`context.serviceWorkers()` / `waitForEvent("serviceworker")` でIDを取得する)。
本アプリは新しいタブ上書きのみで機能的にはbackgroundを必要としないが、E2E観察の
ためだけに最小限のno-opに近いservice worker(`background.ts`)を追加した
(インストール時に`logOp`で1行ログを出す以外は何もしない)。

## src/lib/gemini/ (Gemini連携の土台・2026-07-12)
ノートの自動タグ付け・要約・TODO抽出(ユーザー要望)は、いずれもGoogle Gemini APIの
`generateContent`を呼ぶ共通の土台を必要とする。drive/(Google Drive)と同じく「特定の
外部サービス連携」という独立した関心事なので、`src/lib/`直下に専用ディレクトリ
`src/lib/gemini/`を新設した(seamは`gemini.ts`の`callGemini`一本。fetchを依存注入で
差し替えテスト可能)。APIキーは秘匿情報のため、syncにもDriveの全データJSONバックアップにも
乗らないIndexedDBの設定ストア(db.tsの`getGeminiApiKey`/`setGeminiApiKey`)へ保存する。
無料枠に収まりやすいflashモデル(gemini-2.0-flash)を既定にする。

## タグ検索: Markdown+front matter正本 + SQLite再生成インデックス (2026-07-12)
ユーザー設計を採用。正本はNAS上の「1ノート=1つの .md + YAML front matter」
(id/title/tags/created_at/updated_at、AI要約は source_note_id/generated_by)。
書き出しはnative-host(nas_bridge.py)経由。**ブラウザ拡張からSQLiteは直接使えない**ため、
アプリ内のタグ検索はメモリ内フィルタ＋既存IndexedDB(search.ts)で行う(ノートは最大501件・
全件メモリ上なので索引不要で一瞬)。「外部ツールでSQL検索したい」用途のため、native-host側に
Python(標準ライブラリのsqlite3のみ)で notes/*.md → data/index.db を再生成するツール
(build_index.py)を別途置く。index.dbは消えても.mdから再生成できる(正本は.md)。
front matterのパースは形式を自前で制御しているため最小の自前パーサで済ませPyYAML依存は持たない。

## タブ↔NAS active の世代同期 / ⭐スペシャル(保管棚) (2026-07-13)
- **世代同期**(ユーザー指示): タブとNAS activeを世代番号(NAS `data/generation.txt`)で突き合わせる。
  人間の初回編集で `bump-generation`→所有権取得。5分毎+ロード時に、所有者で同世代なら push
  (active上書き+日付追記+削除突合)、NASが新しければ pull(NAS activeでノートを丸ごと上書き=最終
  操作者優先)。native host に read/bump-generation・read-active を追加、md↔Note逆パーサ
  (`markdownToNote`)で pull を復元。NAS active への per-note 書き込みは廃し 5分 push へ一本化。
- **⭐スペシャル**(ユーザー指示): ノート見出しの ☆/⭐ で「保管棚」へ。ボードにある間は追従、削除で凍結
  (`SpecialItem`)して残る。サイドバーの SpecialPanel(TODOの下/タグ候補の上)でフォルダ作成・移動・
  開く・外す。NAS/Drive の `special/<folder>/<id>.md` へ書き出す(`specialSync`/`driveSpecial`)。
  純粋ロジックは `src/lib/entities/special.ts`。

## NAS/Drive/SQLite保存構造の統一 + タグ/本文/期間検索 + 検索結果の貼り付け (2026-07-13)
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

## UIの一括リデザイン(トークン化+アイコン化+レイアウト再構成・2026-07-16)
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
