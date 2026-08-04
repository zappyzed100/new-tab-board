// @vitest-environment jsdom
// NoteEditorPane.test.tsx — 破棄済みCM6インスタンスからの遅延イベントを無視する回帰テスト
// (2026-08-04のCI再発「初期化ボタンでノートの内容が空に戻る」がCIでだけ落ちる件)。
// 実機のCM6タイミングは再現できないため、Notepadをフェイクに差し替えて
// 「古いインスタンスのonContentChangeが、再マウント後に遅れて発火する」ことだけを直接起こす。
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Note } from "../../../types";

/** マウントされたNotepad(フェイク)が受け取ったonContentChangeを、マウント順に記録する。 */
const contentChangeCallbacks: ((content: string) => void)[] = [];

vi.mock("./Notepad", () => ({
  Notepad: ({
    content,
    onContentChange,
  }: {
    content: string;
    onContentChange: (content: string) => void;
  }) => {
    // 実物と同じく「最後に受け取ったコールバック」を保持する(Notepadは
    // onContentChangeRefを毎レンダ更新する。破棄済みインスタンスは再レンダされないため
    // 古いコールバックを持ち続ける——その状況をここで再現する)。
    const index = contentChangeCallbacks.length;
    if (!mountedIndexes.has(onContentChange)) {
      mountedIndexes.add(onContentChange);
      contentChangeCallbacks[index] = onContentChange;
    }
    return <div data-testid="fake-notepad">{content}</div>;
  },
}));
const mountedIndexes = new Set<unknown>();

// 重い外部依存(Drive同期/Gemini/IndexedDB/スナップショット常駐)はこのテストの対象外。
vi.mock("../../../lib/drive/useDriveSync", () => ({ useDriveSync: () => "idle" }));
vi.mock("../../../lib/gemini/useAutoTagScheduler", () => ({ useAutoTagScheduler: () => {} }));
vi.mock("./SnapshotScheduler", () => ({ SnapshotScheduler: () => null }));
vi.mock("../../../lib/storage/db", () => ({ getGeminiApiKey: async () => null }));
vi.mock("../../../lib/history/useSnapshotScheduler", () => ({ forceSnapshot: async () => {} }));

const { NoteEditorPane } = await import("./NoteEditorPane");

const NOTE_ID = "note-1";

function makeNote(content: string): Note {
  return { id: NOTE_ID, title: "テスト", content, pinned: false, order: 0 };
}

/** App.tsx相当の最小ホスト。onNotesChangeを実際に適用して、本文の真値を保持する。 */
function Host({ onNotes }: { onNotes: (notes: Note[]) => void }) {
  const [notes, setNotes] = useState<Note[]>([makeNote("消される予定の本文")]);
  onNotes(notes);
  return (
    <NoteEditorPane
      note={notes[0]}
      notes={notes}
      tagCandidates={[]}
      isActive={true}
      isFirst={true}
      isLast={true}
      autoFocus={false}
      manualSyncSignal={0}
      replaceContentVersion={0}
      onNotesChange={(update) =>
        setNotes((prev) => (typeof update === "function" ? update(prev) : update))
      }
      onSelectNote={() => {}}
      onSelectNoteByTitle={() => {}}
      onCreateNote={() => {}}
      onAddTodos={() => {}}
      onMessage={() => {}}
      onTogglePin={() => {}}
      onToggleSpecial={() => {}}
      onDeleteNote={() => {}}
      onMoveUp={() => {}}
      onMoveDown={() => {}}
      onDragStartNote={() => {}}
      onDropNote={() => {}}
      wrapLines={false}
      fixedTags={[]}
      onEditingChange={() => {}}
    />
  );
}

afterEach(() => {
  cleanup();
  contentChangeCallbacks.length = 0;
  mountedIndexes.clear();
});

describe("初期化と古いCM6インスタンスの遅延イベント", () => {
  it("初期化後に破棄済みインスタンスがonContentChangeを遅れて発火しても、本文は空のまま", async () => {
    let current: Note[] = [];
    render(<Host onNotes={(notes) => (current = notes)} />);
    // 遅延importのNotepad(フェイク)がマウントされるまで待つ。
    expect(await screen.findByTestId("fake-notepad")).toBeTruthy();
    const staleCallback = contentChangeCallbacks[0];
    expect(staleCallback).toBeTypeOf("function");

    // 初期化ボタン(本文を空へ戻し、Notepadを再マウントする)。
    await act(async () => {
      screen.getByTestId(`reset-note-${NOTE_ID}`).click();
    });
    expect(current[0].content).toBe("");

    // ここが本題: 破棄されたインスタンスの遅延イベントが、再マウント完了(=抑止フラグが
    // 解除されるeffect)より**後**に届く。時間の窓で守っていた頃はこれが素通りし、
    // note.contentが古い本文へ戻っていた——Notepadは画面内に入るまでCM6を作らないため、
    // その後に生成されるCM6が古い本文でできあがり、初期化が効かなかったように見える。
    await act(async () => {
      staleCallback("消される予定の本文");
    });
    expect(current[0].content).toBe("");
  });

  it("初期化後の新しいインスタンスからの入力は、これまでどおり保存される(過剰に無視しない)", async () => {
    let current: Note[] = [];
    render(<Host onNotes={(notes) => (current = notes)} />);
    expect(await screen.findByTestId("fake-notepad")).toBeTruthy();

    await act(async () => {
      screen.getByTestId(`reset-note-${NOTE_ID}`).click();
    });
    const freshCallback = contentChangeCallbacks[contentChangeCallbacks.length - 1];
    await act(async () => {
      freshCallback("初期化後の新しい本文");
    });
    expect(current[0].content).toBe("初期化後の新しい本文");
  });
});
