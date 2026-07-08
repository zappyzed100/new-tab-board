// set-time-freeze.mjs — .time-freeze.jsonの書換/削除(GUARDRAILS.md §12.2 time動詞)
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./playwright-extension.mjs";

const file = join(repoRoot, ".time-freeze.json");
const arg = process.argv[2];

if (!arg || arg === "clear") {
  if (existsSync(file)) rmSync(file);
  console.log("[set-time-freeze] cleared");
  process.exit(0);
}

const epochMs = Date.parse(arg);
if (Number.isNaN(epochMs)) {
  console.error(`[set-time-freeze] invalid ISO8601: ${arg}`);
  process.exit(1);
}
writeFileSync(file, JSON.stringify({ epochMs }), "utf-8");
console.log(`[set-time-freeze] frozen at ${arg} (${epochMs}ms)`);
