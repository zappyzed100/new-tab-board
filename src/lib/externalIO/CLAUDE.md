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

## nativeMessaging.tsのテスト

`chrome.runtime.connectNative`は`Port`を返す同期API。テストでは`connectNative`を
引数として差し替え可能にし(`ConnectNativeFn`)、フェイクPortの`onMessage`/`onDisconnect`
リスナーを手動で発火させる形でチャンク分割・再結合・エラー処理を検証する
(`nativeMessaging.test.ts`のパターンを踏襲)。
