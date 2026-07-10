# ui-parts.md — 機能ごとのUI部品リスト(仮置き・ドラフト)

UIスコアリング用途などで「機能→どのUI部品か」を突き合わせるための一覧。
採点基準が未確定な段階の仮置きで、後から構造ごと変わる前提。
`testid`は`data-testid`属性の値(Playwright等で要素を特定するのに使える)。

| 機能 | 部品(コンポーネント) | ファイル | testid(ルート) | 表示形態 |
|---|---|---|---|---|
| ブックマークグリッド | BookmarkGrid | `src/newtab/components/shell/BookmarkGrid.tsx` | `bookmark-grid` | 常時表示・グリッド |
| ノートタブ | NoteTabs | `src/newtab/components/notes/NoteTabs.tsx` | `note-tabs` | 常時表示・タブバー |
| ノート編集(CodeMirror) | Notepad | `src/newtab/components/notes/Notepad.tsx` | `notepad-editor` | 常時表示(プレビュー時は代わりにMarkdownPreview) |
| Markdownプレビュー | MarkdownPreview | `src/newtab/components/notes/MarkdownPreview.tsx` | `markdown-preview` | トグル時のみ表示 |
| スナップショット自動保存 | SnapshotScheduler | `src/newtab/components/notes/SnapshotScheduler.tsx` | (無し) | 見えないロジック専用(UIを持たない) |
| 履歴/diff | HistoryPanel | `src/newtab/components/notes/HistoryPanel.tsx` | `history-panel` | トグル表示・パネル |
| diff表示 | DiffView | `src/newtab/components/notes/DiffView.tsx` | `diff-view` | HistoryPanel内の子部品 |
| バックリンク | BacklinksPanel | `src/newtab/components/notes/BacklinksPanel.tsx` | `backlinks-panel` / `backlinks-empty` | ノート編集エリア内に常時表示 |
| 全文検索 | SearchPanel | `src/newtab/components/discovery/SearchPanel.tsx` | `search-panel` | トグル表示・パネル |
| 横断TODO集約 | TodoPanel | `src/newtab/components/discovery/TodoPanel.tsx` | `todo-panel` | トグル表示・パネル |
| コマンドパレット | CommandPalette | `src/newtab/components/discovery/CommandPalette.tsx` | `command-palette` | モーダル(Cmd/Ctrl+K) |
| オムニバー | Omnibar | `src/newtab/components/discovery/Omnibar.tsx` | `omnibar-form` | 常時表示・検索バー |
| ショートカット一覧 | ShortcutsModal | `src/newtab/components/discovery/ShortcutsModal.tsx` | `shortcuts-modal` | モーダル(`?`キー) |
| データ管理(JSON入出力/ファイル/NAS設定) | DataPanel | `src/newtab/components/shell/DataPanel.tsx` | `data-panel` | トグル表示・パネル |
| 時計 | Clock | `src/newtab/components/shell/Clock.tsx` | `clock` | 常時表示 |
| テーマ切替 | ThemeToggle | `src/newtab/components/shell/ThemeToggle.tsx` | `theme-select` | 常時表示・セレクトボックス |
| 小型カレンダー | MiniCalendar | `src/newtab/components/shell/MiniCalendar.tsx` | `mini-calendar` | トグル表示・パネル |
| Drive同期状態表示 | (App.tsx内・専用コンポーネント無し) | `src/newtab/App.tsx` | `drive-sync-status` | アクティブノートがある時のみ表示・バッジ |
| 次の予定カウントダウン | (App.tsx内) | `src/newtab/App.tsx` | `next-event-countdown` | 予定がある時のみ表示・バナー(最上部) |
| 予定前アラーム停止 | (App.tsx内) | `src/newtab/App.tsx` | `stop-pre-event-alarm` | アラーム中のみ表示・ボタン |
| Flow Launcher連携 | (UI無し・バックグラウンド処理) | `src/lib/externalIO/nativeMessaging.ts` | — | 取り込み結果は新規ノートとして間接的に見えるのみ |

## 補足
- 「常時表示」でも実際にはトグルボタン側(`toggle-search`等)がApp.tsx側にあり、その操作対象として上記パネル部品が出てくる形のものが多い(SearchPanel/TodoPanel/HistoryPanel/DataPanel/MiniCalendar)。
- スコアリングの単位を「コンポーネント単位」にするか「画面全体のスクリーンショット単位」にするかは、あちらのリポジトリでの設計待ち。
