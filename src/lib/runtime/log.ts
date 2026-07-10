// log.ts — ログの唯一の出口(GUARDRAILS.md §8.2)。他ファイルでのconsole直呼びはhard log-direct-callが止める
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
}
