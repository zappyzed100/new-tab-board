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
エディタで開いて読める——ユーザー指示)。

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
