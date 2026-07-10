# src/background/ — フォルダ固有の知見

## service workerのテストの書き方(重要——テストを書く前に読む)

`background.ts`はモジュール読み込み時(トップレベルコード)に
`chrome.runtime.onInstalled`/`chrome.alarms.onAlarm`等へリスナーを**即座に**登録する。
つまりテストで`chrome`グローバルをスタブする前に静的`import`してしまうと、
登録処理は本物の(未スタブの)`chrome`に対して走ってしまい失敗するか、
存在しない`chrome`への参照でエラーになる。

**正しい手順**: `beforeAll`内で先に`vi.stubGlobal("chrome", fakeChrome)`してから、
**動的**`await import("./background")`でモジュールを読み込む(静的importは
ファイル先頭でホイストされテスト本体より先に評価されるため、スタブが間に合わない)。

登録されたリスナー関数(`onInstalled`/`onAlarm`/`onButtonClicked`/`onMessage`)は
オブジェクトに捕まえておき、以降のテストでは**新しいfake chromeへ差し替えてから
同じリスナー関数を呼び出す**——リスナー本体は呼び出し時点でグローバル`chrome`を
再参照する(登録時にキャプチャした古い`chrome`を握っているわけではない)ため、
`vi.stubGlobal`で差し替えるだけで新しい記録用配列/storageに向けて動作する。
`background.test.ts`がこのパターンの実例。

外部I/O(`getAuthToken`/`fetchNextEvent`)は`vi.mock`でモジュールごと差し替える。

## chrome.alarmsの再スケジュール

`chrome.alarms.create`は同名アラームを**上書き**する(明示的な`clear`は不要な場面もあるが、
「予定が無くなった」ケースは`clear`しないとアラームが残り続けるので、
`scheduleOrClearPreEventAlarm`のように無し/既に開始済み/未来の3分岐を明示的に扱う)。

## offscreenドキュメントは常に1つだけ

音声再生用の offscreen document は`fireAlarm`で作成し`stopAlarm`で閉じる、
という単純な1個だけの寿命管理。`chrome.offscreen.hasDocument()`で存在確認してから
`closeDocument()`する(無いのに閉じようとするとエラーになるため)。
