// nativeMessaging.test.ts — nativeMessaging.ts(Flow Launcher native messagingクライアント)の単体テスト
import { afterEach, describe, expect, it, vi } from "vitest";
import { NATIVE_HOST_NAME, pullPendingFile } from "./nativeMessaging";

afterEach(() => {
  vi.unstubAllGlobals();
});

type FakePort = {
  port: chrome.runtime.Port;
  emitMessage: (msg: unknown) => void;
  emitDisconnect: (lastErrorMessage?: string) => void;
  sentMessages: unknown[];
};

function makeFakePort(): FakePort {
  const messageListeners: ((msg: unknown) => void)[] = [];
  const disconnectListeners: (() => void)[] = [];
  const sentMessages: unknown[] = [];
  const port = {
    postMessage: (msg: unknown) => sentMessages.push(msg),
    disconnect: () => {},
    onMessage: { addListener: (fn: (msg: unknown) => void) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn: () => void) => disconnectListeners.push(fn) },
    name: NATIVE_HOST_NAME,
  } as unknown as chrome.runtime.Port;

  return {
    port,
    sentMessages,
    emitMessage: (msg) => messageListeners.forEach((fn) => fn(msg)),
    emitDisconnect: (lastErrorMessage) => {
      vi.stubGlobal("chrome", {
        runtime: { lastError: lastErrorMessage ? { message: lastErrorMessage } : undefined },
      });
      disconnectListeners.forEach((fn) => fn());
    },
  };
}

describe("pullPendingFile", () => {
  it("no-pending-fileならnullを返し、pull要求メッセージを送る", async () => {
    const fake = makeFakePort();
    const promise = pullPendingFile(() => fake.port);
    fake.emitMessage({ type: "no-pending-file" });
    expect(await promise).toBeNull();
    expect(fake.sentMessages).toEqual([{ type: "pull-pending-file" }]);
  });

  it("単一チャンクを再構成してファイルを返し、ackを送る", async () => {
    const fake = makeFakePort();
    const promise = pullPendingFile(() => fake.port);
    fake.emitMessage({
      type: "file-chunk",
      requestId: "req-1",
      seq: 0,
      total: 1,
      name: "メモ.txt",
      data: "こんにちは",
    });
    expect(await promise).toEqual({ name: "メモ.txt", content: "こんにちは" });
    expect(fake.sentMessages).toContainEqual({ type: "ack", requestId: "req-1" });
  });

  it("複数チャンクを順不同で受け取っても正しい順序で結合する", async () => {
    const fake = makeFakePort();
    const promise = pullPendingFile(() => fake.port);
    fake.emitMessage({ type: "file-chunk", requestId: "req-2", seq: 1, total: 2, data: "world" });
    fake.emitMessage({
      type: "file-chunk",
      requestId: "req-2",
      seq: 0,
      total: 2,
      name: "big.txt",
      data: "hello ",
    });
    expect(await promise).toEqual({ name: "big.txt", content: "hello world" });
  });

  it("connectNativeが例外を投げれば(host未インストール等)nullを返す", async () => {
    const result = await pullPendingFile(() => {
      throw new Error("not installed");
    });
    expect(result).toBeNull();
  });

  it("メッセージ無しで切断されれば(host側の問題)nullを返す", async () => {
    const fake = makeFakePort();
    const promise = pullPendingFile(() => fake.port);
    fake.emitDisconnect("Specified native messaging host not found.");
    expect(await promise).toBeNull();
  });
});
