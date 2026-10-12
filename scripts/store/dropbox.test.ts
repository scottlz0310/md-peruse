import { describe, expect, test } from "bun:test";
import type { FetchLike } from "./client";
import { DropboxApiError, DropboxClient } from "./dropbox";

const APP_KEY = "app-key-1234";
const APP_SECRET = "app-secret-5678";
const REFRESH = "refresh-token-abcd";
const ACCESS = "access-token-wxyz";

interface Call {
  url: string;
  init?: RequestInit;
}

function setup(
  handlers: { token?: () => Response; upload?: () => Response } = {},
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
