// Microsoft Store の Submission API（Partner Center の申請の API）のクライアント。
//
// 認証は Azure AD のクライアント資格情報（v1 のトークン エンドポイント）。エンドポイントと呼び出しの
// 順序は、運用実績のある PhotoGeoExplorer の `Submit-ToPartnerCenter.ps1` と、公式の資料
// （Manage app submissions）に合わせた。
//
// シークレットと、SAS URL（署名つき）は、ログとエラーメッセージに出さない。

import type { StoreApplication, StoreSubmission } from "./plan";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface StoreClientOptions {
  fetch: FetchLike;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Store ID（例: 9P35BW61FN4W）。 */
  appId: string;
  baseUrl?: string;
  tokenUrl?: string;
}

export const DEFAULT_BASE_URL =
  "https://manage.devcenter.microsoft.com/v1.0/my";
const RESOURCE = "https://manage.devcenter.microsoft.com";

export interface SubmissionStatus {
  status: string;
  statusDetails?: unknown;
}

export class StoreApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "StoreApiError";
  }
}

export class StoreClient {
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private token: string | undefined;

  constructor(private readonly options: StoreClientOptions) {
    this.fetchFn = options.fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.tokenUrl =
      options.tokenUrl ??
      `https://login.microsoftonline.com/${options.tenantId}/oauth2/token`;
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const response = await this.fetchFn(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        resource: RESOURCE,
      }).toString(),
    });
    if (!response.ok) {
      // 応答の本文は、エラーの種類と説明だけを読む（資格情報は含まれない）。
      let detail = "";
      try {
        const body = (await response.json()) as {
          error?: string;
          error_description?: string;
        };
        detail = ` ${body.error ?? ""} ${(body.error_description ?? "").split("\r\n")[0]}`;
      } catch {
        // 本文が JSON でなければ、状態コードだけを伝える。
      }
      throw new StoreApiError(
        `アクセス トークンを取得できませんでした（HTTP ${response.status}）。${detail.trim()}`,
        response.status,
      );
    }
    const body = (await response.json()) as { access_token?: string };
    if (!body.access_token) {
      throw new Error(
        "トークン エンドポイントの応答に access_token がありません",
      );
    }
    this.token = body.access_token;
    return this.token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T | undefined> {
    const token = await this.accessToken();
    const response = await this.fetchFn(`${this.baseUrl}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const correlation = response.headers.get("MS-CV") ?? "—";
      const text = (await response.text()).slice(0, 1000);
      throw new StoreApiError(
        `Store API のエラー: ${method} ${path}（HTTP ${response.status}、MS-CV: ${correlation}）${text}`,
        response.status,
      );
    }
    const text = await response.text();
    return text === "" ? undefined : (JSON.parse(text) as T);
  }

  private get appPath(): string {
    return `applications/${this.options.appId}`;
  }

  async getApplication(): Promise<StoreApplication> {
    return (await this.request<StoreApplication>(
      "GET",
      this.appPath,
    )) as StoreApplication;
  }

  async getSubmission(submissionId: string): Promise<StoreSubmission> {
    return (await this.request<StoreSubmission>(
      "GET",
      `${this.appPath}/submissions/${submissionId}`,
    )) as StoreSubmission;
  }

  /** 直近の公開済みの申請のコピーとして、新しい申請（下書き）を作る。 */
  async createSubmission(): Promise<StoreSubmission> {
    return (await this.request<StoreSubmission>(
      "POST",
      `${this.appPath}/submissions`,
    )) as StoreSubmission;
  }

  async updateSubmission(submission: StoreSubmission): Promise<void> {
    await this.request(
      "PUT",
      `${this.appPath}/submissions/${submission.id}`,
      submission,
    );
  }

  /** 申請ごとの SAS URL へ ZIP をアップロードする。URL は署名を含むので、メッセージに出さない。 */
  async uploadZip(uploadUrl: string, zip: Uint8Array): Promise<void> {
    const response = await this.fetchFn(uploadUrl, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": "application/octet-stream",
      },
      // 型の上では Uint8Array を直接渡せないので、Blob に包む。
      body: new Blob([zip as BlobPart]),
    });
    if (!response.ok) {
      throw new StoreApiError(
        `ZIP のアップロードに失敗しました（HTTP ${response.status}）`,
        response.status,
      );
    }
  }

  async commit(submissionId: string): Promise<SubmissionStatus> {
    return (await this.request<SubmissionStatus>(
      "POST",
      `${this.appPath}/submissions/${submissionId}/commit`,
    )) as SubmissionStatus;
  }

  async getStatus(submissionId: string): Promise<SubmissionStatus> {
    return (await this.request<SubmissionStatus>(
      "GET",
      `${this.appPath}/submissions/${submissionId}/status`,
    )) as SubmissionStatus;
  }
}

/** commit が受理されるまで（`CommitStarted` を抜けるまで）待つ。認定の完了までは待たない。 */
export async function waitForCommit(
  client: Pick<StoreClient, "getStatus">,
  submissionId: string,
  options: {
    sleep: (ms: number) => Promise<void>;
    intervalMs: number;
    maxAttempts: number;
  },
): Promise<SubmissionStatus> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    const status = await client.getStatus(submissionId);
    if (status.status !== "CommitStarted") return status;
    await options.sleep(options.intervalMs);
  }
  throw new Error(
    `commit の受理を待ちましたが、状態が CommitStarted のままです（申請 ${submissionId}）。Partner Center で状態を確認してください。`,
  );
}
