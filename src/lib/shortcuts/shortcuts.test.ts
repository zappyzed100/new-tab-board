// shortcuts.test.ts — shortcuts.ts(ショートカット単一レジストリ)の単体テスト
import { describe, expect, it } from "vitest";
import {
  buildBookmarkJumpShortcuts,
  buildNoteJumpShortcuts,
  comboLabel,
  matchesCombo,
} from "./shortcuts";

describe("matchesCombo", () => {
  it("Ctrl+Kに一致する", () => {
    expect(
      matchesCombo(
        { key: "k", ctrlOrMeta: true },
        { key: "k", ctrlKey: true, metaKey: false, shiftKey: false },
      ),
    ).toBe(true);
  });

  it("Macの Meta+K にも一致する(ctrlOrMetaはどちらか一方でよい)", () => {
    expect(
      matchesCombo(
        { key: "k", ctrlOrMeta: true },
        { key: "k", ctrlKey: false, metaKey: true, shiftKey: false },
      ),
    ).toBe(true);
  });

  it("修飾キー無し指定の場合、Ctrl/Metaが押されていると一致しない(数字ジャンプ用)", () => {
    expect(
      matchesCombo({ key: "1" }, { key: "1", ctrlKey: true, metaKey: false, shiftKey: false }),
    ).toBe(false);
  });

  it("キーが異なれば一致しない", () => {
    expect(
      matchesCombo(
        { key: "k", ctrlOrMeta: true },
        { key: "j", ctrlKey: true, metaKey: false, shiftKey: false },
      ),
    ).toBe(false);
  });

  it("大文字小文字を無視する(?のような記号キーも含む)", () => {
    expect(
      matchesCombo({ key: "?" }, { key: "?", ctrlKey: false, metaKey: false, shiftKey: true }),
    ).toBe(true);
  });
});

describe("buildNoteJumpShortcuts", () => {
  it("ノート数分のCmd/Ctrl+数字ショートカットを生成する", () => {
    const defs = buildNoteJumpShortcuts(3);
    expect(defs.map((d) => d.id)).toEqual(["noteJump-0", "noteJump-1", "noteJump-2"]);
    expect(defs[0].combo).toEqual({ key: "1", ctrlOrMeta: true });
  });

  it("9件を超えても最大9件までしか生成しない", () => {
    expect(buildNoteJumpShortcuts(20)).toHaveLength(9);
  });
});

describe("buildBookmarkJumpShortcuts", () => {
  it("修飾キー無しの数字ショートカットを生成する", () => {
    const defs = buildBookmarkJumpShortcuts(2);
    expect(defs[0].combo).toEqual({ key: "1" });
    expect(defs[1].combo).toEqual({ key: "2" });
  });
});

describe("comboLabel", () => {
  it("修飾キー付きコンボを読める形式にする", () => {
    expect(comboLabel({ key: "k", ctrlOrMeta: true })).toBe("Cmd/Ctrl+K");
  });

  it("単独キーはそのまま大文字化する", () => {
    expect(comboLabel({ key: "?" })).toBe("?");
  });
});
