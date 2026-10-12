import { describe, expect, test } from "bun:test";
import type { FetchLike } from "./client";
import { DropboxApiError, DropboxClient, describeSecretShape } from "./dropbox";

const APP_KEY = "app-key-1234";
const APP_SECRET = "app-secret-5678";
const REFRESH = "refresh-token-abcd";
const ACCESS = "access-token-wxyz";

interface Call {
  url: string;
  init?: RequestInit;
}

function setup(
  handlers: {
    token?: () => Response;
    upload?: () => Response;
    download?: () => Response;
  } = {},
) {
  const calls: Call[] = [];
  const traces: string[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    calls.push({ url: input, init });
    if (input === "https://api.dropbox.com/oauth2/token") {
      return (
        handlers.token?.() ??
        new Response(JSON.stringify({ access_token: ACCESS }))
      );
    }
    if (input === "https://content.dropboxapi.com/2/files/upload") {
      return (
        handlers.upload?.() ??
        new Response(
          JSON.stringify({ path_display: "/usage-daily/a.csv", size: 7 }),
        )
      );
    }
    if (input === "https://content.dropboxapi.com/2/files/download") {
      return handlers.download?.() ?? new Response("a,b\r\n1,2\r\n");
    }
    throw new Error(`想定外の呼び出し: ${input}`);
  };
  const client = new DropboxClient({
    fetch: fetchFn,
    appKey: APP_KEY,
    appSecret: APP_SECRET,
    refreshToken: REFRESH,
    trace: (line) => traces.push(line),
  });
  return { client, calls, traces };
}

describe("DropboxClient.upload", () => {
  test("refresh token でトークンを得て、同じパスを上書きするアップロードをする", async () => {
    const { client, calls, traces } = setup();

    const saved = await client.upload("/usage-daily/a.csv", "a,b\r\n1,2\r\n");

    expect(saved).toEqual({ path: "/usage-daily/a.csv", size: 7 });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.dropbox.com/oauth2/token",
      "https://content.dropboxapi.com/2/files/upload",
    ]);
    const tokenInit = calls[0]?.init;
    expect(tokenInit?.body).toBe(
      `grant_type=refresh_token&refresh_token=${REFRESH}`,
    );
    const tokenHeaders = (tokenInit?.headers ?? {}) as Record<string, string>;
    expect(tokenHeaders.Authorization).toBe(
      `Basic ${Buffer.from(`${APP_KEY}:${APP_SECRET}`).toString("base64")}`,
    );
    const uploadInit = calls[1]?.init;
    const headers = uploadInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${ACCESS}`);
    expect(JSON.parse(headers["Dropbox-API-Arg"] as string)).toEqual({
      path: "/usage-daily/a.csv",
      mode: "overwrite",
      autorename: false,
      mute: true,
    });
    expect(uploadInit?.body).toBe("a,b\r\n1,2\r\n");
    // 記録には、資格情報もファイルの内容も出さない。
    const everything = traces.join("\n");
    for (const secret of [APP_SECRET, REFRESH, ACCESS, "a,b"]) {
      expect(everything).not.toContain(secret);
    }
  });

  test("アクセス トークンは、2 回目以降の書き込みで使い回す", async () => {
    const { client, calls } = setup();
    await client.upload("/usage-daily/a.csv", "x");
    await client.upload("/usage-daily/b.csv", "y");
    expect(calls.filter((c) => c.url.endsWith("/oauth2/token"))).toHaveLength(
      1,
    );
  });

  test.each([
    { name: "接頭辞の外", path: "/other/a.csv" },
    { name: "ルート直下", path: "/a.csv" },
    { name: "接頭辞だけ", path: "/usage-daily/" },
    { name: "親ディレクトリへの参照", path: "/usage-daily/../a.csv" },
    { name: "連続したスラッシュ", path: "/usage-daily//a.csv" },
    { name: "英数字以外の文字（空白）", path: "/usage-daily/a b.csv" },
    { name: "日本語", path: "/usage-daily/日別.csv" },
    { name: "接頭辞が似ている別のフォルダー", path: "/usage-daily-x/a.csv" },
  ])(
    "書き込み先が許可の外（$name）なら、トークンを取る前に拒否する",
    async ({ path }) => {
      const { client, calls } = setup();
      await expect(client.upload(path, "x")).rejects.toThrow(
        "/usage-daily/ の下の",
      );
      expect(calls).toHaveLength(0);
    },
  );

  test("トークンの取得の失敗は、資格情報を含めずに伝える", async () => {
    const { client } = setup({
      token: () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: `bad ${REFRESH} ${APP_SECRET}`,
          }),
          { status: 400 },
        ),
    });
    const error = await client
      .upload("/usage-daily/a.csv", "x")
      .catch((e) => e);
    expect(error).toBeInstanceOf(DropboxApiError);
    expect((error as DropboxApiError).httpStatus).toBe(400);
    expect((error as Error).message).toContain("invalid_grant");
    expect((error as Error).message).not.toContain(REFRESH);
    expect((error as Error).message).not.toContain(APP_SECRET);
  });

  test("トークンの応答に access_token が無ければ、原因が分かる例外にする", async () => {
    const { client } = setup({
      token: () => new Response(JSON.stringify({})),
    });
    await expect(client.upload("/usage-daily/a.csv", "x")).rejects.toThrow(
      "access_token がありません",
    );
  });

  test("アップロードの失敗は、パスと状態コードを示し、トークンを含めない", async () => {
    const { client } = setup({
      upload: () =>
        new Response(`{"error_summary":"missing_scope/ ${ACCESS}"}`, {
          status: 401,
        }),
    });
    const error = await client
      .upload("/usage-daily/a.csv", "x")
      .catch((e) => e);
    expect(error).toBeInstanceOf(DropboxApiError);
    expect((error as Error).message).toContain("/usage-daily/a.csv");
    expect((error as Error).message).toContain("HTTP 401");
    expect((error as Error).message).toContain("missing_scope");
    expect((error as Error).message).not.toContain(ACCESS);
  });

  test("応答に size が無ければ、送ったバイト数を返す", async () => {
    const { client } = setup({ upload: () => new Response("{}") });
    expect(await client.upload("/usage-daily/a.csv", "日本")).toEqual({
      path: "/usage-daily/a.csv",
      size: 6,
    });
  });
});

describe("DropboxClient.download", () => {
  test("トークンを得て、パスを指定してファイルの内容を読む", async () => {
    const { client, calls } = setup();

    const text = await client.download("/usage-daily/merged.csv");

    expect(text).toBe("a,b\r\n1,2\r\n");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.dropbox.com/oauth2/token",
      "https://content.dropboxapi.com/2/files/download",
    ]);
    const headers = (calls[1]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${ACCESS}`);
    expect(JSON.parse(headers["Dropbox-API-Arg"] as string)).toEqual({
      path: "/usage-daily/merged.csv",
    });
  });

  test("ファイルが無い（HTTP 409 と path/not_found）ときは、undefined を返す", async () => {
    const { client } = setup({
      download: () =>
        new Response(
          JSON.stringify({
            error_summary: "path/not_found/.",
            error: { ".tag": "path", path: { ".tag": "not_found" } },
          }),
          { status: 409 },
        ),
    });
    expect(await client.download("/usage-daily/merged.csv")).toBeUndefined();
  });

  test.each([
    {
      name: "409 でも not_found 以外（権限など）",
      response: () =>
        new Response(`{"error_summary":"path/restricted_content/ ${ACCESS}"}`, {
          status: 409,
        }),
      status: 409,
    },
    {
      name: "認証の失敗（401）",
      response: () =>
        new Response(`{"error_summary":"missing_scope/ ${ACCESS}"}`, {
          status: 401,
        }),
      status: 401,
    },
  ])(
    "$name は、握りつぶさずに伝え、トークンを含めない",
    async ({ response, status }) => {
      const { client } = setup({ download: response });
      const error = await client
        .download("/usage-daily/merged.csv")
        .catch((e) => e);
      expect(error).toBeInstanceOf(DropboxApiError);
      expect((error as DropboxApiError).httpStatus).toBe(status);
      expect((error as Error).message).toContain("/usage-daily/merged.csv");
      expect((error as Error).message).not.toContain(ACCESS);
    },
  );

  test.each([
    "/other/merged.csv",
    "/usage-daily/../merged.csv",
    "/usage-daily//merged.csv",
  ])("許可の外のパス（%p）は、トークンを取る前に拒否する", async (path) => {
    const { client, calls } = setup();
    await expect(client.download(path)).rejects.toThrow("/usage-daily/ の下の");
    expect(calls).toHaveLength(0);
  });
});

describe("describeSecretShape", () => {
  test.each([
    {
      name: "正しい形（英数字と _ -）",
      value: "abcDEF123_-xyz",
      expected:
        "X: 長さ 14、空白・改行 なし、引用符 なし、英数字と _ - 以外の文字 なし、先頭が sl. なし",
    },
    {
      name: "引用符で囲まれている",
      value: '"abcDEF123"',
      expected:
        "X: 長さ 11、空白・改行 なし、引用符 あり、英数字と _ - 以外の文字 あり、先頭が sl. なし",
    },
    {
      name: "末尾に改行が混ざっている",
      value: "abcDEF123\n",
      expected:
        "X: 長さ 10、空白・改行 あり、引用符 なし、英数字と _ - 以外の文字 あり、先頭が sl. なし",
    },
    {
      name: "アクセストークン（sl. で始まる）を取り違えている",
      value: "sl.B1abc",
      expected:
        "X: 長さ 8、空白・改行 なし、引用符 なし、英数字と _ - 以外の文字 あり、先頭が sl. あり",
    },
  ])("$name", ({ value, expected }) => {
    expect(describeSecretShape("X", value)).toBe(expected);
  });

  test("値そのものは、説明に含めない", () => {
    expect(describeSecretShape("X", "super-secret-value")).not.toContain(
      "super-secret-value",
    );
  });
});

describe("DropboxClient: トークンの取得の失敗に、登録された値の形を添える", () => {
  const malformed = () =>
    new Response(
      JSON.stringify({
        error: "invalid_grant",
        error_description: "refresh token is malformed",
      }),
      { status: 400 },
    );

  function clientWith(refreshToken: string) {
    const fetchFn: FetchLike = async () => malformed();
    return new DropboxClient({
      fetch: fetchFn,
      appKey: APP_KEY,
      appSecret: APP_SECRET,
      refreshToken,
    });
  }

  test.each([
    {
      name: "引用符と改行が混ざった値",
      token: '"refresh-token-abcd"\n',
      flags:
        "長さ 21、空白・改行 あり、引用符 あり、英数字と _ - 以外の文字 あり、先頭が sl. なし",
    },
    {
      name: "アクセストークンを登録した値",
      token: "sl.accessTokenValue",
      flags:
        "長さ 19、空白・改行 なし、引用符 なし、英数字と _ - 以外の文字 あり、先頭が sl. あり",
    },
  ])("$name を、値を出さずに特定できる", async ({ token, flags }) => {
    const error = await clientWith(token)
      .upload("/usage-daily/a.csv", "x")
      .catch((e) => e);
    const message = (error as Error).message;
    expect(message).toContain("refresh token is malformed");
    expect(message).toContain(`DROPBOX_REFRESH_TOKEN: ${flags}`);
    expect(message).toContain("DROPBOX_APP_KEY: 長さ 12");
    expect(message).toContain("DROPBOX_APP_SECRET: 長さ 15");
    // 値そのものは、どの形でも出さない。
    expect(message).not.toContain(token.trim());
    expect(message).not.toContain(APP_SECRET);
    expect(message).not.toContain(APP_KEY);
  });
});
