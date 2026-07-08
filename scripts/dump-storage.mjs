// dump-storage.mjs — chrome.storage.localの読み取りダンプ(GUARDRAILS.md §12.3 観察レール・db動詞)
//
// UIページを開かずservice workerコンテキストで直接読む(seed-board.mjsと同じ理由——
// 新しいタブページを開くとApp.tsxのマウントがstorageへ書き込み、観察対象を変えてしまう)。
import { launchWithExtension } from "./playwright-extension.mjs";

const { context, worker } = await launchWithExtension();
const data = await worker.evaluate(() => chrome.storage.local.get(null));
console.log(JSON.stringify(data, null, 2));
await context.close();
