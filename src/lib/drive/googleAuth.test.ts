// googleAuth.test.ts — googleAuth.ts(launchWebAuthFlowラッパー)の単体テスト
// このモジュールはトークンをメモリ+chrome.storage.localの2層でキャッシュするため、
// テストごとにvi.resetModules()＋動的importで新しいモジュールインスタンスを読み直して
// 隔離する(モジュール状態のテスト間漏れを防ぐ——src/lib/externalIO/CLAUDE.mdの
// 「モジュール状態はテスト間で永続する」の型と同じ)。永続層はテスト側で共有の擬似ストアを
// 渡せるので、「新しいタブ」= モジュール再読み込みだけを差し替えて再現できる。
import { afterEach, describe, expect, it, vi } from "vitest";

type LaunchFn = ReturnType<typeof vi.fn>;

/** chrome.storage.localの最小スタブ。storeを渡し回すことでタブ間共有を再現する。 */
function storageStub(store: Record<string, unknown>) {
  return {
    local: {
      get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      }),
      remove: vi.fn(async (key: string) => {
        delete store[key];
      }),
    },
  };
}

/** chromeスタブを組んでgoogleAuthを新規に読み込む(=新しいタブでの初回読み込み相当)。
 * storeを使い回せば「別タブだが同じchrome.storage.local」を再現できる。 */
async function load(launchWebAuthFlow: LaunchFn, store: Record<string, unknown> = {}) {
  vi.resetModules();
  vi.stubGlobal("chrome", {
    runtime: {
      getManifest: () => ({
        oauth2: {
          client_id: "test-client-id",
          scopes: ["https://scope-a", "https://scope-b"],
        },
      }),
    },
    identity: {
      getRedirectURL: () => "https://ext-id.chromiumapp.org/",
      launchWebAuthFlow,
    },
    storage: storageStub(store),
  });
  return await import("./googleAuth");
}

/** access_token付きのリダイレクトURL(implicitフローの戻り)を作る。 */
function redirectWith(token: string, expiresIn = 3600): string {
  return `https://ext-id.chromiumapp.org/#access_token=${token}&expires_in=${expiresIn}&token_type=Bearer`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAuthToken", () => {
  it("launchWebAuthFlowが返すリダイレクトからaccess_tokenを取り出して返す", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthToken } = await load(launch);
    expect(await getAuthToken(true)).toBe("abc123");
  });

  it("implicitフローのURLで呼ぶ(カスタムURIスキーム回避)", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthToken } = await load(launch);
    await getAuthToken(true);
    const arg = launch.mock.calls[0][0] as { url: string; interactive: boolean };
    expect(arg.interactive).toBe(true);
    const url = new URL(arg.url);
    expect(url.searchParams.get("response_type")).toBe("token");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://ext-id.chromiumapp.org/");
    expect(url.searchParams.get("scope")).toBe("https://scope-a https://scope-b");
  });

  it("非対話時はabortOnLoadForNonInteractive:falseとタイムアウトを渡す(サイレント更新がGoogleのリダイレクト連鎖の途中で打ち切られ`User interaction required`になっていた実機不具合の回帰)", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthToken } = await load(launch);
    await getAuthToken(false);
    const arg = launch.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.abortOnLoadForNonInteractive).toBe(false);
    expect(arg.timeoutMsForNonInteractive).toBeGreaterThan(0);
  });

  it("失敗を診断ログへ流すとき所要時間を添える(タイムアウトかGoogleの即答かをログだけで判別するため・2026-07-29)", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("User interaction required."));
    const auth = await load(launch);
    const { setLogSink } = await import("../runtime/log");
    const entries: { op: string; elapsedMs?: number }[] = [];
    setLogSink((entry) => entries.push({ op: entry.op, elapsedMs: entry.elapsedMs }));
    try {
      await auth.getAuthToken(false);
    } finally {
      setLogSink(null);
    }
    const failure = entries.find((e) => e.op === "getAuthToken-error");
    expect(failure).toBeDefined();
    // 値そのものは環境依存なので「記録されていること」だけを固定する(非決定性を持ち込まない)。
    expect(typeof failure?.elapsedMs).toBe("number");
  });

  it("非対話のタイムアウトは短く保つ(伸ばしても完走しないと実機で確定したため・2026-07-29)", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthToken } = await load(launch);
    await getAuthToken(false);
    const arg = launch.mock.calls[0][0] as Record<string, unknown>;
    // 一度30_000msへ広げたが、実機ログで今度は毎回きっかり30秒で落ちた(同じログで手動接続は
    // 2.7秒で成功)。サイレント認可は待っても通らないので、この値は諦めるまでの無駄時間にすぎない。
    // 伸ばす変更が再び入らないよう上限を固定する。
    expect(arg.timeoutMsForNonInteractive).toBeLessThanOrEqual(10_000);
  });

  it("対話時はabortOnLoadForNonInteractive等を渡さない(ユーザー操作を待つため)", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthToken } = await load(launch);
    await getAuthToken(true);
    const arg = launch.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.abortOnLoadForNonInteractive).toBeUndefined();
    expect(arg.timeoutMsForNonInteractive).toBeUndefined();
  });

  it("対話時はprompt=select_accountを付ける(無操作で完結してinteractive:trueでも`User interaction required`になる回帰・2026-07-27)", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthToken } = await load(launch);
    await getAuthToken(true);
    const arg = launch.mock.calls[0][0] as { url: string };
    expect(new URL(arg.url).searchParams.get("prompt")).toBe("select_account");
  });

  it("非対話時はpromptを付けない(付けると無言の自動更新のたびに操作を要求してしまう)", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthToken } = await load(launch);
    await getAuthToken(false);
    const arg = launch.mock.calls[0][0] as { url: string };
    expect(new URL(arg.url).searchParams.get("prompt")).toBeNull();
  });

  it("回帰: 新しいタブ(モジュール再読み込み)でも認可フローを再実行せず永続トークンを再利用する", async () => {
    // 実害の再現条件そのもの。キャッシュがモジュール変数だけだった頃は、タブを開くたびに
    // 空から始まってサイレント認可が走り、それが失敗してDrive連携が丸ごと停止していた。
    const store: Record<string, unknown> = {};
    const launch = vi.fn().mockResolvedValue(redirectWith("persisted-token", 3600));

    const firstTab = await load(launch, store);
    expect(await firstTab.getAuthToken(true)).toBe("persisted-token");
    expect(launch).toHaveBeenCalledTimes(1);

    const secondTab = await load(launch, store); // 別タブ相当(モジュール状態は空・storeは共有)
    expect(await secondTab.getAuthToken(false)).toBe("persisted-token");
    expect(launch).toHaveBeenCalledTimes(1); // 再認可は走らない
  });

  it("永続トークンが失効していれば取り直す", async () => {
    // expiresAtは固定値(1970-01-01)——現在時刻に対して確実に過去なので、テストは
    // 実行時刻に依存しない(§9.2 test-nondeterminism)。
    const store: Record<string, unknown> = {
      driveAccessToken: { token: "expired", expiresAt: 0 },
    };
    const launch = vi.fn().mockResolvedValue(redirectWith("renewed"));
    const { getAuthToken } = await load(launch, store);
    expect(await getAuthToken(false)).toBe("renewed");
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("永続層が壊れていても落ちず取り直す", async () => {
    const store: Record<string, unknown> = { driveAccessToken: { nonsense: true } };
    const launch = vi.fn().mockResolvedValue(redirectWith("recovered"));
    const { getAuthToken } = await load(launch, store);
    expect(await getAuthToken(false)).toBe("recovered");
  });

  it("同時に呼ばれても認可フローは1回だけ走る(全ペインが同時に同期を始める競合の回帰)", async () => {
    // deferredは先に作る——launch()が呼ばれてからresolverを受け取る書き方だと、
    // テスト側がresolveする時点でまだlaunch()に到達しておらず取りこぼす。
    let resolveLaunch: (value: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      resolveLaunch = resolve;
    });
    const launch = vi.fn(() => pending);
    const { getAuthToken } = await load(launch as unknown as LaunchFn);
    const both = Promise.all([getAuthToken(false), getAuthToken(false)]);
    resolveLaunch(redirectWith("single"));
    expect(await both).toEqual(["single", "single"]);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("リダイレクトにaccess_tokenが無ければnullを返す", async () => {
    const launch = vi.fn().mockResolvedValue("https://ext-id.chromiumapp.org/#error=access_denied");
    const { getAuthToken } = await load(launch);
    expect(await getAuthToken(false)).toBeNull();
  });

  it("例外が投げられても握りつぶしてnullを返す(未サインイン等)", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("The user is not signed in."));
    const { getAuthToken } = await load(launch);
    expect(await getAuthToken(false)).toBeNull();
  });

  it("有効期限内の2回目はlaunchWebAuthFlowを再度呼ばずキャッシュを返す", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123", 3600));
    const { getAuthToken } = await load(launch);
    expect(await getAuthToken(true)).toBe("abc123");
    expect(await getAuthToken(false)).toBe("abc123");
    expect(launch).toHaveBeenCalledTimes(1);
  });
});

describe("getAuthTokenWithError", () => {
  it("取得成功時はtokenを返しerrorはnull", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthTokenWithError } = await load(launch);
    expect(await getAuthTokenWithError(true)).toEqual({ token: "abc123", error: null });
  });

  it("例外時は握りつぶさずerrorにメッセージを返す", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("popup closed by user"));
    const { getAuthTokenWithError } = await load(launch);
    expect(await getAuthTokenWithError(true)).toEqual({
      token: null,
      error: "popup closed by user",
    });
  });

  it("access_tokenが無ければtoken:nullとerrorメッセージを返す", async () => {
    const launch = vi.fn().mockResolvedValue("https://ext-id.chromiumapp.org/#error=access_denied");
    const { getAuthTokenWithError } = await load(launch);
    const result = await getAuthTokenWithError(false);
    expect(result.token).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

describe("getOAuthClientId", () => {
  it("manifest.jsonのoauth2.client_idを返す(pickerOAuth.ts等が使い回すため)", async () => {
    const { getOAuthClientId } = await load(vi.fn());
    expect(getOAuthClientId()).toBe("test-client-id");
  });
});

describe("invalidateToken", () => {
  it("メモリと永続の両方から外し、次回はlaunchWebAuthFlowを再度呼ぶ", async () => {
    const store: Record<string, unknown> = {};
    const launch = vi
      .fn()
      .mockResolvedValueOnce(redirectWith("first"))
      .mockResolvedValueOnce(redirectWith("second"));
    const { getAuthToken, invalidateToken } = await load(launch, store);
    expect(await getAuthToken(true)).toBe("first");
    await invalidateToken("first");
    expect(store.driveAccessToken).toBeUndefined(); // 永続層からも消える
    expect(await getAuthToken(true)).toBe("second");
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("別のトークンを指定された場合は永続トークンを消さない", async () => {
    const store: Record<string, unknown> = {};
    const launch = vi.fn().mockResolvedValue(redirectWith("keep-me"));
    const { getAuthToken, invalidateToken } = await load(launch, store);
    await getAuthToken(true);
    await invalidateToken("someone-elses-token");
    expect(store.driveAccessToken).toBeDefined();
  });
});

describe("invalidateOnAuthError", () => {
  it("HTTP 401を含むエラーならトークンを無効化する", async () => {
    const store: Record<string, unknown> = {};
    const launch = vi
      .fn()
      .mockResolvedValueOnce(redirectWith("first"))
      .mockResolvedValueOnce(redirectWith("second"));
    const { getAuthToken, invalidateOnAuthError } = await load(launch, store);
    expect(await getAuthToken(true)).toBe("first");

    await invalidateOnAuthError(new Error("Drive検索失敗: HTTP 401"), "first");

    expect(store.driveAccessToken).toBeUndefined();
    expect(await getAuthToken(true)).toBe("second");
  });

  it("401以外のエラーではトークンをそのまま残す", async () => {
    const store: Record<string, unknown> = {};
    const launch = vi.fn().mockResolvedValueOnce(redirectWith("first"));
    const { getAuthToken, invalidateOnAuthError } = await load(launch, store);
    expect(await getAuthToken(true)).toBe("first");

    await invalidateOnAuthError(new Error("Drive検索失敗: HTTP 500"), "first");
    await invalidateOnAuthError("network down", "first");

    expect(store.driveAccessToken).toBeDefined();
    expect(await getAuthToken(true)).toBe("first");
    expect(launch).toHaveBeenCalledTimes(1);
  });
});

// 【更新トークン方式 — 2026-07-29】
// implicitフローには更新トークンが無く、失効後の再取得はブラウザの認可フローを無人で走らせる
// しかないが、それがこの環境では通らない(実機ログ: 8秒でも30秒でもタイムアウトし、同じログで
// 手動接続は2.7秒で成功)。authorization codeフローで更新トークンを受け取り、以後はHTTPS POST
// だけで再発行する——ブラウザを一切開かないので無人更新が成立する。
describe("更新トークン方式(client_secretが設定されている場合)", () => {
  /** import.meta.env経由のsecretを差し替えてモジュールを読み直す。 */
  async function loadWithSecret(
    launchWebAuthFlow: LaunchFn,
    fetchImpl: ReturnType<typeof vi.fn>,
    store: Record<string, unknown> = {},
  ) {
    vi.stubEnv("VITE_GOOGLE_CLIENT_SECRET", "test-secret");
    vi.stubGlobal("fetch", fetchImpl);
    return { mod: await load(launchWebAuthFlow, store), store };
  }

  function tokenResponse(body: Record<string, unknown>, ok = true, status = 200) {
    return { ok, status, json: async () => body };
  }

  it("保存済みの更新トークンがあれば、ブラウザを開かずにアクセストークンを再発行する", async () => {
    const launch = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(tokenResponse({ access_token: "renewed", expires_in: 3600 }));
    const { mod } = await loadWithSecret(launch, fetchMock, { driveRefreshToken: "stored-refresh" });

    // 非対話(背景同期と同じ条件)でも通ることが要点。
    expect(await mod.getAuthToken(false)).toBe("renewed");
    // ブラウザの認可フローは一度も呼ばれない——ここが「放置しても切れない」の核心。
    expect(launch).not.toHaveBeenCalled();
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("stored-refresh");
  });

  it("更新トークンが失効(HTTP 400)していたら捨てる(毎回同じ失敗を繰り返さない)", async () => {
    const launch = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse({ error: "invalid_grant" }, false, 400));
    const { mod, store } = await loadWithSecret(launch, fetchMock, {
      driveRefreshToken: "revoked",
    });

    expect(await mod.getAuthToken(false)).toBeNull();
    expect(store.driveRefreshToken).toBeUndefined();
  });

  it("ネットワーク断では更新トークンを捨てない(次につながれば通るため)", async () => {
    const launch = vi.fn();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const { mod, store } = await loadWithSecret(launch, fetchMock, { driveRefreshToken: "keep-me" });

    expect(await mod.getAuthToken(false)).toBeNull();
    expect(store.driveRefreshToken).toBe("keep-me");
  });

  it("更新トークンが無い非対話呼び出しでは、通らないと分かっている無人認可を試さない", async () => {
    const launch = vi.fn();
    const fetchMock = vi.fn();
    const { mod } = await loadWithSecret(launch, fetchMock, {});

    expect(await mod.getAuthToken(false)).toBeNull();
    // 8秒(旧30秒)待って必ず失敗する経路へ入らないこと。
    expect(launch).not.toHaveBeenCalled();
  });

  it("対話接続では認可コードを交換し、更新トークンを保存する", async () => {
    const launch = vi.fn().mockResolvedValue("https://ext-id.chromiumapp.org/?code=auth-code-1");
    const fetchMock = vi.fn().mockResolvedValue(
      tokenResponse({ access_token: "fresh", expires_in: 3600, refresh_token: "new-refresh" }),
    );
    const { mod, store } = await loadWithSecret(launch, fetchMock, {});

    expect(await mod.getAuthToken(true)).toBe("fresh");
    expect(store.driveRefreshToken).toBe("new-refresh");
    const authUrl = new URL((launch.mock.calls[0][0] as { url: string }).url);
    expect(authUrl.searchParams.get("response_type")).toBe("code");
    // この2つが無いとGoogleは更新トークンを返さず、無人更新ができないまま元に戻る。
    expect(authUrl.searchParams.get("access_type")).toBe("offline");
    expect(authUrl.searchParams.get("prompt")).toBe("consent");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code-1");
    expect(body.get("code_verifier")).toBeTruthy();
  });
});
