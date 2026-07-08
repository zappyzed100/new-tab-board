// exportImport.test.ts — exportImport.ts(JSON書き出し/取り込み)の単体テスト
import { describe, expect, it } from "vitest";
import { buildExportPayload, parseImportPayload, serializeExport } from "./exportImport";
import type { Note, Settings } from "../types";

const settings: Settings = { openIn: "same", theme: "auto", searchEngine: "https://x/?q=%s" };
const notes: Note[] = [{ id: "n1", title: "メモ", content: "本文", pinned: false, order: 0 }];
const sync = { bookmarks: [], appLaunches: [], settings };

describe("buildExportPayload / serializeExport / parseImportPayload", () => {
  it("組み立てて直列化し、パースすると同じ内容に戻る(往復)", () => {
    const payload = buildExportPayload(sync, notes, 1234);
    const json = serializeExport(payload);
    const parsed = parseImportPayload(json);
    expect(parsed).toEqual(payload);
  });

  it("壊れたJSONはnullを返す", () => {
    expect(parseImportPayload("{not valid json")).toBeNull();
  });

  it("必要なフィールドが欠けている形はnullを返す", () => {
    expect(parseImportPayload(JSON.stringify({ version: 1 }))).toBeNull();
  });
});
