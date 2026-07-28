// useNoteScrollAnchor.ts — 再配置でノートが動いても「読んでいる位置」を動かさないスクロールアンカー
//
// 実測masonry(App.tsxのnoteLayout)は、ノートの高さが確定/変化するたびに全ノートのtopを置き直す。
// 高さが確定する契機はスクロールそのもの(窓化でペイン/CodeMirrorがマウントし、仮の520px・320pxが
// 実測へ置き換わる)なので、**下へ読み進めるほど盤面が動いて読んでいた行を見失う**
// (ユーザー報告・2026-07-27)。セルは絶対配置+inline styleで動かしているため、ブラウザの
// スクロールアンカリングも効かない。
//
// ここでは原因を潰すのではなく**結果を打ち消す**: 画面内で一番よく見えているノートを常に覚えて
// おき、再配置の直後にそのノートの画面上の位置が変わっていたら、差分だけ即座にスクロールを
// 補正する。原因(高さの確定・件数の増減・列数の変化・文字サイズ変更…)を問わず効く。
import { useEffect, useLayoutEffect, useRef } from "react";

/** これ未満のズレは補正しない(丸め誤差でスクロールを揺らさない)。 */
const MIN_CORRECTION_PX = 1;

type Anchor = { noteId: string; viewportTop: number };

/** 画面内で一番大きく見えているノートセルを選ぶ。読んでいるのはこれ、という近似。
 * 走査対象は**表示中(mounted)のセルだけ**——全件(最大501)のrectを毎フレーム測ると、
 * 読みやすくするための処理自体がジャンクの原因になる。 */
function pickAnchor(): Anchor | null {
  const cells = document.querySelectorAll<HTMLElement>(
    '.note-cell[data-viewport-state="mounted"][data-note-id]',
  );
  const viewportHeight = window.innerHeight;
  let best: Anchor | null = null;
  let bestOverlap = 0;
  for (const cell of cells) {
    const rect = cell.getBoundingClientRect();
    const overlap = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
    if (overlap <= bestOverlap) continue;
    bestOverlap = overlap;
    best = { noteId: cell.dataset.noteId ?? "", viewportTop: rect.top };
  }
  return best;
}

/**
 * `layout` が変わるたびに、直前に覚えたアンカーノートの画面上の位置を保つようスクロールを補正する。
 * 引数はレイアウト計算の結果そのもの(参照が変われば再配置が起きたと見なす)。
 */
export function useNoteScrollAnchor(layout: unknown): void {
  const anchorRef = useRef<Anchor | null>(null);
  const frameRef = useRef<number | null>(null);

  // スクロール中はアンカーを追従させる(rAFで1フレーム1回に間引く)。補正で自分が起こした
  // スクロールでも同じ値が選び直されるだけなので、フィードバックループにはならない。
  useEffect(() => {
    const update = () => {
      frameRef.current = null;
      anchorRef.current = pickAnchor();
    };
    const onScroll = () => {
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  // 再配置の**直後・描画前**に補正する(useLayoutEffect)。useEffectだと補正前の状態が
  // 一度画面に出てしまい、視覚的にはガタつきとして見える。
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    // 最上部にいる時は補正しない——上端に貼り付いたままが期待される挙動で、
    // 補正すると「一番上にいたのに勝手に下がる」ことになる。
    if (!anchor || window.scrollY <= 0) {
      anchorRef.current = pickAnchor();
      return;
    }
    const cell = document.querySelector<HTMLElement>(
      `.note-cell[data-note-id="${CSS.escape(anchor.noteId)}"]`,
    );
    // アンカーが消えた(削除・固定タグで絞られた等)なら、比べる基準が無いので選び直すだけ。
    if (!cell) {
      anchorRef.current = pickAnchor();
      return;
    }
    const delta = cell.getBoundingClientRect().top - anchor.viewportTop;
    if (Math.abs(delta) >= MIN_CORRECTION_PX) window.scrollBy(0, delta);
    // **落ち着いた状態で必ず取り直す**。スクロール時にしか更新しないと、スクロールを止めた後に
    // 起きる再配置(高さの確定が続く・折り返しや文字サイズの変更)の時点で古いノートを掴んだままに
    // なる。実測(2026-07-27)では、スクロール直後に選ばれた列先頭のノート(topが動かない)を掴み
    // 続け、実際に読んでいたノートが2025px動いても delta=0 と判定していた。
    // scrollBy はこのレイアウト効果の中で同期的に効くので、この時点のrectは補正後の値になる。
    anchorRef.current = pickAnchor();
  }, [layout]);
}
