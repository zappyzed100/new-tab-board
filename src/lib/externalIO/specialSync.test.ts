// specialSync.test.ts — NASの special/ 書き出し・突き合わせ削除の単体テスト
import { describe, expect, it, vi } from "vitest";
import { pushSpecialToNas, specialEntryToMarkdown, specialRelPath } from "./specialSync";
import { markdownToNote } from "./nasArchive";
import type { SpecialEntry } from "../entities/special";

const entry = (over: Partial<SpecialEntry>): SpecialEntry => ({
  id: "n",
  title: "t",
  content: "本文",
  source: "live",
  ...over,
});

describe("specialRelPath", () => {
  it("フォルダ有りは <folder>/<id>.md、無しは <id>.md(前後スラッシュ正規化)", () => {
    expect(specialRelPath({ id: "a", folder: "/仕事/2026/" })).toBe("仕事/2026/a.md");
    expect(specialRelPath({ id: "a" })).toBe("a.md");
  });
});

describe("specialEntryToMarkdown", () => {
  it("noteToMarkdown 形式で書き、markdownToNote で往復する", () => {
    const md = specialEntryToMarkdown(
      entry({ id: "a", title: "計画", content: "本文", folder: "仕事" }),
    );
    const back = markdownToNote(md);
    expect(back).toMatchObject({
      id: "a",
      title: "計画",
      content: "本文",
      special: true,
      specialFolder: "仕事",
    });
  });
});

describe("pushSpecialToNas", () => {
  it("各エントリを special/ へ書き、desiredに無い既存.mdを消す(フォルダ移動の旧ファイルも)", async () => {
    const writeFileToNas = vi.fn().mockResolvedValue(true);
    const deleteFileFromNas = vi.fn().mockResolvedValue(true);
    // 既存: a は今ルート(移動して旧 仕事/a.md が残っている)、z は今回のエントリに無い(削除対象)。
    const listNasTree = vi.fn().mockResolvedValue(["a.md", "仕事/a.md", "z.md"]);

    const res = await pushSpecialToNas([entry({ id: "a" })], {
      getNasFolderPath: async () => "Z:\\NAS",
      writeFileToNas,
      listNasTree,
      deleteFileFromNas,
    });

    // a は special/a.md へ書く。
    expect(writeFileToNas).toHaveBeenCalledWith(
      "Z:\\NAS",
      "special/a.md",
      expect.stringContaining("id: a"),
    );
    // 旧 仕事/a.md と z.md は desired に無いので削除。現行 a.md は残す。
    expect(deleteFileFromNas).toHaveBeenCalledWith("Z:\\NAS", "special/仕事/a.md");
    expect(deleteFileFromNas).toHaveBeenCalledWith("Z:\\NAS", "special/z.md");
    expect(deleteFileFromNas).not.toHaveBeenCalledWith("Z:\\NAS", "special/a.md");
    expect(res).toEqual({ written: 1, deleted: 2 });
  });

  it("NAS未設定ならhostに触れず0件", async () => {
    const writeFileToNas = vi.fn();
    const res = await pushSpecialToNas([entry({})], {
      getNasFolderPath: async () => undefined,
      writeFileToNas,
    });
    expect(writeFileToNas).not.toHaveBeenCalled();
    expect(res).toEqual({ written: 0, deleted: 0 });
  });
});
