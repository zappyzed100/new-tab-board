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
export type HistoryHit = {
  note_id: string;
  title: string | null;
  timestamp: number;
  snippet: string;
};
type SearchResult = { type: "search-result"; ok: boolean; rows?: HistoryHit[]; error?: string };
type RebuildResult = {
  type: "rebuild-result";
  ok: boolean;
  notes?: number;
  snapshots?: number;
  error?: string;
};
type ListTreeResult = { type: "list-tree-result"; ok: boolean; files?: string[]; error?: string };
type HostResponse =
  | ProbeResult
  | WriteResult
  | ReadResult
  | SearchResult
  | RebuildResult
  | ListTreeResult
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

/** NAS上の検索索引(data/index.db)を .md と履歴 .txt から作り直す。件数を返す(失敗はnull)。 */
export async function rebuildNasIndex(
  path: string,
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<{ notes: number; snapshots: number } | null> {
  const result = await callHost({ type: "rebuild-index", path }, connectNative);
  if (result?.type === "rebuild-result" && result.ok) {
    return { notes: result.notes ?? 0, snapshots: result.snapshots ?? 0 };
  }
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
