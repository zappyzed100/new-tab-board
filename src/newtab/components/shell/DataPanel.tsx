// DataPanel.tsx — JSON全データバックアップ(Drive自動同期+Driveから復元)・ローカル
// ファイル操作・NASアーカイブ設定(SPEC.md §4.3・§4.7・§4.10-a)
// JSONエクスポート/インポートは、ボタン操作不要の自動Driveバックアップ(App.tsxの
// useJsonBackupSync)に置き換えた——このパネルの「Driveから復元」は明示的なクリック
// 操作のままにしている(自動復元はローカル未同期の変更を問答無用で上書きする危険があるため)。
// 結果メッセージの表示state・DOM位置はApp.tsx側に持たせている(onMessageで通知するだけ)
// ——このコンポーネント内で持つと、隣接する「ショートカット一覧」ボタンとwidth:100%の
// メッセージが同じflexコンテナで並ぶため、メッセージの有無でショートカットボタンの
// 表示位置がガタつく(ユーザー指摘)。
import { useEffect, useState } from "react";
import { Button, Flex, TextField } from "@radix-ui/themes";
import { getNasFolderPath, setNasFolderPath } from "../../../lib/storage/db";
import { parseImportPayload } from "../../../lib/fileio/exportImport";
import { pickAndReadTextFile } from "../../../lib/fileio/fileSystem";
import { flushAllToNas } from "../../../lib/externalIO/nasArchive";
import { probeNasPath } from "../../../lib/externalIO/nasNativeHost";
import { getAuthTokenWithError } from "../../../lib/drive/googleAuth";
import { restoreJsonBackupFromDrive } from "../../../lib/drive/jsonBackupSync";
import type { AppLaunch, Bookmark, Note, Settings } from "../../../types";

type SyncState = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };

type Props = {
  sync: SyncState;
  onImportData: (data: { sync: SyncState; notes: Note[] }) => void;
  onOpenFileAsNote: (title: string, content: string) => void;
  onMessage: (message: string) => void;
};

export function DataPanel({ sync, onImportData, onOpenFileAsNote, onMessage }: Props) {
  const [nasPathInput, setNasPathInput] = useState("");

  useEffect(() => {
    void getNasFolderPath().then((path) => {
      if (path) setNasPathInput(path);
    });
  }, []);
  async function handleConnectDrive() {
    const { token, error } = await getAuthTokenWithError(true);
    onMessage(
      token
        ? "Googleアカウントに接続しました(以後は自動でDriveへバックアップされます)"
        : // 「失敗しました」とだけ出しても原因の手がかりが一切残らないため、
          // 実際のエラー内容をそのまま案内に含める(NAS設定と同じ方針)。
          `Googleアカウントへの接続に失敗しました(${error}。ポップアップを閉じた場合は再度お試しください)`,
    );
  }

  async function handleRestoreFromDrive() {
    const result = await restoreJsonBackupFromDrive(true, sync.settings.jsonBackupFileId);
    if (result.status === "unauthenticated") {
      onMessage("Googleアカウントにログインできませんでした");
      return;
    }
    if (result.status === "not-found") {
      onMessage("Drive上にバックアップがまだありません(何か変更すると自動作成されます)");
      return;
    }
    if (result.status === "error") {
      onMessage("Driveからの読み込みに失敗しました");
      return;
    }
    const payload = parseImportPayload(result.json);
    if (!payload) {
      onMessage("復元失敗: バックアップの形式が不正です");
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
    onMessage("Driveから復元しました");
  }

  async function handleOpenFile() {
    const result = await pickAndReadTextFile();
    if (!result) {
      // キャンセル時も無反応に見えないよう明示的に案内する(NAS設定と同じ方針——
      // 「何も起きない」と「機能が壊れている」をユーザーが区別できるようにする)。
      onMessage("ファイル選択がキャンセルされました");
      return;
    }
    const title = result.name.replace(/\.txt$/i, "");
    onOpenFileAsNote(title, result.content);
    onMessage(`「${title}」をノートとして読み込みました`);
  }

  async function handleSaveNasPath() {
    const path = nasPathInput.trim();
    if (!path) {
      onMessage("NASフォルダのパスを入力してください");
      return;
    }
    // 拡張機能はサンドボックスの都合上パス文字列だけでは読み書きできないため、
    // native-host/nas_bridge.py(NASブリッジ)へ実際に到達確認する。host未導入
    // ならここで検出できる(showDirectoryPickerの既知バグを回避する本格対応
    // ——docs/nas-native-messaging-protocol.md参照)。
    const reachable = await probeNasPath(path);
    if (!reachable) {
      onMessage(
        "NASフォルダに到達できませんでした(パスが正しいか、native-host/README.mdの手順で" +
          "NASブリッジを導入済みか確認してください)",
      );
      return;
    }
    await setNasFolderPath(path);
    onMessage("NASフォルダを設定しました");
  }

  async function handleFlushNow() {
    const { flushed, failed } = await flushAllToNas();
    onMessage(`NASへ${flushed}件書き出しました(失敗${failed}件)`);
  }

  return (
    <Flex asChild wrap="wrap" gap="2">
      <div data-testid="data-panel">
        {/* 使用頻度順(左ほどよく使う): 日常のノート運用に絡む操作(開く/書き出し)を左、
            初期設定・災害復旧向けの稀な操作を右へ(ユーザー指示)。 */}
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
          data-testid="data-flush-nas"
          title="未保管の履歴を今すぐNASフォルダへ書き出す"
          onClick={() => void handleFlushNow()}
        >
          📤 今すぐNASへ書き出し
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-restore-from-drive"
          title="Google Drive上の自動バックアップから全データを復元する"
          onClick={() => void handleRestoreFromDrive()}
        >
          ☁️ Driveから復元
        </Button>
        <TextField.Root
          aria-label="NASフォルダのパス"
          placeholder="例: Z:\NAS\backup"
          data-testid="data-nas-path-input"
          value={nasPathInput}
          onChange={(e) => setNasPathInput(e.target.value)}
        />
        <Button
          type="button"
          variant="soft"
          data-testid="data-set-nas-folder"
          title="履歴の長期保管先(NASの共有フォルダ等)のパスを保存する"
          onClick={() => void handleSaveNasPath()}
        >
          📁 NASフォルダを保存
        </Button>
        {/* 設定系ボタンとして配列の一番右に配置(ユーザー指示)。 */}
        <Button
          type="button"
          variant="soft"
          data-testid="data-connect-drive"
          title="Googleアカウントに接続する(以後は自動でDriveへバックアップされます)"
          onClick={() => void handleConnectDrive()}
        >
          ⚙️ GDrive設定
        </Button>
      </div>
    </Flex>
  );
}
