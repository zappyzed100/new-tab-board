# src/newtab/components/board/ — フォルダ固有の知見

## 500件ボードは「カード位置」と「詳細ペイン」を分離する

`ViewportNote.tsx`は全ノートの軽量な`.note-cell`だけをDOMに維持し、表示領域±900pxのカードと
アクティブノートだけで`NoteEditorPane`をマウントする。画面外では直前の実高さを持つプレースホルダへ
置換するため、masonryの列高とスクロール位置を保ったままCodeMirror・各種scheduler・ボタン群を破棄
できる。500要素それぞれにObserverを作らず、モジュール内の単一IntersectionObserverを共有する。

本文が表示中に変更され、そのまま画面外へ出た場合は`onSuspend`を呼ぶ。App側はこれを即時
スナップショットへ配線し、ペイン破棄で5分timerがキャンセルされても編集履歴を失わない。

## セルは絶対配置。**親DOMを変える置き換えをしてはいけない**

`.note-cell`は`position:absolute`で、列は`columnIndex`(→`--note-column-index`→`left`)、縦位置は
`top`(px)をAppから受け取るだけ(`layout.css`)。**DOMの並びはorder順で固定**する。列ごとの`<div>`へ
振り分ける実装に戻すと、ノートが1件増減しただけでセルが別の親へ移り、Reactが再マウントして
CodeMirrorが破棄され、入力中のカーソルと以降の打鍵が失われる(2026-07-23の実害。回帰は
`e2e/specs/notes-board.spec.ts`「空ノートの2番目に入力しても…」がDOMノードの同一性で固定する)。
同じ理由で、位置合わせは`top`/`left`だけで行い、DOMの並べ替え(insertBefore)も避ける
——フォーカス中の要素をDOM上で動かすとChromeはblurする。
