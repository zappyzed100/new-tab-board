// background.ts — サービスワーカー(インストールログ + Calendar次予定の定期ポーリング +
// 予定前アラーム。SPEC.md §4.9・§4.11)
import { logOp } from "../lib/runtime/log";
import { getAuthToken } from "../lib/drive/googleAuth";
import { fetchNextEvent } from "../lib/nextEvent/calendar";
import { resolveAlarmTime } from "../lib/nextEvent/preEventAlarm";
import { loadLocalData, saveLocalData } from "../lib/storage/storage";
import { getBatteryWebhookConfig, getNasFolderPath } from "../lib/storage/db";
import { rebuildNasIndex } from "../lib/externalIO/nasNativeHost";
import { fetchBatteryStatus } from "../lib/externalIO/batteryStatus";
import { copyNotesToDriveDateFolder } from "../lib/drive/driveActiveMirror";
import { syncDriveNotesSafely } from "../lib/drive/driveSafeSync";
import { now as clockNow } from "../lib/runtime/clock";

const POLL_ALARM_NAME = "next-event-poll";
// カレンダー次予定の取得間隔。ユーザー指示で15分に一回(予定の10分前アラームは preEventAlarm 側)。
const POLL_INTERVAL_MINUTES = 15;
const PRE_EVENT_ALARM_NAME = "pre-event-alarm";
const NOTIFICATION_ID = "pre-event-notification";
// 日次メンテ(Drive日付フォルダへ前日分を格納 + NASのSQLite索引を再生成)。厳密な0:30起動は
// chrome.alarmsでは保証できないため、1時間おきに起こして「日付が変わっていれば一度だけ実行」
// する方式にする(ユーザー指示の「一日一回・0:30くらい・起動時に未実行なら補完」を満たす)。
const DAILY_ALARM_NAME = "daily-maintenance";
const DAILY_INTERVAL_MINUTES = 60;
// スマホのバッテリー低下警告(GAS Web App中継。gas/README.md参照)。1時間間隔で確認する
// (ユーザー指示・2026-07-18に15分から変更)。
const BATTERY_POLL_ALARM_NAME = "battery-poll";
const BATTERY_POLL_INTERVAL_MINUTES = 60;
const BATTERY_NOTIFICATION_ID = "battery-low-notification";
// ノートのDrive同期は各New Tabではなくservice workerの1本へ集約する。5分ごとに
// ノートID単位の和集合マージを行い、結果はchrome.storage経由で開いているタブへ配信される。
const DRIVE_SYNC_ALARM_NAME = "drive-note-sync";
const DRIVE_SYNC_INTERVAL_MINUTES = 5;

chrome.runtime.onInstalled.addListener(() => {
  logOp("background", "installed", "extension service worker started");
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
  chrome.alarms.create(DAILY_ALARM_NAME, { periodInMinutes: DAILY_INTERVAL_MINUTES });
  chrome.alarms.create(BATTERY_POLL_ALARM_NAME, { periodInMinutes: BATTERY_POLL_INTERVAL_MINUTES });
  chrome.alarms.create(DRIVE_SYNC_ALARM_NAME, { periodInMinutes: DRIVE_SYNC_INTERVAL_MINUTES });
  void runDailyMaintenance(); // 起動直後にも未実行なら補完する(前日分の取りこぼし防止)。
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
  chrome.alarms.create(DAILY_ALARM_NAME, { periodInMinutes: DAILY_INTERVAL_MINUTES });
  chrome.alarms.create(BATTERY_POLL_ALARM_NAME, { periodInMinutes: BATTERY_POLL_INTERVAL_MINUTES });
  chrome.alarms.create(DRIVE_SYNC_ALARM_NAME, { periodInMinutes: DRIVE_SYNC_INTERVAL_MINUTES });
  void runDailyMaintenance();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) void pollNextEvent();
  if (alarm.name === PRE_EVENT_ALARM_NAME) void fireAlarm();
  if (alarm.name === DAILY_ALARM_NAME) void runDailyMaintenance();
  if (alarm.name === BATTERY_POLL_ALARM_NAME) void pollBatteryStatus();
  if (alarm.name === DRIVE_SYNC_ALARM_NAME) void runDriveNoteSync();
});

async function runDriveNoteSync(): Promise<void> {
  const token = await getAuthToken(false);
  if (!token) return;
  try {
    const local = await loadLocalData();
    const result = await syncDriveNotesSafely(
      local.notes,
      local.noteTombstones ?? {},
      token,
      clockNow(),
    );
    if (!result) return;
    await saveLocalData({
      ...local,
      notes: result.notes,
      noteTombstones: result.tombstones,
    });
  } catch (err) {
    logOp("background", "drive-note-sync-error", "", { error: err });
  }
}

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  if (notificationId === NOTIFICATION_ID) void stopAlarm();
  if (notificationId === BATTERY_NOTIFICATION_ID) void stopBatteryAlarm();
});

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type === "stop-pre-event-alarm") void stopAlarm();
  if (message?.type === "stop-battery-alarm") void stopBatteryAlarm();
});

async function pollNextEvent(): Promise<void> {
  const token = await getAuthToken(false);
  if (!token) return;
  try {
    const event = await fetchNextEvent(token);
    const local = await loadLocalData();
    await saveLocalData({
      ...local,
      nextEventCache: event
        ? { title: event.title, startsAt: event.startsAt, fetchedAt: clockNow() }
        : undefined,
    });
    await scheduleOrClearPreEventAlarm(event);
  } catch (err) {
    logOp("background", "poll-next-event-error", "", { error: err });
  }
}

/** epoch ms を "YYYY/M/D"(月・日はゼロ埋めしない——統一構造の日付書式)にする。 */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 前日の同時刻の epoch ms(日付フォルダは「前日」を対象にする——ユーザー指示)。 */
function previousDayMs(now: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return d.getTime();
}

/** 日次メンテ: ①Driveの前日分日付フォルダへ現在のノートを格納 ②NASのSQLite索引を再生成する。
 * 同じ日には二重実行しない(lastDailyMaintenanceDayで判定)。Drive未接続/NAS未設定はそれぞれ
 * 静かにスキップし、片方が失敗してももう片方は実行する(独立)。ユーザー指示の
 * 「Drive日付フォルダ=一日一回・0:30くらいに前日分」「SQLite更新=一日一回」を満たす。 */
async function runDailyMaintenance(): Promise<void> {
  const now = clockNow();
  const today = dayKey(now);
  const local = await loadLocalData();
  if (local.lastDailyMaintenanceDay === today) return; // 今日は実行済み

  // ①Drive: 前日フォルダへ現在の非空ノートを格納(未接続ならトークンnullで静かにスキップ)。
  try {
    const token = await getAuthToken(false);
    if (token) {
      const { dated } = await copyNotesToDriveDateFolder(local.notes, previousDayMs(now), token);
      logOp(
        "background",
        "daily-drive-archive",
        `dated=${dated} day=${dayKey(previousDayMs(now))}`,
      );
    }
  } catch (err) {
    logOp("background", "daily-drive-archive-error", "", { error: err });
  }

  // ②NAS: SQLite索引(index.db)を.mdから再生成(NAS未設定なら静かにスキップ)。
  try {
    const nasPath = await getNasFolderPath();
    if (nasPath) {
      const res = await rebuildNasIndex(nasPath);
      logOp("background", "daily-sqlite-rebuild", res ? `notes=${res.notes}` : "failed");
    }
  } catch (err) {
    logOp("background", "daily-sqlite-rebuild-error", "", { error: err });
  }

  await saveLocalData({ ...local, lastDailyMaintenanceDay: today });
  logOp("background", "daily-maintenance", `day=${today}`);
}

/** 予定が変わる/無くなるたびに予定前アラームを再スケジュール(既存は上書き/クリア)する。
 * 同じ予定(startsAtが同一)に対しては1回しかスケジュールしない——15分毎のポーリングの
 * たびに呼ばれるため、対策が無いと「予定開始まで10分未満(alarmTimeが既に過去)」の間は
 * resolveAlarmTimeがnowへ丸めた時刻を返し続け、ポーリングのたびにアラームが再作成されて
 * 何度も鳴っていた(ユーザー指摘「なるのは一回だけでいい。その後何回かなったけど、あれ全部
 * いらない」2026-07-16 是正)。 */
async function scheduleOrClearPreEventAlarm(event: { startsAt: number } | null): Promise<void> {
  const local = await loadLocalData();
  if (!event) {
    await chrome.alarms.clear(PRE_EVENT_ALARM_NAME);
    if (local.preEventAlarmFor !== undefined) {
      await saveLocalData({ ...local, preEventAlarmFor: undefined });
    }
    logOp("background", "pre-event-alarm-clear", "no next event");
    return;
  }
  if (local.preEventAlarmFor === event.startsAt) {
    return; // この予定は既にスケジュール/発火済み——再作成しない
  }
  const when = resolveAlarmTime(event.startsAt, clockNow());
  if (when === null) {
    await chrome.alarms.clear(PRE_EVENT_ALARM_NAME);
    if (local.preEventAlarmFor !== undefined) {
      await saveLocalData({ ...local, preEventAlarmFor: undefined });
    }
    logOp("background", "pre-event-alarm-clear", `startsAt=${event.startsAt} (既に開始済み)`);
    return;
  }
  chrome.alarms.create(PRE_EVENT_ALARM_NAME, { when });
  await saveLocalData({ ...local, preEventAlarmFor: event.startsAt });
  logOp("background", "pre-event-alarm-schedule", `when=${when}`);
}

// オフスクリーンのループ音声ドキュメントは予定前アラーム・バッテリー低下警告の共用リソース
// (chrome.offscreenは拡張全体で1つしか持てない)。二重createDocument()は例外になるため
// hasDocument()で確認してから作り、閉じる時はもう一方のアラームが鳴っていないか確認してから
// 閉じる(片方の「停止」でもう片方の音まで止まらないようにする)。

async function fireAlarm(): Promise<void> {
  const local = await loadLocalData();
  await saveLocalData({ ...local, alarmActive: true });
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: "予定前アラームのループ音再生(SPEC.md §4.11)",
    });
  }
  chrome.notifications.create(NOTIFICATION_ID, {
    type: "basic",
    iconUrl: "icon128.png",
    title: "まもなく予定です",
    message: "10分後に予定が始まります",
    buttons: [{ title: "停止" }],
    requireInteraction: true,
  });
  logOp("background", "fire-alarm", "pre-event alarm started");
}

async function stopAlarm(): Promise<void> {
  const local = await loadLocalData();
  if (!local.batteryAlarmActive && (await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.closeDocument();
  }
  chrome.notifications.clear(NOTIFICATION_ID);
  await saveLocalData({ ...local, alarmActive: false });
  logOp("background", "stop-alarm", "pre-event alarm stopped");
}

/** GAS Web App(gas/README.md参照)へバッテリー残量を問い合わせる。doGetはconsume-on-read
 * (読んだら即座にGAS側で削除)なので、非nullが返れば常に「スマホが新たに閾値を下回った
 * 未処理イベント」を意味し、そのまま警告してよい(再発火の抑制はGAS側の削除が兼ねるため
 * chrome側で発火済み閾値を覚える必要がない——ユーザー指摘で2026-07-18に変更)。
 * 未設定/未接続/既に消費済みは静かにスキップする。 */
async function pollBatteryStatus(): Promise<void> {
  const config = await getBatteryWebhookConfig();
  if (!config) return;
  const status = await fetchBatteryStatus(config.url, config.token);
  if (!status) return;
  await fireBatteryAlarm(status.level);
}

async function fireBatteryAlarm(level: number): Promise<void> {
  const local = await loadLocalData();
  await saveLocalData({ ...local, batteryAlarmActive: true });
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: "スマホのバッテリー低下警告のループ音再生",
    });
  }
  chrome.notifications.create(BATTERY_NOTIFICATION_ID, {
    type: "basic",
    iconUrl: "icon128.png",
    title: "スマホのバッテリーが少なくなっています",
    message: `残り${level}%です`,
    buttons: [{ title: "停止" }],
    requireInteraction: true,
  });
  logOp("background", "fire-battery-alarm", `level=${level}`);
}

async function stopBatteryAlarm(): Promise<void> {
  const local = await loadLocalData();
  if (!local.alarmActive && (await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.closeDocument();
  }
  chrome.notifications.clear(BATTERY_NOTIFICATION_ID);
  await saveLocalData({ ...local, batteryAlarmActive: false });
  logOp("background", "stop-battery-alarm", "battery alarm stopped");
}
