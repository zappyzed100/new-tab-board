// storage.ts — chrome.storage.local ⇔ localStorage フォールバックの唯一の入出口(GUARDRAILS.md §8.2)
import type { Board } from "./board";
import { logOp } from "./log";

const STORAGE_KEY = "board";

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

export async function loadBoard(): Promise<Board | null> {
  const started = Date.now();
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    logOp("storage", "load", "chrome.storage.local", { elapsedMs: Date.now() - started });
    return (result[STORAGE_KEY] as Board | undefined) ?? null;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  logOp("storage", "load", "localStorage(fallback)", { elapsedMs: Date.now() - started });
  return raw ? (JSON.parse(raw) as Board) : null;
}

export async function saveBoard(board: Board): Promise<void> {
  const started = Date.now();
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: board });
    logOp("storage", "save", "chrome.storage.local", { elapsedMs: Date.now() - started });
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  logOp("storage", "save", "localStorage(fallback)", { elapsedMs: Date.now() - started });
}
