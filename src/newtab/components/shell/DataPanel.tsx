// DataPanel.tsx — JSON全データバックアップ(Drive自動同期+Driveから復元)・ローカル
// ファイル操作・NASアーカイブ設定(SPEC.md §4.3・§4.7・§4.10-a)
// JSONエクスポート/インポートは、ボタン操作不要の自動Driveバックアップ(App.tsxの
// useJsonBackupSync)に置き換えた——このパネルの「Driveから復元」は明示的なクリック
// 操作のままにしている(自動復元はローカル未同期の変更を問答無用で上書きする危険があるため)。
import { useState } from "react";
import { Button, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { setNasDirectoryHandle } from "../../../lib/storage/db";
import { parseImportPayload } from "../../../lib/fileio/exportImport";
import { exportNotesToFolder, pickAndReadTextFile } from "../../../lib/fileio/fileSystem";
import { flushAllToNas } from "../../../lib/externalIO/nasArchive";
import { restoreJsonBackupFromDrive } from "../../../lib/drive/jsonBackupSync";
import type { AppLaunch, Bookmark, Note, Settings } from "../../../types";

type SyncState = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };

type Props = {
  sync: SyncState;
  notes: Note[];
  onImportData: (data: { sync: SyncState; notes: Note[] }) => void;
  onOpenFileAsNote: (title: string, content: string) => void;
  /** App.tsx側のuseJsonBackupSyncの状態をラベル化したもの(JSON_BACKUP_STATUS_LABEL経由)。 */
  jsonBackupStatusLabel: string;
};

export function DataPanel({
  sync,
  notes,
  onImportData,
  onOpenFileAsNote,
  jsonBackupStatusLabel,
}: Props) {
  const [message, setMessage] = useState<string | null>(null);

  async function handleRestoreFromDrive() {
    const result = await restoreJsonBackupFromDrive(true, sync.settings.jsonBackupFileId);
    if (result.status === "unauthenticated") {
      setMessage("Googleアカウントにログインできませんでした");
      return;
    }
    if (result.status === "not-found") {
      setMessage("Drive上にバックアップがまだありません(何か変更すると自動作成されます)");
      return;
    }
    if (result.status === "error") {
      setMessage("Driveからの読み込みに失敗しました");
      return;
    }
    const payload = parseImportPayload(result.json);
    if (!payload) {
      setMessage("復元失敗: バックアップの形式が不正です");
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
    setMessage("Driveから復元しました");
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
    <Card data-testid="data-panel">
      <Heading as="h2" size="3" mb="1">
        🗄️ データ管理(バックアップ・取り込み・NAS設定)
      </Heading>
      {jsonBackupStatusLabel ? (
        <Text as="p" size="1" color="gray" data-testid="json-backup-status" mb="2">
          {jsonBackupStatusLabel}(ブックマーク/ノート/設定は自動でDriveへバックアップされます)
        </Text>
      ) : null}
      <Flex wrap="wrap" gap="2">
        <Button
          type="button"
          variant="soft"
          data-testid="data-restore-from-drive"
          title="Google Drive上の自動バックアップから全データを復元する"
          onClick={() => void handleRestoreFromDrive()}
        >
          ☁️ Driveから復元
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-open-file"
          title="ローカルの.txtファイルを選んで新規ノートとして読み込む"
          onClick={() => void handleOpenFile()}
        >
          📄 ファイルを開く
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-set-nas-folder"
          title="履歴の長期保管先(NASの共有フォルダ等)を選ぶ"
          onClick={() => void handleSetNasFolder()}
        >
          📁 NASフォルダを設定
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-flush-nas"
          title="未保管の履歴を今すぐNASフォルダへ書き出す"
          onClick={() => void handleFlushNow()}
        >
          📤 今すぐNASへ書き出し
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-export-folder"
          title="全ノートをそれぞれ.mdファイルとしてフォルダへ書き出す"
          onClick={() => void handleExportFolder()}
        >
          🗂️ フォルダへ書き出し
        </Button>
      </Flex>
      {message ? (
        <Text as="p" size="2" data-testid="data-panel-message">
          {message}
        </Text>
      ) : null}
    </Card>
  );
}
