/**
 * 起動済みのアプリ（WebView2 のリモートデバッグ。既定は 127.0.0.1:9222）へ CDP で接続する。
 * 性能測定と実機確認の道具が共有する。アプリの起動は `run.ps1` と `../devtools/app-session.ps1` が行う。
 */

type Reply = { id: number; result?: unknown; error?: unknown };

export type Cdp = {
  send(method: string, params?: object): Promise<unknown>;
  /** ページ内で式を評価し、値を返す。CSP が eval を禁じるため、式はソース文字列として渡す。 */
  evaluate<T>(expression: string): Promise<T>;
  /** CDP のイベント（例: `Tracing.dataCollected`）を購読する。 */
  on(method: string, handler: (params: unknown) => void): void;
  close(): void;
};

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function connect(port = 9222): Promise<Cdp> {
  let pageUrl: string | undefined;
  for (let attempt = 0; attempt < 300 && pageUrl === undefined; attempt++) {
    try {
      const targets = (await (
        await fetch(`http://127.0.0.1:${port}/json`)
      ).json()) as {
        type: string;
        webSocketDebuggerUrl: string;
      }[];
      pageUrl = targets.find(
        (target) => target.type === "page",
      )?.webSocketDebuggerUrl;
    } catch {
      // アプリがまだ起動していない。
    }
    if (pageUrl === undefined) await sleep(200);
  }
  if (pageUrl === undefined)
    throw new Error(`CDP（ポート ${port}）へ接続できない`);

  const socket = new WebSocket(pageUrl);
  await new Promise<void>((resolve) => {
    socket.onopen = () => resolve();
  });
  let nextId = 0;
  const pending = new Map<number, (reply: Reply) => void>();
  const handlers = new Map<string, ((params: unknown) => void)[]>();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as Reply & {
      method?: string;
      params?: unknown;
    };
    if (message.method !== undefined) {
      for (const handler of handlers.get(message.method) ?? [])
        handler(message.params);
      return;
    }
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };

  const send = (method: string, params: object = {}) => {
    const id = ++nextId;
    const promise = new Promise<Reply>((resolve) => pending.set(id, resolve));
    socket.send(JSON.stringify({ id, method, params }));
    return promise.then((reply) => {
      if (reply.error !== undefined)
        throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
      return reply.result;
    });
  };

  return {
    send,
    async evaluate<T>(expression: string) {
      const result = (await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })) as { exceptionDetails?: unknown; result: { value: T } };
      if (result.exceptionDetails !== undefined) {
        throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 600));
      }
      return result.result.value;
    },
    on(method, handler) {
      handlers.set(method, [...(handlers.get(method) ?? []), handler]);
    },
    close: () => socket.close(),
  };
}

/** 引数 `--name value` を取り出す。無ければ既定値を返す。 */
export function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

export function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ??
    Number.NaN
  );
}

/**
 * 操作（`trigger`）から、`predicate` が真になり、レイアウトが確定し、次のフレームが始まるまでを測る。
 * `trigger` と `predicate` は、ページ内で評価するソース文字列である。
 *
 * - `layout`: DOM への反映の直後のフレームで、強制レイアウトを行った時点（spec.md 5.1 の「描画完了」）
 * - `frame`: その次のフレームが始まった時点。アクセシビリティ木が有効な環境では、その更新が乗る
 *   （design-decisions.md 13.6）。
 */
export function timedAction(
  trigger: string,
  predicate: string,
  timeoutMs: number,
): string {
  return `new Promise((resolve) => {
    const t0 = performance.now();
    let finished = false;
    const predicate = () => { ${predicate} };
    const observer = new MutationObserver(() => { if (!finished && predicate()) done(); });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    function done() {
      finished = true;
      observer.disconnect();
      requestAnimationFrame(() => {
        document.body.getBoundingClientRect();
        const layout = performance.now() - t0;
        requestAnimationFrame(() => resolve({ ok: true, layout, frame: performance.now() - t0 }));
      });
    }
    setTimeout(() => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      resolve({ ok: false });
    }, ${timeoutMs});
    ${trigger};
    if (!finished && predicate()) done();
  })`;
}

export type Timing =
  | { ok: true; layout: number; frame: number }
  | { ok: false };

/** ツリーの行（ファイル名またはフォルダー名が `name`）をクリックするソース。 */
export const clickRow = (name: string) => `
  const row = [...document.querySelectorAll('.tree-row')]
    .find((r) => r.querySelector('.tree-label')?.textContent === ${JSON.stringify(name)});
  if (!row) throw new Error('行が見つからない: ' + ${JSON.stringify(name)});
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, view: window }));`;

/** 本文の h1 が `fragment` を含む、という述語のソース。 */
export const h1Contains = (fragment: string) =>
  `return (document.querySelector('.markdown-body h1')?.textContent ?? '').includes(${JSON.stringify(fragment)});`;

/** 書式なしの表示（`.plain-source`）の先頭が `head` で始まる、という述語のソース。 */
export const plainStartsWith = (head: string) =>
  `const pre = document.querySelector('.plain-source'); return !!pre && (pre.firstChild?.data ?? '').startsWith(${JSON.stringify(head)});`;

/** ワークスペースの復元が済み、ツリーが出るまで待つ。 */
export async function waitForTree(cdp: Cdp): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const count = await cdp
      .evaluate<number>("document.querySelectorAll('.tree-row').length")
      .catch(() => 0);
    if (count > 0) break;
    await sleep(200);
  }
  await sleep(1500);
}
