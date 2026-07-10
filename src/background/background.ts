// background.ts — サービスワーカー(インストールログ + Calendar次予定の定期ポーリング +
// 予定前アラーム。SPEC.md §4.9・§4.11)
import { logOp } from "../lib/runtime/log";
import { getAuthToken } from "../lib/drive/googleAuth";
import { fetchNextEvent } from "../lib/nextEvent/calendar";
import { resolveAlarmTime } from "../lib/nextEvent/preEventAlarm";
import { loadLocalData, saveLocalData } from "../lib/storage/storage";
import { now as clockNow } from "../lib/runtime/clock";

const POLL_ALARM_NAME = "next-event-poll";
const POLL_INTERVAL_MINUTES = 5;
const PRE_EVENT_ALARM_NAME = "pre-event-alarm";
const NOTIFICATION_ID = "pre-event-notification";

chrome.runtime.onInstalled.addListener(() => {
  logOp("background", "installed", "extension service worker started");
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) void pollNextEvent();
  if (alarm.name === PRE_EVENT_ALARM_NAME) void fireAlarm();
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
