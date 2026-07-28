// fixedTagPresets.ts — 固定タグモードのプリセット(名前付きタグの組)の純粋な操作。I/Oは持たない。
// 選択中プリセットのタグは「編集を終えたノートへの追記」(tags.ts の applyFixedTags)と
// 「盤面の絞り込み」(search/tagSearch.ts の filterNotesByFixedTags)の両方の入力になる。
import { normalizeTagName } from "./tags";
import type { FixedTagPreset } from "../../types";

/** 入力欄の文字列(例: "仕事 #2026, 打合せ")をタグ配列にする。空白/カンマ/読点で区切り、
 * 各語を normalizeTagName で本文の `#タグ` として成立する形へ丸め、空と重複を落とす。
 * ここで丸めておかないと、本文へ書いた `#タグ` と extractTags の抽出結果が食い違い、
 * 「付けたのに絞り込みに出てこない」固定タグが生まれる。 */
export function parseFixedTagInput(raw: string): string[] {
  const out: string[] = [];
  for (const word of raw.split(/[\s,、]+/)) {
    const tag = normalizeTagName(word);
    if (tag !== "" && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** プリセットを末尾へ追加する。名前が空、またはタグが1つも無ければ元配列をそのまま返す
 * (タグ0個のプリセットは選んでも何も固定しない=モードOFFと区別できないため作らせない)。
 * id は呼び出し側が渡す(この関数を純粋に保つため crypto.randomUUID を内部で呼ばない)。 */
export function addFixedTagPreset(
  presets: FixedTagPreset[],
  name: string,
  tags: string[],
  id: string,
): FixedTagPreset[] {
  const trimmed = name.trim();
  if (trimmed === "" || tags.length === 0) return presets;
  return [...presets, { id, name: trimmed, tags }];
}

/** 指定idのプリセットを取り除く。 */
export function removeFixedTagPreset(presets: FixedTagPreset[], id: string): FixedTagPreset[] {
  return presets.filter((p) => p.id !== id);
}

/** 現在選択中のプリセットのタグ(未選択・該当なし=空配列=固定タグモードOFF)。
 * 「モードON/OFF」を別フラグで持たず、この配列が空かどうかだけを唯一の判定にする
 * (フラグとidの2つが食い違う状態を作らない)。 */
export function activeFixedTags(presets: FixedTagPreset[], activeId: string | undefined): string[] {
  if (!activeId) return [];
  return presets.find((p) => p.id === activeId)?.tags ?? [];
}
