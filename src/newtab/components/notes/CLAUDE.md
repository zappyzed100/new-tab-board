# src/newtab/components/notes/ — フォルダ固有の知見

## ノートは全件を1枚のボード(列固定masonry)で常時表示する(2026-07-12)

旧「最大3件を横並び+チェックボックスで表示選択」モデルは撤去した(`resolveVisibleNoteIds`/
`MAX_VISIBLE_NOTES`/`note-tab-visible-*` は削除済み)。現在はノート**全件**をボードに出し、
App.tsx が `sortedNotes`(ピン→order)を `i % 列数` で各列(`.note-column`)へ振り分けて
縦積みする(列数は画面幅から `noteColumnCountFor`。最大3列)。

- **「列固定・安定」を選んだ理由**(ユーザー選択): 高さ計測JSの本物masonryはタイプ中に
  ノートが別の列へ飛ぶ(チラつく)。列を order の index で固定すると、タイプで高さが
  変わっても列は動かない。短いノートの真下に次が詰まり、削除で全員がひとつ左上へ寄る。
  唯一の割り切り: 極端に長いノートはその列だけ縦に伸びる(高さは厳密には揃わない)。
- **並べ替え・削除・ピンはすべて linear order(`sortedNotes`)上の操作**。masonryの見た目は
  App側の振り分けが追従するだけ。`reorderNotesById`/`moveNoteUp`/`updateNote({pinned})` は
  `src/lib/entities/notes.ts`。CSSの等高stretch(旧 `align-items:stretch`)へ戻すと
  「短いノートのパディングが伸びる」不具合が再発する(回帰: `e2e/specs/notes-board.spec.ts`
  が getBoundingClientRect で数値検証している)。

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

App.tsx の維持effectが `ensureTrailingEmptyNotes(notes, 3, clockNow())` を適用する
(`src/lib/entities/notes.ts`)。**「末尾から連続する空ノート」が3未満のときだけ**補充する冪等
関数で、補充が無ければ同一参照を返す(effectが no-op を検知して再保存/無限ループを避ける)。
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
`note-editor-area-`(ペイン)で数え、linear order は列(masonry)から復元する
(`notes-board.spec.ts` の `noteTitlesLinear`: linear i は col i%列数 の row ⌊i/列数⌋)。

## 履歴サマリは「無からの頭」と「(編集)+変更箇所」を区別する

`summarizeSnapshot(current, previous)`(`src/lib/history/history.ts`)は、前スナップショットが
無い/空なら本文の頭(最初の非空行)を、既存を編集したなら `(編集)` を冠して最初に異なる行を返す
(ユーザー指摘「頭だけ見せられても分からない」)。サマリは**保存時に確定して Snapshot に格納**する
(`useSnapshotScheduler.ts` が `lastContentRef` を previous として渡す)ため、過去のスナップショットの
表記は遡って変わらない。セッション先頭の1件目は previous が null 扱い=「無から」表記になる既知の割り切り。
