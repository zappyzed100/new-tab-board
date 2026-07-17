# New Tab Board

Chrome の新しいタブページを、個人用ダッシュボードに置き換える Manifest V3 拡張機能。
ブックマークグリッド・複数ノートのMarkdownエディタ(履歴/diff/全文検索/wikiリンク付き)・
小型カレンダー・JSON入出力などをまとめて提供する。外部認証・外部APIは
一切使わない「ローカル完結」構成——保存先はブラウザローカルの `chrome.storage`(sync/local)
と IndexedDB のみ(バックエンド無し)。技術選定の理由は [docs/stack.md](docs/stack.md) を参照。
機能の詳細仕様は `SPEC.md` を参照。

## セットアップ

```sh
npm ci
uv tool install pre-commit   # 初回のみ
pre-commit install           # 初回のみ
```

## よく使う操作

このプロジェクトは共通動詞ルーター経由で操作する（規約: [AGENTS.md](AGENTS.md) §0）:

```sh
uv run scripts/dev.py up      # dist/ を継続ビルド(vite build --watch)
uv run scripts/dev.py test    # 単体テスト(vitest)
uv run scripts/dev.py e2e     # E2E(拡張機能を実際に読み込んだPlaywright)
uv run scripts/dev.py check   # 構造検査
uv run scripts/dev.py verbs   # 動詞一覧と配線状態
```

## Chrome へ読み込む

1. `npm run build` で `dist/` を生成する。
2. `chrome://extensions` を開き、デベロッパーモードを有効化する。
3. 「パッケージ化されていない拡張機能を読み込む」で `dist/` を選択する。
4. 新しいタブを開くとダッシュボードが表示される。

## 主な機能

- **ブックマークグリッド**: 追加/編集/削除・D&D並べ替え・数字キー1-9ジャンプ。
- **複数ノート(CodeMirror 6)**: Markdownプレビュー・`#タグ`・`[[wikiリンク]]`+バックリンク・
  インライン電卓(`3 * 8 =` → 結果を自動追記)。検索はノート編集エリア内のトグル(Cmd/Ctrl+F)。
- **履歴/diff**: 編集の切れ目(アイドル/blur/paste等)を自動検出してIndexedDBへgzip保存。
  diff表示・復元(復元前に現在値もスナップショット)。
- **全文検索**: 自前の転置インデックス(形態素解析なし・分かち書き言語向けの近似)。
  ショートカットは単一レジストリ駆動(`?`でチートシート)。
- **JSON入出力+ローカルファイル**: 全データのJSON書き出し/取り込み、File System Access
  経由での.txt読み込み・全ノートのフォルダ一括書き出し。
- **時計/テーマ(light/dark/auto)+小型カレンダー+単体TODOリスト**: サイドバーに常時表示の
  小型ウィジェット。カレンダーは日クリックでGoogleカレンダーへURL遷移(API/OAuth不要・一方向)。
  TODOリストはノート本文とは独立したシンプルな追加/完了/削除のみ(TodoMVC相当)。
- **Google Drive自動同期**: ノート現行内容のみを上書きミラー(履歴は上げない)。
- **Google Calendar読み取り+次の予定カウントダウン**: 数分おきのポーリング+
  ローカルティックで最上部に大きく表示。
- **予定前アラーム**: 予定の10分前から、停止するまで鳴り続ける(Chrome起動中のみ)。
- **SSD→NAS二層アーカイブ**: IndexedDB(SSD一次退避)からNASフォルダへ履歴本体を
  store-and-forward。
- **Flow Launcher連携(拡張側クライアントのみ)**: host本体は別リポジトリで実装
  (通信規約は`docs/native-messaging-protocol.md`)。

外部連携機能(Drive/Calendar/アラーム/NAS/Flow Launcher)は自動テストで検証できない
実機確認項目を伴う。チェックリストは[docs/manual-verification.md](docs/manual-verification.md)
を参照。

## 外部連携のセットアップ(人間が作業する箇所)

このプロジェクトは「未設定でも新しいタブ本体(ブックマーク/ノート/カレンダー小型表示等)は
動く」設計。以下はすべて**任意**の外部連携で、有効化するには人間がブラウザ外の画面
(Google Cloud Console・AI Studio・script.google.com・OS)を操作する必要がある。
どれも拡張機能内の「データ管理」パネル(サイドバー下部)から接続する。

### 1. Google Drive自動同期 + Googleカレンダー連携

**現状**: このリポジトリの`public/manifest.json`にはすでに動作確認済みのOAuthクライアント
(`oauth2.client_id`)が設定済みなので、**このリポジトリをそのままビルドして使うだけなら
Google Cloud Console側の作業は不要**——「データ管理」→「GDrive設定」ボタンを押して
Googleアカウントで許可するだけで、Drive同期とカレンダー次予定表示の両方が有効になる
(スコープは`drive.file`+`calendar.readonly`で、初回OAuth許可時に両方まとめて要求される)。

フォーク/自分の別プロジェクトとして使う場合など、**自分専用のOAuthクライアントを
新規発行する必要がある**ときの手順:

1. [Google Cloud Console](https://console.cloud.google.com/)で新規プロジェクトを作成
2. 「APIとサービス」→「有効なAPIとサービス」で **Google Drive API** と
   **Google Calendar API** を有効化する
3. 「OAuth同意画面」を設定する(External・テストユーザーに自分のGoogleアカウントを追加。
   本番公開審査は不要——個人利用のテストモードのままで動く)
4. 「認証情報」→「認証情報を作成」→「OAuthクライアントID」
   - **アプリケーションの種類は必ず「ウェブ アプリケーション」を選ぶ**
     (「Chrome拡張機能」型は選ばない——後述の理由で動かない)
   - 「承認済みのリダイレクトURI」に次を追加する:
     `https://<拡張機能ID>.chromiumapp.org/`
     (`<拡張機能ID>`は`chrome://extensions`で本拡張を開いたときに表示される32文字のID。
     `manifest.json`の`key`で拡張機能IDを固定しているので、ビルドし直してもIDは変わらない)
   - 発行された「クライアントID」を`public/manifest.json`の`oauth2.client_id`へ書き換える
5. `npm run build`し直して拡張機能を再読み込みする

   なぜ「Chrome拡張機能」型ではダメか: `chrome.identity.getAuthToken`(Chrome拡張機能型
   クライアント向けAPI)は、ブラウザ本体がGoogleに未サインインの環境だと旧カスタムURI
   スキーム経由のフォールバックへ落ち、2023-10のGoogleセキュリティ変更で
   `invalid_request: Custom URI scheme is not supported`エラーになり実機で動かなかった
   (詳細: [src/lib/drive/googleAuth.ts](src/lib/drive/googleAuth.ts)冒頭コメント)。
   そのため本プロジェクトは`launchWebAuthFlow`(`https://<id>.chromiumapp.org/`への
   リダイレクトを使う環境非依存の方式)へ移行済みで、これには「ウェブ アプリケーション」型の
   クライアントが要る。

- 同期先は Drive の `app/New Tab Board/` フォルダ配下(自動作成)。詳細は
  [src/lib/drive/CLAUDE.md](src/lib/drive/CLAUDE.md)。
- カレンダーは自分の「メイン(primary)」カレンダーのみを読む(カレンダーIDの指定UIは無い)。
- 実機確認チェックリストは[docs/manual-verification.md](docs/manual-verification.md)の
  M10・M10-b・M11を参照。

#### スマホから`active/`フォルダを開くショートカット(擬似持ち出し)

Drive上の`app/New Tab Board/active/`には各ノートの最新内容が常時ミラーされているので、
スマホのホーム画面にこのフォルダへ直接飛ぶショートカットを置くと、アプリを経由せず
Driveアプリ経由で最新ノートを閲覧できる(擬似的な持ち出し手段)。

**Android(Driveの標準ウィジェット)**:
1. ホーム画面の空いている場所を長押し→「ウィジェット」を選択
2. 「ドライブ」を探し、「ドライブのショートカット」をホーム画面へ追加
3. Googleアカウントを選択→開きたいフォルダ(`active`)を選択→「選択」/「追加」

`active`フォルダが選択画面に出ない場合は、先にDriveアプリ内でそのフォルダの「⋮」→
「整理」→「ショートカットを追加」から、マイドライブ直下にショートカットを作っておく。

**iPhone(「ショートカット」アプリ)**:
1. Driveアプリで`active`フォルダを開き、フォルダ横の「⋮」→「リンクをコピー」
   (コピーしただけでは共有設定は変わらない)
2. 標準「ショートカット」アプリ→右上「+」→「アクションを追加」→「URL」を追加し、
   コピーしたフォルダURLを貼り付ける
3. もう一度「アクションを追加」→「URLを開く」を追加
4. 画面上部のショートカット名を押して「ホーム画面に追加」、名前を付けて追加

どちらもDriveアプリがインストールされていればDriveアプリ内でフォルダが開く
(環境によってはSafari/ブラウザが開くこともあるが、同じフォルダへ辿り着く)。

### 2. Gemini APIキー(タグ付け/要約/TODO抽出)

1. [Google AI Studio](https://aistudio.google.com/apikey)で無料のAPIキーを発行する
   (`AIza...`から始まる文字列)
2. 拡張機能の「データ管理」→「Gemini APIキー」ボタンを押し、キーを貼り付けて保存する
   (キーは`chrome.storage`の設定ストアに保存され、Drive同期や全データバックアップには
   乗らない——秘匿情報として画面にも再表示されない)
3. 保存後は自動で有効になる。ノート保存時の自動タグ付け・要約・TODO抽出のいずれかを
   使うと呼び出される([src/lib/gemini/gemini.ts](src/lib/gemini/gemini.ts))
- 既定モデルは無料枠に収まりやすい軽量モデル(`DEFAULT_GEMINI_MODEL`。実際のAPIで
  404になる場合はこの定数だけを実在するモデルIDへ書き換える)
- 1日450回に達すると画面上部に乗り換え警告バナーが出る(無料枠の枯渇を事前に知らせる)
- 429(レート制限)を受けると1分間は自動でリクエストを止める(手動対応不要)

### 3. スマホのバッテリー低下警告(Google Apps Script中継)

スマホと拡張機能は別デバイスなので、間を橋渡しするサーバーとしてGoogle Apps Script(GAS)の
無料Web Appを使う。**この節がこのセットアップの中で一番手数が多い**——手順は
[gas/README.md](gas/README.md)に正本があり、以下はその要約:

1. [script.google.com](https://script.google.com)で新規プロジェクトを作成する
2. [gas/battery-webhook.gs](gas/battery-webhook.gs)の中身をエディタへ丸ごと貼り付ける
3. 貼り付けたコード内の`SHARED_TOKEN = "REPLACE_WITH_YOUR_OWN_LONG_RANDOM_TOKEN"`を、
   自分だけの長いランダム文字列に書き換える(生成例: `openssl rand -hex 32`。この
   トークンを知らない第三者はURLが漏れても読み書きできない――簡易認証の要)
4. 右上「デプロイ」→「新しいデプロイ」→歯車アイコンで種類「ウェブアプリ」を選択
   - 「次のユーザーとして実行」: **自分**
   - 「アクセスできるユーザー」: **全員**(スマホ側は認証なしでPOSTするため。
     トークン照合はスクリプト内部で行うので、これで公開しても安全)
5. デプロイ後に表示される「ウェブアプリのURL」
   (`https://script.google.com/macros/s/xxxxx/exec`の形式)をコピーする
6. 拡張機能の「データ管理」→「GAS連携を設定」ボタンを押し、上記URLと手順3のトークンを
   両方入力して保存する
7. スマホ側の自動化アプリを設定する(**ここも人間の作業**——OSごとに手段が違う):
   - **Android(Tasker / Automate / MacroDroid等)**: トリガーを「バッテリーレベルが
     指定%以下になった時」に設定し、アクションで「HTTP Request(POST)」を追加する。
     URLは手順5のURL、ContentTypeは`application/json`、Bodyは
     `{"token":"<手順3のトークン>","level":<バッテリー残量の変数>}`
     (変数名はアプリごとに異なる。Taskerなら`%BATT`等)
   - **iOS(ショートカット)**: 「個人用オートメーション」→「バッテリー残量」
     (iOS 16以降。無ければ定期実行トリガー+「バッテリー残量を取得」アクションで代替)
     →アクション「URLの内容を取得」で、メソッドPOST・本文(JSON)に
     `{"token":"<手順3のトークン>","level":<バッテリー残量>}`を設定する
8. 動作確認: 拡張機能側は15分おきに`GET ?token=<トークン>`でGASへ問い合わせる。GAS側は
   **読んだら即座に値を削除する(consume-on-read)**ため、非nullが返る=スマホが新たに
   閾値を下回った未処理イベントを意味し、そのたびに1回、予定前アラームと同じ音+通知で
   警告する(再武装のタイミングをchrome側で管理する必要は無い——詳細は
   [gas/battery-webhook.gs](gas/battery-webhook.gs)冒頭のコメント参照)

このGASコード自体は`npm`/`vitest`/CIのビルド・テスト対象外(Googleのクラウド上で動く
別ランタイムのコードのため)。中身を変更したら、上記手順2の貼り付けをやり直す必要がある。

### 4. SSD→NASアーカイブ(Native Messaging host)

ノート履歴をNASへ書き出すには、PC側に常駐する小さなPythonプログラム
(`native-host/nas_bridge.py`)をOSへ登録する必要がある(ブラウザの
`showDirectoryPicker()`には拡張機能から呼ぶと実機で必ず失敗する既知バグ
[WICG/file-system-access#314](https://github.com/WICG/file-system-access/issues/314)が
あり、回避策として標準入出力でJSON通信するこの方式にした)。

1. Python 3.11以降を用意する(`python --version`で確認)
2. `native-host/`フォルダで次を実行する:
   ```sh
   cd native-host
   python install_windows.py
   ```
   起動用ラッパー(`nas_bridge.bat`)とhostマニフェスト
   (`com.newtabboard.nas_bridge.json`)が生成され、Windowsレジストリ
   (`HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.newtabboard.nas_bridge`)
   へマニフェストの場所が登録される(**現状Windows専用**の手順)
3. `chrome://extensions`で拡張機能を再読み込みする
4. 拡張機能の「データ管理」→「NASフォルダのパス」欄にパス(例: `Z:\NAS\backup`や
   `\\myserver\backup`)を入力して「NASフォルダを保存」を押す
   (「設定しました」と出れば成功。「到達できませんでした」ならhost未導入か
   パスが誤っている)
5. アンインストールする場合は上記レジストリキーを削除し、`nas_bridge.bat`と
   `com.newtabboard.nas_bridge.json`(どちらも`install_windows.py`が生成した派生ファイル)を
   削除してよい

タグ検索用にNAS上の`.md`からSQLite索引を再生成したい場合(任意):
```sh
cd native-host
python build_index.py "Z:\NAS\backup"
```
詳細・SQLクエリ例は[native-host/README.md](native-host/README.md)を参照。

### 5. Flow Launcher連携

host本体(別リポジトリ)を[docs/native-messaging-protocol.md](docs/native-messaging-protocol.md)の
契約に沿って実装し、OSへnative messaging hostとして登録する必要がある。このリポジトリ側は
クライアント(`connectNative`呼び出し)のみを持ち、host実装は対象外。

## リポジトリの構成

- `src/newtab/` — 新しいタブページの React UI(`components/` に機能別コンポーネント)
- `src/lib/` — ストレージ・IndexedDB・ログ・時刻などの外部I/Oシーム（UIから直接叩かない —
  AGENTS.md §5）。全文検索・電卓・wikiリンクパーサ等の純粋ロジックもここに置く。
- `e2e/` — Playwright E2E（拡張機能を実際にロードして検証）
- `SPEC.md` — 機能仕様の正本
- `docs/stack.md` — 技術選定理由
- `docs/native-messaging-protocol.md` — Flow Launcher連携の通信規約(host側実装の契約)
- `docs/manual-verification.md` — 自動テストで検証できない実機確認チェックリスト
- `.guardrails/` — `GUARDRAILS.md` / `GOALS.md` / `BOOTSTRAP.md` / `CUSTOMIZE.md`。
  `bindings/catalog.md` / `AGENTS.md`（ルート）とあわせて、このリポジトリの出戻り防止機構
  （LLMエージェントとの協業ガードレール）の正本。作業前に読むこと。
