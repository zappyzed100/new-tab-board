// note-sync.ts — 端末内/Drive間でノートを欠落させずに和集合マージする純粋ロジック
import type { Note } from "../../types";

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

function sameNote(a: Note, b: Note): boolean {
  return persistedNoteJson(a) === persistedNoteJson(b);
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

/** staleな全体保存同士を和集合にした際、別IDで二重化した自動空ノートだけをタイトルで畳む。 */
function deduplicateGeneratedPlaceholders(notes: Note[]): Note[] {
  const seenTitles = new Set<string>();
  let placeholderCount = 0;
  return notes.filter((note) => {
    if (!isGeneratedEmptyPlaceholder(note)) return true;
    if (seenTitles.has(note.title)) return false;
    if (placeholderCount >= 3) return false;
    seenTitles.add(note.title);
    placeholderCount += 1;
    return true;
  });
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
          !sameNote(local, remote) &&
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
      [...mergedById.values()].sort((a, b) => a.order - b.order),
    ),
    tombstones,
  };
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
