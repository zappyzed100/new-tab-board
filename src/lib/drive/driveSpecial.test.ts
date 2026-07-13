// driveSpecial.test.ts — Driveのspecial/書き出し・フォルダ内突き合わせ削除の単体テスト
import { describe, expect, it, vi } from "vitest";
import { pushSpecialToDrive } from "./driveSpecial";
import type { SpecialEntry } from "../entities/special";

const entry = (over: Partial<SpecialEntry>): SpecialEntry => ({
  id: "n",
  title: "t",
  content: "本文",
  source: "live",
  ...over,
});

describe("pushSpecialToDrive", () => {
  it("フォルダごとに解決してアップロードし、フォルダ内のdesiredに無いファイルを削除する", async () => {
    // フォルダ "仕事" と ルート の2グループ。
    const resolveFolderPath = vi
      .fn()
      .mockImplementation(async (parts: string[]) => `folder:${parts.join("/")}`);
    const listNoteFilesInFolder = vi.fn().mockImplementation(async (folderId: string) => {
      if (folderId === "folder:app/New Tab Board/special/仕事")
        return [
          { id: "fa", noteId: "a" },
          { id: "fx", noteId: "x" }, // xは今回のエントリに無い→削除
        ];
      return []; // ルートは空
    });
    const uploadNote = vi.fn().mockResolvedValue("uploaded");
    const deleteDriveFile = vi.fn().mockResolvedValue(undefined);

    const res = await pushSpecialToDrive(
      [entry({ id: "a", folder: "仕事" }), entry({ id: "b" })], // a=仕事, b=ルート
      "tok",
      { resolveFolderPath, listNoteFilesInFolder, uploadNote, deleteDriveFile },
    );

    // a は 仕事フォルダへ(既存fa=PATCH)、b はルートへ(新規=null)。
    expect(uploadNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" }),
      "tok",
      "fa",
      undefined,
      { folderId: "folder:app/New Tab Board/special/仕事", kind: "special:仕事", filename: "a.md" },
    );
    expect(uploadNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b" }),
      "tok",
      null,
      undefined,
      { folderId: "folder:app/New Tab Board/special", kind: "special:", filename: "b.md" },
    );
    // 仕事フォルダの x(desiredに無い)を削除。
    expect(deleteDriveFile).toHaveBeenCalledWith("fx", "tok");
    expect(res).toEqual({ uploaded: 2, deleted: 1 });
  });
});
