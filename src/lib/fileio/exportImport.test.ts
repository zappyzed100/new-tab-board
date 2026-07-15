// exportImport.test.ts — exportImport.ts(JSON書き出し/取り込み)の単体テスト
import { describe, expect, it } from "vitest";
import { buildExportPayload, parseImportPayload, serializeExport } from "./exportImport";
import type { Note, Settings, SpecialItem, Todo } from "../../types";

const settings: Settings = { openIn: "same", theme: "auto", searchEngine: "https://x/?q=%s" };
const notes: Note[] = [{ id: "n1", title: "メモ", content: "本文", pinned: false, order: 0 }];
const todos: Todo[] = [{ id: "t1", text: "買い物", done: false, order: 0 }];
const specialItems: SpecialItem[] = [
  { id: "s1", title: "凍結メモ", content: "本文", frozenAt: 1000 },
];
const specialFolders = ["仕事"];
const sync = { bookmarks: [], appLaunches: [], settings };
const extra = { notes, todos, specialItems, specialFolders };

describe("buildExportPayload / serializeExport / parseImportPayload", () => {
  it("組み立てて直列化し、パースすると同じ内容に戻る(往復。todos/special/specialFoldersも含む)", () => {
    const payload = buildExportPayload(sync, extra, 1234);
    const json = serializeExport(payload);
    const parsed = parseImportPayload(json);
    expect(parsed).toEqual(payload);
    expect(parsed?.todos).toEqual(todos);
    expect(parsed?.specialItems).toEqual(specialItems);
    expect(parsed?.specialFolders).toEqual(specialFolders);
  });

  it("壊れたJSONはnullを返す", () => {
    expect(parseImportPayload("{not valid json")).toBeNull();
  });

  it("必要なフィールドが欠けている形はnullを返す", () => {
    expect(parseImportPayload(JSON.stringify({ version: 1 }))).toBeNull();
  });

  it("todos/specialItems/specialFoldersを追加する前の旧バックアップも読める(無ければ空配列で補う)", () => {
    const oldPayload = {
      version: 1,
      exportedAt: 1234,
      bookmarks: [],
      appLaunches: [],
      settings,
      notes,
      // todos/specialItems/specialFoldersが無い旧形式
    };
    const parsed = parseImportPayload(JSON.stringify(oldPayload));
    expect(parsed).not.toBeNull();
    expect(parsed?.todos).toEqual([]);
    expect(parsed?.specialItems).toEqual([]);
    expect(parsed?.specialFolders).toEqual([]);
  });
});
