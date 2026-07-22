// note-sync.ts — 端末内/Drive間でノートを欠落させずに和集合マージする純粋ロジック
import type { Note } from "../../types";
import { sortedNotes } from "../entities/notes";

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
function sameSyncedNote(a: Note, b: Note): boolean {
  const comparable = (note: Note) => ({
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
  });
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
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

function isGeneratedEmptyPlaceholder(note: Note): boolean {
  return (
    /^ノート[A-Z]+$/.test(note.title) &&
    note.content.trim() === "" &&
    !note.pinned &&
    !note.done &&
    !note.special &&
    !note.junk &&
    (note.tags?.length ?? 0) === 0
  );
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

/** ユーザーが選んで**編集中**のノートを、同期の再適用(pull/マージ/placeholder畳み込み)から守る。
 * 起動直後に速攻でノートを選んで編集を始めると、その後に届く各種同期処理がそのノートを
 * 並べ替え・削除・内容上書きして「選択が飛ぶ/入力が消える」実害があった(ユーザー報告)。
 * protectedId のノートは `local`(=編集中の最新ローカル状態)からそのまま採用し、同期結果の
 * 該当ノートを置き換える(=動かさない・消さない・上書きしない=最優先)。
 * 自動空ノート(placeholder)を選んだ直後に、dedupで別idの同名placeholderへ畳まれて選択が
 * 飛ぶのも防ぐ——保護対象がまだ空placeholderなら、同名の空placeholderを退けて protectedId を残す。
 * protectedId が null か、local に存在しなければ何もしない(=起動時の自動選択は保護しない)。 */
export function preserveProtectedNote(
  next: Note[],
  local: Note[],
  protectedId: string | null,
): Note[] {
  if (!protectedId) return next;
  const localNote = local.find((note) => note.id === protectedId);
  if (!localNote) return next;
  const placeholder = isGeneratedEmptyPlaceholder(localNote);
  const kept = next.filter((note) => {
    if (note.id === protectedId) return false; // 保護対象は local 版で入れ直す(下で push)
    // 保護対象がまだ空placeholderなら、dedupで勝った同名の空placeholderを退けて選択を保つ。
    if (placeholder && note.title === localNote.title && isGeneratedEmptyPlaceholder(note)) {
      return false;
    }
    return true;
  });
  // 表示(sortedNotes)は安定ソートで、同(pinned, order)のタイは配列順で決まる。以前の
  // 「末尾へ追加して order で再ソート」は、同orderのノート(例: 補充された空ノート)が
  // いると保護対象がタイに負けて1つ右の表示位置へ飛んだ(=一文字目が右のノートに飛んで
  // 見えた実バグの後半)。localでの表示位置(rank)をタイの決着に使い、localに無い新参
  // ノートは保護対象より後ろへ置く——「動かさない」を同orderタイでも守る。
  const localRank = new Map(sortedNotes(local).map((note, index) => [note.id, index]));
  const rankOf = (note: Note) => localRank.get(note.id) ?? Number.MAX_SAFE_INTEGER;
  return [...kept, localNote].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return rankOf(a) - rankOf(b);
  });
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
