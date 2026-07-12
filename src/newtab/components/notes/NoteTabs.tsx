// NoteTabs.tsx — ノートのタブ切替UI(追加/リネーム/削除/D&D並べ替え。SPEC.md §4.2)
// Radixの<Tabs>へ全面置換(ユーザー指示。以前あったchrome-tabs OSS移植の曲線シェイプは
// 失われ、フラットなタブ見た目になる)。@radix-ui/themesのTabs.Triggerは子要素を
// 可視用+隠しレイアウト計測用の2箇所に複製する内部実装(tabs.jsで確認済み)のため、
// data-testidを持つ子を渡すとDOM上に同じtestidの要素が2つでき、E2Eのクリック/
// ダブルクリックが不安定になる実害があった。そのため本ファイルだけはThemesではなく
// 下層の生radix-uiパッケージ(themesが内部で使っているのと同じprimitive)を直接使い、
// asChildで子要素の複製を避けている(見た目はRadix Themesのrt-*クラスに乗らないため
// 自前CSSで整えるが、選択状態管理・キーボードナビゲーション・ARIA属性はRadixに任せる)。
// HTML仕様上、閉じるボタン・リネーム入力はbutton要素の子にできない制約があるため、
// Tabs.TriggerのasChild先はdiv(interactive contentのネスト制約が無い要素)にしている。
// 本家(adamschwartz/chrome-tabs)のドラッグ物理演算(draggabilly)の代わりに、
// BookmarkGrid.tsxと同じ自前のHTML5 native drag-and-dropパターンで並べ替えを実装している。
// ピン留め機能のUIは撤去済み(データ上のnote.pinned/sortedNotesの並び順ロジック自体は
// 互換性のため維持——インポートしたデータのpinned:trueも並び順には反映され続ける)。
import { useState } from "react";
import { Checkbox, IconButton, TextField } from "@radix-ui/themes";
import { Tabs } from "radix-ui";
import {
  addNote,
  createNote,
  nextNoteLetterTitle,
  removeNote,
  reorderNotes,
  sortedNotes,
  updateNote,
} from "../../../lib/entities/notes";
import type { Note } from "../../../types";

type Props = {
  notes: Note[];
  activeNoteId: string | null;
  /** 横並び表示中のノートID(3件以下なら常に全件と一致)。 */
  visibleNoteIds: string[];
  onNotesChange: (update: Note[] | ((prev: Note[]) => Note[])) => void;
  onSelect: (noteId: string) => void;
  /** 4件以上の時だけ使う「表示する3件」の選択トグル。 */
  onToggleVisible: (noteId: string) => void;
};

export function NoteTabs({
  notes,
  activeNoteId,
  visibleNoteIds,
  onNotesChange,
  onSelect,
  onToggleVisible,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const sorted = sortedNotes(notes);

  function handleAdd() {
    const title = nextNoteLetterTitle(notes.map((n) => n.title));
    if (title === null) {
      window.alert("ノートを開きすぎです!(ノートA〜Zの26件が上限です)");
      return;
    }
    const note = createNote(title, sorted.length);
    onNotesChange((prev) => addNote(prev, note));
    onSelect(note.id);
  }

  function handleDrop(toIndex: number) {
    if (dragIndex !== null && dragIndex !== toIndex) {
      onNotesChange((prev) => reorderNotes(prev, dragIndex, toIndex));
    }
    setDragIndex(null);
  }

  const renamingNote = renamingId ? notes.find((n) => n.id === renamingId) : undefined;

  return (
    <Tabs.Root value={activeNoteId ?? ""} onValueChange={onSelect}>
      <div data-testid="note-tabs">
        <Tabs.List className="note-tab-list">
          {sorted.map((note, index) => {
            const isActive = note.id === activeNoteId;
            return (
              <Tabs.Trigger key={note.id} value={note.id} asChild>
                <div
                  className="note-tab"
                  data-testid={`note-tab-${note.id}`}
                  data-active={isActive || undefined}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(index)}
                >
                  <span
                    data-testid={`note-tab-select-${note.id}`}
                    aria-current={isActive}
                    title="ダブルクリックでノート名を変更できます"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(note.id);
                    }}
                  >
                    {note.title}
                  </span>
                  {notes.length > 3 ? (
                    <Checkbox
                      data-testid={`note-tab-visible-${note.id}`}
                      title="横並び表示に含める(最大3件)"
                      checked={visibleNoteIds.includes(note.id)}
                      disabled={visibleNoteIds.length >= 3 && !visibleNoteIds.includes(note.id)}
                      // Tabs.Triggerは(クリックではなく)mousedown、および子要素へフォーカスが
                      // 移った際のfocus(onFocus。ブラウザがクリック時に自動でボタンへフォーカス
                      // を移す副作用としてfocusinがバブリングする)の時点でcontext.onValueChangeを
                      // 呼ぶ(生radix-uiのTabsTrigger実装。RovingFocusGroup.Itemのフォーカス管理
                      // 込み)。clickだけstopPropagationしてもmousedown/focusは止まらず素通りして
                      // バブリングし、親のonSelect(selectNote)がrequestedVisibleIdsを別ロジック
                      // (スワップ式)で書き換えてしまい、直後のonCheckedChangeによる追加/削除と
                      // 競合して「チェックした直後に外れる」という再現しにくい競合の原因になって
                      // いた。両方の段階で止める。
                      onMouseDown={(e) => e.stopPropagation()}
                      onFocus={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => onToggleVisible(note.id)}
                    />
                  ) : null}
                  <span
                    data-testid={`note-tab-delete-${note.id}`}
                    className="note-tab-close"
                    role="button"
                    tabIndex={0}
                    title="このノートを削除する"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNotesChange((prev) => removeNote(prev, note.id));
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      e.stopPropagation();
                      onNotesChange((prev) => removeNote(prev, note.id));
                    }}
                  >
                    ×
                  </span>
                </div>
              </Tabs.Trigger>
            );
          })}
        </Tabs.List>
        <IconButton
          type="button"
          data-testid="note-tab-add"
          className="note-tab-add"
          title="新しいノートを作成する"
          onClick={handleAdd}
        >
          +
        </IconButton>
      </div>
      {renamingNote ? (
        <TextField.Root
          aria-label="ノート名"
          data-testid={`note-tab-rename-input-${renamingNote.id}`}
          autoFocus
          defaultValue={renamingNote.title}
          onBlur={(e) => {
            const nextTitle = e.target.value || renamingNote.title;
            onNotesChange((prev) => updateNote(prev, renamingNote.id, { title: nextTitle }));
            setRenamingId(null);
          }}
        />
      ) : null}
    </Tabs.Root>
  );
}
