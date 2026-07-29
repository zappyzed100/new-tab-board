// deviceSettings.ts — 「端末ローカル設定」(IndexedDB側)をローカルファイルへ持ち出す/戻すための集約
//
// 【なぜ settingsBackup.ts と分けるのか — 2026-07-29】
// db.ts の端末ローカル設定(Gemini APIキー・GAS連携トークン・保管庫パス・Driveフォルダ設定)は、
// 「同期・バックアップ経由で外部へ漏れない」ことを目的に **意図的に** chrome.storage.sync にも
// 保管庫/Drive の設定バックアップにも載せていない(db.ts のヘッダー参照。§7 秘匿)。
// 一方でユーザーからは「手動でローカルへ書き出すファイルにはこれらも入れてほしい」という
// 明示の指示があった(移行や再セットアップのたびに5項目を手で入れ直すのが実務上の負担)。
//
// そこで**経路ごとに扱いを変える**:
//   - 自動でクラウドへ上がる経路(settingsBackup.ts → 保管庫/Drive): 従来どおり含めない。
//   - ユーザーが明示的に押して自分のディスクへ保存する経路(このモジュール): 含める。
// これにより db.ts の方針の目的(秘匿情報が**自動で**外部へ出ないこと)を保ったまま、
// 手動の持ち出しだけを可能にする。書き出したファイルは平文なので取り扱い注意
// ——UI側(DataPanel)のtitleと結果メッセージでその旨を明示する。
import {
  getAlarmEnabled,
  getBatteryWebhookConfig,
  getDriveFolderIds,
  getDriveSharedFolderChosen,
  getGeminiApiKey,
  getNasFolderPath,
  saveDriveFolderId,
  setAlarmEnabled,
  setBatteryWebhookConfig,
  setDriveSharedFolderChosen,
  setGeminiApiKey,
  setNasFolderPath,
  type BatteryWebhookConfig,
} from "../storage/db";

/** ローカルファイルへ持ち出す端末ローカル設定。未設定の項目は欠落させる(undefined)
 * ——空文字で書き出すと、取り込み側で「未設定へ戻す」のか「触らない」のか区別できない。 */
export type DeviceSettings = {
  /** 保管庫フォルダのパス。 */
  nasFolderPath?: string;
  /** Gemini APIキー(秘匿)。 */
  geminiApiKey?: string;
  /** GAS連携(バッテリー中継)のURL+トークン(秘匿)。 */
  batteryWebhookConfig?: BatteryWebhookConfig;
  /** この端末でアラーム音を鳴らすか。 */
  alarmEnabled?: boolean;
  /** Driveのフォルダパス→フォルダIDの永続キャッシュ(GDrive設定/共有フォルダ設定の実体)。 */
  driveFolderIds?: Record<string, string>;
  /** 「共有フォルダを選択」を明示実行済みかの旗。 */
  driveSharedFolderChosen?: boolean;
};

/** 現在の端末ローカル設定を読み出す。未設定の項目はキーごと省く。 */
export async function readDeviceSettings(): Promise<DeviceSettings> {
  const [
    nasFolderPath,
    geminiApiKey,
    batteryWebhookConfig,
    alarmEnabled,
    driveFolderIds,
    driveSharedFolderChosen,
  ] = await Promise.all([
    getNasFolderPath(),
    getGeminiApiKey(),
    getBatteryWebhookConfig(),
    getAlarmEnabled(),
    getDriveFolderIds(),
    getDriveSharedFolderChosen(),
  ]);
  const out: DeviceSettings = { alarmEnabled, driveSharedFolderChosen };
  if (nasFolderPath !== undefined) out.nasFolderPath = nasFolderPath;
  if (geminiApiKey !== undefined) out.geminiApiKey = geminiApiKey;
  if (batteryWebhookConfig !== undefined) out.batteryWebhookConfig = batteryWebhookConfig;
  // 空オブジェクトは「1件も無い」なので書き出さない(取り込み側の判定を単純に保つ)。
  if (driveFolderIds && Object.keys(driveFolderIds).length > 0) {
    out.driveFolderIds = driveFolderIds;
  }
  return out;
}

/** 取り込んだ端末ローカル設定を適用する。**欠落している項目は現状維持**(空で潰さない)
 * ——古い版のファイルや、一部だけ設定していた端末で書き出したファイルを読んでも、
 * 設定済みの項目を巻き添えで消さないため。 */
export async function applyDeviceSettings(settings: DeviceSettings): Promise<void> {
  if (settings.nasFolderPath !== undefined) await setNasFolderPath(settings.nasFolderPath);
  if (settings.geminiApiKey !== undefined) await setGeminiApiKey(settings.geminiApiKey);
  if (settings.batteryWebhookConfig !== undefined) {
    await setBatteryWebhookConfig(settings.batteryWebhookConfig);
  }
  if (settings.alarmEnabled !== undefined) await setAlarmEnabled(settings.alarmEnabled);
  for (const [path, id] of Object.entries(settings.driveFolderIds ?? {})) {
    await saveDriveFolderId(path, id);
  }
  // 旗を降ろすAPIは無い(db.tsのsetDriveSharedFolderChosenは立てる専用)。falseは
  // 「まだ選んでいない」の初期値と同義なので、trueのときだけ立てれば復元として足りる。
  if (settings.driveSharedFolderChosen === true) await setDriveSharedFolderChosen();
}

/** 取り込んだJSONのdeviceSettings部分を検証する。想定外の形はundefinedにして無視する
 * (設定本体の取り込みまで巻き添えで失敗させない)。 */
export function parseDeviceSettings(value: unknown): DeviceSettings | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const out: DeviceSettings = {};
  if (typeof v.nasFolderPath === "string") out.nasFolderPath = v.nasFolderPath;
  if (typeof v.geminiApiKey === "string") out.geminiApiKey = v.geminiApiKey;
  if (typeof v.alarmEnabled === "boolean") out.alarmEnabled = v.alarmEnabled;
  if (typeof v.driveSharedFolderChosen === "boolean") {
    out.driveSharedFolderChosen = v.driveSharedFolderChosen;
  }
  const battery = v.batteryWebhookConfig;
  if (battery && typeof battery === "object") {
    const b = battery as Record<string, unknown>;
    if (typeof b.url === "string" && typeof b.token === "string") {
      out.batteryWebhookConfig = { url: b.url, token: b.token };
    }
  }
  const folders = v.driveFolderIds;
  if (folders && typeof folders === "object" && !Array.isArray(folders)) {
    const entries = Object.entries(folders as Record<string, unknown>).filter(
      ([, id]) => typeof id === "string",
    ) as [string, string][];
    if (entries.length > 0) out.driveFolderIds = Object.fromEntries(entries);
  }
  return out;
}
