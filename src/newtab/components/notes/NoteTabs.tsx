// NoteTabs.tsx — ノートのタブ切替UI(追加/リネーム/削除。SPEC.md §4.2)
// タブの曲線シェイプはOSS実装 adamschwartz/chrome-tabs (MIT)のsvg/tab.svg+
// css/chrome-tabs.cssの実物を参照して移植(左右対称の1つのpath symbolを
// scale(-1,1)で反転複製し、隣接タブと地続きに見える台形状の切り欠きを作る手法)。
// ピン留め機能のUIは撤去済み(データ上のnote.pinned/sortedNotesの並び順ロジック自体は
// 互換性のため維持——インポートしたデータのpinned:trueも並び順には反映され続ける)。
import { useState } from "react";
import {
  addNote,
  createNote,
  nextNoteLetterTitle,
  removeNote,
  sortedNotes,
  updateNote,
} from "../../../lib/entities/notes";
import type { Note } from "../../../types";

type Props = {
  notes: Note[];
  activeNoteId: string | null;
  onNotesChange: (notes: Note[]) => void;
  onSelect: (noteId: string) => void;
};

export function NoteTabs({ notes, activeNoteId, onNotesChange, onSelect }: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const sorted = sortedNotes(notes);

  function handleAdd() {
    const title = nextNoteLetterTitle(notes.map((n) => n.title));
    if (title === null) {
      window.alert("ノートを開きすぎです!(ノートA〜Zの26件が上限です)");
      return;
    }
    const note = createNote(title, sorted.length);
    onNotesChange(addNote(notes, note));
    onSelect(note.id);
  }

  return (
    <div data-testid="note-tabs">
      {/* chrome-tabsのsvg/tab.svgを移植した共有シンボル定義(1回だけ描画し各タブから参照) */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <symbol id="note-tab-geometry-left" viewBox="0 0 214 36">
            <path d="M17 0h197v36H0v-2c4.5 0 9-3.5 9-8V8c0-4.5 3.5-8 8-8z" />
          </symbol>
          <symbol id="note-tab-geometry-right" viewBox="0 0 214 36">
            <use href="#note-tab-geometry-left" />
          </symbol>
        </defs>
      </svg>
      {sorted.map((note) => {
        const isActive = note.id === activeNoteId;
        return (
          <div
            key={note.id}
            data-testid={`note-tab-${note.id}`}
            className="note-tab"
            data-active={isActive || undefined}
          >
            <div className="note-tab-background" aria-hidden="true">
              <svg preserveAspectRatio="none" className="note-tab-geometry-svg">
                <svg width="52%" height="100%">
                  <use
                    href="#note-tab-geometry-left"
                    width="214"
                    height="36"
                    className="note-tab-geometry"
                  />
                </svg>
                <g transform="scale(-1, 1)">
                  <svg width="52%" height="100%" x="-100%" y="0">
                    <use
                      href="#note-tab-geometry-right"
                      width="214"
                      height="36"
                      className="note-tab-geometry"
                    />
                  </svg>
                </g>
              </svg>
            </div>
            <div className="note-tab-dividers" />
            <div className="note-tab-content">
              {renamingId === note.id ? (
                <input
                  aria-label="ノート名"
                  data-testid={`note-tab-rename-input-${note.id}`}
                  defaultValue={note.title}
                  onBlur={(e) => {
                    onNotesChange(
                      updateNote(notes, note.id, { title: e.target.value || note.title }),
                    );
                    setRenamingId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  data-testid={`note-tab-select-${note.id}`}
                  aria-current={isActive}
                  title="ダブルクリックでノート名を変更できます"
                  onClick={() => onSelect(note.id)}
                  onDoubleClick={() => setRenamingId(note.id)}
                >
                  {note.title}
                </button>
              )}
              <button
                type="button"
                data-testid={`note-tab-delete-${note.id}`}
                className="note-tab-close"
                title="このノートを削除する"
                onClick={() => onNotesChange(removeNote(notes, note.id))}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        data-testid="note-tab-add"
        className="note-tab-add"
        title="新しいノートを作成する"
        onClick={handleAdd}
      >
        +
      </button>
    </div>
  );
}
