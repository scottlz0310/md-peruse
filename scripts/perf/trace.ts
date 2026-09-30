/**
 * 文書の切り替えで、描画のメインスレッドの時間が、どの段階に使われたかを Chromium のトレースで集計する。
 * 「次のフレームまで」が「強制レイアウト」より大きく伸びるとき（アクセシビリティ木の更新など）の原因の切り分けに使う。
 *
 * 使い方（アプリは `run.ps1` が起動する）:
 *   bun scripts/perf/trace.ts --file doc-mixed-2mib.md --plain "# 性能測定用の文書（2 MiB" [--samples 3] [--accessibility]
 *   bun scripts/perf/trace.ts --file doc-plain-1mib.md --h1 "1 MiB、素の Markdown"
 *
 * `--h1` は書式ありの文書（本文の h1 の一部）、`--plain` は書式なしの文書（`pre` の先頭の文字列）の完了の判定である。
 * `--accessibility` は、アクセシビリティ（`Accessibility.enable`）を有効にして測る。
 * 各段階は、メインスレッド（`ProxyMain::BeginMainFrame` が最大のスレッド）の、トレース全体の合計である。
 */
import {
  clickRow,
  connect,
  h1Contains,
  option,
  plainStartsWith,
  sleep,
  type Timing,
  timedAction,
  waitForTree,
} from "./cdp";

const file = option("file", "");
const h1 = option("h1", "");
const plain = option("plain", "");
if (file === "" || (h1 === "" && plain === "")) {
  throw new Error(
    "使い方: bun scripts/perf/trace.ts --file <名前> (--h1 <断片> | --plain <先頭>)",
  );
}
const samples = Number(option("samples", "3"));

const cdp = await connect();
await waitForTree(cdp);
if (process.argv.includes("--accessibility")) {
  await cdp.send("Accessibility.enable");
  await sleep(1000);
}

type TraceEvent = { ph: string; name: string; tid: number; dur?: number };
const events: TraceEvent[] = [];
cdp.on("Tracing.dataCollected", (params) => {
  events.push(...(params as { value: TraceEvent[] }).value);
});
let completed: () => void = () => {};
cdp.on("Tracing.tracingComplete", () => completed());

const PHASES = [
  "Blink.Accessibility.UpdateTime",
  "Layout",
  "UpdateLayoutTree",
  "PrePaint",
  "Paint",
  "Layerize",
  "Commit",
  "RasterTask",
];
const ready = plain === "" ? h1Contains(h1) : plainStartsWith(plain);

for (let i = 0; i < samples; i++) {
  await cdp.evaluate(
    timedAction(clickRow("doc-small.md"), h1Contains("小さな文書"), 15_000),
  );
  await sleep(1200);
  events.length = 0;
  await cdp.send("Tracing.start", {
    traceConfig: {
      recordMode: "recordAsMuchAsPossible",
      includedCategories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "blink",
        "cc",
        "v8",
      ],
    },
  });
  const timing = await cdp.evaluate<Timing>(
    timedAction(clickRow(file), ready, 300_000),
  );
  await sleep(500);
  const done = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await cdp.send("Tracing.end");
  await done;

  const perThread = new Map<number, number>();
  for (const event of events) {
    if (event.ph === "X" && event.name === "ProxyMain::BeginMainFrame") {
      perThread.set(
        event.tid,
        (perThread.get(event.tid) ?? 0) + (event.dur ?? 0) / 1000,
      );
    }
  }
  const mainThread = [...perThread.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];
  const sums = new Map<string, number>(PHASES.map((phase) => [phase, 0]));
  for (const event of events) {
    if (event.ph !== "X" || event.dur === undefined || !sums.has(event.name))
      continue;
    // ラスタライズは別スレッドで行う。
    if (event.name !== "RasterTask" && event.tid !== mainThread) continue;
    sums.set(event.name, (sums.get(event.name) ?? 0) + event.dur / 1000);
  }
  const phases = [...sums.entries()].map(
    ([name, ms]) =>
      `${name.replace("Blink.Accessibility.UpdateTime", "Accessibility")}=${Math.round(ms)}`,
  );
  console.log(
    timing.ok
      ? `#${i + 1} layout ${Math.round(timing.layout)} ms / frame ${Math.round(timing.frame)} ms | ${phases.join(" ")}`
      : `#${i + 1} 時間切れ`,
  );
}
cdp.close();
process.exit(0);
