# src/newtab/components/notes/ — フォルダ固有の知見

## ノートは全件を1枚のボード(実測masonry)で常時表示する(2026-07-13にアルゴリズム変更)

旧「最大3件を横並び+チェックボックスで表示選択」モデルは撤去した(`resolveVisibleNoteIds`/
`MAX_VISIBLE_NOTES`/`note-tab-visible-*` は削除済み)。現在はノート**全件のカード**をボードに出し、
App.tsx が **各ペインの実高さ(ResizeObserver)を測り、`sortedNotes`(ピン→order)順に「その時点で
一番低い列へ入れる」greedy最密詰め**で各列(`.note-column`)へ振り分けて縦積みする(列数は画面幅から
`noteColumnCountFor`。最大3列)。**列固定(旧 `i % 列数`)から2026-07-13にユーザー選択「最密」で変更**。

ただし、全カード内の詳細ペインを常駐させてはいけない。最大501件すべてにEditorView・選択描画層・
scheduler・ボタン群を生成する構造はGPU/CPU資源を無制限に積み上げ、2026-07-19にBraveのHangWatcherが
GPU入力スレッド停止のダンプを採取する実害が出た。`components/board/ViewportNote.tsx`が表示領域周辺
だけ`NoteEditorPane`を生成し、さらに`Notepad.tsx`もCodeMirror単体の二重防御を持つ。回帰は
`e2e/stress/resource-budget.spec.ts`で500件時の詳細ペイン・CodeMirror・Observer・timer・DOM数を検査する。

- **測定の仕組み**: 各ペインを `ViewportNote`(`components/board/`・`.note-cell`)で包み、表示中だけResizeObserverで
  高さを親state(`noteHeights`)へ返す。列幅は一定なので**列を移っても高さは変わらず**、内容変更の
  ときだけ高さが変わる=再配置は入力時のみ(タイプ中のチラつきはこの範囲。ユーザー了承済みの割り切り)。
  ループ防止: `reportNoteHeight` は 0.5px 未満の差なら参照を変えない。
- **列高さがほぼ揃う**(greedyの最短列詰め=バランス保証: 列高さの差は最大ノート高さ未満)。長い
  ノートがあってもその列だけ突出しない。CSSの等高stretch(`align-items:stretch`)へ戻すと不具合。
- **並べ替え・削除・ピンはすべて linear order(`sortedNotes`)上の操作**。masonryの見た目は
  App側の振り分けが追従するだけ。`reorderNotesById`/`moveNoteUp`/`updateNote({pinned})` は
  `src/lib/entities/notes.ts`。
- **論理順序は `data-linear-index` で読む**: 実測masonryは列配置を高さで決めるため、列レイアウトから
  order を復元できない。各 `.note-cell` に order列での位置を `data-linear-index` で出す
  (E2E `notes-board.spec.ts` の `noteTitlesLinear` はこれをソートして順序を読む)。回帰は
  getBoundingClientRect で「列は重ならない・列内はgap詰め・列高さのばらつき<最大ノート高さ」を数値検証。

## ドラッグ交換は「掴んだidをApp側のrefで受け渡す」(DataTransferは使わない)

ノートペインのドラッグ入れ替えは、つまみ(`note-drag-handle-*`)の onDragStart で App の
`dragNoteIdRef` に自分のidを入れ、drop先ペイン(Card)の onDrop で App の `handleNoteDrop` が
そのidを読んで `reorderNotesById` する。**DataTransfer に id を載せない**のは、Playwrightの
合成ドラッグ(`locator.dragTo`)がペイン間で DataTransfer を運ばないため——refなら同期更新で
確実に受け渡せる(Reactステートだと dragstart→drop の間に再レンダが挟まらず古いclosureを
読む取りこぼしもある)。**dropは本文中央(CodeMirror)へ落とすとCM6がdropイベントを飲む**ので、
実質エディタ外のヘッダ(つまみ帯)へ落とす運用。drop許可のため Card の onDragOver は無条件
preventDefault。E2Eでも `dragTo` は相手ペインの**つまみ**へ落としている。

## 末尾に常に空ノートを3つ確保する(ユーザー指示)

`src/lib/storage/local-data-repository.ts`が排他コミット内で
`ensureTrailingEmptyNotes(notes, 3, now)`を適用する(`src/lib/entities/notes.ts`)。
**「末尾から連続する空ノート」が3未満のときだけ**補充する冪等関数で、起動時初期化と
ユーザー操作の差分コミットにだけ作用する。Appの購読effectから補充・再保存してはいけない——
複数タブが互いのstorage通知へ書き返すフィードバックループを防ぐため、購読は確定revisionの反映専用。
副作用: **末尾に非空ノートを置く操作(ファイル取り込み・末尾ノートへの入力)は、直後に空3つが
末尾へ追加される**ため、E2Eで「追加は+1件ちょうど」と数えると壊れる——件数固定で数えず、
対象ノートの存在で確認すること(`data-panel-fileio.spec.ts` はこの理由でタブの存在確認に
変更済み)。空ノートはNAS保存/自動タグの対象外(App.tsx・NoteEditorPane.tsx の
`content.trim()===""` ガード)。

## ノートタブは撤去済み(全件ボード表示のため不要になった・2026-07-13)

`NoteTabs.tsx` は削除した(ユーザー指示「ノートタブいらない」)。全件をボードで常時表示し、
末尾に常に空3つがあるため「タブで切替/追加」する意味が無い。旧タブの役割は各ペインへ移行済み:
追加=空ノートへ入力、リネーム=ペイン先頭の見出し(`.note-pane-title-input`)、削除=🗑ボタン、
並べ替え=ピン/⬆️優先度/⠿ドラッグ、選択=検索結果やバックリンクからの `selectNote`。
**E2Eはノート名を `note-tab-select-` で数えられなくなった**——ノート数は
`note-editor-area-`(ペイン)で数え、linear order は各 `.note-cell` の `data-linear-index` を
ソートして復元する(`notes-board.spec.ts` の `noteTitlesLinear`。実測masonryでは i%列数 の
復元式は使えない——列配置が高さ依存になったため)。

## 履歴サマリは「無からの頭」と「(編集)+変更箇所」を区別する

`summarizeSnapshot(current, previous)`(`src/lib/history/history.ts`)は、前スナップショットが
無い/空なら本文の頭(最初の非空行)を、既存を編集したなら `(編集)` を冠して最初に異なる行を返す
(ユーザー指摘「頭だけ見せられても分からない」)。サマリは**保存時に確定して Snapshot に格納**する
(`useSnapshotScheduler.ts` が `lastContentRef` を previous として渡す)ため、過去のスナップショットの
表記は遡って変わらない。セッション先頭の1件目は previous が null 扱い=「無から」表記になる既知の割り切り。
