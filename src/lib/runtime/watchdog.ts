// watchdog.ts — 「ブラウザが固まる」の証拠を残す常駐ウォッチドッグ(ユーザー要望・2026-07-26)
//
// 固まった瞬間はコンソールを見に行けないし、タブが落ちればconsoleのログごと消える。だから
// **止まったこと自体をあとから読める形で残す**: 1秒ごとの心拍が遅れた量(=主スレッドが
// 止まっていた時間)・長時間タスク・エラー・その時点の資源量を chrome.storage.local の
// リングバッファへ追記する。書き込みは固まっている最中には走れないので、**復帰した直後に**
// 記録する設計にしてある(心拍の遅れは復帰時に初めて分かる)。
//
// 秘匿(AGENTS.md §7): ノート本文・タイトル・タグ・URLは一切入れない。入れるのは件数・
// バイト数・ミリ秒などの数値と、どの機能が有効かの真偽値だけ。
import { loadDiagnosticsLog, saveDiagnosticsLog } from "../storage/storage";
import { logOp, setLogSink } from "./log";
import { now as clockNow } from "./clock";

/** 1件の診断イベント。JSONでそのまま保存する(人が読む整形は formatDiagnosticsLog)。 */
export type DiagEvent = {
  /** 記録時刻(epoch ms)。 */
  at: number;
  /** このタブの短縮id。複数タブのどれが固まったかを見分ける。 */
  tab: string;
  kind: "start" | "stall" | "longtask" | "sample" | "error" | "slowop";
  detail: string;
  metrics?: Record<string, number | string | boolean>;
};

/** 心拍の間隔。これより大きく遅れたら「主スレッドが止まっていた」と見なす。 */
const TICK_MS = 1_000;
/** 遅れがこれを超えたら stall として記録する(GCや軽い詰まりでは鳴らさない)。 */
const STALL_THRESHOLD_MS = 2_000;
/** 個別に記録する長時間タスクの閾値。これ未満は件数と合計だけ sample に混ぜる。 */
const LONGTASK_REPORT_MS = 500;
/** 定期サンプリングの間隔。 */
const SAMPLE_MS = 60_000;
/** 保存する最大件数(古いものから捨てる)。1件あたり概ね150〜250バイト。 */
export const DIAG_LOG_MAX = 400;
/** 書き込みの最小間隔。固まりの証拠より先に自分が負荷になっては本末転倒なので絞る。 */
const FLUSH_INTERVAL_MS = 5_000;

let running = false;

/** 数値metricsを持つイベントを組み立てる(tab idを毎回埋める)。 */
function makeEvent(
  tab: string,
  kind: DiagEvent["kind"],
  detail: string,
  metrics?: DiagEvent["metrics"],
): DiagEvent {
  return { at: clockNow(), tab, kind, detail, ...(metrics ? { metrics } : {}) };
}

/** ブラウザ側から取れる汎用の資源量。アプリ固有の数値は sample コールバックが足す。 */
function browserMetrics(): Record<string, number> {
  const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    domNodes: document.getElementsByTagName("*").length,
    editors: document.querySelectorAll(".cm-editor").length,
    mountedPanes: document.querySelectorAll('.note-cell[data-viewport-state="mounted"]').length,
    ...(heap ? { heapMB: Math.round(heap.usedJSHeapSize / 1024 / 1024) } : {}),
  };
}

/**
 * ウォッチドッグを開始する。戻り値を呼ぶと停止する(多重起動はしない)。
 * `sample` はアプリ固有の数値(ノート件数・有効な機能など)を返す任意のコールバック。
 */
export function startWatchdog(
  sample?: () => Record<string, number | string | boolean>,
): () => void {
  if (running || typeof window === "undefined") return () => {};
  running = true;
  const tab = crypto.randomUUID().slice(0, 8);
  const pending: DiagEvent[] = [];
  let lastFlushAt = 0;
  let flushing: Promise<void> = Promise.resolve();
  // 閾値未満の長時間タスクは、件数と合計だけ次のsampleへ集約する(1件ずつ残すと溢れる)。
  let smallLongTasks = 0;
  let smallLongTaskMs = 0;
  // 診断ログ自身の書き込み中か(logOpからの転送を止める再入ガード)。
  let writing = false;

  function record(event: DiagEvent, urgent = false) {
    pending.push(event);
    // 復帰直後の1件は取りこぼしたくない(タブが落ちればメモリ上のバッファごと消える)。
    if (urgent || clockNow() - lastFlushAt >= FLUSH_INTERVAL_MS) void flush();
  }

  function flush(): Promise<void> {
    if (pending.length === 0) return flushing;
    const batch = pending.splice(0, pending.length);
    lastFlushAt = clockNow();
    // 直列化する: 複数タブ・複数呼び出しの read-modify-write が交差すると取りこぼす。
    flushing = flushing.then(async () => {
      // 書き込み中はlogOpからの転送を止める。保存自体が遅いとそれが slowop として記録され、
      // またflushが走る……という自己増殖(ログがログを呼ぶ)を断つ。
      writing = true;
      try {
        const existing = await loadDiagnosticsLog<DiagEvent>();
        await saveDiagnosticsLog([...existing, ...batch].slice(-DIAG_LOG_MAX));
      } catch (error) {
        // 診断の保存に失敗しても本体の動作は止めない(コンソールには残す)。
        logOp("watchdog", "flush-error", `pending=${batch.length}`, { error });
      } finally {
        writing = false;
      }
    });
    return flushing;
  }

  // 単一出口(logOp)を通る**遅い操作と失敗**を診断ログへも流す。呼び出し側を1つも変えずに
  // 「固まる直前に何が遅かったか」が残る——elapsedMs は既にI/O各所が渡している。
  setLogSink((entry) => {
    if (writing || entry.tag === "watchdog") return; // 自己増殖の防止
    record(
      makeEvent(
        tab,
        entry.error !== undefined ? "error" : "slowop",
        `${entry.tag}/${entry.op}: ${entry.detail.slice(0, 120)}` +
          (entry.error !== undefined ? ` error=${String(entry.error).slice(0, 200)}` : ""),
        entry.elapsedMs !== undefined ? { elapsedMs: Math.round(entry.elapsedMs) } : undefined,
      ),
      entry.error !== undefined,
    );
  });

  const startMetrics = { ...browserMetrics(), ...(sample?.() ?? {}) };
  record(makeEvent(tab, "start", "ウォッチドッグ開始", startMetrics), true);
  logOp("watchdog", "start", `tab=${tab}`);

  // ① 心拍: 主スレッドが止まっていた時間を、復帰した瞬間に測って残す。
  //    performance.now() は単調増加(時刻変更やスリープ復帰の影響を受けない)。
  let lastTick = performance.now();
  let lastSampleAt = performance.now();
  const ticker = window.setInterval(() => {
    const nowMs = performance.now();
    const lag = nowMs - lastTick - TICK_MS;
    lastTick = nowMs;
    if (lag >= STALL_THRESHOLD_MS) {
      record(
        makeEvent(tab, "stall", `主スレッドが${Math.round(lag)}ms止まっていた`, {
          stallMs: Math.round(lag),
          hidden: document.hidden,
          ...browserMetrics(),
          ...(sample?.() ?? {}),
        }),
        true,
      );
      logOp("watchdog", "stall", `tab=${tab} lag=${Math.round(lag)}ms`);
    }
    if (nowMs - lastSampleAt >= SAMPLE_MS) {
      lastSampleAt = nowMs;
      record(
        makeEvent(tab, "sample", "定期サンプル", {
          smallLongTasks,
          smallLongTaskMs: Math.round(smallLongTaskMs),
          hidden: document.hidden,
          ...browserMetrics(),
          ...(sample?.() ?? {}),
        }),
      );
      smallLongTasks = 0;
      smallLongTaskMs = 0;
    }
  }, TICK_MS);

  // ② 長時間タスク: 何が主スレッドを占有したかの手がかり(attributionは粗いが無いよりよい)。
  let observer: PerformanceObserver | null = null;
  if (typeof PerformanceObserver !== "undefined") {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= LONGTASK_REPORT_MS) {
            record(
              makeEvent(tab, "longtask", `${Math.round(entry.duration)}msの長時間タスク`, {
                durationMs: Math.round(entry.duration),
                name: entry.name,
              }),
            );
          } else {
            smallLongTasks += 1;
            smallLongTaskMs += entry.duration;
          }
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch (error) {
      // longtaskに対応しない環境(古いブラウザ/テスト)では心拍だけで運用する。
      logOp("watchdog", "longtask-unavailable", "PerformanceObserver(longtask)を使えない", {
        error,
      });
      observer = null;
    }
  }

  // ③ 例外: 固まる直前に何か投げていたら、それが手がかりになる。
  const onError = (event: ErrorEvent) => {
    record(makeEvent(tab, "error", `未捕捉の例外: ${String(event.message).slice(0, 200)}`), true);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    record(makeEvent(tab, "error", `未処理のPromise: ${String(event.reason).slice(0, 200)}`), true);
  };
  // ④ 離脱・非表示のタイミングで確実に書き出す(タブを閉じられても直前までが残るように)。
  const onHide = () => void flush();
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onHide);

  return () => {
    running = false;
    setLogSink(null);
    window.clearInterval(ticker);
    observer?.disconnect();
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onHide);
    void flush();
  };
}

/** 保存済みの診断ログ(古い順)。 */
export async function readDiagnostics(): Promise<DiagEvent[]> {
  return loadDiagnosticsLog();
}

export async function clearDiagnostics(): Promise<void> {
  await saveDiagnosticsLog([]);
}

/** 人が読む(そのまま貼って渡せる)形へ整形する。新しいものが下。 */
export function formatDiagnosticsLog(events: DiagEvent[]): string {
  if (events.length === 0) return "診断ログはまだありません";
  const lines = events.map((e) => {
    const time = new Date(e.at).toISOString().replace("T", " ").slice(0, 19);
    const metrics = e.metrics
      ? ` ${Object.entries(e.metrics)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`
      : "";
    return `${time} [${e.tab}] ${e.kind}: ${e.detail}${metrics}`;
  });
  return lines.join("\n");
}

/** 一覧の要約(画面に出す1行)。「何回・最大何秒止まったか」を先に見せる。 */
export function summarizeDiagnostics(events: DiagEvent[]): string {
  const stalls = events.filter((e) => e.kind === "stall");
  const worst = stalls.reduce((max, e) => Math.max(max, Number(e.metrics?.stallMs ?? 0)), 0);
  const errors = events.filter((e) => e.kind === "error").length;
  const tabs = new Set(events.map((e) => e.tab)).size;
  return (
    `診断ログ${events.length}件(タブ${tabs}個分): ` +
    `停止${stalls.length}回・最長${(worst / 1000).toFixed(1)}秒・例外${errors}件`
  );
}
