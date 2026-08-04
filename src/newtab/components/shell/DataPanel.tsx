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
  Activity,
  BatteryWarning,
  Bell,
  BellOff,
  CloudDownload,
  CloudUpload,
  Download,
  FileText,
  FileUp,
  FolderOpen,
  FolderSymlink,
  KeyRound,
  Settings as SettingsIcon,
  Trash2,
  Upload,
} from "lucide-react";
import {
  getAlarmEnabled,
  getBatteryWebhookConfig,
  getGeminiApiKey,
  getNasFolderPath,
  saveDriveFolderId,
  setAlarmEnabled,
  setBatteryWebhookConfig,
  setDriveSharedFolderChosen,
  setGeminiApiKey,
  setNasFolderPath,
} from "../../../lib/storage/db";
import { dedupeStoredSnapshots } from "../../../lib/history/snapshotCleanup";
import {
  clearDiagnostics,
  formatDiagnosticsLog,
  readDiagnostics,
  summarizeDiagnostics,
} from "../../../lib/runtime/watchdog";
import { parseImportPayload } from "../../../lib/fileio/exportImport";
import { pickAndReadTextFile } from "../../../lib/fileio/fileSystem";
import { flushAllToNas } from "../../../lib/externalIO/nasArchive";
import { probeNasPath } from "../../../lib/externalIO/nasNativeHost";
import { getAuthToken, getAuthTokenWithError } from "../../../lib/drive/googleAuth";
import { resetDriveFolderCache } from "../../../lib/drive/drive";
import { restoreJsonBackupFromDrive } from "../../../lib/drive/jsonBackupSync";
import { pickSharedFolderViaOAuth } from "../../../lib/drive/pickerOAuth";
import type { AppLaunch, Bookmark, Note, Settings, SpecialItem, Todo } from "../../../types";

type SyncState = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };

type Props = {
  sync: SyncState;
  onImportData: (data: {
    sync: SyncState;
    notes: Note[];
    todos?: Todo[];
    specialItems?: SpecialItem[];
    specialFolders?: string[];
  }) => void;
  onOpenFileAsNote: (title: string, content: string) => void;
  onMessage: (message: string) => void;
  /** 現在の全データを今すぐGoogle Driveへ退避(バックアップ)する(自動同期の即時版)。 */
  onBackupToDrive: () => void;
  /** NASのdata/settings-backup.json(notesを除く全体設定)を読み戻して適用する。 */
  onRestoreFromNas: () => void;
  /** 設定(notesを除く)をローカルファイルへ書き出す/ローカルファイルから読み込む。
   * 保管庫やDriveを使わない環境でも設定を持ち運べるようにするためのユーザー指示。 */
  onExportSettingsFile: () => void;
  onImportSettingsFile: () => void;
  /** 端末ローカル設定(IndexedDB)を外部から書き換えた時に増える。この値が変わると
   * このパネルは設定済み表示・入力欄の初期値を読み直す(設定のファイル取り込み用)。 */
  deviceSettingsReloadSignal: number;
  /** 現在開いているノートを即座にNASのactive/と今日の日付フォルダへ反映する
   * (ユーザー指示: 「今すぐNASへ書き出し」でも通常のtickを待たずに反映してほしい)。 */
  onPushNasActiveNow: () => Promise<void>;
  /** Drive接続状態(null=未判定)。Appが持つ——このパネルは折りたたまれるため、ここで
   * 状態を持つと開くまで未接続に気づけず早期警告にならない(App.tsxのdriveConnected参照)。 */
  driveConnected: boolean | null;
  /** 接続状態が判明/変化したときにAppへ知らせる(「GDrive設定」での再接続結果を即反映する)。 */
  onDriveConnectionChange: (connected: boolean) => void;
  /** 保管庫フォルダ/Gemini APIキー/バッテリー中継の設定が変わった時にAppへ知らせる。
   * Appはヘッダーの常時表示バッジ(未設定の間だけ出す)をこれで更新する——このパネルは
   * 開いている間しか存在せず、ここだけでstateを持つと閉じるまで/次に開くまでバッジが
   * 古いままになる(driveConnected/onDriveConnectionChangeと同じ理由)。 */
  onNasConfiguredChange: (configured: boolean) => void;
  onGeminiConfiguredChange: (configured: boolean) => void;
  onBatteryConfiguredChange: (configured: boolean) => void;
  /** 「共有フォルダを選択」を実行済みかが変わった時にAppへ知らせる(同じ形の3つと同じ理由)。 */
  onDriveSharedFolderChosenChange: (chosen: boolean) => void;
};

export function DataPanel({
  sync,
  onImportData,
  onOpenFileAsNote,
  onMessage,
  onBackupToDrive,
  onRestoreFromNas,
  onExportSettingsFile,
  onImportSettingsFile,
  deviceSettingsReloadSignal,
  onPushNasActiveNow,
  driveConnected,
  onDriveConnectionChange,
  onNasConfiguredChange,
  onGeminiConfiguredChange,
  onBatteryConfiguredChange,
  onDriveSharedFolderChosenChange,
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
  // スマホのバッテリー低下警告(GAS Web App中継。gas/README.md参照)の接続設定。
  // トークンは秘匿情報なのでGeminiキーと同じ扱い(保存済みの値は画面に出さない)。
  const [showBatteryInput, setShowBatteryInput] = useState(false);
  const [batteryUrlInput, setBatteryUrlInput] = useState("");
  const [batteryTokenInput, setBatteryTokenInput] = useState("");
  const [batteryConfigSet, setBatteryConfigSet] = useState(false);
  // この端末でアラーム(予定前・バッテリー)を鳴らすか。**端末ローカル設定**(db.ts。settings
  // backup/復元で他PCへ伝播しない)。既定=鳴らす。複数PCで同時に鳴るのを避けたい端末でオフにする。
  const [alarmOn, setAlarmOn] = useState(true);
  // 履歴の重複掃除: 押す→確認ボタンが出る→実行(履歴を消すので二段クリックにする)。
  const [cleanupArmed, setCleanupArmed] = useState(false);
  const [cleaningHistory, setCleaningHistory] = useState(false);
  useEffect(() => {
    // 非対話で問い合わせる——日常の画面表示でOAuthポップアップを出さないため(App.tsxの
    // 突合effectと同じ方針)。結果はAppへ返す(常時表示の警告バッジもこの値で出る)。
    void getAuthToken(false).then((token) => onDriveConnectionChange(token !== null));
    void getNasFolderPath().then((path) => {
      if (path) setNasPathInput(path);
    });
    void getGeminiApiKey().then((key) => setGeminiKeySet(Boolean(key)));
    void getBatteryWebhookConfig().then((config) => {
      if (config) {
        setBatteryUrlInput(config.url);
        setBatteryConfigSet(true);
      }
    });
    void getAlarmEnabled().then(setAlarmOn);
    // deviceSettingsReloadSignalで読み直す: 「設定をファイルから読み込み」はIndexedDB側の
    // 端末ローカル設定を丸ごと差し替えるが、この画面の「(設定済み)」表示や入力欄の初期値は
    // マウント時に一度読むだけだった——パネルを開いたまま取り込むと、実際には設定されて
    // いるのに「未設定」のままに見える(2026-07-29)。
  }, [deviceSettingsReloadSignal]);

  /** 「固まった」の証拠(ウォッチドッグの診断ログ)を人が読める形にしてクリップボードへ。
   * ノートへ書き出すとNAS/Drive同期や自動タグ付けに乗ってしまうため、貼り付けで渡せる
   * クリップボードにする(渡し先はチャット/issue)。 */
  async function handleCopyDiagnostics() {
    const events = await readDiagnostics();
    const summary = summarizeDiagnostics(events);
    try {
      await navigator.clipboard.writeText(formatDiagnosticsLog(events));
      onMessage(`${summary} — クリップボードへコピーしました`);
    } catch (error) {
      // クリップボードが使えない状況でも、要約だけは画面で読めるようにする。
      onMessage(`${summary}(コピーに失敗: ${String(error)})`);
    }
  }

  /** 診断ログを空にする(ユーザー指示: 拡張を更新した後、古い記録と混ざらないよう
   * まっさらな状態から検証したい)。過去の記録を消すだけで、以後もウォッチドッグは動き続ける。 */
  async function handleClearDiagnostics() {
    await clearDiagnostics();
    onMessage("診断ログを消去しました");
  }

  /** 溜まってしまった同一内容の履歴を畳む(2026-07-25の増殖バグの後始末。lib側が正本)。 */
  async function handleCleanupHistory() {
    setCleaningHistory(true);
    onMessage("履歴の重複を掃除しています…");
    try {
      const { scanned, removed, indexTokensTouched } = await dedupeStoredSnapshots();
      onMessage(
        removed === 0
          ? `履歴に重複はありませんでした(${scanned}件を確認)`
          : `重複した履歴を${removed}件削除しました(${scanned}件中・検索索引${indexTokensTouched}件を更新)`,
      );
    } catch (error) {
      onMessage(`履歴の掃除に失敗しました: ${String(error)}`);
    } finally {
      setCleaningHistory(false);
      setCleanupArmed(false);
    }
  }

  async function handleToggleAlarm() {
    const next = !alarmOn;
    await setAlarmEnabled(next);
    setAlarmOn(next);
    onMessage(
      next
        ? "この端末でアラーム(予定前・バッテリー)を鳴らします"
        : "この端末ではアラームを鳴らしません(音も通知も出しません。他PCには影響しません)",
    );
  }

  async function handleSaveGeminiKey() {
    const key = geminiKeyInput.trim();
    if (!key) {
      onMessage("Gemini APIキーを入力してください(AI Studioで発行できます)");
      return;
    }
    await setGeminiApiKey(key);
    setGeminiKeyInput("");
    setGeminiKeySet(true);
    onGeminiConfiguredChange(true);
    setShowGeminiInput(false);
    onMessage("Gemini APIキーを保存しました");
  }
  async function handleConnectDrive() {
    const { token, error } = await getAuthTokenWithError(true);
    onDriveConnectionChange(token !== null); // 再接続の成否を警告バッジ/ボタン表示へ即反映する
    onMessage(
      token
        ? "Googleアカウントに接続しました(以後は自動でDriveへバックアップされます)"
        : // 「失敗しました」とだけ出しても原因の手がかりが一切残らないため、
          // 実際のエラー内容をそのまま案内に含める(NAS設定と同じ方針)。
          `Googleアカウントへの接続に失敗しました(${error}。ポップアップを閉じた場合は再度お試しください)`,
    );
  }

  // 複数アプリでapp/フォルダを共有するため、drive.fileスコープのままGoogle Pickerの
  // 「デスクトップ・モバイル向けフロー」(OAuth認可URL・インプリシットフロー。メインログインと
  // 同じ「ウェブアプリケーション」型クライアントをdrive.file単体スコープで使い回す)で既存の
  // 共有フォルダをユーザーに明示選択してもらい、そのフォルダIDを「app」パスの永続キャッシュへ
  // 直接書き込む(ユーザー設計)。以後のresolveFolderPath(["app","New Tab Board",...])は
  // 名前検索すらせずこのIDを使う。resetDriveFolderCache()でメモリ+永続の両方をクリアしてから
  // 書き込む——永続キャッシュだけクリアすると、同じタブ内ではメモリの`folderIdCache`が
  // 選び直した後も古いIDを返し続け、直後の「Driveへ退避」が失敗する実機不具合があった。
  async function handlePickSharedFolder() {
    let picked: { id: string; name: string | null } | null;
    try {
      picked = await pickSharedFolderViaOAuth();
    } catch (err) {
      onMessage(`フォルダ選択に失敗しました(${err instanceof Error ? err.message : String(err)})`);
      return;
    }
    if (!picked) {
      onMessage("フォルダ選択がキャンセルされました");
      return;
    }
    await resetDriveFolderCache();
    await saveDriveFolderId("app", picked.id);
    await setDriveSharedFolderChosen();
    onDriveSharedFolderChosenChange(true); // 常時表示バッジ(未選択の間だけ出す)を即時反映する
    onMessage(
      `共有フォルダ「${picked.name ?? picked.id}」を選択しました(以後このフォルダを使います)`,
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
      todos: payload.todos,
      specialItems: payload.specialItems,
      specialFolders: payload.specialFolders,
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
      onMessage("保管庫フォルダのパスを入力してください");
      return;
    }
    // 拡張機能はサンドボックスの都合上パス文字列だけでは読み書きできないため、
    // native-host/nas_bridge.py(NASブリッジ)へ実際に到達確認する。host未導入
    // ならここで検出できる(showDirectoryPickerの既知バグを回避する本格対応
    // ——docs/nas-native-messaging-protocol.md参照)。
    const reachable = await probeNasPath(path);
    if (!reachable) {
      onMessage(
        "保管庫フォルダに到達できませんでした(パスが正しいか、native-host/README.mdの手順で" +
          "保管庫ブリッジを導入済みか確認してください)",
      );
      return;
    }
    await setNasFolderPath(path);
    setShowNasInput(false);
    onNasConfiguredChange(true);
    onMessage("保管庫フォルダを設定しました");
  }

  async function handleSaveBatteryConfig() {
    const url = batteryUrlInput.trim();
    const token = batteryTokenInput.trim();
    if (!url || !token) {
      onMessage("GAS Web AppのURLと共有トークンの両方を入力してください");
      return;
    }
    await setBatteryWebhookConfig({ url, token });
    setBatteryTokenInput("");
    setBatteryConfigSet(true);
    onBatteryConfiguredChange(true);
    setShowBatteryInput(false);
    onMessage("バッテリー低下警告の接続設定を保存しました");
  }

  async function handleFlushNow() {
    const { flushed, failed } = await flushAllToNas();
    // 未保管の履歴フラッシュに加え、現在開いているノートもactive/日付フォルダへ即座に反映する
    // (ユーザー指示: ボタンを押した時点で通常のtickを待たずに反映してほしい)。
    await onPushNasActiveNow();
    onMessage(`保管庫へ${flushed}件書き出しました(失敗${failed}件)`);
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
          title="未保管の履歴を今すぐ保管庫フォルダへ書き出す"
          onClick={() => void handleFlushNow()}
        >
          <Upload size={14} aria-hidden="true" />
          今すぐ保管庫へ書き出し
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-restore-from-nas"
          title="保管庫に保存された設定バックアップ(テーマ/TODO/ブックマーク/ノート文字サイズ/お気に入り/タグ候補。notesは対象外)から復元する"
          onClick={onRestoreFromNas}
        >
          <CloudDownload size={14} aria-hidden="true" />
          保管庫から復元
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-export-settings-file"
          title="設定(テーマ/TODO/ブックマーク/お気に入り/タグ候補に加え、Gemini APIキー・GAS連携・保管庫フォルダパス・GDrive/共有フォルダ設定も含む)をローカルのJSONファイルへ書き出す。APIキーは平文で入るため取り扱い注意。notesは対象外"
          onClick={onExportSettingsFile}
        >
          <Download size={14} aria-hidden="true" />
          設定をファイルへ書き出し
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-import-settings-file"
          title="書き出した設定JSONファイルを選んで読み込む(設定・TODO・ブックマークに加え、Gemini APIキー・GAS連携・保管庫フォルダパス・GDrive/共有フォルダ設定も反映する。notesは対象外)"
          onClick={onImportSettingsFile}
        >
          <FileUp size={14} aria-hidden="true" />
          設定をファイルから読み込み
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-backup-to-drive"
          title="現在の全データ(ノート/ブックマーク/設定/TODO)を今すぐGoogle Driveへバックアップする"
          onClick={onBackupToDrive}
        >
          <CloudUpload size={14} aria-hidden="true" />
          今すぐDriveへバックアップ
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
          title="履歴の長期保管先(共有フォルダ等)のパスを設定する"
          onClick={() => setShowNasInput((v) => !v)}
        >
          <FolderOpen size={14} aria-hidden="true" />
          保管庫フォルダを設定
        </Button>
        {showNasInput ? (
          <>
            <TextField.Root
              aria-label="保管庫フォルダのパス"
              placeholder="例: Z:\保管庫\backup"
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
          // 未接続はDrive連携が全停止している状態——soft(他の設定ボタンと同じ見た目)だと
          // 埋もれて気づけないため、色で浮かせる(2026-07-20の2日間無症状停止を受けて)。
          variant={driveConnected === false ? "solid" : "soft"}
          color={driveConnected === false ? "orange" : undefined}
          data-testid="data-connect-drive"
          data-drive-connected={driveConnected === null ? "unknown" : String(driveConnected)}
          title={
            driveConnected === false
              ? "Driveへ未接続です。ノートの同期・削除の反映が停止しています。押して再接続してください"
              : "Googleアカウントに接続する(以後は自動でDriveへバックアップされます)"
          }
          onClick={() => void handleConnectDrive()}
        >
          <SettingsIcon size={14} aria-hidden="true" />
          GDrive設定{driveConnected === false ? "(未接続)" : ""}
        </Button>
        <Button
          type="button"
          variant="soft"
          data-testid="data-pick-shared-folder"
          title="Google Picker で複数アプリ共有の既存フォルダ(app等)を選択する(drive.fileスコープのまま、選んだフォルダへのアクセスを得られる)"
          onClick={() => void handlePickSharedFolder()}
        >
          <FolderSymlink size={14} aria-hidden="true" />
          共有フォルダを選択
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
        <Button
          type="button"
          variant={showBatteryInput ? "solid" : "soft"}
          data-testid="data-set-battery-webhook"
          title="GAS(Google Apps Script) Web App連携の接続先を設定する(現在はスマホのバッテリー低下警告で使用。gas/README.md参照)"
          onClick={() => setShowBatteryInput((v) => !v)}
        >
          <BatteryWarning size={14} aria-hidden="true" />
          GAS連携を設定{batteryConfigSet ? "(設定済み)" : ""}
        </Button>
        {showBatteryInput ? (
          <>
            <TextField.Root
              aria-label="バッテリー警告のGAS Web App URL"
              placeholder="https://script.google.com/macros/s/xxx/exec"
              data-testid="data-battery-url-input"
              autoFocus
              value={batteryUrlInput}
              onChange={(e) => setBatteryUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSaveBatteryConfig();
              }}
            />
            <TextField.Root
              aria-label="バッテリー警告の共有トークン"
              type="password"
              placeholder={batteryConfigSet ? "設定済み(再入力で上書き)" : "共有トークン"}
              data-testid="data-battery-token-input"
              value={batteryTokenInput}
              onChange={(e) => setBatteryTokenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSaveBatteryConfig();
              }}
            />
            <Button
              type="button"
              variant="soft"
              data-testid="data-save-battery-webhook"
              title="入力したURL・トークンを保存する"
              onClick={() => void handleSaveBatteryConfig()}
            >
              保存
            </Button>
          </>
        ) : null}
        {/* アラーム(予定前・バッテリー)を この端末で 鳴らすか。複数PCで同時に鳴るのを避けたい
            端末でオフにする。端末ローカル設定(db.ts)なので他PCへは伝播しない。 */}
        <Button
          type="button"
          variant={alarmOn ? "soft" : "solid"}
          color={alarmOn ? undefined : "red"}
          data-testid="data-toggle-alarm"
          title="この端末で予定前アラーム・バッテリー警告の音/通知を出すか(複数PCで同時に鳴るのを避けたいときにオフ。この端末だけに効き、他PCには影響しません)"
          onClick={() => void handleToggleAlarm()}
        >
          {alarmOn ? (
            <Bell size={14} aria-hidden="true" />
          ) : (
            <BellOff size={14} aria-hidden="true" />
          )}
          {alarmOn ? "アラーム: この端末で鳴らす" : "アラーム: この端末では鳴らさない"}
        </Button>
        {/* 「ブラウザが止まった」の証拠を渡すための書き出し(常駐ウォッチドッグが記録している)。
            止まった直後でも、復帰後に読めば「何秒止まったか・その時の資源量」が残っている。 */}
        <Button
          type="button"
          variant="soft"
          data-testid="data-copy-diagnostics"
          title="固まった時の記録(主スレッドが止まっていた時間・その時のノート数/エディタ数/メモリ)をクリップボードへコピーする。ノート本文は含みません"
          onClick={() => void handleCopyDiagnostics()}
        >
          <Activity size={14} aria-hidden="true" />
          診断ログをコピー
        </Button>
        {/* 拡張を更新した後、古い記録(修正前の挙動)と混ざらないよう空にする(ユーザー指示)。
            コピーではなく削除なので確認は挟まない——履歴の重複掃除と違い元に戻す価値のある
            データではなく、単なる調査用ログのため。 */}
        <Button
          type="button"
          variant="soft"
          color="gray"
          data-testid="data-clear-diagnostics"
          title="蓄積した診断ログを消去する(拡張を更新した後、まっさらな状態から検証したい時に)"
          onClick={() => void handleClearDiagnostics()}
        >
          診断ログを消去
        </Button>
        {/* 2026-07-25以前に「ペインがマウントしただけ」で積まれた同一内容の履歴を一度だけ畳む
            (原因側は修正済みだが、既に溜まった分は消えない)。**履歴を消す操作**なので、
            NASフォルダ設定と同じ二段クリック(押す→確認が出る)にする。window.confirmは
            このアプリのどこでも使っていないので、既存の展開型の作法に合わせる。 */}
        <Button
          type="button"
          variant={cleanupArmed ? "solid" : "soft"}
          data-testid="data-cleanup-history"
          title="同じ内容が連続して重複保存されている履歴を1件に畳む(内容が変わっている履歴・保管庫へ保管済みの履歴は消しません)"
          disabled={cleaningHistory}
          onClick={() => setCleanupArmed((v) => !v)}
        >
          <Trash2 size={14} aria-hidden="true" />
          {cleaningHistory ? "履歴を掃除中…" : "履歴の重複を掃除"}
        </Button>
        {cleanupArmed ? (
          <>
            <Button
              type="button"
              color="red"
              data-testid="data-cleanup-history-run"
              title="連続して同じ内容の履歴を1件だけ残して削除する(元に戻せません)"
              disabled={cleaningHistory}
              onClick={() => void handleCleanupHistory()}
            >
              重複を削除する(戻せません)
            </Button>
            <Button
              type="button"
              variant="soft"
              color="gray"
              data-testid="data-cleanup-history-cancel"
              disabled={cleaningHistory}
              onClick={() => setCleanupArmed(false)}
            >
              やめる
            </Button>
          </>
        ) : null}
      </div>
    </Flex>
  );
}
