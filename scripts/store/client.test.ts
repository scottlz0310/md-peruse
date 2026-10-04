import { describe, expect, test } from "bun:test";
import {
  type FetchLike,
  StoreApiError,
  StoreClient,
  type StoreClientOptions,
  waitForCommit,
} from "./client";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const SECRET = "s3cr3t-value";
const TOKEN_URL = "https://login.example/tenant-1/oauth2/token";
const BASE = "https://api.example/v1.0/my";

function setup(
  handler: (call: Call) => Response | Promise<Response>,
  extra: Partial<StoreClientOptions> = {},
) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    const call: Call = {
      url: input,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    };
    calls.push(call);
    return handler(call);
  };
  const client = new StoreClient({
    fetch: fetchFn,
    tenantId: "tenant-1",
    clientId: "client-1",
    clientSecret: SECRET,
    appId: "9P35BW61FN4W",
    baseUrl: BASE,
    tokenUrl: TOKEN_URL,
    ...extra,
  });
  return { client, calls };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

function route(call: Call): Response {
  return call.url === TOKEN_URL
    ? json({ access_token: "tok-1" })
    : json({ ok: true });
}

describe("認証", () => {
  test("クライアント資格情報でトークンを取り、API には Bearer で渡す", async () => {
    const { client, calls } = setup(route);
    await client.getApplication();

    const token = calls[0] as Call;
    expect(token.method).toBe("POST");
    expect(token.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const form = new URLSearchParams(token.body as string);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("client-1");
    expect(form.get("resource")).toBe("https://manage.devcenter.microsoft.com");

    const api = calls[1] as Call;
    expect(api.url).toBe(`${BASE}/applications/9P35BW61FN4W`);
    expect(api.headers.Authorization).toBe("Bearer tok-1");
  });

  test("トークンは 1 回だけ取得して使い回す", async () => {
    const { client, calls } = setup(route);
    await client.getApplication();
    await client.getSubmission("s1");
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });

  test("トークンの取得に失敗しても、シークレットをメッセージに出さない", async () => {
    const { client } = setup(() =>
      json(
        {
          error: "invalid_client",
          error_description: "AADSTS7000215: bad secret\r\nTrace ID: x",
        },
        401,
      ),
    );
    const error = await client.getApplication().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StoreApiError);
    const message = (error as Error).message;
    expect(message).toContain("HTTP 401");
    expect(message).toContain("invalid_client");
    expect(message).toContain("AADSTS7000215");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("Trace ID");
  });
});

describe("申請の呼び出し", () => {
  test.each([
    [
      "getApplication",
      (c: StoreClient) => c.getApplication(),
      "GET",
      "applications/9P35BW61FN4W",
    ],
    [
      "getSubmission",
      (c: StoreClient) => c.getSubmission("s1"),
      "GET",
      "applications/9P35BW61FN4W/submissions/s1",
    ],
    [
      "createSubmission",
      (c: StoreClient) => c.createSubmission(),
      "POST",
      "applications/9P35BW61FN4W/submissions",
    ],
    [
      "commit",
      (c: StoreClient) => c.commit("s1"),
      "POST",
      "applications/9P35BW61FN4W/submissions/s1/commit",
    ],
    [
      "getStatus",
      (c: StoreClient) => c.getStatus("s1"),
      "GET",
      "applications/9P35BW61FN4W/submissions/s1/status",
    ],
  ])("%s", async (_name, call, method, path) => {
    const { client, calls } = setup(route);
    await call(client);
    const api = calls[1] as Call;
    expect(api.method).toBe(method);
    expect(api.url).toBe(`${BASE}/${path}`);
  });

  test("更新は申請の JSON 全体を PUT する", async () => {
    const { client, calls } = setup(route);
    await client.updateSubmission({
      id: "s1",
      targetPublishMode: "Manual",
      listings: {},
      applicationPackages: [],
    });
    const api = calls[1] as Call;
    expect(api.method).toBe("PUT");
    expect(api.url).toBe(`${BASE}/applications/9P35BW61FN4W/submissions/s1`);
    expect(JSON.parse(api.body as string).targetPublishMode).toBe("Manual");
  });

  test("エラーには、状態コードと相関 ID と経路を含め、トークンは含めない", async () => {
    const { client } = setup((call) =>
      call.url === TOKEN_URL
        ? json({ access_token: "tok-1" })
        : new Response("bad request body", {
            status: 400,
            headers: { "MS-CV": "cv123" },
          }),
    );
    const error = await client.createSubmission().catch((e: unknown) => e);
    const message = (error as Error).message;
    expect(message).toContain("POST applications/9P35BW61FN4W/submissions");
    expect(message).toContain("HTTP 400");
    expect(message).toContain("cv123");
    expect(message).toContain("bad request body");
    expect(message).not.toContain("tok-1");
  });
});

describe("ZIP のアップロード", () => {
  const SAS = "https://blob.example/container/file?sv=1&sig=SUPER-SECRET-SIG";

  test("SAS URL へ BlockBlob として PUT する", async () => {
    const { client, calls } = setup(() => new Response(null, { status: 201 }));
    await client.uploadZip(SAS, new Uint8Array([80, 75]));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(SAS);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.headers["x-ms-blob-type"]).toBe("BlockBlob");
  });

  test("失敗したときのメッセージに、署名つきの URL を含めない", async () => {
    const { client } = setup(() => new Response("denied", { status: 403 }));
    const error = await client
      .uploadZip(SAS, new Uint8Array(1))
      .catch((e: unknown) => e);
    expect((error as Error).message).toContain("HTTP 403");
    expect((error as Error).message).not.toContain("SUPER-SECRET-SIG");
  });
});

describe("呼び出しの記録（trace）", () => {
  /** 呼ぶたびに 25 ms 進む時計。所要時間が決まった値になる。 */
  const clock = () => {
    let time = 1_000;
    return () => {
      time += 25;
      return time;
    };
  };

  test("API の呼び出しごとに、メソッド、パス、状態コード、所要時間、相関 ID を残す", async () => {
    const lines: string[] = [];
    const { client } = setup(
      (call) =>
        call.url === TOKEN_URL
          ? json({ access_token: "tok-1" })
          : new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "MS-CV": "cv-1", "x-ms-request-id": "req-1" },
            }),
      { trace: (line) => lines.push(line), now: clock() },
    );
    await client.getApplication();
    await client.getSubmission("s1");

    expect(lines).toEqual([
      "POST トークン エンドポイント（Azure AD） → HTTP 200（25 ms）",
      "GET applications/9P35BW61FN4W → HTTP 200（25 ms、MS-CV=cv-1, x-ms-request-id=req-1）",
      "GET applications/9P35BW61FN4W/submissions/s1 → HTTP 200（25 ms、MS-CV=cv-1, x-ms-request-id=req-1）",
    ]);
  });

  test("記録に、シークレット、トークン、テナント ID を含めない", async () => {
    const lines: string[] = [];
    const { client } = setup(route, { trace: (line) => lines.push(line) });
    await client.getApplication();
    const all = lines.join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("tok-1");
    expect(all).not.toContain("tenant-1");
  });

  test("失敗した呼び出しも、状態コードを記録する", async () => {
    const lines: string[] = [];
    const { client } = setup(
      (call) =>
        call.url === TOKEN_URL
          ? json({ access_token: "tok-1" })
          : new Response("bad", { status: 400, headers: { "MS-CV": "cv-9" } }),
      { trace: (line) => lines.push(line) },
    );
    await client.createSubmission().catch(() => {});
    expect(lines.at(-1)).toContain(
      "POST applications/9P35BW61FN4W/submissions → HTTP 400",
    );
    expect(lines.at(-1)).toContain("MS-CV=cv-9");
  });

  test("ZIP のアップロードを記録し、署名つき URL は含めない", async () => {
    const lines: string[] = [];
    const sas = "https://blob.example/c/f?sv=1&sig=SUPER-SECRET-SIG";
    const { client } = setup(() => new Response(null, { status: 201 }), {
      trace: (line) => lines.push(line),
    });
    await client.uploadZip(sas, new Uint8Array(3));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("ZIP のアップロード（3 バイト");
    expect(lines[0]).toContain("HTTP 201");
    expect(lines[0]).not.toContain("SUPER-SECRET-SIG");
    expect(lines[0]).not.toContain("blob.example");
  });

  test("trace を渡さなくても動く", async () => {
    const { client } = setup(route);
    expect(await client.getApplication()).toBeDefined();
  });
});

describe("StoreApiError の詳細（失敗の調査用）", () => {
  test("API のエラーは、応答の本文と相関 ID を持つ", async () => {
    const { client } = setup((call) =>
      call.url === TOKEN_URL
        ? json({ access_token: "tok-1" })
        : new Response('{"code":"InvalidParameterValue"}', {
            status: 400,
            headers: { "MS-CV": "cv-7", "request-id": "r-7" },
          }),
    );
    const error = (await client
      .updateSubmission({
        id: "s1",
        targetPublishMode: "Manual",
        listings: {},
        applicationPackages: [],
      })
      .catch((e: unknown) => e)) as StoreApiError;
    expect(error).toBeInstanceOf(StoreApiError);
    expect(error.httpStatus).toBe(400);
    expect(error.responseBody).toBe('{"code":"InvalidParameterValue"}');
    expect(error.correlation).toBe("MS-CV=cv-7, request-id=r-7");
  });

  test("相関 ID が無い応答は、メッセージに「相関 ID なし」と書く", async () => {
    const { client } = setup((call) =>
      call.url === TOKEN_URL
        ? json({ access_token: "tok-1" })
        : new Response("x", { status: 500 }),
    );
    const error = (await client
      .getApplication()
      .catch((e: unknown) => e)) as StoreApiError;
    expect(error.message).toContain("相関 ID なし");
    expect(error.correlation).toBe("");
  });

  test("ZIP のアップロードの失敗も、本文と相関 ID を持つ（署名つき URL は含めない）", async () => {
    const { client } = setup(
      () =>
        new Response("<Error><Code>AuthenticationFailed</Code></Error>", {
          status: 403,
          headers: { "x-ms-request-id": "blob-1" },
        }),
    );
    const error = (await client
      .uploadZip(
        "https://blob.example/f?sig=SUPER-SECRET-SIG",
        new Uint8Array(1),
      )
      .catch((e: unknown) => e)) as StoreApiError;
    expect(error.responseBody).toContain("AuthenticationFailed");
    expect(error.correlation).toBe("x-ms-request-id=blob-1");
    expect(error.message).not.toContain("SUPER-SECRET-SIG");
  });
});

describe("waitForCommit", () => {
  function statuses(...sequence: string[]) {
    let index = 0;
    return {
      getStatus: async () => ({
        status: sequence[Math.min(index++, sequence.length - 1)] as string,
      }),
      reads: () => index,
    };
  }
  const options = (sleeps: number[]) => ({
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    intervalMs: 5000,
    maxAttempts: 3,
  });

  test("CommitStarted を抜けたら、その状態を返す", async () => {
    const sleeps: number[] = [];
    const client = statuses("CommitStarted", "CommitStarted", "PreProcessing");
    expect(await waitForCommit(client, "s1", options(sleeps))).toEqual({
      status: "PreProcessing",
    });
    expect(sleeps).toEqual([5000, 5000]);
  });

  test("最初から CommitStarted でなければ、待たない", async () => {
    const sleeps: number[] = [];
    await waitForCommit(statuses("CommitFailed"), "s1", options(sleeps));
    expect(sleeps).toEqual([]);
  });

  test("上限まで待っても抜けなければ、例外にする", async () => {
    const sleeps: number[] = [];
    await expect(
      waitForCommit(statuses("CommitStarted"), "s1", options(sleeps)),
    ).rejects.toThrow("CommitStarted のままです（申請 s1）");
    expect(sleeps).toHaveLength(3);
  });
});
