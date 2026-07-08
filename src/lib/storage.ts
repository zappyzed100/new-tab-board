// storage.ts — chrome.storage.local ⇔ localStorage フォールバックの唯一の入出口(GUARDRAILS.md §8.2)
import type { Board } from "./board";

const STORAGE_KEY = "board";

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

export async function loadBoard(): Promise<Board | null> {
  if (hasChromeStorage()) {
    // NO-LOG: Step 7 でログ単一出口(logOp)実装後に置き換える
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as Board | undefined) ?? null;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Board) : null;
}

export async function saveBoard(board: Board): Promise<void> {
  if (hasChromeStorage()) {
    // NO-LOG: Step 7 でログ単一出口(logOp)実装後に置き換える
    await chrome.storage.local.set({ [STORAGE_KEY]: board });
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
}
