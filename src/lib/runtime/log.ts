// log.ts — ログの唯一の出口(GUARDRAILS.md §8.2)。他ファイルでのconsole直呼びはhard log-direct-callが止める

/** 遅いと見なす閾値(ms)。これ以上かかった操作は診断ログにも残す(固まる直前の手がかり)。 */
export const SLOW_OP_MS = 500;

/** 診断ログへの転送口。watchdog.ts が起動時に差し込む(log.ts は watchdog を import しない
 * ——循環参照になるため、依存の向きを「watchdog → log」の一方向に保つ)。 */
export type LogSink = (entry: {
  tag: string;
  op: string;
  detail: string;
  elapsedMs?: number;
  error?: unknown;
}) => void;

let sink: LogSink | null = null;

/** 診断ログへの転送を有効化/解除する(nullで解除)。 */
export function setLogSink(next: LogSink | null): void {
  sink = next;
}

export function logOp(
  tag: string,
  op: string,
  detail: string,
  opts: { error?: unknown; elapsedMs?: number } = {},
): void {
  const { error, elapsedMs } = opts;
  const opLabel = error !== undefined ? `ERROR ${op}` : op;
  const elapsedSuffix = elapsedMs !== undefined ? ` (+${elapsedMs}ms)` : "";
  const errorSuffix = error !== undefined ? ` error=${String(error)}` : "";
  console.log(`[${tag}] ${opLabel}: ${detail}${errorSuffix}${elapsedSuffix}`);
  // コンソールはタブが落ちれば消える。**遅い操作と失敗だけ**を永続側へも流す
  // (全部流すと診断ログ自身が負荷になり、探したい異常が埋もれる)。
  if (sink && (error !== undefined || (elapsedMs ?? 0) >= SLOW_OP_MS)) {
    sink({ tag, op, detail, elapsedMs, error });
  }
}
