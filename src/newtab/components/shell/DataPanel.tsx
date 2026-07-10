// DataPanel.tsx — JSON全データ書き出し/取り込み・ローカルファイル操作・NASアーカイブ設定
// (SPEC.md §4.3・§4.7・§4.10-a)
import { useRef, useState } from "react";
import { setNasDirectoryHandle } from "../../../lib/storage/db";
import {
  buildExportPayload,
  parseImportPayload,
  serializeExport,
} from "../../../lib/fileio/exportImport";
import { exportNotesToFolder, pickAndReadTextFile } from "../../../lib/fileio/fileSystem";
import { flushAllToNas } from "../../../lib/externalIO/nasArchive";
import { now } from "../../../lib/runtime/clock";
import type { AppLaunch, Bookmark, Note, Settings } from "../../../types";

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

  async function handleSetNasFolder() {
    try {
      const handle = await window.showDirectoryPicker();
      await setNasDirectoryHandle(handle);
      setMessage("NASフォルダを設定しました");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setMessage("NASフォルダの設定に失敗しました");
      throw err;
    }
  }

  async function handleFlushNow() {
    const { flushed, failed } = await flushAllToNas();
    setMessage(`NASへ${flushed}件書き出しました(失敗${failed}件)`);
  }

  return (
    <div data-testid="data-panel">
      <h2 className="panel-title">🗄️ データ管理(バックアップ・取り込み・NAS設定)</h2>
      <button
        type="button"
        data-testid="data-export-json"
        title="ブックマーク/ノート/設定を全部1つのJSONファイルへ書き出す(バックアップ)"
        onClick={handleExport}
      >
        ⬇️ JSONエクスポート
      </button>
      <button
        type="button"
        data-testid="data-import-json"
        title="エクスポートしたJSONファイルから全データを復元する"
        onClick={() => fileInputRef.current?.click()}
      >
        ⬆️ JSONインポート
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
      <button
        type="button"
        data-testid="data-open-file"
        title="ローカルの.txtファイルを選んで新規ノートとして読み込む"
        onClick={() => void handleOpenFile()}
      >
        📂 ファイルを開く
      </button>
      <button
        type="button"
        data-testid="data-set-nas-folder"
        title="履歴の長期保管先(NASの共有フォルダ等)を選ぶ"
        onClick={() => void handleSetNasFolder()}
      >
        📁 NASフォルダを設定
      </button>
      <button
        type="button"
        data-testid="data-flush-nas"
        title="未保管の履歴を今すぐNASフォルダへ書き出す"
        onClick={() => void handleFlushNow()}
      >
        📤 今すぐNASへ書き出し
      </button>
      <button
        type="button"
        data-testid="data-export-folder"
        title="全ノートをそれぞれ.mdファイルとしてフォルダへ書き出す"
        onClick={() => void handleExportFolder()}
      >
        🗂️ フォルダへ書き出し
      </button>
      {message ? <p data-testid="data-panel-message">{message}</p> : null}
    </div>
  );
}
