// background.ts — サービスワーカー(インストールログ + Calendar次予定の定期ポーリング +
// 予定前アラーム。SPEC.md §4.9・§4.11)
import { logOp } from "../lib/runtime/log";
import { getAuthToken } from "../lib/drive/googleAuth";
import { fetchNextEvent } from "../lib/nextEvent/calendar";
import { resolveAlarmTime } from "../lib/nextEvent/preEventAlarm";
import { loadLocalData, saveLocalData } from "../lib/storage/storage";
import { getNasFolderPath } from "../lib/storage/db";
import { rebuildNasIndex } from "../lib/externalIO/nasNativeHost";
import { copyNotesToDriveDateFolder } from "../lib/drive/driveActiveMirror";
import { now as clockNow } from "../lib/runtime/clock";

const POLL_ALARM_NAME = "next-event-poll";
const POLL_INTERVAL_MINUTES = 5;
const PRE_EVENT_ALARM_NAME = "pre-event-alarm";
const NOTIFICATION_ID = "pre-event-notification";
// 日次メンテ(Drive日付フォルダへ前日分を格納 + NASのSQLite索引を再生成)。厳密な0:30起動は
// chrome.alarmsでは保証できないため、1時間おきに起こして「日付が変わっていれば一度だけ実行」
// する方式にする(ユーザー指示の「一日一回・0:30くらい・起動時に未実行なら補完」を満たす)。
const DAILY_ALARM_NAME = "daily-maintenance";
const DAILY_INTERVAL_MINUTES = 60;

chrome.runtime.onInstalled.addListener(() => {
  logOp("background", "installed", "extension service worker started");
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
  chrome.alarms.create(DAILY_ALARM_NAME, { periodInMinutes: DAILY_INTERVAL_MINUTES });
  void runDailyMaintenance(); // 起動直後にも未実行なら補完する(前日分の取りこぼし防止)。
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
  chrome.alarms.create(DAILY_ALARM_NAME, { periodInMinutes: DAILY_INTERVAL_MINUTES });
  void runDailyMaintenance();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) void pollNextEvent();
  if (alarm.name === PRE_EVENT_ALARM_NAME) void fireAlarm();
  if (alarm.name === DAILY_ALARM_NAME) void runDailyMaintenance();
});

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  if (notificationId === NOTIFICATION_ID) void stopAlarm();
});

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type === "stop-pre-event-alarm") void stopAlarm();
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

/** 予定が変わる/無くなるたびに予定前アラームを再スケジュール(既存は上書き/クリア)する。 */
async function scheduleOrClearPreEventAlarm(event: { startsAt: number } | null): Promise<void> {
  if (!event) {
    await chrome.alarms.clear(PRE_EVENT_ALARM_NAME);
    logOp("background", "pre-event-alarm-clear", "no next event");
    return;
  }
  const when = resolveAlarmTime(event.startsAt, clockNow());
  if (when === null) {
    await chrome.alarms.clear(PRE_EVENT_ALARM_NAME);
    logOp("background", "pre-event-alarm-clear", `startsAt=${event.startsAt} (既に開始済み)`);
    return;
  }
  chrome.alarms.create(PRE_EVENT_ALARM_NAME, { when });
  logOp("background", "pre-event-alarm-schedule", `when=${when}`);
}

async function fireAlarm(): Promise<void> {
  const local = await loadLocalData();
  await saveLocalData({ ...local, alarmActive: true });
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "予定前アラームのループ音再生(SPEC.md §4.11)",
  });
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
  if (await chrome.offscreen.hasDocument()) {
    await chrome.offscreen.closeDocument();
  }
  chrome.notifications.clear(NOTIFICATION_ID);
  const local = await loadLocalData();
  await saveLocalData({ ...local, alarmActive: false });
  logOp("background", "stop-alarm", "pre-event alarm stopped");
}
