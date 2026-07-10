// nativeMessaging.ts — Flow Launcher連携: native messaging hostからファイルをpullする
// 拡張側クライアント(SPEC.md §4.10-d)。host本体(Flow Launcherのフォーク)は別リポジトリで
// 実装される——通信規約は docs/native-messaging-protocol.md を正本とする。
//
// pull型にする理由: MV3のservice workerは寝るため「hostが拡張を叩く」設計は不安定。
// host側が新規タブを開き、拡張側から接続しに行く(このモジュールの役割)。
import { logOp } from "../runtime/log";

export const NATIVE_HOST_NAME = "com.newtabboard.flow_launcher_bridge";

type ChunkMessage = {
  type: "file-chunk";
  requestId: string;
  seq: number;
  total: number;
  name?: string;
  data: string;
};
type NoPendingMessage = { type: "no-pending-file" };
type IncomingMessage = ChunkMessage | NoPendingMessage;

export type ConnectNativeFn = (application: string) => chrome.runtime.Port;

/** hostへ接続し、待機中のファイル(あれば)をpullして返す。host未導入/エラー時はnull。 */
export function pullPendingFile(
  connectNative: ConnectNativeFn = (app) => chrome.runtime.connectNative(app),
): Promise<{ name: string; content: string } | null> {
  return new Promise((resolve) => {
    let port: chrome.runtime.Port;
    try {
      port = connectNative(NATIVE_HOST_NAME);
    } catch (err) {
      logOp("nativeMessaging", "connect-error", String(err), { error: err });
      resolve(null);
      return;
    }

    const chunks = new Map<number, string>();
    let fileName: string | undefined;
    let expectedTotal: number | undefined;
    let settled = false;

    function finish(result: { name: string; content: string } | null) {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {
        // 既に切断済み等は無視(disconnect自体は冪等な後始末のため)
      }
      resolve(result);
    }

    port.onMessage.addListener((message: IncomingMessage) => {
      if (message.type === "no-pending-file") {
        logOp("nativeMessaging", "pull", "no pending file");
        finish(null);
        return;
      }
      if (message.type === "file-chunk") {
        if (message.name) fileName = message.name;
        expectedTotal = message.total;
        chunks.set(message.seq, message.data);
        if (expectedTotal !== undefined && chunks.size >= expectedTotal) {
          const content = Array.from({ length: expectedTotal }, (_, i) => chunks.get(i) ?? "").join(
            "",
          );
          port.postMessage({ type: "ack", requestId: message.requestId });
          logOp("nativeMessaging", "pull", `name=${fileName ?? "(不明)"} chunks=${expectedTotal}`);
          finish(fileName ? { name: fileName, content } : null);
        }
      }
    });

    port.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        logOp("nativeMessaging", "disconnect", lastError.message ?? "unknown error");
      }
      finish(null);
    });

    port.postMessage({ type: "pull-pending-file" });
  });
}
