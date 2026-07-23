# nas-native-messaging-protocol.md — NASブリッジの通信規約(SPEC.md §4.3)

`native-host/`(このリポジトリに同梱)が実装するnative messaging hostと、拡張側
クライアント(`src/lib/externalIO/nasNativeHost.ts`)の間の契約。

## 背景・設計方針

- Chrome拡張機能のページから`window.showDirectoryPicker()`を呼ぶと、実際に有効な
  フォルダを選択してもAbortErrorになる既知のChromiumバグがある
  (WICG/file-system-access#314、crbug.com/issues/40240444)。バージョンによって
  再現したりしなかったりする不安定なバグで、JSだけでの回避策は無い。
- 拡張機能はサンドボックスの都合上、任意のファイルパスへ直接アクセスできない。
  確実に直すにはNative Messaging(PC側に常駐する別プログラムと標準入出力で
  JSON通信する)以外に方法が無い。
- Flow Launcher連携(`docs/native-messaging-protocol.md`)と違い、こちらは
  本アプリ専用の自作ブリッジのため、host本体もこのリポジトリの`native-host/`に
  同梱する(別リポジトリ化しない)。

## host名

```
com.newtabboard.nas_bridge
```

`native-host/install_windows.py`が、この名前でnative messaging hostマニフェスト
(実行ファイルパス + 拡張機能IDを`allowed_origins`に許可)をWindowsレジストリへ
登録する。拡張機能ID(`gimpafmoklcgklcggonojldigofjbnnj`——本リポジトリの
manifest.jsonの`key`から決定的に算出される固定ID)を許可リストへ入れる。

## メッセージ形式(JSON、stdin/stdoutのnative messagingプロトコルに準拠)

Flow Launcher連携と異なりリクエスト/レスポンスの1往復で完結する(接続→1メッセージ
送信→1メッセージ受信→切断、を操作のたびに繰り返す)。

### フォルダへの到達性確認(probe)

```json
{ "type": "probe", "path": "Z:\\NAS\\backup" }
```

```json
{ "type": "probe-result", "ok": true }
```

```json
{ "type": "probe-result", "ok": false, "error": "エラー内容" }
```

### ファイル書き込み(write-file)

`filename`は`2026/7/12/n1-123-s1.txt`のような**サブフォルダ付きの相対パス**を許す
(年/月/日でフォルダ分けする——`nasArchive.ts`)。hostは`path`(NASベースフォルダ)配下に
中間フォルダを自動生成してから書き込む。ただし`path`自体が存在しない(NAS未接続等)場合は
幻のローカルフォルダをでっち上げず失敗させる。`..`等でベースの外へ出るパスは拒否する
(`ok: false`)。NASへ書く本文は**プレーンテキスト**(gzip+base64ではない。そのまま
エディタで開いて読める——ユーザー指示)。統一構造の `active/<id>.md` と日付フォルダ
`YYYY/M/D/<id>.md` は **Markdown + YAML front matter**(id/title/tags/created_at/updated_at + 本文)で
書く——これもプレーンテキストなので host 側の扱いは同じ(そのまま書くだけ。Drive側と完全一致)。

```json
{ "type": "write-file", "path": "Z:\\NAS\\backup", "filename": "2026/7/12/n1-123-s1.txt", "content": "本文" }
```

```json
{ "type": "write-result", "ok": true }
```

```json
{ "type": "write-result", "ok": false, "error": "エラー内容" }
```

### ファイル読み込み(read-file)

`filename`は書き込み時と同じサブフォルダ付き相対パス。

```json
{ "type": "read-file", "path": "Z:\\NAS\\backup", "filename": "2026/7/12/n1-123-s1.txt" }
```

```json
{ "type": "read-result", "ok": true, "content": "本文" }
```

```json
{ "type": "read-result", "ok": false, "error": "エラー内容" }
```

### ファイル削除(delete-file)

`filename` は書き込み時と同じサブフォルダ付き相対パス。ブラウザで消された/空になったノートの
`active/<id>.md` を消すために使う。**既に無い場合も `ok:true`**(消したい結果は達成)。`..` 等で
ベースの外へ出るパスは拒否。

```json
{ "type": "delete-file", "path": "Z:\\NAS\\backup", "filename": "active/<id>.md" }
```

```json
{ "type": "delete-result", "ok": true }
```

### 世代番号の読取/加算(read-generation / bump-generation)

タブ(ブラウザ)と NAS active の同期に使う世代カウンタ(`data/generation.txt` に整数1つ)。
ブラウザは操作開始時に `bump-generation` で新世代=所有権を得て、以後 active を上書きしてよいのは
NAS の世代が自分の世代と一致するときだけ。NAS の方が大きい=他セッションが新しい→pull(ユーザー指示)。
未作成なら世代 0。`path` 自体が無ければ `ok:false`。負値・非現実的な巨大値(10^15超)は 0 として扱う
(世代ファイルが壊れていた場合の保険)。

```json
{ "type": "read-generation", "path": "Z:\\NAS\\backup" }
```

```json
{ "type": "generation-result", "ok": true, "generation": 3 }
```

`bump-generation` は **CAS(compare-and-swap)**——呼び出し側が自分の知っている現在世代を
`expected` として渡し、NAS上の現在値と一致する場合のみ +1 して返す(2026-07-19是正)。
不一致(=呼び出し側がまだ最新のNAS状態を取り込めていない)なら `ok:false, stale:true` と
現在値を返す。呼び出し側はこの現在値を受け取ったら、まず `read-active` でpullしてローカルを
最新化してから、必要なら改めて `bump-generation` を試みる契約にする(無条件bumpのままだと、
他タブが既に進めた世代を知らないタブが所有権を奪ってしまい、そのタブの持つ古いノート一覧が
active へ丸ごと書き戻される——他タブの削除がロールバックされる実害があった)。

```json
{ "type": "bump-generation", "path": "Z:\\NAS\\backup", "expected": 3 }
```

```json
{ "type": "generation-result", "ok": true, "generation": 4 }
```

```json
{ "type": "generation-result", "ok": false, "stale": true, "generation": 5 }
```

### active の一括読取(read-active)

`active/` 直下の `.md` を全部(ファイル名+内容)返す。pull(タブを NAS active で上書き)に使う。
`active/` が無ければ空リスト。サブフォルダは対象外(active は `<id>.md` の平置き)。

```json
{ "type": "read-active", "path": "Z:\\NAS\\backup" }
```

```json
{ "type": "read-active-result", "ok": true, "files": [
  { "filename": "n1.md", "content": "---\nid: n1\n...\n---\n\n本文" }
] }
```

### 索引の再生成(rebuild-index)

`notes/*.md` と履歴 `年/月/日/*.txt` から `data/index.db`(SQLite)を作り直す(build_index.py)。

```json
{ "type": "rebuild-index", "path": "Z:\\NAS\\backup" }
```

```json
{ "type": "rebuild-result", "ok": true, "notes": 3, "snapshots": 12 }
```

### 履歴のタグ＋本文検索(search)

タグで絞り込み→本文の部分一致(LIKE)で“履歴”を検索する。ブラウザからSQLiteは叩けないため
Python側(nas_bridge.py)がindex.dbへSQLを実行し、結果だけ返す。`index.db`が無ければ
`ok:false`(先に rebuild-index が要る)。

```json
{ "type": "search", "path": "Z:\\NAS\\backup", "tags": ["登山"], "text": "高尾山", "mode": "and" }
```

```json
{ "type": "search-result", "ok": true, "rows": [
  { "note_id": "…", "title": "登山ノート", "timestamp": 1783830340293, "snippet": "…高尾山…" }
] }
```

### ノートのタグ+本文+期間検索(search-notes)

現在の `notes`(.md)を対象に、タグ(AND/OR)＋本文の部分一致(LIKE)＋期間(created_at の**半開区間**
`>= from AND < to`、ISO8601)で検索する。検索結果をノートへ貼り付けるため**本文(content)全文**も返す。
`index.db` が無ければ `ok:false`。

```json
{ "type": "search-notes", "path": "Z:\\NAS\\backup", "tags": ["登山"], "text": "高尾山",
  "mode": "and", "from": "2026-07-01T00:00:00.000Z", "to": "2026-08-01T00:00:00.000Z" }
```

```json
{ "type": "search-notes-result", "ok": true, "rows": [
  { "note_id": "…", "title": "登山計画", "created_at": "2026-07-01T00:00:00.000Z",
    "content": "…本文全文…", "snippet": "…高尾山…" }
] }
```

### 上位タグ(top-tags)

`notes` のタグを頻度降順で返す(検索UIの上位タグチップ用)。`index.db` が無ければ `ok:false`。

```json
{ "type": "top-tags", "path": "Z:\\NAS\\backup", "limit": 50 }
```

```json
{ "type": "top-tags-result", "ok": true, "tags": [ { "tag": "登山", "count": 12 } ] }
```

### フォルダの.md一覧(list-tree)

`subdir`(例: `library`)配下の `.md` を相対パスで再帰列挙する(ライブラリのツリー閲覧用)。
フォルダが無ければ空リスト。`..`等でbaseの外へ出るsubdirは拒否。

```json
{ "type": "list-tree", "path": "Z:\\NAS\\backup", "subdir": "library" }
```

```json
{ "type": "list-tree-result", "ok": true, "files": ["メモ.md", "仕事/2026/計画.md"] }
```

### ノート添付画像の書き込み/読み込み/一覧(write-binary / read-binary / list-images)

画像は `chrome.storage.local`(10MBクォータ)に載せず **NASにだけ** 置く(2026-07-23)。JSONに
バイト列は載らないので base64 で運ぶ。**テキスト用の write-file/read-file は utf-8 前提なので
相乗りさせない**——バイナリを utf-8 として読み書きすると壊れる。

```json
{ "type": "write-binary", "path": "Z:\NAS\backup", "filename": "images/<noteId>/<id>.png",
  "contentBase64": "iVBORw0K..." }
```
```json
{ "type": "write-binary-result", "ok": true }
```

```json
{ "type": "read-binary", "path": "Z:\NAS\backup", "filename": "images/<noteId>/<id>.png" }
```
```json
{ "type": "read-binary-result", "ok": true, "contentBase64": "iVBORw0K..." }
```

`list-images` は `images/` 配下の画像だけを `images/<noteId>/<name>` 形式で再帰列挙する
(起動時にブラウザが一括で取りに来る)。`list-tree` と分けているのは、あちらが `.md`/`.txt` だけを
返す契約で active/special の**突合削除**に使われており、画像を混ぜると削除対象がずれるため。

```json
{ "type": "list-images", "path": "Z:\NAS\backup" }
```
```json
{ "type": "list-images-result", "ok": true, "files": ["images/n1/a.png", "images/n2/b.webp"] }
```

## エラー・切断時の扱い

- host未インストール/接続失敗時、`chrome.runtime.connectNative`は`onDisconnect`を
  発火させ`chrome.runtime.lastError`にエラーメッセージが入る。拡張側はこれを
  失敗(`ok: false`相当)として扱う。
- 各操作は独立した接続で1往復のみ行う(Flow Launcher連携のような複数チャンクの
  やり取りは無い——NASのスナップショット本文はnative messagingの1メッセージ上限
  (約1MB)を通常超えないため)。

## 拡張側の呼び出し方

```ts
import { probeNasPath, readFileFromNas, writeFileToNas } from "src/lib/externalIO/nasNativeHost";

const ok = await probeNasPath("Z:\\NAS\\backup"); // host未導入/到達不可はfalse
await writeFileToNas("Z:\\NAS\\backup", "2026/7/12/foo.txt", "本文"); // 成功/失敗をboolean で返す
const content = await readFileFromNas("Z:\\NAS\\backup", "2026/7/12/foo.txt"); // 読めなければnull
```

## host側の導入手順

`native-host/README.md`参照。
