// @vitest-environment jsdom
// useSnapshotScheduler.test.ts — forceSnapshot(即時保存。SPEC.md §6)とフック本体の単体テスト
// useSnapshotScheduler自体(Reactフック本体)は編集区切り検出のタイマー/DOMイベント配線のみで
// 中身のロジックはhistory.test.tsで既にテスト済みのため、ここでは配線を伴わない
// forceSnapshotのみを対象にする(db.ts/search.tsは実体をfake-indexeddb経由で使う)。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { forceSnapshot, useSnapshotScheduler } from "./useSnapshotScheduler";
import { CHANGE_THRESHOLD_CHARS } from "./history";
import { getSnapshotsByNote } from "../storage/db";
import { searchSnapshotIds } from "../search/search";
import { gzipDecompress } from "./gzip";
import { Blob as NodeBlob } from "node:buffer";

// jsdomのBlobはstream()を持たず、gzipCompressが実行時に落ちる(フック本体のテストに
// jsdomが要るためこのファイルだけjsdom環境)。Node実装へ差し替えて実体のgzipを通す。
globalThis.Blob = NodeBlob as unknown as typeof globalThis.Blob;

describe("forceSnapshot", () => {
  it("db.tsへスナップショットを1件保存する(archived:falseで即座に本文を持つ)", async () => {
    await forceSnapshot("note-1", "こんにちは世界");
    const snapshots = await getSnapshotsByNote("note-1");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].archived).toBe(false);
    expect(await gzipDecompress(snapshots[0].content!)).toBe("こんにちは世界");
  });

  it("全文検索インデックスにも反映される", async () => {
    // tokenize.tsは分かち書き言語向けの単語境界分割のため、日本語部分は連続する
    // 文字列全体が1トークンになる(既知の制約)。クエリと完全一致させるため、
    // 半角スペースで区切った単独トークンを検索語に使う。
    await forceSnapshot("note-2", "メモ searchable-keyword 本文");
    const ids = await searchSnapshotIds("searchable-keyword");
    const snapshots = await getSnapshotsByNote("note-2");
    expect(ids).toContain(snapshots[0].id);
  });

  it("呼ぶたびに新しいスナップショットを追加する(上書きしない)", async () => {
    await forceSnapshot("note-3", "1回目");
    await forceSnapshot("note-3", "2回目");
    const snapshots = await getSnapshotsByNote("note-3");
    expect(snapshots).toHaveLength(2);
  });
});

// フック本体の配線も、無編集で刻まないこと(=無限増殖の回帰)だけは押さえる。
// 実測(2026-07-25): ペインのマウントだけで1件書かれ、スクロール/タブ開閉のたびに増えていた。
describe("useSnapshotScheduler(マウントだけでは刻まない)", () => {
  afterEach(cleanup);

  function Harness({ noteId, content }: { noteId: string; content: string }) {
    useSnapshotScheduler(noteId, content);
    return null;
  }

  const longContent = "あ".repeat(CHANGE_THRESHOLD_CHARS + 50);

  it("200文字以上のノートでも、マウントしただけでは保存しない", async () => {
    render(<Harness noteId="mount-1" content={longContent} />);
    await vi.waitFor(async () => {
      expect(await getSnapshotsByNote("mount-1")).toHaveLength(0);
    });
  });

  it("マウント・アンマウントを繰り返しても増えない(スクロールでの窓化が該当)", async () => {
    for (let i = 0; i < 5; i++) {
      const view = render(<Harness noteId="mount-2" content={longContent} />);
      view.unmount();
    }
    await vi.waitFor(async () => {
      expect(await getSnapshotsByNote("mount-2")).toHaveLength(0);
    });
  });

  it("マウント後に閾値を超えて本文が変われば保存する(履歴機能自体は生きている)", async () => {
    const view = render(<Harness noteId="mount-3" content={longContent} />);
    view.rerender(<Harness noteId="mount-3" content={`${longContent}${"い".repeat(300)}`} />);
    await vi.waitFor(async () => {
      expect((await getSnapshotsByNote("mount-3")).length).toBeGreaterThan(0);
    });
  });

  it("既に同じ内容が保存済みなら重ねて保存しない(複数タブが同じ編集を受け取る経路)", async () => {
    const edited = `${longContent}${"う".repeat(300)}`;
    await forceSnapshot("mount-4", edited); // 別タブが先に保存した想定
    const view = render(<Harness noteId="mount-4" content={longContent} />);
    view.rerender(<Harness noteId="mount-4" content={edited} />);
    await vi.waitFor(async () => {
      expect(await getSnapshotsByNote("mount-4")).toHaveLength(1);
    });
  });
});
