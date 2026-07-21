// nasNativeHost.ts — NASブリッジ native messaging hostの拡張側クライアント(SPEC.md §4.3)
// showDirectoryPicker()のChromium既知バグ(WICG/file-system-access#314、
// crbug.com/issues/40240444)を回避するため、PC側に常駐する別プログラム
// (native-host/nas_bridge.py)と標準入出力でJSON通信し、任意のフォルダパスへ
// 読み書きする。契約: docs/nas-native-messaging-protocol.md。
//
// Flow Launcher連携(nativeMessaging.ts)と違い、各操作は接続→1メッセージ送信→
// 1メッセージ受信→切断、の1往復で完結する(チャンク分割は行わない——NASの
// スナップショット本文はnative messagingの1メッセージ上限(約1MB)を通常超えない)。
import { logOp } from "../runtime/log";

export const NAS_HOST_NAME = "com.newtabboard.nas_bridge";

export type ConnectNativeFn = (application: string) => chrome.runtime.Port;

type ProbeResult = { type: "probe-result"; ok: boolean; error?: string };
type WriteResult = { type: "write-result"; ok: boolean; error?: string };
type ReadResult = { type: "read-result"; ok: boolean; content?: string; error?: string };
type DeleteResult = { type: "delete-result"; ok: boolean; error?: string };
export type HistoryHit = {
  note_id: string;
  title: string | null;
  timestamp: number;
  snippet: string;
};
type SearchResult = { type: "search-result"; ok: boolean; rows?: HistoryHit[]; error?: string };
/** search-notes の1件。検索結果をノートへ貼り付けるため content(全文)も返る。
 * archived_date は日次アーカイブ(YYYY/M/D)由来の行にだけ入る(現行notesはnull)。 */
export type NoteHit = {
  note_id: string;
  title: string | null;
  created_at: string | null;
  content: string;
  snippet: string;
  archived_date: string | null;
};
type SearchNotesResult = {
  type: "search-notes-result";
  ok: boolean;
  rows?: NoteHit[];
  error?: string;
};
export type TagCount = { tag: string; count: number };
type TopTagsResult = { type: "top-tags-result"; ok: boolean; tags?: TagCount[]; error?: string };
type RebuildResult = {
  type: "rebuild-result";
  ok: boolean;
  notes?: number;
  dateNotes?: number;
  snapshots?: number;
  error?: string;
};
type ListTreeResult = { type: "list-tree-result"; ok: boolean; files?: string[]; error?: string };
type GenerationResult = {
  type: "generation-result";
  ok: boolean;
  generation?: number;
  stale?: boolean;
  error?: string;
};
/** read-active の1件(active/<id>.md のファイル名とmd内容)。pull(タブ上書き)で使う。 */
export type ActiveFile = { filename: string; content: string };
type ReadActiveResult = {
  type: "read-active-result";
  ok: boolean;
  files?: ActiveFile[];
  error?: string;
};
type HostResponse =
  | ProbeResult
  | WriteResult
  | ReadResult
  | DeleteResult
  | SearchResult
  | SearchNotesResult
  | TopTagsResult
  | RebuildResult
  | ListTreeResult
  | GenerationResult
  | ReadActiveResult
  | { type: "error"; error: string };

function callHost(
  request: Record<string, unknown>,
  connectNative: ConnectNativeFn,
): Promise<HostResponse | null> {
  return new Promise((resolve) => {
    let port: chrome.runtime.Port;
    try {
      port = connectNative(NAS_HOST_NAME);
    } catch (err) {
      logOp("nasNativeHost", "connect-error", String(err), { error: err });
      resolve(null);
      return;
    }

    let settled = false;
    function finish(result: HostResponse | null) {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {
        // 既に切断済み等は無視(disconnect自体は冪等な後始末のため)
      }
      resolve(result);
    }

    port.onMessage.addListener((message: HostResponse) => finish(message));
    port.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        logOp("nasNativeHost", "disconnect", lastError.message ?? "unknown error");
      }
      finish(null);
    });
    port.postMessage(request);
  });
}

/** NASフォルダへの到達性を確認する(host未導入/パス到達不可でfalse)。 */
export async function probeNasPath(
  path: string,
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<boolean> {
  const result = await callHost({ type: "probe", path }, connectNative);
  return result?.type === "probe-result" && result.ok;
}

/** 指定フォルダへファイルを書き込む(成功/失敗をboolean で返す)。 */
export async function writeFileToNas(
  path: string,
  filename: string,
  content: string,
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<boolean> {
  const result = await callHost({ type: "write-file", path, filename, content }, connectNative);
  return result?.type === "write-result" && result.ok;
}

/** 指定フォルダのファイルを読み込む(host未導入/読み込み失敗でnull)。 */
export async function readFileFromNas(
  path: string,
  filename: string,
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<string | null> {
  const result = await callHost({ type: "read-file", path, filename }, connectNative);
  if (result?.type === "read-result" && result.ok && result.content !== undefined) {
    return result.content;
  }
  return null;
}

/** 指定フォルダのファイルを削除する(ブラウザで消えた/空になったノートを active/ から消す用)。
 * 既に無い場合も成功(true)。host未導入/失敗はfalse。 */
export async function deleteFileFromNas(
  path: string,
  filename: string,
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<boolean> {
  const result = await callHost({ type: "delete-file", path, filename }, connectNative);
  return result?.type === "delete-result" && result.ok;
}

/** NAS上の検索索引(data/index.db)を .md(active・日付フォルダ)と履歴 .txt から作り直す。
 * 件数を返す(失敗はnull)。 */
export async function rebuildNasIndex(
  path: string,
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<{ notes: number; dateNotes: number; snapshots: number } | null> {
  const result = await callHost({ type: "rebuild-index", path }, connectNative);
  if (result?.type === "rebuild-result" && result.ok) {
    return {
      notes: result.notes ?? 0,
      dateNotes: result.dateNotes ?? 0,
      snapshots: result.snapshots ?? 0,
    };
  }
  return null;
}

/** NASの現在の世代番号を読む(タブ↔active同期。未接続/失敗はnull)。 */
export async function readNasGeneration(
  path: string,
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<number | null> {
  const result = await callHost({ type: "read-generation", path }, connectNative);
  if (result?.type === "generation-result" && result.ok) return result.generation ?? 0;
  return null;
}

/** bumpNasGeneration の結果。ok:true=所有権取得成功(新世代)。ok:false,stale:true=CAS不一致
 * (呼び出し側のexpectedがもう古い。現在世代を返すのでまずpullしてから再試行する)。 */
export type BumpGenerationResult =
  | { ok: true; generation: number }
  | { ok: false; stale: true; generation: number }
  | { ok: false; stale: false };

/** 世代番号を、呼び出し側が知っている現在値(expected)と一致する場合のみ+1する(CAS)。
 * 操作開始時に所有権を得るために呼ぶ。通信自体の失敗(host未導入等)はnull。
 *
 * **無条件bumpから変更した理由(2026-07-19)**: 複数タブが同時に開いていると、タブAが
 * ノートを削除してbump→push(NASへ反映)した直後、まだAの削除をpullしていないタブBが
 * 何か別の編集をしても無条件bumpでは所有権を奪えてしまい、次のpushでBの持つ古い
 * (削除前の)ノート一覧がNASへ丸ごと書き戻されていた(ユーザー報告「消しても消しても
 * ノートが復活する」)。呼び出し側(App.tsx)はstale応答を受けたらpullActiveFromNasで
 * まずローカルを最新化してから、次の編集で改めてbumpを試みる。 */
export async function bumpNasGeneration(
  path: string,
  expected: number,
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<BumpGenerationResult | null> {
  const result = await callHost({ type: "bump-generation", path, expected }, connectNative);
  if (result?.type !== "generation-result") return null;
  if (result.ok) return { ok: true, generation: result.generation ?? 0 };
  if (result.stale) return { ok: false, stale: true, generation: result.generation ?? 0 };
  return { ok: false, stale: false };
}

/** active/ 直下の .md を全部(ファイル名+内容)読む(pull=タブをNAS activeで上書き)。失敗はnull。 */
export async function readNasActive(
  path: string,
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<ActiveFile[] | null> {
  const result = await callHost({ type: "read-active", path }, connectNative);
  if (result?.type === "read-active-result" && result.ok) return result.files ?? [];
  return null;
}

/** NASの subdir(例: "library")配下の .md を相対パスで列挙する(ライブラリのツリー閲覧用)。失敗はnull。 */
export async function listNasTree(
  path: string,
  subdir: string,
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<string[] | null> {
  const result = await callHost({ type: "list-tree", path, subdir }, connectNative);
  if (result?.type === "list-tree-result" && result.ok) {
    return result.files ?? [];
  }
  return null;
}

/** タグ絞り込み＋本文の部分一致で“履歴”をSQL検索する(Python側で実行)。失敗はnull。 */
export async function searchNasHistory(
  path: string,
  query: { tags?: string[]; text?: string; mode?: "and" | "or" },
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<HistoryHit[] | null> {
  const result = await callHost(
    {
      type: "search",
      path,
      tags: query.tags ?? [],
      text: query.text ?? "",
      mode: query.mode ?? "and",
    },
    connectNative,
  );
  if (result?.type === "search-result" && result.ok) {
    return result.rows ?? [];
  }
  return null;
}

/** NASの索引(index.db)から、タグを頻度降順で取得する(検索UIの上位タグチップ用)。失敗はnull。 */
export async function topNasTags(
  path: string,
  limit = 50,
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<TagCount[] | null> {
  const result = await callHost({ type: "top-tags", path, limit }, connectNative);
  if (result?.type === "top-tags-result" && result.ok) {
    return result.tags ?? [];
  }
  return null;
}

/** NASの“ノート”(現在の.md)を タグ(AND/OR)＋本文(部分一致)＋期間(半開区間 from<=..<to)で
 * SQL検索する(Python側)。貼り付け用に本文全文も返る。from/to は ISO8601 文字列(未指定は無制限)。
 * 期間を指定すると、現行ノートに加えて日次アーカイブ(過去の日付フォルダの内容)も対象になる
 * (該当行は archived_date が入る)。失敗はnull。 */
export async function searchNasNotes(
  path: string,
  query: {
    tags?: string[];
    text?: string;
    mode?: "and" | "or";
    from?: string;
    to?: string;
  },
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<NoteHit[] | null> {
  const result = await callHost(
    {
      type: "search-notes",
      path,
      tags: query.tags ?? [],
      text: query.text ?? "",
      mode: query.mode ?? "and",
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
    },
    connectNative,
  );
  if (result?.type === "search-notes-result" && result.ok) {
    return result.rows ?? [];
  }
  return null;
}
