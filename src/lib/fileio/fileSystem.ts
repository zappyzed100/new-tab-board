// fileSystem.ts — ローカルファイルの読み込み/書き出しの唯一の入出口(SPEC.md §4.10-a・手動フォルダエクスポート)
//
// ローカル.txtを「アプリ内で開く」(OSデフォルトハンドラにはなれない。§4.10前提)、および
// 全ノートを選んだフォルダへ個別の.mdファイルとして書き出す(NAS二層アーカイブの
// 自動化は対象外。§4.3——あちらは持続的な書き込み権限が要るため、この2機能とは別に
// nasArchive.tsがshowDirectoryPickerを使い続ける)。
//
// 「ファイルを開く」は元々File System Access API(showOpenFilePicker)を使っていたが、
// Chrome拡張機能のページ(chrome_url_overridesのnewtab等)から呼ぶと「ユーザーが実際に
// ファイルを選択してもAbortErrorで即座に失敗する」というChromium側の既知バグがある
// (WICG/file-system-access#314、crbug.com/issues/40240444。extensionコンテキスト特有)。
// 実機で「ボタンを押しても何も起きない」という形で再現したため、標準の
// `<input type="file">`へ置き換え、この既知バグの影響を受けない実装にしている。
//
// 「フォルダへ書き出し」は同じ既知バグの対象がshowDirectoryPickerのため、一時
// chrome.downloadsのsaveAsを1件ずつ出す方式に置き換えたが、「フォルダを1回選んで
// 全ノートをそこへ書き出したい」という要望(ユーザー指示)によりshowDirectoryPicker
// を使う元の設計へ戻した——ユーザーが実際にこの既知バグへ当たった場合は、選択後も
// AbortErrorとして届くため「キャンセルした」という体で処理は打ち切られる
// (DataPanel.tsx側でエラーメッセージを表示する)。
import { logOp } from "../runtime/log";
import type { Note } from "../../types";

function sanitizeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "_").trim() || "無題のノート";
}

/** ファイル選択ダイアログ(OSのExplorer/Finder相当)で.txtを選び、中身を読み込む。
 * キャンセル時はnullを返す。 */
export async function pickAndReadTextFile(): Promise<{ name: string; content: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,text/plain";
    // 画面には出さないが、DOMに接続されていない要素へのclick()はネイティブの
    // ファイル選択ダイアログを開かないブラウザ/コンテキストがあるため、
    // 一時的にbodyへ挿入してから呼ぶ(処理後は必ず取り除く)。
    input.style.display = "none";
    document.body.appendChild(input);
    function cleanup() {
      input.remove();
    }
    input.addEventListener("cancel", () => {
      cleanup();
      resolve(null);
    });
    input.addEventListener("change", () => {
      cleanup();
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file.text().then(
        (content) => {
          logOp("fileSystem", "open", `name=${file.name}`);
          resolve({ name: file.name, content });
        },
        (err: unknown) => {
          logOp("fileSystem", "open-error", String(err));
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
    input.click();
  });
}

export type ExportResult = { exported: number; cancelled: boolean };

/** フォルダ選択ダイアログ(OSのExplorer/Finder相当)を1回だけ出し、選んだフォルダへ
 * 全ノートを個別の.mdファイルとして書き出す。キャンセル時は書き出し0件で返す
 * (Chromium拡張機能コンテキストの既知バグ——ヘッダー参照——で選択後もAbortErrorに
 * なる場合も同じ扱いになる。区別できないため、失敗時はDataPanel.tsx側で
 * 「キャンセルまたは失敗」の両方を案内するメッセージを表示する)。 */
export async function exportNotesToFolder(notes: Note[]): Promise<ExportResult> {
  let dirHandle: FileSystemDirectoryHandle;
  try {
    dirHandle = await window.showDirectoryPicker();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { exported: 0, cancelled: true };
    }
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
  return { exported: notes.length, cancelled: false };
}
