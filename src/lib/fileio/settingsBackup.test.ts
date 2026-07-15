// settingsBackup.test.ts — settingsBackup.ts(notes抜きの全体設定バックアップ)の単体テスト
import { describe, expect, it } from "vitest";
import {
  buildSettingsBackupPayload,
  parseSettingsBackupPayload,
  serializeSettingsBackup,
} from "./settingsBackup";
import type { Settings, SpecialItem, Todo } from "../../types";

const settings: Settings = { openIn: "same", theme: "dark", searchEngine: "https://x/?q=%s" };
const todos: Todo[] = [{ id: "t1", text: "買い物", done: false, order: 0 }];
const specialItems: SpecialItem[] = [
  { id: "s1", title: "凍結メモ", content: "本文", frozenAt: 1000 },
];
const specialFolders = ["仕事"];
const sync = { bookmarks: [], appLaunches: [], settings };
const extra = { todos, specialItems, specialFolders };

describe("buildSettingsBackupPayload / serializeSettingsBackup / parseSettingsBackupPayload", () => {
  it("組み立てて直列化し、パースすると同じ内容に戻る(往復)", () => {
    const payload = buildSettingsBackupPayload(sync, extra, 1234);
    const json = serializeSettingsBackup(payload);
    const parsed = parseSettingsBackupPayload(json);
    expect(parsed).toEqual(payload);
  });

  it("notesを含まない(NAS/Driveのactive/日付フォルダで別途同期されているため)", () => {
    const payload = buildSettingsBackupPayload(sync, extra, 1234);
    expect(payload).not.toHaveProperty("notes");
  });

  it("壊れたJSONはnullを返す", () => {
    expect(parseSettingsBackupPayload("{not valid json")).toBeNull();
  });

  it("必要なフィールドが欠けている形はnullを返す", () => {
    expect(parseSettingsBackupPayload(JSON.stringify({ version: 1 }))).toBeNull();
  });
});
