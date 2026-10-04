// Microsoft Store の Submission API（Partner Center の申請の API）のクライアント。
//
// 認証は Azure AD のクライアント資格情報（v1 のトークン エンドポイント）。エンドポイントと呼び出しの
// 順序は、運用実績のある PhotoGeoExplorer の `Submit-ToPartnerCenter.ps1` と、公式の資料
// （Manage app submissions）に合わせた。
//
// シークレットと、SAS URL（署名つき）、テナント ID は、ログとエラーメッセージ、トレースに出さない。
// API の応答の本文に、これらの値が含まれるかもしれないので、本文は、エラーを作る時点で取り除く（`scrub`）。
// 呼び出しごとの記録（メソッド、パス、状態コード、所要時間、相関 ID）は、`trace` で渡す。Microsoft
// の API は、実走でしか分からない拒否（HTTP 400 など）が多いので、失敗の調査に使える情報
// （応答の本文と相関 ID）を、例外にも持たせる（`StoreApiError`）。

import type { StoreApplication, StoreSubmission } from "./plan";
import { redactText } from "./redact";

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
  /** 呼び出しごとの記録を受け取る。資格情報と署名つき URL は渡さない。 */
  trace?: (line: string) => void;
  /** 所要時間の計測に使う時刻（ミリ秒）。テストで差し替える。 */
  now?: () => number;
}

export const DEFAULT_BASE_URL =
  "https://manage.devcenter.microsoft.com/v1.0/my";
const RESOURCE = "https://manage.devcenter.microsoft.com";

/** 問い合わせ（Microsoft への調査の依頼）に使える、応答の相関 ID の見出し。 */
const CORRELATION_HEADERS = [
  "MS-CV",
  "MS-CorrelationId",
  "MS-RequestId",
  "x-ms-request-id",
  "x-ms-correlation-request-id",
  "request-id",
];

export interface SubmissionStatus {
  status: string;
  statusDetails?: unknown;
}

export interface StoreApiErrorDetail {
  /** 応答の本文（先頭 1000 文字）。資格情報は含まれない。 */
  responseBody?: string;
  /** 相関 ID（`見出し=値` をカンマで区切る）。無ければ空。 */
  correlation?: string;
}

export class StoreApiError extends Error {
  readonly responseBody?: string;
  readonly correlation?: string;

  constructor(
    message: string,
    readonly httpStatus: number,
    detail: StoreApiErrorDetail = {},
  ) {
    super(message);
    this.name = "StoreApiError";
    this.responseBody = detail.responseBody;
    this.correlation = detail.correlation;
  }
}

function correlationOf(headers: Headers): string {
  return CORRELATION_HEADERS.flatMap((name) => {
    const value = headers.get(name);
    return value ? [`${name}=${value}`] : [];
  }).join(", ");
}

export class StoreClient {
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private readonly trace: (line: string) => void;
  private readonly now: () => number;
  private token: string | undefined;

  constructor(private readonly options: StoreClientOptions) {
    this.fetchFn = options.fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.tokenUrl =
      options.tokenUrl ??
      `https://login.microsoftonline.com/${options.tenantId}/oauth2/token`;
    this.trace = options.trace ?? (() => {});
    this.now = options.now ?? Date.now;
  }

  /** 応答の本文などから、資格情報（トークン、シークレット、テナント ID、クライアント ID）と署名を取り除く。 */
  private scrub(text: string): string {
    return redactText(text, [
      this.token,
      this.options.clientSecret,
      this.options.tenantId,
      this.options.clientId,
    ]);
  }

  private record(
    what: string,
    status: number,
    startedAt: number,
    correlation: string,
  ): void {
    const suffix = correlation ? `、${correlation}` : "";
    this.trace(
      `${what} → HTTP ${status}（${this.now() - startedAt} ms${suffix}）`,
    );
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const startedAt = this.now();
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
    // テナント ID を含む URL は、記録に出さない。
    this.record(
      "POST トークン エンドポイント（Azure AD）",
      response.status,
      startedAt,
      correlationOf(response.headers),
    );
    if (!response.ok) {
      // 応答の本文は、エラーの種類と説明だけを読む（資格情報は含まれない）。
      let detail = "";
      try {
        const body = (await response.json()) as {
          error?: string;
          error_description?: string;
        };
        detail = this.scrub(
          ` ${body.error ?? ""} ${(body.error_description ?? "").split("\r\n")[0]}`,
        );
      } catch {
        // 本文が JSON でなければ、状態コードだけを伝える。
      }
      throw new StoreApiError(
        `アクセス トークンを取得できませんでした（HTTP ${response.status}）。${detail.trim()}`,
        response.status,
        { correlation: correlationOf(response.headers) },
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
    const startedAt = this.now();
    const response = await this.fetchFn(`${this.baseUrl}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const correlation = correlationOf(response.headers);
    this.record(`${method} ${path}`, response.status, startedAt, correlation);
    if (!response.ok) {
      const text = this.scrub((await response.text()).slice(0, 1000));
      throw new StoreApiError(
        `Store API のエラー: ${method} ${path}（HTTP ${response.status}、${correlation || "相関 ID なし"}）${text}`,
        response.status,
        { responseBody: text, correlation },
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

  /** 申請を更新する。API が返す、更新後の申請を返す（応答が空なら undefined）。 */
  async updateSubmission(
    submission: StoreSubmission,
  ): Promise<StoreSubmission | undefined> {
    return this.request<StoreSubmission>(
      "PUT",
      `${this.appPath}/submissions/${submission.id}`,
      submission,
    );
  }

  /** 申請ごとの SAS URL へ ZIP をアップロードする。URL は署名を含むので、メッセージにも記録にも出さない。 */
  async uploadZip(uploadUrl: string, zip: Uint8Array): Promise<void> {
    const startedAt = this.now();
    const response = await this.fetchFn(uploadUrl, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": "application/octet-stream",
      },
      // 型の上では Uint8Array を直接渡せないので、Blob に包む。
      body: new Blob([zip as BlobPart]),
    });
    const correlation = correlationOf(response.headers);
    this.record(
      `PUT ZIP のアップロード（${zip.length} バイト。署名つき URL は記録しない）`,
      response.status,
      startedAt,
      correlation,
    );
    if (!response.ok) {
      // Azure Blob のエラーの本文は、XML のエラー コードと説明で、署名は含まれない。
      const text = this.scrub((await response.text()).slice(0, 1000));
      throw new StoreApiError(
        `ZIP のアップロードに失敗しました（HTTP ${response.status}、${correlation || "相関 ID なし"}）${text}`,
        response.status,
        { responseBody: text, correlation },
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

/** 状態の 1 回の読み取り。取り込みの経過（タイムライン）として、証跡に残す。 */
export interface StatusEntry {
  /** 読み取った時刻（ISO 8601）。 */
  at: string;
  status: string;
  statusDetails?: unknown;
}

/** commit の後の取り込み（前処理）の途中の状態。ここを抜けたら、取り込みの結果が出ている。 */
export const INGESTION_STATUSES: readonly string[] = [
  "CommitStarted",
  "PreProcessing",
];

/** 失敗や取り消しを示す状態（`CommitFailed`、`PreProcessingFailed`、`CertificationFailed`、`Canceled` など）。 */
export function isFailureStatus(status: string): boolean {
  return status.endsWith("Failed") || status === "Canceled";
}

export interface IngestionResult {
  /** 最後に読み取った状態。 */
  status: SubmissionStatus;
  /** 読み取った状態の、すべての記録（時刻つき）。 */
  timeline: StatusEntry[];
  /** 上限まで待っても、取り込みの途中のままだったとき true。 */
  timedOut: boolean;
}

/**
 * commit の後、取り込み（`CommitStarted` と `PreProcessing`）を抜けるまで、状態を読み続ける。画像と
 * パッケージの取り込みの成否は、ここを抜けた状態（`Certification` なら成功、`PreProcessingFailed` なら
 * 失敗）で分かる。認定の完了までは待たない。読み取りのたびに、タイムラインへ記録する。
 */
export async function waitForIngestion(
  client: Pick<StoreClient, "getStatus">,
  submissionId: string,
  options: {
    sleep: (ms: number) => Promise<void>;
    intervalMs: number;
    maxAttempts: number;
    now: () => Date;
    /** 状態を読み取るたびに呼ぶ（ログ用）。 */
    onStatus?: (entry: StatusEntry) => void;
  },
): Promise<IngestionResult> {
  const timeline: StatusEntry[] = [];
  let last: SubmissionStatus = { status: "不明" };
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    last = await client.getStatus(submissionId);
    const entry: StatusEntry = {
      at: options.now().toISOString(),
      status: last.status,
      statusDetails: last.statusDetails,
    };
    timeline.push(entry);
    options.onStatus?.(entry);
    if (!INGESTION_STATUSES.includes(last.status)) {
      return { status: last, timeline, timedOut: false };
    }
    if (attempt < options.maxAttempts) await options.sleep(options.intervalMs);
  }
  return { status: last, timeline, timedOut: true };
}
