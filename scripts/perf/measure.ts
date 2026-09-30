/**
 * 描画に関わる性能目標（spec.md 5.1）を、起動済みの Release のアプリで測る。
 *
 * 使い方（アプリは `run.ps1` が起動する。単独で使うときは、`--remote-debugging-port=9222` 付きで起動しておく）:
 *   bun scripts/perf/measure.ts --ws <gen-workspace.ts で作ったフォルダー> [--out result.json] [--samples 6]
 *       [--only switch,tree,change]
 *
 * - switch: ツリーの行のクリックから、本文が新しい文書になり、レイアウトが確定し、次のフレームが始まるまで
 * - tree: フォルダーの行のクリックから、1000項目が並ぶまで（初回の展開を `--samples` 回）
 * - change: 外部での atomic replace（rename）から、本文が新しい内容になるまで（debounce の150 msを含む）
 *
 * 値は `layout`（強制レイアウト。目標の判定に使う）と `frame`（次のフレーム。アクセシビリティ木の更新が乗る）の
 * ミリ秒。判定は中央値で行う（design-decisions.md 13.6）。ウィンドウは前面に出す。無人・バックグラウンドでは、
 * 変更反映が約6秒遅れることがある。
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  clickRow,
  connect,
  h1Contains,
  median,
  option,
  plainStartsWith,
  quantile,
  sleep,
  type Timing,
  timedAction,
  waitForTree,
} from "./cdp";

const workspace = option("ws", "");
if (workspace === "")
  throw new Error("使い方: bun scripts/perf/measure.ts --ws <フォルダー>");
const outPath = option("out", "");
const samples = Number(option("samples", "6"));
const only = option("only", "switch,tree,change").split(",");

const cdp = await connect();
await waitForTree(cdp);

const run = (trigger: string, predicate: string, timeoutMs: number) =>
  cdp.evaluate<Timing>(timedAction(trigger, predicate, timeoutMs));

function summarize(timings: Timing[]) {
  const ok = timings.filter((t): t is Extract<Timing, { ok: true }> => t.ok);
  const stat = (key: "layout" | "frame") => {
    const values = ok.map((t) => t[key]);
    return {
      median: Math.round(median(values)),
      p95: Math.round(quantile(values, 0.95)),
      max: Math.round(Math.max(...values)),
    };
  };
  return {
    n: ok.length,
    failed: timings.length - ok.length,
    layout: stat("layout"),
    frame: stat("frame"),
  };
}

const result: Record<string, unknown> = {
  userAgent: await cdp.evaluate<string>("navigator.userAgent"),
  viewport: await cdp.evaluate<{ w: number; h: number }>(
    "({ w: innerWidth, h: innerHeight })",
  ),
};
const report = (group: string, name: string, timings: Timing[]) => {
  const summary = summarize(timings);
  (result[group] as Record<string, unknown> | undefined) ??= {};
  (result[group] as Record<string, unknown>)[name] = {
    ...summary,
    raw: timings,
  };
  console.log(
    `${group.padEnd(8)}${name.padEnd(22)} layout 中央値 ${summary.layout.median} ms（p95 ${summary.layout.p95}）  frame 中央値 ${summary.frame.median} ms  n=${summary.n}${summary.failed > 0 ? ` 失敗${summary.failed}` : ""}`,
  );
};

if (only.includes("switch")) {
  const docs: { name: string; file: string; ready: string }[] = [
    {
      name: "plain-1mib",
      file: "doc-plain-1mib.md",
      ready: h1Contains("1 MiB、素の Markdown"),
    },
    {
      name: "mixed-1mib",
      file: "doc-mixed-1mib.md",
      ready: h1Contains("1 MiB、コードと数式"),
    },
    {
      name: "mixed-250k",
      file: "doc-mixed-250k.md",
      ready: h1Contains("250 KiB、コードと数式"),
    },
    {
      name: "lists-500k",
      file: "doc-lists-500k.md",
      ready: h1Contains("リスト主体（500 KiB）"),
    },
    {
      name: "edge-chars-in",
      file: "doc-edge-chars-in.md",
      ready: h1Contains("境界内の文字数"),
    },
    // 上限を超えて、書式なしで表示される文書。
    {
      name: "plainview-2mib",
      file: "doc-mixed-2mib.md",
      ready: plainStartsWith("# 性能測定用の文書（2 MiB"),
    },
    {
      name: "plainview-10mib",
      file: "doc-mixed-10mib.md",
      ready: plainStartsWith("# 性能測定用の文書（10 MiB"),
    },
  ];
  for (const doc of docs) {
    const timings: Timing[] = [];
    for (let i = 0; i < samples; i++) {
      // 基準の小さな文書へ戻してから測る（同じ文書の再選択は何も起こらないため）。
      await run(clickRow("doc-small.md"), h1Contains("小さな文書"), 15_000);
      await sleep(700);
      timings.push(await run(clickRow(doc.file), doc.ready, 300_000));
      await sleep(700);
    }
    report("switch", doc.name, timings);
  }
}

if (only.includes("tree")) {
  const folderReady = (name: string) => `
    const row = [...document.querySelectorAll('.tree-row')]
      .find((r) => r.querySelector('.tree-label')?.textContent === ${JSON.stringify(name)});
    const li = row?.closest('li');
    return (li?.querySelectorAll(':scope > ul > li[role=treeitem]').length ?? 0) >= 1000;`;
  for (const kind of ["many", "many-dirs"]) {
    const timings: Timing[] = [];
    for (let k = 1; k <= Math.min(samples, 5); k++) {
      const name = `${kind}-${k}`;
      timings.push(await run(clickRow(name), folderReady(name), 30_000));
      await sleep(500);
      // 畳んでから次へ進む（展開済みの行が増えると、後続の測定に影響するため）。
      await cdp.evaluate(`(() => { ${clickRow(name)} return true; })()`);
      await sleep(500);
    }
    report("tree", kind, timings);
  }
}

if (only.includes("change")) {
  for (const doc of [
    {
      name: "plain-1mib",
      file: "doc-plain-1mib.md",
      h1: "1 MiB、素の Markdown",
    },
    {
      name: "mixed-1mib",
      file: "doc-mixed-1mib.md",
      h1: "1 MiB、コードと数式",
    },
  ]) {
    const path = join(workspace, doc.file);
    const original = readFileSync(path, "utf8");
    await run(clickRow("doc-small.md"), h1Contains("小さな文書"), 15_000);
    await sleep(700);
    await run(clickRow(doc.file), h1Contains(doc.h1), 60_000);
    await sleep(1500);
    const timings: Timing[] = [];
    try {
      for (let i = 1; i <= samples; i++) {
        const marker = `更新${i}`;
        const lines = original.split("\n");
        lines[0] = `${lines[0]} ${marker}`;
        const temporary = `${path}.tmp`;
        writeFileSync(temporary, lines.join("\n"));
        // ページ側の待機を先に始め、その後で rename する（時刻はどちらも Date.now()）。
        const waiting = cdp.evaluate<{
          ok: boolean;
          layout: number;
          frame: number;
        }>(`new Promise((resolve) => {
          let finished = false;
          const predicate = () => (document.querySelector('.markdown-body h1')?.textContent ?? '').includes(${JSON.stringify(marker)});
          const observer = new MutationObserver(() => { if (!finished && predicate()) done(); });
          observer.observe(document.body, { subtree: true, childList: true, characterData: true });
          function done() {
            finished = true;
            observer.disconnect();
            requestAnimationFrame(() => {
              document.body.getBoundingClientRect();
              const layout = Date.now();
              requestAnimationFrame(() => resolve({ ok: true, layout, frame: Date.now() }));
            });
          }
          setTimeout(() => { if (!finished) { finished = true; observer.disconnect(); resolve({ ok: false }); } }, 30000);
        })`);
        await sleep(300);
        const renamedAt = Date.now();
        renameSync(temporary, path);
        const reply = await waiting;
        timings.push(
          reply.ok
            ? {
                ok: true,
                layout: reply.layout - renamedAt,
                frame: reply.frame - renamedAt,
              }
            : { ok: false },
        );
        await sleep(1500);
      }
    } finally {
      writeFileSync(path, original);
    }
    report("change", doc.name, timings);
    await sleep(1000);
  }
}

if (outPath !== "") writeFileSync(outPath, JSON.stringify(result, null, 2));
cdp.close();
process.exit(0);
