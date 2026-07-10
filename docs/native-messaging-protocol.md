# native-messaging-protocol.md — Flow Launcher連携の通信規約(SPEC.md §4.10-d・§4.5.1)

このリポジトリが実装するのは**拡張側のクライアントのみ**(`src/lib/nativeMessaging.ts`)。
Flow Launcherのフォーク・native messaging hostの実装自体は別リポジトリで行う。
本書はその別リポジトリ側の実装が従うべき契約を定義する。

## 背景・設計方針

- Chrome拡張はネイティブアプリを直接起動できず、任意のファイルパスも読めない
  (サンドボックス)。実データの搬送にはNative Messagingが必須。
- MV3のservice workerは寝るため「hostが拡張を起こす」設計は不安定。**host側が
  .txtを受け取ったら新規タブを開き、拡張側から接続しに行くpull型**にする
  (SPEC.md §4.10-d)。
- native messagingの1メッセージ上限は約1MB。通常の.txtは問題ないが、契約として
  チャンク分割に対応する。

## host名

```
com.newtabboard.flow_launcher_bridge
```

host側はこの名前でnative messaging hostマニフェスト(実行ファイルパス + 拡張機能IDを
`allowed_origins`に許可)をOSに登録する(Windowsはレジストリ、macOS/Linuxは
`NativeMessagingHosts`ディレクトリ配下のJSON)。拡張機能ID
(`gimpafmoklcgklcggonojldigofjbnnj`——本リポジトリのmanifest.jsonの`key`から決定的に
算出される固定ID)を許可リストへ入れること。

## メッセージ形式(JSON、stdin/stdoutのnative messagingプロトコルに準拠)

### 拡張 → host: pull要求

接続直後に必ず1回送る。

```json
{ "type": "pull-pending-file" }
```

### host → 拡張: 保留ファイル無し

```json
{ "type": "no-pending-file" }
```

### host → 拡張: ファイル本体(チャンク分割)

1メッセージ = 1チャンク。`seq`は0始まり、`total`は全チャンク数。**先頭チャンク(seq=0)
にのみ`name`(ファイル名)を含める**。

```json
{
  "type": "file-chunk",
  "requestId": "任意の一意な文字列(この転送1回分の識別子)",
  "seq": 0,
  "total": 3,
  "name": "メモ.txt",
  "data": "本文の一部(chunk)"
}
```

拡張は`total`件のチャンクを`seq`順に結合して本文を復元する(受信順は問わない——
`nativeMessaging.ts`は`seq`をキーにMapへ格納してから結合する)。

### 拡張 → host: 受信確認(ack)

全チャンク受信後に1回送る。hostはこれを受けて当該ファイルを「配信済み」として
消費してよい(再送しない)。

```json
{ "type": "ack", "requestId": "…" }
```

## エラー・切断時の扱い

- host未インストール/接続失敗時、`chrome.runtime.connectNative`は`onDisconnect`を
  発火させ`chrome.runtime.lastError`にエラーメッセージが入る。拡張側はこれを
  「Flow Launcher未導入」として扱い、通常起動を継続する(エラー表示はしない)。
- チャンク受信中に(ackを送る前に)切断された場合、拡張側は`null`を返し、その回の
  取り込みを諦める(host側の再送責務——次に新規タブが開いた時に再度pull要求される)。

## 拡張側の呼び出し方

```ts
import { pullPendingFile } from "src/lib/nativeMessaging";

const result = await pullPendingFile(); // host未導入/エラー時はnull
if (result) {
  // result.name / result.content を新規ノートとして取り込む(App.tsxのopenFileAsNote)
}
```
