// fileSystem.ts — File System Access APIの唯一の入出口(SPEC.md §4.10-a・手動フォルダエクスポート)
//
// ローカル.txtを「アプリ内で開く」(OSデフォルトハンドラにはなれない。§4.10前提)、および
// 全ノートを選択フォルダへ手動一括書き出しする(NAS二層アーカイブの自動化は対象外。§4.3)。
import { logOp } from "./log";
import type { Note } from "../types";

function sanitizeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "_").trim() || "無題のノート";
}

/** ファイル選択ダイアログで.txtを選び、中身を読み込む。キャンセル時はnullを返す。 */
export async function pickAndReadTextFile(): Promise<{ name: string; content: string } | null> {
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "テキストファイル", accept: { "text/plain": [".txt"] } }],
    });
    const file = await handle.getFile();
    const content = await file.text();
    logOp("fileSystem", "open", `name=${file.name}`);
    return { name: file.name, content };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    logOp("fileSystem", "open-error", String(err));
    throw err;
  }
}

/** 選択したフォルダへ全ノートを個別の.mdファイルとして書き出す。キャンセル時は何もしない。 */
export async function exportNotesToFolder(notes: Note[]): Promise<void> {
  let dirHandle: FileSystemDirectoryHandle;
  try {
    dirHandle = await window.showDirectoryPicker();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    logOp("fileSystem", "export-error", String(err));
    throw err;
  }
  for (const note of notes) {
    const fileHandle = await dirHandle.getFileHandle(`${sanitizeFileName(note.title)}.md`, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(note.content);
    await writable.close();
  }
  logOp("fileSystem", "export", `notes=${notes.length}`);
}
