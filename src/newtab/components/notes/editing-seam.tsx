// editing-seam.tsx — 編集中ノートの単一の真実源(ドラフトバッファ＋編集レジストリ)を配るReact context
//
// ノート編集中に別経路の同期(別タブ/NAS/Drive/backgroundの確定revision)が届くと、編集中ノートの
// 本文が古い断面で上書きされ入力が消える実害があった(ユーザー報告)。旧来の「activeNoteId 1件だけを
// 各同期経路が任意に守る」方式は、本文ペインをクリックしただけの非選択ノートや、コミット往復/
// Gemini書き込み等の経路を保護できず、経路が増えるたびに穴が増えた。
//
// ここは対症療法をやめ、**フォーカス中/未保存の全ノート**を一箇所で追跡する:
//  - draftContent: CM6が毎打鍵で書く最新テキスト(未保存を含む)。エディタはマウント時これを最優先で
//    読むため、同期が note.content を巻き戻す/再マウントを起こしても入力が生き残る(belt)。
//  - editingIds: フォーカス中(=編集中)のノートid集合。App が protectedNoteIds() の土台にし、
//    全マージ/再適用点でこの集合を local 版で不可侵にする(reorder/削除/本文上書きを防ぐ)。
// App が ref を同期クロージャから直読みし、seam(操作関数)を Provider で子(NoteEditorPane)へ配る。
import { createContext, useContext, useMemo, useRef } from "react";
import type { MutableRefObject, ReactNode } from "react";

export type EditingSeam = {
  /** id -> CM6が保持する最新テキスト(未保存の打鍵を含む)。無ければ undefined。 */
  getDraft: (id: string) => string | undefined;
  setDraft: (id: string, text: string) => void;
  clearDraft: (id: string) => void;
  /** フォーカス取得/喪失。編集中idの集合を更新する(protectedNoteIds の土台)。 */
  beginEditing: (id: string) => void;
  endEditing: (id: string) => void;
};

export type EditingRefs = {
  draftContentRef: MutableRefObject<Map<string, string>>;
  editingIdsRef: MutableRefObject<Set<string>>;
};

const EditingSeamContext = createContext<EditingSeam | null>(null);

/** App が持つ ref とそれを操作する seam を1度だけ生成する。ref は同期tick/購読のクロージャから
 * 直読みし、seam は Provider で子へ配る(2つに分けるのは、読み手=App と書き手=子が別階層のため)。 */
export function useEditingSeam(): { seam: EditingSeam; refs: EditingRefs } {
  const draftContentRef = useRef<Map<string, string>>(new Map());
  const editingIdsRef = useRef<Set<string>>(new Set());
  const seam = useMemo<EditingSeam>(
    () => ({
      getDraft: (id) => draftContentRef.current.get(id),
      setDraft: (id, text) => draftContentRef.current.set(id, text),
      clearDraft: (id) => draftContentRef.current.delete(id),
      beginEditing: (id) => editingIdsRef.current.add(id),
      endEditing: (id) => editingIdsRef.current.delete(id),
    }),
    [],
  );
  return { seam, refs: { draftContentRef, editingIdsRef } };
}

export function EditingSeamProvider({
  seam,
  children,
}: {
  seam: EditingSeam;
  children: ReactNode;
}) {
  return <EditingSeamContext.Provider value={seam}>{children}</EditingSeamContext.Provider>;
}

/** 子コンポーネント(NoteEditorPane)から seam を読む。Provider の外(テスト等)では null。 */
export function useEditingSeamContext(): EditingSeam | null {
  return useContext(EditingSeamContext);
}
