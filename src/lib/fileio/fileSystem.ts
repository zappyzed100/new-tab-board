// fileSystem.ts — ローカルファイルの読み込み/書き出しの唯一の入出口(SPEC.md §4.10-a・手動フォルダエクスポート)
//
// ローカル.txtを「アプリ内で開く」(OSデフォルトハンドラにはなれない。§4.10前提)、および
// 全ノートを個別の.mdファイルとして書き出す(NAS二層アーカイブの自動化は対象外。§4.3——
// あちらは持続的な書き込み権限が要るため、この2機能とは別にnasArchive.tsが
// showDirectoryPickerを使い続ける)。
//
// この2機能は元々File System Access API(showOpenFilePicker/showDirectoryPicker)を
// 使っていたが、Chrome拡張機能のページ(chrome_url_overridesのnewtab等)から呼ぶと
// 「ユーザーが実際にファイル/フォルダを選択してもAbortErrorで即座に失敗する」という
// Chromium側の既知のバグがある(WICG/file-system-access#314、
// crbug.com/issues/40240444。extensionコンテキスト特有)。実機で「ボタンを押しても
// 何も起きない(ダイアログが一切出ない、あるいは選んだ直後に無反応で終わる)」という
// 形で再現した。読み込みは標準の`<input type="file">`、書き出しは`chrome.downloads`
// (要"downloads"権限)へ置き換え、この既知バグの影響を受けない実装にしている。
import { logOp } from "../runtime/log";
import type { Note } from "../../types";

function sanitizeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "_").trim() || "無題のノート";
}

/** ファイル選択ダイアログで.txtを選び、中身を読み込む。キャンセル時はnullを返す。 */
export async function pickAndReadTextFile(): Promise<{ name: string; content: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,text/plain";
    // "cancel"イベント(Chrome 113+)でダイアログを閉じただけのケースを検知する。
    input.addEventListener("cancel", () => resolve(null));
    input.addEventListener("change", () => {
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

/** 各ノートを個別の.mdファイルとしてダウンロードフォルダ配下へ書き出す
 * (`new-tab-board-notes/`サブフォルダへ集約)。 */
export async function exportNotesToFolder(notes: Note[]): Promise<void> {
  for (const note of notes) {
    const blob = new Blob([note.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    try {
      await downloadBlobUrl(url, `new-tab-board-notes/${sanitizeFileName(note.title)}.md`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  logOp("fileSystem", "export", `notes=${notes.length}`);
}

/** ダウンロードが完了(またはエラーで中断)するまで待ってから解決する。
 * chrome.downloads.downloadのコールバックはダウンロード「開始」時点で呼ばれるため、
 * ここでrevokeObjectURLしてしまうとブラウザがblobの中身を読み切る前にURLが失効し
 * ファイルが空/欠落する恐れがある——onChangedで実際の完了を確認してから返す。 */
function downloadBlobUrl(url: string, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        const message = chrome.runtime.lastError?.message ?? "downloadId is undefined";
        logOp("fileSystem", "export-error", message);
        reject(new Error(message));
        return;
      }
      function onChanged(delta: chrome.downloads.DownloadDelta) {
        if (delta.id !== downloadId || !delta.state) return;
        if (delta.state.current === "complete") {
          chrome.downloads.onChanged.removeListener(onChanged);
          resolve();
        } else if (delta.state.current === "interrupted") {
          chrome.downloads.onChanged.removeListener(onChanged);
          logOp("fileSystem", "export-error", `download interrupted: ${filename}`);
          reject(new Error(`download interrupted: ${filename}`));
        }
      }
      chrome.downloads.onChanged.addListener(onChanged);
    });
  });
}
