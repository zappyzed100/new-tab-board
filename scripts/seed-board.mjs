// seed-board.mjs — 固定フィクスチャのboardをchrome.storage.localへ書き込む(GUARDRAILS.md §12.2 seed動詞)
//
// service worker(background)のコンテキストで直接 chrome.storage.local.set を評価する。
// 新しいタブページ(App.tsx)を開いてから書き込むと、Reactマウント時の自動保存
// (loadBoard→null→createEmptyBoard→saveBoard)と競合し、フィクスチャが上書きされて
// 消えてしまうため、UIページを一切開かないこの方式にした(実測で発見した競合)。
import { launchWithExtension } from "./playwright-extension.mjs";

const fixtureBoard = {
  columns: [
    {
      id: "seed-todo",
      title: "Todo",
      cards: [{ id: "seed-card-1", text: "サンプルカード", createdAt: 0 }],
    },
    { id: "seed-doing", title: "Doing", cards: [] },
    { id: "seed-done", title: "Done", cards: [] },
  ],
};

const { context, worker } = await launchWithExtension();
await worker.evaluate((board) => chrome.storage.local.set({ board }), fixtureBoard);
console.log("[seed-board] board fixture written to chrome.storage.local");
await context.close();
