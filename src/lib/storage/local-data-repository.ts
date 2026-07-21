// local-data-repository.ts — localDataへのノート差分コミットと初期化を一元化するrepository
import type { LocalData, Note } from "../../types";
import { ensureTrailingEmptyNotes, TRAILING_EMPTY_NOTES } from "../entities/notes";
import {
  mergeNoteCollections,
  type NoteTombstones,
  updateTombstonesForMutation,
} from "./note-sync";
import { updateLocalData } from "./storage";

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function changedNotes(previous: Note[], next: Note[]): Note[] {
  const previousById = new Map(previous.map((note) => [note.id, note]));
  return next.filter((note) => !sameValue(previousById.get(note.id), note));
}

function withTrailingNotes(notes: Note[], now: number): Note[] {
  return ensureTrailingEmptyNotes(notes, TRAILING_EMPTY_NOTES, now);
}

function noteTimestamp(note: Note): number {
  return note.updatedAt ?? note.createdAt ?? 0;
}

/** 起動時の正規化と末尾空ノート補充を、全タブ共通の排他コミット内で一度だけ行う。 */
export async function initializeLocalData(now: number): Promise<LocalData> {
  return updateLocalData((current) => {
    const normalized = mergeNoteCollections(current.notes ?? [], [], current.noteTombstones ?? {});
    const notes = withTrailingNotes(normalized.notes, now);
    if (
      sameValue(notes, current.notes ?? []) &&
      sameValue(normalized.tombstones, current.noteTombstones ?? {})
    ) {
      return current;
    }
    return { ...current, notes, noteTombstones: normalized.tombstones };
  });
}

/**
 * UI操作のbefore/afterから変更ノートと削除tombstoneだけを抽出し、最新の永続状態へ適用する。
 * 画面が持つ古い全件配列を保存しないため、別タブが直前に作ったノートを巻き込んで消さない。
 */
export async function commitNoteMutation(
  previous: Note[],
  next: Note[],
  changedAt: number,
): Promise<LocalData> {
  const upserts = changedNotes(previous, next);
  const mutationTombstones = updateTombstonesForMutation(previous, next, {}, changedAt);
  return updateLocalData((current) => {
    // ローカル操作はWeb Lock取得順が正規の全順序。同一msの連続キー入力を外部同期用の
    // 「同時刻競合」に渡すと競合コピーになるため、同時刻は後からlockを得た操作を採る。
    const notesById = new Map((current.notes ?? []).map((note) => [note.id, note]));
    const tombstones = { ...(current.noteTombstones ?? {}) };
    for (const [id, deletedAt] of Object.entries(mutationTombstones)) {
      tombstones[id] = Math.max(tombstones[id] ?? 0, deletedAt);
      const stored = notesById.get(id);
      if (stored && deletedAt >= noteTimestamp(stored)) notesById.delete(id);
    }
    for (const note of upserts) {
      const timestamp = noteTimestamp(note);
      if (timestamp < (tombstones[note.id] ?? 0)) continue;
      const stored = notesById.get(note.id);
      if (!stored || timestamp >= noteTimestamp(stored)) notesById.set(note.id, note);
      delete tombstones[note.id];
    }
    return {
      ...current,
      notes: withTrailingNotes([...notesById.values()], changedAt),
      noteTombstones: tombstones,
    };
  });
}

/** Drive/NASから得たlosslessマージ結果を、保存時点の最新ローカル状態ともう一度マージする。 */
export async function commitMergedNotes(
  incoming: Note[],
  tombstones: NoteTombstones,
): Promise<LocalData> {
  return updateLocalData((current) => {
    const merged = mergeNoteCollections(
      current.notes ?? [],
      incoming,
      current.noteTombstones ?? {},
      tombstones,
    );
    return {
      ...current,
      notes: merged.notes,
      noteTombstones: merged.tombstones,
    };
  });
}
