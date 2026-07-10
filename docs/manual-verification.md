# manual-verification.md — 外部連携フェーズ(M10〜M14)の実機確認チェックリスト

自動テスト(vitest/tsc/eslint/e2e/CI)では検証できない項目。`npm run build`後、
`chrome://extensions`でデベロッパーモード→パッケージ化されていない拡張機能を読み込む
→`dist/`を選択してから、それぞれ実際に操作して確認する。

## M10 — Google Drive自動同期
- [ ] ノートを編集 → OAuth許可ダイアログ(自分のGoogleアカウント)が出るか
- [ ] 許可後、Google Driveに`<ノート名>.md`ファイルが作られるか
- [ ] ノート付近の同期状態表示(「☁同期済」等)が正しく変化するか
- [ ] `Cmd/Ctrl+S`で即時同期がキックされるか

## M11 — Calendar読み取り + 次の予定カウントダウン
- [ ] Googleカレンダーに予定を1つ作っておく
- [ ] 新規タブ最上部に「次の予定まで N分(タイトル)」が表示されるか
- [ ] 予定開始後は「予定は進行中です」に切り替わるか

## M12 — 予定前アラーム
- [ ] 予定の10分前に音(ループ)が鳴るか
- [ ] `chrome.notifications`の通知(停止ボタン付き)が出るか
- [ ] 通知の「停止」ボタン、またはnew-tab上の「アラーム停止」ボタンで音が止まるか

## M13 — SSD→NAS二層アーカイブ
- [ ] データ管理パネルの「NASフォルダを設定」で実際のNAS上のフォルダを選択できるか
- [ ] 「今すぐNASへ書き出し」で未archivedのスナップショットがNASへファイルとして
      書き出され、履歴パネルに「(NAS保管)」表示が付くか
- [ ] NASを一時的に切断した状態でも履歴一覧の表示自体は壊れないか(degrade確認)

## M14 — Flow Launcher連携
- [ ] 別リポジトリ側でnative messaging host(`docs/native-messaging-protocol.md`の
      契約に準拠)を実装・OSに登録する
- [ ] host経由で.txtを渡した際、新規タブが開いて拡張が`connectNative`で接続し、
      内容が新規ノートとして取り込まれるか

## 前提(すでに完了済み)
- Google Cloud ConsoleでのOAuthクライアントID発行・テストユーザー登録は完了済み
  (`public/manifest.json`の`oauth2.client_id`に反映済み)
- 拡張機能IDは`gimpafmoklcgklcggonojldigofjbnnj`に固定済み(`manifest.json`の`key`)
