import { describe, expect, test } from "bun:test";
import {
  type FetchLike,
  isFailureStatus,
  StoreApiError,
  StoreClient,
  type StoreClientOptions,
  waitForIngestion,
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

describe("エラーの本文に秘密値が含まれる場合（発生源で取り除く）", () => {
  const SIG = "SIGNATURE-VALUE-9z";

  test("API のエラー: 本文に、トークン、シークレット、テナント ID、クライアント ID、署名があっても、メッセージと本文から取り除く", async () => {
    const { client } = setup((call) =>
      call.url === TOKEN_URL
        ? json({ access_token: "tok-abcdef" })
        : new Response(
            `denied tok-abcdef secret=${SECRET} tenant tenant-1 client client-1 https://blob/x?sv=1&sig=${SIG} Bearer abc.def`,
            { status: 401 },
          ),
    );
    const error = (await client
      .getApplication()
      .catch((e: unknown) => e)) as StoreApiError;
    for (const text of [error.message, error.responseBody ?? ""]) {
      expect(text).not.toContain("tok-abcdef");
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("tenant-1");
      expect(text).not.toContain("client-1");
      expect(text).not.toContain(SIG);
      expect(text).not.toContain("abc.def");
      expect(text).toContain("denied");
    }
    expect(error.httpStatus).toBe(401);
  });

  test("トークンの取得の失敗: 説明に、シークレットとテナント ID があっても、メッセージから取り除く", async () => {
    const { client } = setup(() =>
      json(
        {
          error: "invalid_client",
          error_description: `AADSTS7000215: bad ${SECRET} for tenant-1\r\nTrace ID: x`,
        },
        401,
      ),
    );
    const error = (await client
      .getApplication()
      .catch((e: unknown) => e)) as StoreApiError;
    expect(error.message).toContain("invalid_client");
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain("tenant-1");
  });

  test("ZIP のアップロードの失敗: 本文の署名を取り除く", async () => {
    const { client } = setup(
      () =>
        new Response(`<Error><Message>sig=${SIG} mismatch</Message></Error>`, {
          status: 403,
        }),
    );
    const error = (await client
      .uploadZip("https://blob.example/f?sig=URLSIG", new Uint8Array(1))
      .catch((e: unknown) => e)) as StoreApiError;
    expect(error.message).not.toContain(SIG);
    expect(error.responseBody).not.toContain(SIG);
    expect(error.responseBody).toContain("mismatch");
  });
});

describe("isFailureStatus", () => {
  test.each([
    ["CommitFailed", true],
    ["PreProcessingFailed", true],
    ["CertificationFailed", true],
    ["ReleaseFailed", true],
    ["PublishFailed", true],
    ["Canceled", true],
    ["CommitStarted", false],
    ["PreProcessing", false],
    ["Certification", false],
    ["Published", false],
  ])("%s は、失敗を示す状態か: %p", (status, expected) => {
    expect(isFailureStatus(status)).toBe(expected);
  });
});

describe("waitForIngestion", () => {
  /** 呼ぶたびに、次の状態を返す。最後の状態は、以降も返し続ける。 */
  function statuses(
    ...sequence: Array<string | { status: string; statusDetails: unknown }>
  ) {
    let index = 0;
    return {
      getStatus: async () => {
        const item = sequence[Math.min(index++, sequence.length - 1)];
        return typeof item === "string"
          ? { status: item }
          : (item as { status: string; statusDetails: unknown });
      },
      reads: () => index,
    };
  }
  const clock = () => {
    let minute = 0;
    return () => new Date(Date.UTC(2026, 9, 4, 1, minute++, 0));
  };
  const options = (sleeps: number[], maxAttempts = 5) => ({
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    intervalMs: 10_000,
    maxAttempts,
    now: clock(),
  });

  test("CommitStarted と PreProcessing を抜けるまで読み、抜けた状態を返す", async () => {
    const sleeps: number[] = [];
    const client = statuses(
      "CommitStarted",
      "PreProcessing",
      "PreProcessing",
      "Certification",
    );
    const result = await waitForIngestion(client, "s1", options(sleeps));
    expect(result.status).toEqual({ status: "Certification" });
    expect(result.timedOut).toBe(false);
    expect(sleeps).toEqual([10_000, 10_000, 10_000]);
  });

  test("読み取るたびに、時刻つきで記録する（タイムライン）", async () => {
    const client = statuses("CommitStarted", "PreProcessing", "Certification");
    const result = await waitForIngestion(client, "s1", options([]));
    expect(result.timeline).toEqual([
      {
        at: "2026-10-04T01:00:00.000Z",
        status: "CommitStarted",
        statusDetails: undefined,
      },
      {
        at: "2026-10-04T01:01:00.000Z",
        status: "PreProcessing",
        statusDetails: undefined,
      },
      {
        at: "2026-10-04T01:02:00.000Z",
        status: "Certification",
        statusDetails: undefined,
      },
    ]);
  });

  test("onStatus を、読み取るたびに呼ぶ", async () => {
    const seen: string[] = [];
    await waitForIngestion(statuses("PreProcessing", "Certification"), "s1", {
      ...options([]),
      onStatus: (entry) => seen.push(entry.status),
    });
    expect(seen).toEqual(["PreProcessing", "Certification"]);
  });

  test("最初から取り込みの途中でなければ、待たない（失敗の状態も、そのまま返す）", async () => {
    const sleeps: number[] = [];
    const details = { errors: [{ code: "X" }] };
    const result = await waitForIngestion(
      statuses({ status: "PreProcessingFailed", statusDetails: details }),
      "s1",
      options(sleeps),
    );
    expect(result.status.status).toBe("PreProcessingFailed");
    expect(result.status.statusDetails).toEqual(details);
    expect(result.timeline[0]?.statusDetails).toEqual(details);
    expect(sleeps).toEqual([]);
  });

  test("上限まで待っても取り込みの途中なら、例外にせず、timedOut で返す（最後の状態と記録つき）", async () => {
    const sleeps: number[] = [];
    const result = await waitForIngestion(
      statuses("PreProcessing"),
      "s1",
      options(sleeps, 3),
    );
    expect(result.timedOut).toBe(true);
    expect(result.status.status).toBe("PreProcessing");
    expect(result.timeline).toHaveLength(3);
    // 最後の読み取りの後は、待たない。
    expect(sleeps).toEqual([10_000, 10_000]);
  });
});
