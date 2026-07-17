# gas/ — スマホのバッテリー低下警告をNew Tab Boardへ中継するGoogle Apps Script

このフォルダはリポジトリのビルド/テスト対象外です(Google Apps Script はGoogleのクラウドで
動くコードで、npm/vitest/playwrightのどれからも実行されません)。手動でデプロイします。

## なぜGASを使うか

スマホと拡張機能(New Tab Board)は別デバイスなので、間を橋渡しする何かが必要です。GASを
Web Appとして公開すると、スマホ側は認証不要の単純なHTTPリクエストを送るだけで済み(GAS自身が
Googleアカウントの権限で動くため、スマホ側にOAuth設定が要らない)、拡張機能側も単純な
`fetch()`で最新値を読めます。

## デプロイ手順

1. [script.google.com](https://script.google.com) で新規プロジェクトを作成
2. `battery-webhook.gs` の中身をエディタへ丸ごと貼り付け
3. `SHARED_TOKEN` を自分だけの長いランダム文字列に書き換える(例:
   `openssl rand -hex 32` やパスワードマネージャーで生成したものを使う。第三者にURLを
   知られても、このトークンを知らなければ書き込み/読み取りできない)
4. 右上「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」を選択
   - 実行するユーザー: 自分
   - アクセスできるユーザー: 全員
5. デプロイ後に表示される「ウェブアプリのURL」(`https://script.google.com/macros/s/.../exec`)
   と、手順3のトークンを、New Tab Boardの「データ管理」→「バッテリー警告を設定」へ入力する

## スマホ側の自動化設定

GASのURLへ、バッテリー残量が下がった時に以下のJSONをPOSTするよう設定する:

```json
{ "token": "<手順3で決めたトークン>", "level": <0-100の整数> }
```

### Android(Tasker / Automate / MacroDroid等)

- トリガー: バッテリーレベル(例: 50%以下になった時)
- アクション: HTTP Request(POST)
  - URL: デプロイ後のウェブアプリURL
  - Body: `{"token":"<トークン>","level":%batteryLevel%}` (アプリ側の変数名は各ツールで異なる)
  - Content-Type: `application/json`

### iOS(ショートカット)

- 個人用オートメーション → バッテリー残量(iOS 16以降。または定期実行+「バッテリー残量を取得」
  アクションで条件分岐)
- アクション「URLの内容を取得」
  - URL: デプロイ後のウェブアプリURL
  - メソッド: POST
  - 本文(JSON): `{"token": "<トークン>", "level": <バッテリー残量>}`

New Tab Board側は1時間おきにこのURLへ`GET ?token=<トークン>`で問い合わせる(予定前アラームと
同じ仕組みを再利用)。GAS側は**読んだら即座に値を削除する(consume-on-read)**ため、doGetが
非nullを返した=スマホが新たに閾値を下回った未処理イベント、という単純な1回限りの
メールボックスとして機能し、そのたびに1回だけ警告が鳴る。拡張機能側で「どの閾値を
もう鳴らしたか」を記憶・比較する必要はない(閾値の再武装判断はconsume-on-readの削除が
兼ねる)。
