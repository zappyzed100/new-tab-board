# src/newtab/components/board/ — フォルダ固有の知見

## 500件ボードは「カード位置」と「詳細ペイン」を分離する

`ViewportNote.tsx`は全ノートの軽量な`.note-cell`だけをDOMに維持し、表示領域±900pxのカードと
アクティブノートだけで`NoteEditorPane`をマウントする。画面外では直前の実高さを持つプレースホルダへ
置換するため、masonryの列高とスクロール位置を保ったままCodeMirror・各種scheduler・ボタン群を破棄
できる。500要素それぞれにObserverを作らず、モジュール内の単一IntersectionObserverを共有する。

本文が表示中に変更され、そのまま画面外へ出た場合は`onSuspend`を呼ぶ。App側はこれを即時
スナップショットへ配線し、ペイン破棄で5分timerがキャンセルされても編集履歴を失わない。
