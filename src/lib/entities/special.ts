// special.ts — ⭐スター/スペシャル(保管棚)の純粋ロジック(I/Oなし)。
// ユーザー指示: ⭐でスペシャルへ保管。ノートがボードにある間はそのノートに追従表示し、ノートを
// 削除した時点の内容で凍結(SpecialItem)して残す。フォルダで整理でき、NAS/Driveの special/ に対応。
import type { Note, SpecialItem } from "../../types";

/** スペシャル一覧の表示エントリ(live=ボードにあるスター済みノート / frozen=削除済みの凍結項目)。 */
export type SpecialEntry = {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  folder?: string;
  source: "live" | "frozen";
};

/** フォルダパスの正規化(前後空白・前後スラッシュを除く)。 */
export function normalizeFolder(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

/** ノートのスター(special)をトグルする。 */
export function toggleNoteSpecial(notes: Note[], id: string): Note[] {
  return notes.map((n) => (n.id === id ? { ...n, special: !n.special } : n));
}

/** 削除されるノートがスター済みなら、その内容を凍結 SpecialItem として返す(でなければnull)。 */
export function freezeNoteToSpecial(note: Note, now: number): SpecialItem | null {
  if (!note.special) return null;
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    tags: note.tags,
    folder: note.specialFolder,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    frozenAt: now,
    // 「この端末のみ」ノートを⭐削除しても、凍結内容が special ミラー/設定バックアップへ出ないよう引き継ぐ。
    ...(note.noSync ? { noSync: true } : {}),
  };
}

/** 凍結項目リストへ追加/更新(同idは置換)。 */
export function upsertSpecialItem(items: SpecialItem[], item: SpecialItem): SpecialItem[] {
  return [...items.filter((i) => i.id !== item.id), item];
}

/** 凍結項目を削除する。 */
export function removeSpecialItem(items: SpecialItem[], id: string): SpecialItem[] {
  return items.filter((i) => i.id !== id);
}

/** 凍結項目のフォルダを変更する。 */
export function setSpecialItemFolder(
  items: SpecialItem[],
  id: string,
  folder: string,
): SpecialItem[] {
  const f = normalizeFolder(folder);
  return items.map((i) => (i.id === id ? { ...i, folder: f || undefined } : i));
}

/** フォルダ一覧へ追加(重複・空は無視)。正規化して返す。 */
export function addSpecialFolder(folders: string[], path: string): string[] {
  const p = normalizeFolder(path);
  if (p === "" || folders.includes(p)) return folders;
  return [...folders, p];
}

/** live(ボードのスター済みノート)+ frozen(凍結項目)を合わせた表示エントリを、
 * フォルダ→タイトルの順で返す。ノートが生きていれば同idの凍結より live を優先する。 */
export function specialEntries(notes: Note[], items: SpecialItem[]): SpecialEntry[] {
  const live: SpecialEntry[] = notes
    .filter((n) => n.special)
    .map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      tags: n.tags,
      folder: n.specialFolder,
      source: "live" as const,
    }));
  const liveIds = new Set(live.map((e) => e.id));
  const frozen: SpecialEntry[] = items
    .filter((i) => !liveIds.has(i.id))
    .map((i) => ({
      id: i.id,
      title: i.title,
      content: i.content,
      tags: i.tags,
      folder: i.folder,
      source: "frozen" as const,
    }));
  return [...live, ...frozen].sort(
    (a, b) => (a.folder ?? "").localeCompare(b.folder ?? "") || a.title.localeCompare(b.title),
  );
}

/** スペシャルエントリ一覧の「変化検出シグネチャ」(NAS/DriveどちらのpushもハッシュベースではなくJSON
 * 比較の等価判定で「変わっていなければ書かない」を行うため共用する)。id/folder/title/content だけを
 * 見るため、ノート本体の並べ替え(ピン留め・上へ・ドラッグ)で order が変わっても、スペシャル項目
 * そのものの中身が変わらなければ同じ文字列を返す——並べ替えのたびに⭐全件が無駄に再書き込みされて
 * いた問題の修正(2026-07-16)。 */
export function specialSyncSignature(entries: SpecialEntry[]): string {
  return JSON.stringify(entries.map((e) => [e.id, e.folder ?? "", e.title, e.content]));
}
