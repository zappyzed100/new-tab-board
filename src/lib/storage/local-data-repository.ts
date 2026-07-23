// local-data-repository.ts — localDataへのノート差分コミットと初期化を一元化するrepository
import type { LocalData, Note } from "../../types";
import { ensureTrailingEmptyNotes, TRAILING_EMPTY_NOTES } from "../entities/notes";
import {
  mergeNoteCollections,
  type NoteTombstones,
  updateTombstonesForMutation,
} from "./note-sync";
import { updateLocalData } from "./storage";
import { logOp } from "../runtime/log";

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 末尾から連続する空ノート(content が空白のみ)の数。ログで「なぜ補充されたか/されないか」を
 * 追うための観測用(entities/notes.ts の ensureTrailingEmptyNotes の内部判定と同じ規則)。 */
function trailingEmptyCount(notes: Note[]): number {
  const sorted = [...notes].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return a.order - b.order;
  });
  let count = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].content.trim() === "") count += 1;
    else break;
  }
  return count;
}

function changedNotes(previous: Note[], next: Note[]): Note[] {
  const previousById = new Map(previous.map((note) => [note.id, note]));
  return next.filter((note) => !sameValue(previousById.get(note.id), note));
}

function withTrailingNotes(notes: Note[], now: number): Note[] {
  return ensureTrailingEmptyNotes(notes, TRAILING_EMPTY_NOTES, now);
}

/** 末尾空ノートの維持で「何件足して何件消したか」。件数差だけを出すと、3件追加+2件削除が
 * `+1` に相殺されて**既存ノートの削除が見えなくなる**(実際、入力中ノートより前の空ノートが
 * 消えて盤面が繰り上がるバグを、この相殺が実機ログ上で隠していた — 2026-07-23)。 */
function placeholderDelta(before: Note[], after: Note[]): string {
  const beforeIds = new Set(before.map((n) => n.id));
  const afterIds = new Set(after.map((n) => n.id));
  const added = after.filter((n) => !beforeIds.has(n.id));
  const removed = before.filter((n) => !afterIds.has(n.id));
  return (
    `added=${added.length}[${added.map((n) => n.title).join(",")}] ` +
    `removed=${removed.length}[${removed.map((n) => n.title).join(",")}]`
  );
}

function noteTimestamp(note: Note): number {
  return note.updatedAt ?? note.createdAt ?? 0;
}

/** 起動時の正規化と末尾空ノート補充を、全タブ共通の排他コミット内で一度だけ行う。 */
export async function initializeLocalData(now: number): Promise<LocalData> {
  return updateLocalData((current) => {
    const before = current.notes ?? [];
    const normalized = mergeNoteCollections(before, [], current.noteTombstones ?? {});
    const notes = withTrailingNotes(normalized.notes, now);
    logOp(
      "note-repo",
      "initialize",
      `stored=${before.length} normalized=${normalized.notes.length} ` +
        `final=${notes.length} trailingEmpty=${trailingEmptyCount(notes)} ` +
        placeholderDelta(normalized.notes, notes),
    );
    if (
      sameValue(notes, before) &&
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
  logOp(
    "note-repo",
    "commit-mutation:in",
    `prev=${previous.length} next=${next.length} ` +
      `upserts=${upserts.length}[${upserts.map((n) => n.id.slice(0, 8)).join(",")}] ` +
      `deletes=${Object.keys(mutationTombstones).length} changedAt=${changedAt}`,
  );
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
    const mergedNotes = [...notesById.values()];
    const finalNotes = withTrailingNotes(mergedNotes, changedAt);
    logOp(
      "note-repo",
      "commit-mutation:out",
      `storedNow=${(current.notes ?? []).length} afterMerge=${mergedNotes.length} ` +
        `final=${finalNotes.length} trailingEmpty=${trailingEmptyCount(finalNotes)} ` +
        placeholderDelta(mergedNotes, finalNotes),
    );
    return {
      ...current,
      notes: finalNotes,
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
    logOp(
      "note-repo",
      "commit-merged",
      `storedNow=${(current.notes ?? []).length} incoming=${incoming.length} ` +
        `merged=${merged.notes.length} trailingEmpty=${trailingEmptyCount(merged.notes)}`,
    );
    return {
      ...current,
      notes: merged.notes,
      noteTombstones: merged.tombstones,
    };
  });
}
