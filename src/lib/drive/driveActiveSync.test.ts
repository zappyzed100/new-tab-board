// driveActiveSync.test.ts — Drive active/ からの世代pullの単体テスト
// 実Drive APIは叩かない(resolve/list/downloadを全てDIで差し替える — 本フォルダの既存方針)。
import { describe, expect, it, vi } from "vitest";
import { pullActiveFromDrive } from "./driveActiveSync";

/** noteToMarkdownが出すのと同じ形の front matter + 本文を組む。 */
function md(opts: { id?: string; title: string; order?: number; body: string }): string {
  const lines = ["---"];
  if (opts.id) lines.push(`id: ${opts.id}`);
  lines.push(`title: ${opts.title}`);
  if (opts.order !== undefined) lines.push(`order: ${opts.order}`);
  lines.push("---", "", opts.body);
  return lines.join("\n");
}

function deps(files: { id: string; noteId: string; content: string }[]) {
  return {
    resolveFolderPath: vi.fn(async () => "folder-1"),
    listNoteFilesInFolder: vi.fn(async () => files.map((f) => ({ id: f.id, noteId: f.noteId }))),
    downloadFileContent: vi.fn(async (fileId: string) => {
      const found = files.find((f) => f.id === fileId);
      if (!found) throw new Error(`unexpected fileId ${fileId}`);
      return found.content;
    }),
  };
}

describe("pullActiveFromDrive", () => {
  it("active/のファイルをNote[]へ復元する", async () => {
    const notes = await pullActiveFromDrive(
      "tok",
      deps([
        { id: "f1", noteId: "n1", content: md({ id: "n1", title: "メモA", body: "本文A" }) },
      ]) as never,
    );
    expect(notes).not.toBeNull();
    expect(notes).toHaveLength(1);
    expect(notes?.[0].title).toBe("メモA");
    expect(notes?.[0].content).toBe("本文A");
  });

  it("ノートidはappPropertiesのnoteIdを正本にする(front matterにidが無くても増殖しない)", async () => {
    // markdownToNoteはid欠落時に乱数を振る。それを採ると pullのたびに別ノート扱いになり、
    // 盤面で増殖したうえDrive側のnoteId突合とも食い違う——必ずnoteIdで上書きする。
    const notes = await pullActiveFromDrive(
      "tok",
      deps([
        { id: "f1", noteId: "real-id", content: md({ title: "id無し", body: "本文" }) },
      ]) as never,
    );
    expect(notes?.[0].id).toBe("real-id");
  });

  it("driveFileIdを埋める(次のpushで同じファイルを更新できるように)", async () => {
    const notes = await pullActiveFromDrive(
      "tok",
      deps([
        { id: "file-abc", noteId: "n1", content: md({ id: "n1", title: "t", body: "b" }) },
      ]) as never,
    );
    expect(notes?.[0].driveFileId).toBe("file-abc");
  });

  it("front matterのorder昇順に並べる(列挙順に依存しない)", async () => {
    const notes = await pullActiveFromDrive(
      "tok",
      deps([
        { id: "f1", noteId: "n1", content: md({ id: "n1", title: "後", order: 5, body: "b1" }) },
        { id: "f2", noteId: "n2", content: md({ id: "n2", title: "先", order: 1, body: "b2" }) },
      ]) as never,
    );
    expect(notes?.map((n) => n.title)).toEqual(["先", "後"]);
  });

  it("active/が空ならから配列を返す(nullではない——「Driveに1件も無い」は正当な状態)", async () => {
    const notes = await pullActiveFromDrive("tok", deps([]) as never);
    expect(notes).toEqual([]);
  });

  it("フォルダ解決に失敗したらnull(未接続扱いで呼び出し側は何もしない)", async () => {
    const notes = await pullActiveFromDrive("tok", {
      resolveFolderPath: vi.fn(async () => {
        throw new Error("HTTP 401");
      }),
    } as never);
    expect(notes).toBeNull();
  });

  it("1ファイルのダウンロードに失敗したらnull(部分的な集合でタブを上書きしない)", async () => {
    // 部分結果でpullすると、落ちたファイルのノートが「削除された」と誤認され、
    // 次のpushで実際にDriveから消える——中途半端な集合は決して返さない。
    const notes = await pullActiveFromDrive("tok", {
      resolveFolderPath: vi.fn(async () => "folder-1"),
      listNoteFilesInFolder: vi.fn(async () => [
        { id: "f1", noteId: "n1" },
        { id: "f2", noteId: "n2" },
      ]),
      downloadFileContent: vi.fn(async (fileId: string) => {
        if (fileId === "f2") throw new Error("HTTP 500");
        return md({ id: "n1", title: "t", body: "b" });
      }),
    } as never);
    expect(notes).toBeNull();
  });
});

describe("pullActiveFromDrive — 同一noteIdの重複ファイル", () => {
  // 実害の型(2026-07-20): syncNoteToDriveの同時実行レースでDrive上に同一noteIdのファイルが
  // 2つでき、そこからpullすると同じidのNoteが2件生まれた。updateNoteはid一致の全ノートを
  // 書き換える(notes.ts)ため、片方への編集がもう片方にも入り「ノートAのタイトル・idのまま
  // 本文だけノートBのもの」という壊れ方をした。
  const dup = (updatedA: string, updatedB: string) => [
    {
      id: "f-old",
      noteId: "same-id",
      content: `---\nid: same-id\ntitle: 古い\nupdated_at: ${updatedA}\n---\n\n古い本文`,
    },
    {
      id: "f-new",
      noteId: "same-id",
      content: `---\nid: same-id\ntitle: 新しい\nupdated_at: ${updatedB}\n---\n\n新しい本文`,
    },
  ];

  it("回帰: 同じidのNoteを2件返さない", async () => {
    const notes = await pullActiveFromDrive(
      "tok",
      deps(dup("2026-07-20T05:00:00.000Z", "2026-07-20T16:00:00.000Z")) as never,
    );
    expect(notes).toHaveLength(1);
    expect(new Set(notes?.map((n) => n.id)).size).toBe(1);
  });

  it("重複時はupdated_atが新しい方を残す(最終操作者優先)", async () => {
    const notes = await pullActiveFromDrive(
      "tok",
      deps(dup("2026-07-20T05:00:00.000Z", "2026-07-20T16:00:00.000Z")) as never,
    );
    expect(notes?.[0].content).toBe("新しい本文");
    expect(notes?.[0].driveFileId).toBe("f-new");
  });

  it("列挙順が逆でも新しい方を残す(files.listの順序に依存しない)", async () => {
    const reversed = dup("2026-07-20T05:00:00.000Z", "2026-07-20T16:00:00.000Z").reverse();
    const notes = await pullActiveFromDrive("tok", deps(reversed) as never);
    expect(notes?.[0].content).toBe("新しい本文");
  });
});
