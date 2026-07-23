// driveSafeSync.ts — DriveとローカルをノートID単位で和集合マージし明示削除だけを伝播する
import type { Note } from "../../types";
import { mergeNoteCollections, type NoteTombstones } from "../storage/note-sync";
import { logOp } from "../runtime/log";
import {
  downloadFileContent,
  listNoteFilesInFolder,
  resolveFolderPath,
  uploadNote,
  type FetchLike,
} from "./drive";
import { pullActiveFromDrive } from "./driveActiveSync";
import { reconcileDriveActive } from "./driveActiveMirror";
import { syncNoteToDrive } from "./driveSync";

const TOMBSTONE_FOLDER_PATH = ["app", "New Tab Board", "sync", "v2", "tombstones"];

type TombstoneFile = { noteId: string; deletedAt: number };

export type DriveSafeSyncDeps = {
  resolveFolderPath?: typeof resolveFolderPath;
  listNoteFilesInFolder?: typeof listNoteFilesInFolder;
  downloadFileContent?: typeof downloadFileContent;
  uploadNote?: typeof uploadNote;
  pullActiveFromDrive?: typeof pullActiveFromDrive;
  syncNoteToDrive?: typeof syncNoteToDrive;
  reconcileDriveActive?: typeof reconcileDriveActive;
  fetchImpl?: FetchLike;
};

function samePersistedNote(a: Note, b: Note): boolean {
  const transient = (note: Note) => ({ ...note, driveFileId: undefined, lastSyncedAt: undefined });
  return JSON.stringify(transient(a)) === JSON.stringify(transient(b));
}

async function readDriveTombstones(
  token: string,
  deps: DriveSafeSyncDeps,
): Promise<{ tombstones: NoteTombstones; fileIds: Record<string, string> }> {
  const _resolve = deps.resolveFolderPath ?? resolveFolderPath;
  const _list = deps.listNoteFilesInFolder ?? listNoteFilesInFolder;
  const _download = deps.downloadFileContent ?? downloadFileContent;
  const folderId = await _resolve(TOMBSTONE_FOLDER_PATH, token, deps.fetchImpl);
  const files = await _list(folderId, token, deps.fetchImpl);
  const tombstones: NoteTombstones = {};
  const fileIds: Record<string, string> = {};
  for (const file of files) {
    try {
      const parsed = JSON.parse(await _download(file.id, token, deps.fetchImpl)) as TombstoneFile;
      if (parsed.noteId !== file.noteId || !Number.isFinite(parsed.deletedAt)) continue;
      if (parsed.deletedAt >= (tombstones[file.noteId] ?? 0)) {
        tombstones[file.noteId] = parsed.deletedAt;
        fileIds[file.noteId] = file.id;
      }
    } catch (err) {
      logOp("driveSafeSync", "tombstone-read-error", `note=${file.noteId}`, { error: err });
    }
  }
  return { tombstones, fileIds };
}

async function writeDriveTombstones(
  tombstones: NoteTombstones,
  remote: NoteTombstones,
  fileIds: Record<string, string>,
  folderId: string,
  token: string,
  deps: DriveSafeSyncDeps,
): Promise<void> {
  const _upload = deps.uploadNote ?? uploadNote;
  for (const [noteId, deletedAt] of Object.entries(tombstones)) {
    if ((remote[noteId] ?? 0) >= deletedAt) continue;
    const content = JSON.stringify({ noteId, deletedAt } satisfies TombstoneFile);
    await _upload(
      { id: noteId, title: noteId, content },
      token,
      fileIds[noteId] ?? null,
      deps.fetchImpl,
      {
        folderId,
        kind: "tombstone-v2",
        filename: `${noteId}.json`,
        mimeType: "application/json",
      },
    );
  }
}

/**
 * Drive active/を先に和集合マージしてからアップロード/削除突合する。
 * active/に無いだけでは削除せず、sync/v2/tombstonesの明示削除だけを反映する。
 */
export async function syncDriveNotesSafely(
  localNotes: Note[],
  localTombstones: NoteTombstones,
  token: string,
  now: number,
  deps: DriveSafeSyncDeps = {},
): Promise<{ notes: Note[]; tombstones: NoteTombstones } | null> {
  try {
    logOp("driveSafeSync", "sync-start", `localNotes=${localNotes.length}`);
    const _pull = deps.pullActiveFromDrive ?? pullActiveFromDrive;
    const remoteNotes = await _pull(token, {
      resolveFolderPath: deps.resolveFolderPath,
      listNoteFilesInFolder: deps.listNoteFilesInFolder,
      downloadFileContent: deps.downloadFileContent,
      fetchImpl: deps.fetchImpl,
    });
    if (remoteNotes === null) return null;

    const _resolve = deps.resolveFolderPath ?? resolveFolderPath;
    const tombstoneFolderId = await _resolve(TOMBSTONE_FOLDER_PATH, token, deps.fetchImpl);
    const remoteDeletionState = await readDriveTombstones(token, deps);
    const merged = mergeNoteCollections(
      localNotes,
      remoteNotes,
      localTombstones,
      remoteDeletionState.tombstones,
    );
    const remoteById = new Map(remoteNotes.map((note) => [note.id, note]));
    const _syncNote = deps.syncNoteToDrive ?? syncNoteToDrive;
    const uploadedNotes = new Map<string, Note>();

    for (const note of merged.notes) {
      if (note.content.trim() === "" || note.junk || note.noSync) continue;
      const remote = remoteById.get(note.id);
      if (remote && samePersistedNote(note, remote)) continue;
      const result = await _syncNote(note, now, false);
      if (result.status === "synced") {
        uploadedNotes.set(note.id, {
          ...note,
          driveFileId: result.driveFileId,
          lastSyncedAt: result.lastSyncedAt,
        });
      }
    }

    await writeDriveTombstones(
      merged.tombstones,
      remoteDeletionState.tombstones,
      remoteDeletionState.fileIds,
      tombstoneFolderId,
      token,
      deps,
    );

    const notes = merged.notes.map((note) => uploadedNotes.get(note.id) ?? note);
    const _reconcile = deps.reconcileDriveActive ?? reconcileDriveActive;
    await _reconcile(notes, token);
    logOp(
      "driveSafeSync",
      "sync-done",
      `remoteNotes=${remoteNotes.length} mergedNotes=${notes.length} tombstones=${Object.keys(merged.tombstones).length}`,
    );
    return { notes, tombstones: merged.tombstones };
  } catch (err) {
    logOp("driveSafeSync", "sync-error", "", { error: err });
    return null;
  }
}
