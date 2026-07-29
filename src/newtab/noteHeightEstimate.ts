// noteHeightEstimate.ts — 未測定ノートの高さを本文から見積もる(実測masonryの列割当用)
//
// 【なぜ必要か — 2026-07-29】
// 窓化(ViewportNote)は表示領域周辺のノートしかマウントしないため、**大半のノートは高さが
// 未測定**のまま列へ割り当てられる。以前は未測定を一律520pxとして扱っていたが、実際には
// 数千行=数万pxのノートがあり、見積もりが100倍以上ずれていた。
// 列割当はスティッキー(一度決めたら動かさない——上スクロール中に列が入れ替わる不具合の対策)
// なので、**割当時点の見積もりがそのまま最終的な列バランスになる**。結果、長文ノートを
// 520pxのつもりで詰めた列だけが数万px伸び、他の列は先に尽きて「何も無い領域=真っ黒」が
// 数万pxにわたって現れていた(実測: 3列で最大62,825pxの偏り。ユーザー報告の「真っ黒」)。
//
// 完全に当てる必要はない——**列割当が壊滅的に外れない程度に当たれば十分**で、マウント後は
// ResizeObserverの実測値が置き換える。行数から見積もるだけで桁のズレは消える。
import type { Note } from "../types";

/** ペインの本文以外(見出し・ツールバー・ステータス行・余白)の概算。 */
const CHROME_HEIGHT_PX = 200;
/** CodeMirrorの1行の高さの概算(既定フォントサイズでの実測値に近い値)。 */
const LINE_HEIGHT_PX = 17;
/** 1行に収まる概算文字数。これを超える行は折り返しで複数行ぶんの高さになる。
 * 列幅は画面幅依存だが、桁を合わせるのが目的なので固定の近似で足りる。 */
const CHARS_PER_LINE = 40;
/** 空ノート等でも下回らない下限(ViewportNoteのプレースホルダ既定と揃える)。 */
export const MIN_ESTIMATED_HEIGHT_PX = 520;

/** 本文から描画高さを見積もる。実測値が無いノートの暫定値として使う。 */
export function estimateNoteHeight(note: Pick<Note, "content">): number {
  let rows = 0;
  for (const line of note.content.split("\n")) {
    // 折り返しぶんを数える(空行も1行として数える)。
    rows += Math.max(1, Math.ceil(line.length / CHARS_PER_LINE));
  }
  return Math.max(MIN_ESTIMATED_HEIGHT_PX, CHROME_HEIGHT_PX + rows * LINE_HEIGHT_PX);
}
