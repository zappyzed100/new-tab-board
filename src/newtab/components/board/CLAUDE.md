# src/newtab/components/board/ — フォルダ固有の知見

## 500件ボードは「カード位置」と「詳細ペイン」を分離する

`ViewportNote.tsx`は全ノートの軽量な`.note-cell`だけをDOMに維持し、表示領域±640px
(`VIEWPORT_MARGIN_PX`)のカードとアクティブノートだけで`NoteEditorPane`をマウントする。画面外では
直前の実高さを持つプレースホルダへ置換するため、masonryの列高とスクロール位置を保ったまま
CodeMirror・各種scheduler・ボタン群を破棄できる。500要素それぞれにObserverを作らず、モジュール内の
単一IntersectionObserverを共有する。

本文が表示中に変更され、そのまま画面外へ出た場合は`onSuspend`を呼ぶ。App側はこれを即時
スナップショットへ配線し、ペイン破棄で5分timerがキャンセルされても編集履歴を失わない。

## 窓化は二重・内側を外側より広くする(2026-07-30)

セルの窓化(`ViewportNote.VIEWPORT_MARGIN_PX`=640)とは別に、`Notepad.tsx`側もCM6生成を遅らせる
内側の窓化(`EDITOR_VIEWPORT_MARGIN_PX`=900)を持つ(GPU描画層の累積対策・詳細は同ファイル冒頭の
コメント)。**内側は必ず外側より広くする**——逆転すると「セルはmounted・中のCM6はdeferred」の帯が
でき、そのペインがCM6側の最小高さ(約450px)まで潰れる。潰れた高さの下に「盤面が確保した高さ」との
差が実体のない空白として残り、上スクロール中に真っ黒な領域として見える実害が出た(2026-07-30に
実測: 高さ450pxのセルの下に9,526px、親コミットでは12,072pxの空白)。

## セルはmin-heightで確保ぶんを占め、実測は内側ラッパで取る

`.note-cell`は`min-height`にApp.tsx `noteLayout.assumedHeight`(盤面がそのノートのために積み上げに
使った高さ)を持たせ、中身が(CM6未生成等で)それより低くても確保ぶんを占め続ける。高さの実測
(ResizeObserver)は**セルではなく内側の`.note-cell-measure`(`layout.css`)で取る**——セルを測ると
min-heightという確保値を測り返してしまい、見積もりが永久に是正されない固定点になる。さらに
中のCM6が`[data-editor-state="deferred"]`の間は高さを報告しない(`ViewportNote`のResizeObserver
コールバック)——潰れた高さを確定させると盤面が縮んで読んでいた位置が跳ね(実測1,031px)、CM6生成時に
また戻ってしまう。回帰は`e2e/specs/note-scroll-anchor.spec.ts`「中のCM6が未生成のペインがあっても、
セルは盤面が確保した高さを占める」。

## セルは絶対配置。**親DOMを変える置き換えをしてはいけない**

`.note-cell`は`position:absolute`で、列は`columnIndex`(→`--note-column-index`→`left`)、縦位置は
`top`(px)をAppから受け取るだけ(`layout.css`)。**DOMの並びはorder順で固定**する。列ごとの`<div>`へ
振り分ける実装に戻すと、ノートが1件増減しただけでセルが別の親へ移り、Reactが再マウントして
CodeMirrorが破棄され、入力中のカーソルと以降の打鍵が失われる(2026-07-23の実害。回帰は
`e2e/specs/notes-board.spec.ts`「空ノートの2番目に入力しても…」がDOMノードの同一性で固定する)。
同じ理由で、位置合わせは`top`/`left`だけで行い、DOMの並べ替え(insertBefore)も避ける
——フォーカス中の要素をDOM上で動かすとChromeはblurする。
