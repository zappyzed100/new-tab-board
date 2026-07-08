// reset-e2e-profile.mjs — E2E persistent contextのプロファイル削除(GUARDRAILS.md §12.2 reset動詞)
import { existsSync, rmSync } from "node:fs";
import { userDataDir } from "./playwright-extension.mjs";

if (existsSync(userDataDir)) {
  rmSync(userDataDir, { recursive: true, force: true });
  console.log("[reset-e2e-profile] removed .pw-user-data");
} else {
  console.log("[reset-e2e-profile] already clean (no .pw-user-data)");
}
