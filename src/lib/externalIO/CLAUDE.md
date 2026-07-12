# src/lib/externalIO/ — フォルダ固有の知見

## fake-indexeddbは関数を持つオブジェクトを保存できない(DataCloneError)

`nasArchive.ts`はNASフォルダの`FileSystemDirectoryHandle`をIndexedDBへ直接保存する
設計(ブラウザ仕様上は可能)。しかし`fake-indexeddb`(このプロジェクトのテスト環境)は
`getFileHandle`等のメソッドを持つオブジェクトの構造化複製を`DataCloneError`で拒否する。

**これはfake-indexeddb固有のバグではない**——手作りのフェイクディレクトリハンドルを
実際のChromeのIndexedDBへ保存しようとしたときも、同じ`DataCloneError`が実ブラウザで
再現した(Playwright MCPで実機確認済み)。つまり「関数プロパティを持つオブジェクトの
構造化複製」自体が本物の制約で、テスト環境だけの近似ではない。

対処は`nasArchive.ts`の関数群(`flushAllToNas`/`readArchivedSnapshot`/`getSnapshotBody`)
が`getNasDirectoryHandle`を依存注入で受け取れる形にすること——テストでは実IndexedDB
経由の保存を完全にバイパスしたフェイクハンドルを直接渡す。新しく似た関数を書くときも
このパターンを踏襲する。

## fake-indexeddbの状態は同一テストファイル内で永続する

同じ`.test.ts`ファイル内の複数テスト間で`fake-indexeddb`の状態はリセットされない
(ファイルをまたぐと別インスタンスになりリセットされる)。前のテストの後始末が
次のテストの集計件数に混入するバグを`nasArchive.test.ts`で実際に踏んだ——集計件数の
比較ではなく、特定IDの状態を個別にassertする形で回避すること。

## showDirectoryPicker()はChromium拡張機能コンテキストで既知の不具合がある

NAS二層アーカイブ(`nasArchive.ts`)・`fileSystem.ts`の「フォルダへ書き出し」は
`FileSystemDirectoryHandle`の(NASは持続的な・書き出しは1回選ぶだけの)書き込み権限が
要るため、いずれも`window.showDirectoryPicker()`(呼び出しは`DataPanel.tsx`の
`handleSetNasFolder`/`handleExportFolder`)を使う。しかしChrome拡張機能のページから
呼ぶと、**ユーザーが実際にフォルダを選択してもAbortErrorで即座に失敗する**という
Chromium側の既知バグがある(WICG/file-system-access#314、crbug.com/issues/40240444。
拡張機能コンテキスト特有・Chromeバージョンによって再現したりしなかったりする)。

このバグが原因のAbortErrorと、ユーザーが本当にダイアログをキャンセルした場合の
AbortErrorは**アプリのコードからは区別不可能**(どちらも同じ`DOMException`)。
そのため両方の呼び出し元はAbortError発生時に「キャンセルまたは失敗」の両方を
まとめて案内するメッセージを表示する(片方だけを想定した文言にしない)。

「フォルダへ書き出し」は一時`chrome.downloads`のsaveAsを1件ずつ出す方式(この既知
バグの影響を受けない)へ置き換えたが、「フォルダを1回選んで全ノートをそこへ書き出し
たい」という要望(ユーザー指示)により`showDirectoryPicker`を使う設計へ戻した——
この既知バグに実際に当たった場合は「キャンセルした」という体で処理が打ち切られる
(≒無反応ではなくエラーメッセージが出る、という最低限の対応にとどめている)。
`fileSystem.ts`の「ファイルを開く」だけは`<input type="file">`へ置き換え済みで、
この既知バグの影響を受けない。

## nativeMessaging.tsのテスト

`chrome.runtime.connectNative`は`Port`を返す同期API。テストでは`connectNative`を
引数として差し替え可能にし(`ConnectNativeFn`)、フェイクPortの`onMessage`/`onDisconnect`
リスナーを手動で発火させる形でチャンク分割・再結合・エラー処理を検証する
(`nativeMessaging.test.ts`のパターンを踏襲)。
