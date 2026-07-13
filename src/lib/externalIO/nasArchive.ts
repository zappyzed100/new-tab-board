// nasArchive.ts — SSD一次退避(IndexedDB)→NAS本archiveのstore-and-forward(SPEC.md §4.3)
//
// 安全条件: NAS書き込みを検証してからしかSSD側を消さない(データが0箇所になる瞬間を作らない)。
// 冪等(archived済みスナップショットはスキップ)。
//
// 以前はshowDirectoryPicker()で得たFileSystemDirectoryHandleを使っていたが、Chrome
// 拡張機能のページから呼ぶと選択後もAbortErrorになる既知のChromiumバグ
// (WICG/file-system-access#314、crbug.com/issues/40240444)が実機で解消できず
// (エラーメッセージすら出ない無反応のままだった)、ユーザー指示によりNative
// Messaging(native-host/nas_bridge.py)経由の書き込みへ置き換えた。NASフォルダは
// パス文字列(例: "Z:\\NAS\\backup")で指定する——契約はdocs/nas-native-messaging-protocol.md。
//
// NAS上のファイルは「そのままエディタで開いて読めるプレーンテキスト」で保存する
// (ユーザー指示)。IndexedDB側のsnapshot.contentはgzip+base64だが、NASへ書く直前に
// gzipDecompressして生テキストにする。読み戻し(getSnapshotBody)は呼び出し側が
// gzipDecompressする契約なので、NASの生テキストをgzipCompressし直して圧縮base64へ
// 正規化して返す(呼び出し側UIは無変更)。
// レイアウトは 年/月/日/ のフォルダ階層(例: 2026/7/12/<noteId>-<timestamp>-<id>.txt。
// 月・日はゼロ埋めしない——ユーザー指示)。ネイティブホストが親フォルダを自動生成する。
import { logOp } from "../runtime/log";
import { gzipCompress, gzipDecompress } from "../history/gzip";
import { getAllSnapshots, getNasFolderPath, markSnapshotArchived } from "../storage/db";
import { loadLocalData } from "../storage/storage";
import {
  deleteFileFromNas,
  listNasTree,
  probeNasPath,
  readFileFromNas,
  writeFileToNas,
} from "./nasNativeHost";
import type { Note, Snapshot } from "../../types";

/** YAMLスカラーとして安全な表現にする(front matter用)。特殊文字・空・数値見えは二重引用符で囲む。
 * 書き込み側(ここ)と読み込み側(native-host/build_index.py)で同じ規則を守る。 */
function yamlScalar(value: string): string {
  const oneLine = value.replace(/\r?\n/g, " ");
  const needsQuote =
    oneLine === "" ||
    /^[\s]|[\s]$/.test(oneLine) ||
    /[:#\-?[\]{}&*!|>'"%@`,]/.test(oneLine) ||
    /^[\d.]+$/.test(oneLine);
  if (!needsQuote) return oneLine;
  return `"${oneLine.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** ノートを「YAML front matter + Markdown本文」の.md文字列にする(タグ検索の正本形式・ユーザー設計)。 */
export function noteToMarkdown(note: Note): string {
  const fm: string[] = ["---", `id: ${note.id}`, `title: ${yamlScalar(note.title)}`];
  if (note.tags && note.tags.length > 0) {
    fm.push("tags:");
    for (const tag of note.tags) fm.push(`  - ${yamlScalar(tag)}`);
  } else {
    fm.push("tags: []");
  }
  if (note.createdAt) fm.push(`created_at: ${new Date(note.createdAt).toISOString()}`);
  if (note.updatedAt) fm.push(`updated_at: ${new Date(note.updatedAt).toISOString()}`);
  // 世代pull(タブをNAS activeで上書き)で並び順/ピン/済みを復元するため front matter に出す
  // (数値・真偽はyamlScalarを通さず素で書く——build_index.pyは未知キーを無視するので安全)。
  fm.push(`order: ${note.order}`);
  if (note.pinned) fm.push("pinned: true");
  if (note.done) fm.push("done: true");
  if (note.special) fm.push("special: true");
  if (note.specialFolder) fm.push(`special_folder: ${yamlScalar(note.specialFolder)}`);
  if (note.sourceNoteId) fm.push(`source_note_id: ${note.sourceNoteId}`);
  if (note.generatedBy) fm.push(`generated_by: ${yamlScalar(note.generatedBy)}`);
  fm.push("---");
  // front matterの閉じ --- のあとは空行を1つ入れて本文(慣例)。
  return `${fm.join("\n")}\n\n${note.content}`;
}

/** yamlScalar の逆(front matter値の復元)。両端が二重引用符なら外して \\" と \\\\ を戻す。 */
function yamlUnscalar(value: string): string {
  const s = value.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return s;
}

/** noteToMarkdown が出した .md を Note へ戻す(世代pull=タブをNAS activeで上書きする用)。
 * front matter を最小自前パーサで読む(書き側 yamlScalar/形式と対)。id が無ければ乱数、
 * order/pinned/done 等が無い旧ファイルは既定で補う。tags は "tags: []" か "  - x" の並び。 */
export function markdownToNote(md: string, fallbackOrder = 0): Note {
  const note: Note = {
    id: crypto.randomUUID(),
    title: "",
    content: md,
    pinned: false,
    order: fallbackOrder,
  };
  if (!md.startsWith("---")) return note;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return note;
  const block = md.slice(3, end).replace(/^\n+/, "");
  note.content = md.slice(end + 4).replace(/^\n\n/, ""); // 閉じ --- の後の区切り空行を落とす
  const lines = block.split("\n");
  const tags: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("tags:")) {
      // 続く "  - x" 行を集める(tags: [] / 空なら無し)。
      while (i + 1 < lines.length && lines[i + 1].trimStart().startsWith("- ")) {
        tags.push(yamlUnscalar(lines[++i].trimStart().slice(2)));
      }
      continue;
    }
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === "id") note.id = value || note.id;
    else if (key === "title") note.title = yamlUnscalar(value);
    else if (key === "created_at") {
      const t = Date.parse(value);
      if (!Number.isNaN(t)) note.createdAt = t;
    } else if (key === "updated_at") {
      const t = Date.parse(value);
      if (!Number.isNaN(t)) note.updatedAt = t;
    } else if (key === "order") {
      const n = Number(value);
      if (!Number.isNaN(n)) note.order = n;
    } else if (key === "pinned") note.pinned = value === "true";
    else if (key === "done") note.done = value === "true";
    else if (key === "special") note.special = value === "true";
    else if (key === "special_folder") note.specialFolder = yamlUnscalar(value);
    else if (key === "source_note_id") note.sourceNoteId = value;
    else if (key === "generated_by") note.generatedBy = yamlUnscalar(value);
  }
  if (tags.length > 0) note.tags = tags;
  return note;
}

/** ノート1件を正本 notes/<id>.md としてNASへ書き出す。NAS未設定/到達不可は静かにfalse。 */
export async function writeNoteMarkdownToNas(note: Note, deps: NasDeps = {}): Promise<boolean> {
  const _getNasFolderPath = deps.getNasFolderPath ?? getNasFolderPath;
  const _writeFileToNas = deps.writeFileToNas ?? writeFileToNas;
  const path = await _getNasFolderPath();
  if (!path) return false;
  return _writeFileToNas(path, `notes/${note.id}.md`, noteToMarkdown(note));
}

/** NAS上の相対パス。スナップショットのtimestampのローカル日付でフォルダ分けする。 */
function archivePathFor(snapshot: Snapshot): string {
  const d = new Date(snapshot.timestamp);
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // ゼロ埋めしない(ユーザー指示: 「7」「12」フォルダ)
  const day = d.getDate();
  return `${y}/${m}/${day}/${snapshot.noteId}-${snapshot.timestamp}-${snapshot.id}.txt`;
}

type NasDeps = {
  getNasFolderPath?: () => Promise<string | undefined>;
  probeNasPath?: typeof probeNasPath;
  writeFileToNas?: typeof writeFileToNas;
  readFileFromNas?: typeof readFileFromNas;
  deleteFileFromNas?: typeof deleteFileFromNas;
  listNasTree?: typeof listNasTree;
  /** ゴミ(junk)と判定されたノートIDの集合。これらのノートのスナップショットはNASへ書かない。 */
  getJunkNoteIds?: () => Promise<Set<string>>;
};

/** 現在時刻のローカル日付フォルダ "YYYY/M/D"(月・日はゼロ埋めしない——統一構造の書式)。 */
function dateFolder(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** ノート1件を統一構造でNASへ書く: active/<id>.md と <YYYY/M/D>/<id>.md(md + front matter)。
 * 非空ノートのみ(空はactiveへ入れない——ユーザー指示)。NAS未設定/到達不可は静かにfalse。 */
export async function writeNoteToNasStructure(
  note: Note,
  now: number,
  deps: NasDeps = {},
): Promise<boolean> {
  if (note.content.trim() === "") return false;
  const _getNasFolderPath = deps.getNasFolderPath ?? getNasFolderPath;
  const _writeFileToNas = deps.writeFileToNas ?? writeFileToNas;
  const path = await _getNasFolderPath();
  if (!path) return false;
  const md = noteToMarkdown(note);
  const okActive = await _writeFileToNas(path, `active/${note.id}.md`, md);
  const okDate = await _writeFileToNas(path, `${dateFolder(now)}/${note.id}.md`, md);
  return okActive && okDate;
}

/** active/ を現在の非空ノート一覧へ突き合わせ、消えた/空になった/ゴミ判定のノートの
 * active/<id>.md を削除する(ブラウザで消えたらNASからも消す——ユーザー指示)。削除件数を返す。 */
export async function reconcileActiveNotesOnNas(
  notes: Note[],
  deps: NasDeps = {},
): Promise<number> {
  const _getNasFolderPath = deps.getNasFolderPath ?? getNasFolderPath;
  const _listNasTree = deps.listNasTree ?? listNasTree;
  const _deleteFileFromNas = deps.deleteFileFromNas ?? deleteFileFromNas;
  const path = await _getNasFolderPath();
  if (!path) return 0;
  const keep = new Set(
    notes.filter((n) => n.content.trim() !== "" && !n.junk).map((n) => `${n.id}.md`),
  );
  const files = await _listNasTree(path, "active");
  if (files === null) return 0;
  let deleted = 0;
  for (const f of files) {
    // active/ 直下のファイルのみ対象(サブフォルダは想定しない)。現在の非空ノートに無ければ削除。
    if (!f.includes("/") && !keep.has(f)) {
      if (await _deleteFileFromNas(path, `active/${f}`)) deleted += 1;
    }
  }
  logOp("nasArchive", "reconcile-active", `deleted=${deleted}`);
  return deleted;
}

/** Geminiのタグ付けで junk 判定されたノートIDの集合(NASアーカイブから除外する——ユーザー指示)。 */
async function defaultGetJunkNoteIds(): Promise<Set<string>> {
  const local = await loadLocalData();
  return new Set(local.notes.filter((n) => n.junk).map((n) => n.id));
}

/** 1件をNASへ「プレーンテキスト」で書き込み、再読込して内容が一致することを検証する
 * (サイズだけでなく全文比較)。IndexedDB側のcontentはgzip+base64なので書く直前に展開する。 */
export async function flushSnapshotToNas(
  path: string,
  snapshot: Snapshot,
  deps: NasDeps = {},
): Promise<boolean> {
  if (snapshot.content === undefined) return false; // 既に本体が無い(二重フラッシュ防御)
  const _writeFileToNas = deps.writeFileToNas ?? writeFileToNas;
  const _readFileFromNas = deps.readFileFromNas ?? readFileFromNas;
  const relPath = archivePathFor(snapshot);
  try {
    const plain = await gzipDecompress(snapshot.content);
    const ok = await _writeFileToNas(path, relPath, plain);
    if (!ok) return false;
    const written = await _readFileFromNas(path, relPath);
    return written === plain;
  } catch (err) {
    // contentが壊れたgzip等でdecompressに失敗しても、flushAll全体を巻き込まない。
    logOp("nasArchive", "flush-snapshot-error", relPath, { error: err });
    return false;
  }
}

/** NASフォルダのパスが設定・到達可能なら、未アーカイブの全スナップショットをフラッシュする。 */
export async function flushAllToNas(
  deps: NasDeps = {},
): Promise<{ flushed: number; failed: number }> {
  const _getNasFolderPath = deps.getNasFolderPath ?? getNasFolderPath;
  const _probeNasPath = deps.probeNasPath ?? probeNasPath;
  const path = await _getNasFolderPath();
  if (!path) return { flushed: 0, failed: 0 };

  if (!(await _probeNasPath(path))) {
    logOp("nasArchive", "probe-failed", path);
    return { flushed: 0, failed: 0 };
  }

  // ゴミ判定されたノートのスナップショットはNASへ書かない(ユーザー指示)。
  const junkNoteIds = await (deps.getJunkNoteIds ?? defaultGetJunkNoteIds)();
  const pending = (await getAllSnapshots()).filter(
    (s) => !s.archived && s.content !== undefined && !junkNoteIds.has(s.noteId),
  );
  let flushed = 0;
  let failed = 0;
  for (const snapshot of pending) {
    const ok = await flushSnapshotToNas(path, snapshot, deps);
    if (ok) {
      await markSnapshotArchived(snapshot.id, archivePathFor(snapshot));
      flushed++;
    } else {
      failed++;
    }
  }
  logOp("nasArchive", "flush-all", `flushed=${flushed} failed=${failed}`);
  return { flushed, failed };
}

/** archived済みスナップショットの本文をNASから読み戻す(オフライン時はnull)。 */
export async function readArchivedSnapshot(
  archivePath: string,
  deps: NasDeps = {},
): Promise<string | null> {
  const _getNasFolderPath = deps.getNasFolderPath ?? getNasFolderPath;
  const _readFileFromNas = deps.readFileFromNas ?? readFileFromNas;
  const path = await _getNasFolderPath();
  if (!path) return null;
  const content = await _readFileFromNas(path, archivePath);
  if (content === null) {
    logOp("nasArchive", "read-error", archivePath);
  }
  return content;
}

/** archived済み/未archivedを問わず、スナップショットの本文を「gzip+base64の圧縮文字列」で返す
 * (呼び出し側SearchPanel/HistoryPanelがgzipDecompressする契約)。
 * NASオフライン等で読めなければnull(呼び出し側はdegrade表示する — SPEC.md §4.3)。 */
export async function getSnapshotBody(
  snapshot: Snapshot,
  deps: NasDeps = {},
): Promise<string | null> {
  if (snapshot.content !== undefined) return snapshot.content; // ローカルは既に圧縮base64
  if (snapshot.archived && snapshot.archivePath) {
    const raw = await readArchivedSnapshot(snapshot.archivePath, deps);
    if (raw === null) return null;
    // 新形式(.txt)はNAS上プレーンテキストなので圧縮base64へ正規化して返す。
    // 旧形式(.snapshot)は既に圧縮base64で書かれているためそのまま(後方互換)。
    return snapshot.archivePath.endsWith(".txt") ? await gzipCompress(raw) : raw;
  }
  return null;
}
