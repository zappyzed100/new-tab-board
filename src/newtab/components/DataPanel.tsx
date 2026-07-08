// DataPanel.tsx — JSON全データ書き出し/取り込み・ローカルファイル操作(SPEC.md §4.7・§4.10-a)
import { useRef, useState } from "react";
import { buildExportPayload, parseImportPayload, serializeExport } from "../../lib/exportImport";
import { exportNotesToFolder, pickAndReadTextFile } from "../../lib/fileSystem";
import { now } from "../../lib/clock";
import type { AppLaunch, Bookmark, Note, Settings } from "../../types";

type SyncState = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };

type Props = {
  sync: SyncState;
  notes: Note[];
  onImportData: (data: { sync: SyncState; notes: Note[] }) => void;
  onOpenFileAsNote: (title: string, content: string) => void;
};

export function DataPanel({ sync, notes, onImportData, onOpenFileAsNote }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    const payload = buildExportPayload(sync, notes, now());
    const blob = new Blob([serializeExport(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `new-tab-board-export-${payload.exportedAt}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    const text = await file.text();
    const payload = parseImportPayload(text);
    if (!payload) {
      setMessage("インポート失敗: JSONの形式が不正です");
      return;
    }
    onImportData({
      sync: {
        bookmarks: payload.bookmarks,
        appLaunches: payload.appLaunches,
        settings: payload.settings,
      },
      notes: payload.notes,
    });
    setMessage("インポートしました");
  }

  async function handleOpenFile() {
    const result = await pickAndReadTextFile();
    if (!result) return;
    const title = result.name.replace(/\.txt$/i, "");
    onOpenFileAsNote(title, result.content);
    setMessage(`「${title}」をノートとして読み込みました`);
  }

  async function handleExportFolder() {
    await exportNotesToFolder(notes);
    setMessage("フォルダへ書き出しました");
  }

  return (
    <div data-testid="data-panel">
      <button type="button" data-testid="data-export-json" onClick={handleExport}>
        JSONエクスポート
      </button>
      <button
        type="button"
        data-testid="data-import-json"
        onClick={() => fileInputRef.current?.click()}
      >
        JSONインポート
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        data-testid="data-import-file-input"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
          e.target.value = "";
        }}
      />
      <button type="button" data-testid="data-open-file" onClick={() => void handleOpenFile()}>
        ファイルを開く
      </button>
      <button
        type="button"
        data-testid="data-export-folder"
        onClick={() => void handleExportFolder()}
      >
        フォルダへ書き出し
      </button>
      {message ? <p data-testid="data-panel-message">{message}</p> : null}
    </div>
  );
}
