// Dropbox（App folder 型のアプリ）へ、ファイルを書く最小のクライアント。
//
// 日別の利用統計は、公開リポジトリの artifact・ログに出せないので、非公開の Dropbox に置く。アプリは
// App folder 型で、アプリ専用のフォルダー（`アプリ/md-peruse-insights`）の外には書けない。さらに
// このクライアントは、フォルダー内の `/usage-daily/` の下にしか書かない。
// 認証は、refresh token からアクセス トークンを得る（アクセス トークンは短命）。
// シークレット・トークンは、ログとエラーメッセージに出さない（`scrub`）。

import type { FetchLike } from "./client";
import { redactText } from "./redact";

const TOKEN_URL = "https://api.dropbox.com/oauth2/token";
const UPLOAD_URL = "https://content.dropboxapi.com/2/files/upload";
const DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download";

/** 読み書きを許す、アプリのフォルダー内の接頭辞。 */
export const DROPBOX_ROOT = "/usage-daily/";

/** 接頭辞の下の、英数字・`_`・`.`・`-`・`/` だけのパス（連続した `/` は拒否する。`.` と `..` の区間は別途拒否する）。 */
const SAFE_PATH = /^\/usage-daily\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

export class DropboxApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "DropboxApiError";
  }
}

export interface DropboxClientOptions {
  fetch: FetchLike;
  appKey: string;
  appSecret: string;
  refreshToken: string;
  /** 呼び出しごとの記録を受け取る。資格情報は渡さない。 */
  trace?: (line: string) => void;
}

export interface UploadResult {
  /** アプリのフォルダーを起点にした、保存先のパス。 */
  path: string;
  size: number;
}

/** トークンの取得より前に拒否する（許していない場所のために、資格情報を使わない）。 */
function assertSafePath(path: string): void {
  const dotSegment = path.split("/").some((s) => s === "." || s === "..");
  if (!SAFE_PATH.test(path) || dotSegment) {
    throw new Error(
      `Dropbox の読み書き先は、${DROPBOX_ROOT} の下の英数字と . _ - / だけのパスにしてください: ${path}`,
    );
  }
}

export class DropboxClient {
  private readonly fetchFn: FetchLike;
  private readonly trace: (line: string) => void;
  private token: string | undefined;

  constructor(private readonly options: DropboxClientOptions) {
    this.fetchFn = options.fetch;
    this.trace = options.trace ?? (() => {});
  }

  private scrub(text: string): string {
    return redactText(text, [
      this.token,
      this.options.appKey,
      this.options.appSecret,
      this.options.refreshToken,
    ]);
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const { appKey, appSecret, refreshToken } = this.options;
    const response = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
    this.trace(
      `POST Dropbox トークン エンドポイント → HTTP ${response.status}`,
    );
    if (!response.ok) {
      const text = this.scrub((await response.text()).slice(0, 500));
      throw new DropboxApiError(
        `Dropbox のアクセス トークンを取得できませんでした（HTTP ${response.status}）${text}`,
        response.status,
      );
    }
    const body = (await response.json()) as { access_token?: string };
    if (!body.access_token) {
      throw new Error("Dropbox のトークン応答に access_token がありません");
    }
    this.token = body.access_token;
    return this.token;
  }

  /** アプリのフォルダー内の `path`（`/usage-daily/` の下）へ、テキストを書く。同じパスは上書きする。 */
  async upload(path: string, text: string): Promise<UploadResult> {
    assertSafePath(path);
    const token = await this.accessToken();
    const response = await this.fetchFn(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify({
          path,
          mode: "overwrite",
          autorename: false,
          mute: true,
        }),
        "Content-Type": "application/octet-stream",
      },
      body: text,
    });
    this.trace(`POST Dropbox files/upload ${path} → HTTP ${response.status}`);
    if (!response.ok) {
      const body = this.scrub((await response.text()).slice(0, 1000));
      throw new DropboxApiError(
        `Dropbox への書き込みに失敗しました: ${path}（HTTP ${response.status}）${body}`,
        response.status,
      );
    }
    const saved = (await response.json()) as {
      path_display?: string;
      size?: number;
    };
    return {
      path: saved.path_display ?? path,
      size: saved.size ?? new TextEncoder().encode(text).length,
    };
  }

  /** アプリのフォルダー内の `path`（`/usage-daily/` の下）のテキストを読む。ファイルが無ければ undefined。 */
  async download(path: string): Promise<string | undefined> {
    assertSafePath(path);
    const token = await this.accessToken();
    const response = await this.fetchFn(DOWNLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify({ path }),
      },
    });
    this.trace(`POST Dropbox files/download ${path} → HTTP ${response.status}`);
    if (response.ok) return response.text();
    const body = this.scrub((await response.text()).slice(0, 1000));
    // ファイルが無いときは、HTTP 409 と `path/not_found/...` で返る。それ以外は、握りつぶさず伝える。
    if (response.status === 409 && body.includes('"path/not_found/')) {
      return undefined;
    }
    throw new DropboxApiError(
      `Dropbox からの読み取りに失敗しました: ${path}（HTTP ${response.status}）${body}`,
      response.status,
    );
  }
}
