// background.ts — サービスワーカー(インストールログ + Calendar次予定の定期ポーリング。SPEC.md §4.9)
import { logOp } from "../lib/log";
import { getAuthToken } from "../lib/googleAuth";
import { fetchNextEvent } from "../lib/calendar";
import { loadLocalData, saveLocalData } from "../lib/storage";
import { now as clockNow } from "../lib/clock";

const POLL_ALARM_NAME = "next-event-poll";
const POLL_INTERVAL_MINUTES = 5;

chrome.runtime.onInstalled.addListener(() => {
  logOp("background", "installed", "extension service worker started");
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) {
    void pollNextEvent();
  }
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
  } catch (err) {
    logOp("background", "poll-next-event-error", "", { error: err });
  }
}
