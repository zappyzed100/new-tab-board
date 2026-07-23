// note-sync.ts — 端末内/Drive間でノートを欠落させずに和集合マージするロジック
// (競合コピーの生成だけは無言にせず logOp で観測点を張る — 過去に競合コピーが無音で
//  大量増殖した実害があり、次回は「どのIDが・どの差で・どのタイ時刻で」増えたかをログから追う)。
import type { Note } from "../../types";
import { isGeneratedEmptyPlaceholder, sortedNotes } from "../entities/notes";
import { logOp } from "../runtime/log";

export type NoteTombstones = Record<string, number>;

export type NoteMergeResult = {
  notes: Note[];
  tombstones: NoteTombstones;
};

function noteTimestamp(note: Note): number {
  return note.updatedAt ?? note.createdAt ?? 0;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** NAS/DriveのMarkdown往復で保持される、ユーザーが競合として確認すべきフィールドだけを比較する。
 * `taggedHash`等のローカル専用メタデータや false/undefined の表現差で競合コピーを作らない。 */
function comparableSyncedNote(note: Note): Record<string, unknown> {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    tags: note.tags ?? [],
    createdAt: note.createdAt ?? null,
    updatedAt: note.updatedAt ?? null,
    order: note.order,
    pinned: !!note.pinned,
    done: !!note.done,
    special: !!note.special,
    specialFolder: note.specialFolder ?? null,
    sourceNoteId: note.sourceNoteId ?? null,
    generatedBy: note.generatedBy ?? null,
  };
}

function sameSyncedNote(a: Note, b: Note): boolean {
  return JSON.stringify(comparableSyncedNote(a)) === JSON.stringify(comparableSyncedNote(b));
}

/** 競合コピーの原因追跡用: 2ノートで実際に異なる同期対象フィールド名を列挙する
 * (id/title は競合コピー側で書き換わるため除外——「本文差なのか order 差なのか」を見たい)。 */
function differingSyncedFields(a: Note, b: Note): string[] {
  const ca = comparableSyncedNote(a);
  const cb = comparableSyncedNote(b);
  return Object.keys(ca).filter(
    (k) => k !== "id" && k !== "title" && JSON.stringify(ca[k]) !== JSON.stringify(cb[k]),
  );
}

/** 旧判定がローカル専用メタデータ差だけで作った偽の競合コピーを安全に除去する。
 * 本文・タグ・配置等に差がある本物の競合コピーは残す。 */
function deduplicateRedundantConflictCopies(notes: Note[]): Note[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  return notes.filter((note) => {
    const match = /^(.*)-conflict-[a-z0-9]+$/.exec(note.id);
    if (!match) return true;
    const original = byId.get(match[1]);
    if (!original || note.title !== `${original.title} (競合コピー)`) return true;
    return !sameSyncedNote(original, {
      ...note,
      id: original.id,
      title: original.title,
    });
  });
}

function conflictCopy(note: Note, originalId: string): Note {
  const suffix = stableHash(JSON.stringify(note));
  return {
    ...note,
    id: `${originalId}-conflict-${suffix}`,
    title: `${note.title} (競合コピー)`,
  };
}

/** staleな全体保存同士を和集合にした際、別IDで二重化した自動空ノートだけをタイトルで畳む。
 * 複数タブが空状態から同時起動すると各タブが別IDのA/B/Cを作るため、入力順(local優先)で
 * 勝者を決めると各タブが自分のIDを書き戻し続ける。title→id順の決定的な勝者へ全タブを収束させる。 */
function deduplicateGeneratedPlaceholders(notes: Note[]): Note[] {
  const nonPlaceholders = notes.filter((note) => !isGeneratedEmptyPlaceholder(note));
  const winners = new Map<string, Note>();
  for (const note of notes) {
    if (!isGeneratedEmptyPlaceholder(note)) continue;
    const current = winners.get(note.title);
    if (!current || note.id.localeCompare(current.id) < 0) winners.set(note.title, note);
  }
  const placeholders = [...winners.values()]
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .slice(0, 3);
  return [...nonPlaceholders, ...placeholders];
}

/** ローカル/リモートの削除記録はnoteIdごとの最大時刻を採る。記録が無いことは削除を意味しない。 */
export function mergeTombstones(local: NoteTombstones, remote: NoteTombstones): NoteTombstones {
  const merged: NoteTombstones = { ...local };
  for (const [id, deletedAt] of Object.entries(remote)) {
    merged[id] = Math.max(merged[id] ?? 0, deletedAt);
  }
  return merged;
}

/**
 * ノートID単位のlosslessマージ。
 * - 片側だけにあるノートは必ず残す(不在を削除と解釈しない)。
 * - 明示tombstoneがノート以上に新しい場合だけ削除する。
 * - 同じIDはupdatedAtの新しい方を採る。同時刻で内容が違えば片方を競合コピーとして残す。
 */
export function mergeNoteCollections(
  localNotes: Note[],
  remoteNotes: Note[],
  localTombstones: NoteTombstones = {},
  remoteTombstones: NoteTombstones = {},
): NoteMergeResult {
  const tombstones = mergeTombstones(localTombstones, remoteTombstones);
  const localById = new Map(localNotes.map((note) => [note.id, note]));
  const remoteById = new Map(remoteNotes.map((note) => [note.id, note]));
  const mergedById = new Map<string, Note>();
  const allIds = new Set([...localById.keys(), ...remoteById.keys()]);

  for (const id of allIds) {
    const local = localById.get(id);
    const remote = remoteById.get(id);
    let winner: Note;
    let conflict: Note | undefined;

    if (!local) winner = remote as Note;
    else if (!remote) winner = local;
    else {
      const localTime = noteTimestamp(local);
      const remoteTime = noteTimestamp(remote);
      if (remoteTime > localTime) winner = remote;
      else if (localTime > remoteTime) winner = local;
      else {
        winner = local;
        if (
          !sameSyncedNote(local, remote) &&
          !(isGeneratedEmptyPlaceholder(local) && isGeneratedEmptyPlaceholder(remote))
        ) {
          conflict = conflictCopy(remote, id);
          // 無音の競合コピー増殖を追えるよう、生成の瞬間だけ観測点を張る(既存コピーは
          // 内容一致なら再生成されないためログも出ない=新規に増えた1件だけが記録される)。
          logOp(
            "note-sync",
            "conflict-copy",
            `id=${id} newId=${conflict.id} tiedAt=${localTime} ` +
              `fields=${differingSyncedFields(local, remote).join(",") || "(none)"} ` +
              `localLen=${local.content.length} remoteLen=${remote.content.length}`,
          );
        }
      }
    }

    const deletedAt = tombstones[id];
    if (deletedAt === undefined || deletedAt < noteTimestamp(winner)) {
      mergedById.set(winner.id, winner);
    }
    if (conflict && (deletedAt === undefined || deletedAt < noteTimestamp(conflict))) {
      mergedById.set(conflict.id, conflict);
    }
  }

  return {
    notes: deduplicateGeneratedPlaceholders(
      deduplicateRedundantConflictCopies([...mergedById.values()]).sort(
        (a, b) => a.order - b.order,
      ),
    ),
    tombstones,
  };
}

/** ユーザーが**編集中**のノート(フォーカス中/未保存を含む集合)を、同期の再適用
 * (pull/マージ/placeholder畳み込み)から守る。編集中に届いた各種同期処理がそのノートを
 * 並べ替え・削除・内容上書きして「選択が飛ぶ/入力が消える」実害があった(ユーザー報告)。
 * 旧来は「activeNoteId 1件」しか守れず、本文ペインをクリックしただけの非選択ノートや
 * 経路D/Eを保護できなかったため、**集合**を受け取り全経路の合流点で不可侵にする。
 * protectedIds の各ノートは `local`(=編集中の最新ローカル状態)からそのまま採用し、同期結果の
 * 該当ノートを置き換える(=動かさない・消さない・上書きしない=最優先)。local に無いid・
 * 空集合は何もしない(=起動時の自動選択やまだ知らないノートは保護しない)。
 * 自動空ノート(placeholder)を選んだ直後に、dedupで別idの同名placeholderへ畳まれて選択が
 * 飛ぶのも防ぐ——保護対象がまだ空placeholderなら、同名の空placeholderを退けて保護対象を残す。 */
export function preserveProtectedNotes(
  next: Note[],
  local: Note[],
  protectedIds: Set<string>,
  tombstones: NoteTombstones = {},
): Note[] {
  if (protectedIds.size === 0) return next;
  const localById = new Map(local.map((note) => [note.id, note]));
  const nextIds = new Set(next.map((note) => note.id));
  const protectedLocals: Note[] = [];
  for (const id of protectedIds) {
    const localNote = localById.get(id);
    if (!localNote) continue;
    // 明示的な削除(tombstone)があり同期結果にも存在しないなら復活させない——別タブ/PCで
    // 確定した削除は「編集中」より優先する(でないと削除が全タブで収束しない)。tombstoneの無い
    // 単なる欠落(stale全体保存がdedup/マージで落とした等)は従来どおり local 版で復活させる。
    if (!nextIds.has(id) && tombstones[id] !== undefined) continue;
    protectedLocals.push(localNote);
  }
  if (protectedLocals.length === 0) return next;
  const protectedIdSet = new Set(protectedLocals.map((note) => note.id));
  // 保護対象がまだ空placeholderなら、dedupで勝った同名の空placeholderを退けて選択を保つ。
  const placeholderTitles = new Set(
    protectedLocals.filter(isGeneratedEmptyPlaceholder).map((note) => note.title),
  );
  const kept = next.filter((note) => {
    if (protectedIdSet.has(note.id)) return false; // 保護対象は local 版で入れ直す(下で連結)
    if (placeholderTitles.has(note.title) && isGeneratedEmptyPlaceholder(note)) return false;
    return true;
  });
  // 表示(sortedNotes)は安定ソートで、同(pinned, order)のタイは配列順で決まる。以前の
  // 「末尾へ追加して order で再ソート」は、同orderのノート(例: 補充された空ノート)が
  // いると保護対象がタイに負けて1つ右の表示位置へ飛んだ(=一文字目が右のノートに飛んで
  // 見えた実バグの後半)。localでの表示位置(rank)をタイの決着に使い、localに無い新参
  // ノートは保護対象より後ろへ置く——「動かさない」を同orderタイでも守る。
  const localRank = new Map(sortedNotes(local).map((note, index) => [note.id, index]));
  const rankOf = (note: Note) => localRank.get(note.id) ?? Number.MAX_SAFE_INTEGER;
  return [...kept, ...protectedLocals].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return rankOf(a) - rankOf(b);
  });
}

/** 単一idの薄いラッパー(既存呼び出し/テスト互換)。中身は集合版へ委譲する。 */
export function preserveProtectedNote(
  next: Note[],
  local: Note[],
  protectedId: string | null,
): Note[] {
  return preserveProtectedNotes(next, local, protectedId ? new Set([protectedId]) : new Set());
}

/** 編集後の配列との差分から削除tombstoneを作る。再作成/編集されたIDの古いtombstoneは外す。 */
export function updateTombstonesForMutation(
  previous: Note[],
  next: Note[],
  tombstones: NoteTombstones,
  changedAt: number,
): NoteTombstones {
  const result = { ...tombstones };
  const nextIds = new Set(next.map((note) => note.id));
  for (const note of previous) {
    if (!nextIds.has(note.id)) result[note.id] = Math.max(result[note.id] ?? 0, changedAt);
  }
  for (const note of next) {
    if ((result[note.id] ?? 0) < noteTimestamp(note)) delete result[note.id];
  }
  return result;
}

function persistedNoteJson(note: Note): string {
  return JSON.stringify({ ...note, driveFileId: undefined, lastSyncedAt: undefined });
}

/** タイトル・本文・タグ・配置等のユーザー変更にもupdatedAtを付け、別タブ/PCの順序を判定可能にする。 */
export function stampChangedNotes(previous: Note[], next: Note[], changedAt: number): Note[] {
  const previousById = new Map(previous.map((note) => [note.id, note]));
  return next.map((note) => {
    const before = previousById.get(note.id);
    if (!before || persistedNoteJson(before) === persistedNoteJson(note)) return note;
    if ((note.updatedAt ?? 0) > (before.updatedAt ?? 0)) return note;
    return { ...note, updatedAt: changedAt };
  });
}
