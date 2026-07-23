// nasActiveSync.ts — タブ(ブラウザ)とNAS activeの「世代番号」ベース同期(ユーザー指示)。
// 5分毎(+初回編集時に所有権取得)に世代を突き合わせ、push(自分が最新)/pull(NASが新しい)を決める。
//   - 操作開始時: bump-generation で新世代=所有権を得る(nasOwner=true, localGen=新世代)。
//   - NASの世代 == 自分の世代 かつ 所有者: push(activeを上書き + 日付へ追記 + 消えたものを削除)。
//   - NASの世代 > 自分の世代: pull(NAS activeでタブのノートを上書き。最終操作者優先——ユーザー指示)。
import { bumpNasGeneration, readNasActive } from "./nasNativeHost";
import { getNasFolderPath } from "../storage/db";
import {
  isNoteMarkdown,
  markdownToNote,
  noteToMarkdown,
  reconcileActiveNotesOnNas,
  writeNoteToNasStructure,
} from "./nasArchive";
import { contentHash } from "../gemini/tagging";
import type { Note } from "../../types";

/** active/ファイルの書式バージョン。フォーマット(拡張子・構造・mimeType等の保存先メタデータ)を
 * 変えるたびに上げ、ノート本文が無変更でも保存済みハッシュキャッシュ(nasSavedHashes/
 * driveActiveSavedHashes。どちらもsaveLocalData経由でセッションをまたいで永続化される)を
 * 一度だけ無効化して再書き込みさせる。
 *
 * **"1"→"2"(2026-07-16)**: active/の拡張子を.mdから.txtへ変更した際、本文が無変更の
 * 既存ノートは(fpが本文だけのハッシュだったため)保存済み判定でスキップされ続け、旧.mdが
 * リネームされないまま新.txtが一切書かれない不具合になっていた(ユーザー報告「ドライブに退避
 * でactiveにファイルが出力されない」)。
 *
 * **"2"→"3"(2026-07-16)**: Drive側のuploadNoteをmimeType text/plain対応にした修正で、
 * 同じ理由の不具合をもう一度踏んだ——mimeTypeはnoteToMarkdownの中身(fpの計算元)に含まれない
 * Drive側だけのメタデータのため、本文が無変更の既存ノートはuploadNote自体が呼ばれず、
 * 旧mimeType(text/markdown)のDriveファイルが是正されないまま残っていた(ユーザー報告
 * 「iPhoneのDriveアプリで開けない」の後続——日付フォルダに履歴スナップショット.txtが
 * 混ざって見えたことで発覚)。NAS側はmimeTypeの影響を受けないため、この版上げによる
 * 再書き込みは無害な冗長作業になる(内容は変わらず書き直すだけ)。 */
const ACTIVE_FILE_FORMAT_VERSION = "3";

/** ノートの「保存フィンガープリント」= 保存する.md全体のハッシュ(ユーザー指示: ハッシュで保存済みか判定)。
 * noteToMarkdown はタイトル/本文/タグ/order/pinned/done/special等の永続フィールドだけを含む(driveFileId/
 * taggedHash等の揮発フィールドは含まない)ので、これ1つで「保存すべき変化があったか」を捉えられる。
 * ACTIVE_FILE_FORMAT_VERSIONを連結し、書式バージョンが変わったときも変化として検出する。
 *
 * ただし order は除外する(2026-07-16 是正): reorderNotes は並べ替えのたびに**全ノート**の order を
 * 0からの連番へ振り直すため、1回の「上へ」やドラッグ操作だけで全ノートのフィンガープリントが変わり、
 * 本文が1文字も変わっていないのに全ノートが active/日付フォルダへ無駄に再書き込みされていた
 * (ユーザー指摘「順番差し替えただけで作動するけど、順番変えても中身変わらないだろ」)。order は
 * 実際に書き込みが起きた時点の noteToMarkdown には最新値がそのまま入るため、他の理由で再書き込み
 * されれば追従する——常に最新ではなくなるが、内容不変の並べ替えで書き込みが起きないことを優先する。
 * pinned は除外しない: togglePinNote は1ノートだけを更新する独立した操作であり、並べ替えのように
 * 全ノートを巻き込まない正当な内容変化のため。 */
export function noteSaveFingerprint(note: Note): string {
  return contentHash(`${ACTIVE_FILE_FORMAT_VERSION}:${noteToMarkdown({ ...note, order: 0 })}`);
}

export type SyncDecision = "push" | "pull" | "noop";

/** 世代番号と所有権から、今回のtickで push / pull / 何もしない のどれかを決める純関数。
 * - NASの方が新しい(nasGen > localGen)→ pull(常に。最終操作者優先で上書き)。
 * - 自分が所有者で世代一致 → push(自分の変更をNASへ反映)。
 * - それ以外(受動・同世代/自分が先行)→ noop。 */
export function decideActiveSync(localGen: number, nasGen: number, owner: boolean): SyncDecision {
  if (nasGen > localGen) return "pull";
  if (owner && nasGen === localGen) return "push";
  return "noop";
}

/** 二次側(正本でない方)の判定を調整する。NAS/Driveはどちらも「最終操作者優先で集合を丸ごと
 * 置き換える」方式のため、**両方でpullが走ると互いに上書きし合う**(ping-pong)。そこでpullは
 * 正本側へ一本化し、二次側のpullはその回に正本側が機能しなかった時だけ通す。
 *
 * pushは抑止しない——二次側も「そのミラーを見る用途」があり(Driveならスマホからの閲覧、
 * NASならローカルのアーカイブ/全文索引)、止めると片方だけ古くなる。正本側が機能している時に
 * 二次側へpushしても、送る内容は正本由来の正しい集合なので競合しない。
 *
 * どちらを正本にするかは呼び出し側が決める(ユーザー決定・2026-07-20: **Drive優先**。
 * 当初はNAS優先で配線したが、NASのnative hostが動いていない環境が常態で、
 * Drive側のpullが恒常的に抑止されて2台目に何も降りてこなかったため反転した)。 */
export function resolveSecondaryAction(
  decision: SyncDecision,
  primaryAuthoritative: boolean,
): SyncDecision {
  if (decision === "pull" && primaryAuthoritative) return "noop";
  return decision;
}

export type PullDeps = {
  getNasFolderPath?: () => Promise<string | undefined>;
  readNasActive?: typeof readNasActive;
};

/** pull: NAS active の .md を読み、Note[](order昇順)へ復元する。NAS未設定/到達不可はnull。 */
export async function pullActiveFromNas(deps: PullDeps = {}): Promise<Note[] | null> {
  const path = await (deps.getNasFolderPath ?? getNasFolderPath)();
  if (!path) return null;
  const files = await (deps.readNasActive ?? readNasActive)(path);
  if (files === null) return null;
  // active/ 直下には todos.txt 等の非ノート .txt も同居する。ノート(front matter に id:)
  // だけを取り込む——さもないと id 無し=乱数id・title 無し=空の「(名称未設定)」幻ノートが
  // 毎回生成され、order=0 で左上に出る/時刻0同士で競合コピーを生む(2026-07-22 是正。
  // Drive 側 pullActiveFromDrive が noteId 持ちだけを列挙するのと同じ選り分け)。
  const noteFiles = files.filter((f) => isNoteMarkdown(f.content));
  // ファイル名順の index を fallback order にしつつ、front matter の order で最終的に並べる。
  const notes = noteFiles.map((f, i) => markdownToNote(f.content, i));
  notes.sort((a, b) => a.order - b.order);
  return notes;
}

export type ClaimOwnershipDeps = {
  getNasFolderPath?: () => Promise<string | undefined>;
  bumpNasGeneration?: typeof bumpNasGeneration;
  pullActiveFromNas?: typeof pullActiveFromNas;
};

export type ClaimOwnershipResult =
  | { kind: "no-nas" }
  | { kind: "network-error" }
  | { kind: "claimed"; generation: number }
  | { kind: "stale"; generation: number; pulledNotes: Note[] | null };

/** 操作開始時にNAS世代の所有権を得ようとする(markUserEditから呼ぶ)。CAS(bumpNasGeneration)が
 * stale(呼び出し側のlocalGenがもう古い=他タブが既に世代を進めていた)を返したら、無条件で
 * 所有権を主張せず、まずpullしてNASの最新状態を取り込む。
 *
 * **これが無いと起きていた実害(2026-07-19是正)**: タブAがノートを削除してbump→push
 * した直後、まだAの削除をpullしていないタブBが何か別の編集をすると、旧実装(無条件bump)
 * ではBも無条件で所有権を得てしまい、次のpushでBが持つ古い(削除前の)ノート一覧が
 * NASへ丸ごと書き戻される——Aの削除がロールバックされ「消しても消してもノートが
 * 復活する」という不具合になっていた。 */
export async function claimNasOwnership(
  localGen: number,
  deps: ClaimOwnershipDeps = {},
): Promise<ClaimOwnershipResult> {
  const path = await (deps.getNasFolderPath ?? getNasFolderPath)();
  if (!path) return { kind: "no-nas" };
  const result = await (deps.bumpNasGeneration ?? bumpNasGeneration)(path, localGen);
  if (result === null) return { kind: "network-error" };
  if (result.ok) return { kind: "claimed", generation: result.generation };
  if (!result.stale) return { kind: "network-error" }; // stale以外の失敗(パスエラー等)
  const pulledNotes = await (deps.pullActiveFromNas ?? pullActiveFromNas)();
  return { kind: "stale", generation: result.generation, pulledNotes };
}

export type PushDeps = {
  writeNoteToNasStructure?: typeof writeNoteToNasStructure;
  reconcileActiveNotesOnNas?: typeof reconcileActiveNotesOnNas;
};

/** push: 現在の非空・非junkノートを active/<id>.md と 日付フォルダへ書き、消えた/空になった
 * ノートを active から削除する。**保存フィンガープリントが前回と同じノートは書かない**(ユーザー指示:
 * ハッシュで保存済みか判定して無駄な再保存を避ける。日付フォルダも「その日に変わったノート」だけになる)。
 * savedHashes は id→前回保存時のフィンガープリント。更新後のマップと書込件数を返す(呼び出し側が永続化)。
 * NAS未設定なら writeNoteToNasStructure が静かにfalseで0件。 */
export async function pushActiveToNas(
  notes: Note[],
  now: number,
  savedHashes: Record<string, string>,
  deps: PushDeps = {},
): Promise<{ written: number; savedHashes: Record<string, string> }> {
  const _write = deps.writeNoteToNasStructure ?? writeNoteToNasStructure;
  const _reconcile = deps.reconcileActiveNotesOnNas ?? reconcileActiveNotesOnNas;
  const next: Record<string, string> = {};
  let written = 0;
  for (const n of notes) {
    // 空・ゴミ・「この端末のみ(noSync)」は保存対象外(ハッシュも捨てる)。noSync は本文を端末外へ
    // 出さないための除外(reconcile 側でも keep から外し、過去に書いた active ファイルも削除される)。
    if (n.content.trim() === "" || n.junk || n.noSync) continue;
    const fp = noteSaveFingerprint(n);
    if (savedHashes[n.id] === fp) {
      next[n.id] = fp; // 変更なし=保存済み。書かずにハッシュだけ引き継ぐ。
      continue;
    }
    if (await _write(n, now)) {
      next[n.id] = fp;
      written += 1;
    } else if (savedHashes[n.id] !== undefined) {
      next[n.id] = savedHashes[n.id]; // 書けなかった: 旧ハッシュ維持(次回再試行)
    }
  }
  await _reconcile(notes);
  return { written, savedHashes: next };
}
