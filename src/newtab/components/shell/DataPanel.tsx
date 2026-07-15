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
import {
  CloudDownload,
  CloudUpload,
  FileText,
  FolderOpen,
  KeyRound,
  Settings as SettingsIcon,
  Upload,
} from "lucide-react";
import {
  getGeminiApiKey,
  getNasFolderPath,
  setGeminiApiKey,
  setNasFolderPath,
} from "../../../lib/storage/db";
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
  /** 現在の全データを今すぐGoogle Driveへ退避(バックアップ)する(自動同期の即時版)。 */
  onBackupToDrive: () => void;
};

export function DataPanel({
  sync,
  onImportData,
  onOpenFileAsNote,
  onMessage,
  onBackupToDrive,
}: Props) {
  const [nasPathInput, setNasPathInput] = useState("");
  // パス入力欄は常時表示だと見苦しいため(ユーザー指摘)、「NASフォルダを設定」を
  // 押した時だけその右に出す(ブックマーク/ノートの編集フォームと同じ「押したら
  // その場に出る」パターン)。
  const [showNasInput, setShowNasInput] = useState(false);
  // Gemini APIキー入力(タグ/要約/TODO抽出で使う)。秘匿情報なので保存済みの値は
  // 画面に出さず、設定済みかどうかだけを示す(再入力で上書き)。
  const [showGeminiInput, setShowGeminiInput] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [geminiKeySet, setGeminiKeySet] = useState(false);

  useEffect(() => {
    void getNasFolderPath().then((path) => {
      if (path) setNasPathInput(path);
    });
    void getGeminiApiKey().then((key) => setGeminiKeySet(Boolean(key)));
  }, []);

  async function handleSaveGeminiKey() {
    const key = geminiKeyInput.trim();
    if (!key) {
      onMessage("Gemini APIキーを入力してください(AI Studioで発行できます)");
      return;
    }
    await setGeminiApiKey(key);
    setGeminiKeyInput("");
    setGeminiKeySet(true);
    setShowGeminiInput(false);
    onMessage("Gemini APIキーを保存しました");
  }
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
    setShowNasInput(false);
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
          <FileText size={14} aria-hidden="true" />
          ファイルを開く
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-flush-nas"
          title="未保管の履歴を今すぐNASフォルダへ書き出す"
          onClick={() => void handleFlushNow()}
        >
          <Upload size={14} aria-hidden="true" />
          今すぐNASへ書き出し
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-backup-to-drive"
          title="現在の全データ(ノート/ブックマーク/設定/TODO)を今すぐGoogle Driveへ退避する"
          onClick={onBackupToDrive}
        >
          <CloudUpload size={14} aria-hidden="true" />
          Driveへ退避
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-restore-from-drive"
          title="Google Drive上の自動バックアップから全データを復元する"
          onClick={() => void handleRestoreFromDrive()}
        >
          <CloudDownload size={14} aria-hidden="true" />
          Driveから復元
        </Button>
        <Button
          type="button"
          variant={showNasInput ? "solid" : "soft"}
          data-testid="data-set-nas-folder"
          title="履歴の長期保管先(NASの共有フォルダ等)のパスを設定する"
          onClick={() => setShowNasInput((v) => !v)}
        >
          <FolderOpen size={14} aria-hidden="true" />
          NASフォルダを設定
        </Button>
        {showNasInput ? (
          <>
            <TextField.Root
              aria-label="NASフォルダのパス"
              placeholder="例: Z:\NAS\backup"
              data-testid="data-nas-path-input"
              autoFocus
              value={nasPathInput}
              onChange={(e) => setNasPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSaveNasPath();
              }}
            />
            <Button
              type="button"
              variant="soft"
              data-testid="data-save-nas-path"
              title="入力したパスを保存する"
              onClick={() => void handleSaveNasPath()}
            >
              保存
            </Button>
          </>
        ) : null}
        {/* 設定系ボタンとして配列の一番右に配置(ユーザー指示)。 */}
        <Button
          type="button"
          variant="soft"
          data-testid="data-connect-drive"
          title="Googleアカウントに接続する(以後は自動でDriveへバックアップされます)"
          onClick={() => void handleConnectDrive()}
        >
          <SettingsIcon size={14} aria-hidden="true" />
          GDrive設定
        </Button>
        <Button
          type="button"
          variant={showGeminiInput ? "solid" : "soft"}
          data-testid="data-set-gemini-key"
          title="Gemini APIキーを設定する(タグ付け/要約/TODO抽出で使用。AI Studioで発行)"
          onClick={() => setShowGeminiInput((v) => !v)}
        >
          <KeyRound size={14} aria-hidden="true" />
          Gemini APIキー{geminiKeySet ? "(設定済み)" : ""}
        </Button>
        {showGeminiInput ? (
          <>
            <TextField.Root
              aria-label="Gemini APIキー"
              type="password"
              placeholder={geminiKeySet ? "設定済み(再入力で上書き)" : "AIza... を貼り付け"}
              data-testid="data-gemini-key-input"
              autoFocus
              value={geminiKeyInput}
              onChange={(e) => setGeminiKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSaveGeminiKey();
              }}
            />
            <Button
              type="button"
              variant="soft"
              data-testid="data-save-gemini-key"
              title="入力したAPIキーを保存する"
              onClick={() => void handleSaveGeminiKey()}
            >
              保存
            </Button>
          </>
        ) : null}
      </div>
    </Flex>
  );
}
