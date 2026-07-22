// notes.ts — ノートの純粋な状態更新関数(I/Oを持たない。SPEC.md §4.2)
import type { Note } from "../../types";

/** 「この端末のみ・同期しない」ノートか(Note.noSync)。本文を端末外へ出す全経路の除外判定に使う
 * 単一の述語(NAS/Drive/Gemini/JSONバックアップ/履歴フラッシュ)。ここを唯一の意味の出所にして、
 * 各出口が `!isNoSyncNote(n)` / `excludeNoSyncNotes(...)` を通す。 */
export function isNoSyncNote(note: { noSync?: boolean }): boolean {
  return note.noSync === true;
}

/** 端末外へ送る直前に「この端末のみ」ノートを除いた配列を返す(egress の共通チョークポイント)。 */
export function excludeNoSyncNotes<T extends { noSync?: boolean }>(notes: T[]): T[] {
  return notes.filter((note) => !isNoSyncNote(note));
}

/** ノートの保持上限(ユーザー指示で26→501へ拡張)。A〜Z(26)を超えたらAA以降を解禁する。 */
export const MAX_NOTES = 501;
/** 末尾に常時確保する空ノートの数(ユーザー指示: スプレッドシートの末尾空行と同じ発想)。 */
export const TRAILING_EMPTY_NOTES = 3;

/** 1始まりの通し番号を、スプレッドシート列風の英字(1→A, 26→Z, 27→AA, 28→AB…)へ変換する。 */
function columnLetters(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** 「ノートA」「ノートB」…「ノートZ」「ノートAA」…のうち、既存タイトルと重複しない最初の1つを返す。
 * MAX_NOTES件すべて使用中ならnull(呼び出し側は新規作成を拒否しポップアップを出す)。 */
export function nextNoteLetterTitle(existingTitles: string[]): string | null {
  const used = new Set(existingTitles);
  for (let i = 1; i <= MAX_NOTES; i++) {
    const title = `ノート${columnLetters(i)}`;
    if (!used.has(title)) return title;
  }
  return null;
}

/** ノートを作る。createdAt(epoch ms)は呼び出し側がclock経由で渡す(この関数を純粋に保つため
 * Date.nowを内部で呼ばない)。省略時はタイムスタンプ無し(既存互換)。 */
export function createNote(title: string, order: number, createdAt?: number): Note {
  return {
    id: crypto.randomUUID(),
    title,
    content: "",
    pinned: false,
    order,
    ...(createdAt !== undefined ? { createdAt, updatedAt: createdAt } : {}),
  };
}

export function addNote(notes: Note[], note: Note): Note[] {
  return [...notes, note];
}

/** 自動採番の既定タイトル(「ノートA」「ノートAA」等)か。自動タイトル付けで上書きしてよいかの
 * 判定に使う——人が手で付けたタイトルは自動処理で勝手に書き換えない(ユーザー配慮)。 */
export function isDefaultNoteTitle(title: string): boolean {
  return /^ノート[A-Z]+$/.test(title);
}

/** newNote を afterId のノートの直後(表示順=sortedNotes基準)へ挿入し、order を振り直す。
 * 列固定masonryでは「afterId の一つ右(右端なら一段下の一番左)」に現れる(要約の配置——ユーザー指示)。
 * afterId が見つからなければ末尾へ追加する。 */
export function addNoteAfter(notes: Note[], newNote: Note, afterId: string): Note[] {
  const sorted = sortedNotes(notes);
  const idx = sorted.findIndex((n) => n.id === afterId);
  if (idx === -1) return [...notes, newNote];
  sorted.splice(idx + 1, 0, newNote);
  return sorted.map((n, i) => ({ ...n, order: i }));
}

export function updateNote(notes: Note[], id: string, patch: Partial<Omit<Note, "id">>): Note[] {
  return notes.map((n) => (n.id === id ? { ...n, ...patch } : n));
}

/** ノートへ md/txt ファイルをドロップした時の本文の取り込み方(ユーザー指示: 内容をコピー)。
 * 空ノートは丸ごと置換、非空ノートは既存を消さないよう空行区切りで末尾へ追記する。 */
export function mergeDroppedContent(existing: string, dropped: string): string {
  return existing.trim() === "" ? dropped : `${existing}\n\n${dropped}`;
}

export function removeNote(notes: Note[], id: string): Note[] {
  return notes.filter((n) => n.id !== id);
}

/** ピン留めを先頭に、それぞれorder昇順で並べたコピーを返す。 */
export function sortedNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.order - b.order;
  });
}

/** 表示順(sortedNotes基準)でfromIndexの要素をtoIndexへ移動し、orderを振り直す。 */
export function reorderNotes(notes: Note[], fromIndex: number, toIndex: number): Note[] {
  const sorted = sortedNotes(notes);
  const [moved] = sorted.splice(fromIndex, 1);
  sorted.splice(toIndex, 0, moved);
  return sorted.map((n, i) => ({ ...n, order: i }));
}

/** 表示順(sortedNotes基準)で fromId の要素を toId の位置へ移動する。
 * ノートペインをまたぐドラッグ交換で、index ではなく id で指定するための薄いラッパー
 * (どちらかの id が存在しなければ何もしない)。 */
export function reorderNotesById(notes: Note[], fromId: string, toId: string): Note[] {
  const sorted = sortedNotes(notes);
  const fromIndex = sorted.findIndex((n) => n.id === fromId);
  const toIndex = sorted.findIndex((n) => n.id === toId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return notes;
  return reorderNotes(notes, fromIndex, toIndex);
}

/** 指定ノートを順序列で1つ前(=表示上ひとつ左上)のノートと入れ替える。
 * 先頭(index 0)や存在しないidはそのまま返す(「ひとつ上へ」ボタン用)。 */
export function moveNoteUp(notes: Note[], id: string): Note[] {
  const sorted = sortedNotes(notes);
  const i = sorted.findIndex((n) => n.id === id);
  if (i <= 0) return notes;
  return reorderNotes(notes, i, i - 1);
}

/** 指定ノートを順序列で1つ後ろ(=表示上ひとつ右下)のノートと入れ替える。moveNoteUpの対
 * (「ひとつ下へ」ボタン用)。末尾や存在しないidはそのまま返す。 */
export function moveNoteDown(notes: Note[], id: string): Note[] {
  const sorted = sortedNotes(notes);
  const i = sorted.findIndex((n) => n.id === id);
  if (i === -1 || i >= sorted.length - 1) return notes;
  return reorderNotes(notes, i, i + 1);
}

/** 自動採番の空プレースホルダ(「ノートX」・本文が空白のみ・ピン/チェック/スター/ゴミ/タグ
 * いずれも無し)か。末尾の空バッファ管理で「補充・間引きしてよいブランク」の判定に使う。
 * ユーザーが手で付けた空ノートや、タグ/ピン等の付いた空ノートは対象外(消さない)。
 * note-sync.ts の同期側 dedup もこの述語を共有する(意味の出所を一箇所にして揃える)。 */
export function isGeneratedEmptyPlaceholder(note: Note): boolean {
  return (
    isDefaultNoteTitle(note.title) &&
    note.content.trim() === "" &&
    !note.pinned &&
    !note.done &&
    !note.special &&
    !note.junk &&
    (note.tags?.length ?? 0) === 0
  );
}

/** 「常に空のノートが N 個・表示順の末尾に並ぶ」を保つ純関数(ユーザー指示: 付箋用の余白は常に3つ)。
 * 不足なら `nextNoteLetterTitle` で命名して末尾へ補充し、余った自動空プレースホルダ(末尾に無い=
 * 取り残されたもの)は order の低い方から間引いて常に N 個だけにする。冪等: 既に N 個が末尾に
 * 揃っていれば元の配列をそのまま返す。MAX_NOTES 上限では補充を打ち止める。 */
export function ensureTrailingEmptyNotes(
  notes: Note[],
  desired: number,
  createdAt?: number,
): Note[] {
  const sorted = sortedNotes(notes);
  // 末尾から数えて連続する空ノート(content が空白のみ)の数。
  let trailingEmpty = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].content.trim() === "") trailingEmpty += 1;
    else break;
  }
  const additions: Note[] = [];
  const titles = notes.map((n) => n.title);
  // 新しい空ノートは既存の最大 order より必ず大きい order を振る。`sorted.length` を使うと、
  // 削除で order に穴が空く/並べ替えで非空ノートを末尾へ置く等で「件数以上の order を持つ
  // 非空ノート」があるとき、追加した空ノートがその前に並んで「末尾の空」に数えられず、
  // 毎コミットで空ノートを量産してしまう(ユーザー報告の空ノート20個・カーソルずれの原因)。
  let nextOrder = sorted.reduce((max, n) => Math.max(max, n.order), -1) + 1;
  for (let count = trailingEmpty; count < desired; count++) {
    const title = nextNoteLetterTitle(titles);
    if (title === null) break; // MAX_NOTES 上限
    const note = createNote(title, nextOrder, createdAt);
    additions.push(note);
    titles.push(title);
    nextOrder += 1;
  }
  const combined = additions.length === 0 ? notes : [...notes, ...additions];
  // 自動空プレースホルダが desired を超えたら、order の低い(=末尾に無い・取り残された)ものから
  // 間引いて常に desired 個だけにする。末尾以外の空ノートに入力する等で空が末尾以外へ取り残される
  // と、以前は末尾へ補充だけして総数が増えていた(ユーザー指摘: 常に空は3つのはず。真ん中の空へ
  // 入力すると4つに増えた)。手付けの空ノート/フラグ付き空ノートは述語に該当せず間引かれない。
  const placeholders = sortedNotes(combined.filter(isGeneratedEmptyPlaceholder));
  if (placeholders.length <= desired) {
    // 補充も間引きも無ければ同一参照を返す(維持effectが no-op を検知して再保存を避けられるように)。
    return combined;
  }
  const surplusIds = new Set(placeholders.slice(0, placeholders.length - desired).map((n) => n.id));
  return combined.filter((n) => !surplusIds.has(n.id));
}

/** 検索結果(title/content)をノート末尾へ貼り付ける(ユーザー指示)。末尾側の白紙ノートを
 * 上から順に上書きし、足りなければ追加する。最後に末尾空を desired 個(既定TRAILING_EMPTY_NOTES)維持。
 * 既存の updateNote / createNote / ensureTrailingEmptyNotes を再利用する。 */
export function pasteResultsIntoNotes(
  notes: Note[],
  results: { title: string; content: string }[],
  createdAt: number,
  desiredTrailing: number = TRAILING_EMPTY_NOTES,
): Note[] {
  if (results.length === 0) return notes;
  const sorted = sortedNotes(notes);
  // 末尾から連続する白紙ノートのidを、表示順(上→下)に並べて集める。
  const trailingBlankIds: string[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].content.trim() === "") trailingBlankIds.unshift(sorted[i].id);
    else break;
  }
  let result = [...notes];
  let nextOrder = sorted.length;
  results.forEach((r, i) => {
    if (i < trailingBlankIds.length) {
      // 白紙ノートを上書き(id/order/pinnedは保つ)。
      result = updateNote(result, trailingBlankIds[i], {
        title: r.title || result.find((n) => n.id === trailingBlankIds[i])?.title || "",
        content: r.content,
        updatedAt: createdAt,
      });
    } else {
      const fallback = nextNoteLetterTitle(result.map((n) => n.title)) ?? "貼り付け";
      const note = createNote(r.title || fallback, nextOrder, createdAt);
      result = [...result, { ...note, content: r.content }];
      nextOrder += 1;
    }
  });
  return ensureTrailingEmptyNotes(result, desiredTrailing, createdAt);
}
