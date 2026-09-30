/**
 * 性能測定用のワークスペースを生成する（spec.md 5.1、design-decisions.md 13.6）。
 *
 * 使い方: `bun scripts/perf/gen-workspace.ts <出力先>`（出力先は作り直す。リポジトリの外に置く）
 *
 * - `doc-plain-1mib.md`: 1 MiB。見出し・段落・リスト・表・引用だけ（Mermaid、コード、数式なし）
 * - `doc-mixed-<サイズ>.md`: コードブロック（対応言語）と数式を含む。50k、100k、250k、500k、1mib、2mib、4mib、10mib
 * - `doc-small.md`: 小さな文書（基準値）
 * - `many-1〜5/`: 1000個の `.md`（ツリー展開の測定用。初回の展開を5回測れるよう5つ）
 * - `many-dirs-1〜5/`: 1000個のサブフォルダー
 * - `doc-lists-*`、`doc-onelist-*`、`doc-nested-*`: リストの項目が多い文書（8.7。二乗の確認用）
 * - `doc-edge-*`: 書式なしへ切り替わる上限（`src/markdown/limits.ts`）の内側と外側
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root)
  throw new Error("使い方: bun scripts/perf/gen-workspace.ts <出力先>");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const ONE_MIB = 1_048_000; // 1 MiB（1,048,576）にわずかに届かない大きさ

const sentence =
  "この段落は性能測定のための本文である。日本語と English が混ざった文章を、実際の設計文書に近い密度で並べる。強調は **太字** と *斜体* と `インラインコード` を使い、[リンク](./doc-small.md) も含める。";

const paragraph = (n: number) => `${sentence} 段落番号 ${n}。${sentence}`;

function table(n: number): string {
  const rows = ["| 項目 | 内容 | 値 | 備考 |", "| --- | --- | ---: | :---: |"];
  for (let r = 0; r < 5; r++)
    rows.push(`| 行${n}-${r} | 説明の文章 ${r} | ${n * 10 + r} | ok |`);
  return rows.join("\n");
}

const list = (n: number) =>
  Array.from(
    { length: 8 },
    (_, i) => `- 項目 ${n}-${i}: 箇条書きの内容を少し長めに書く`,
  ).join("\n");

const codeSamples = [
  "```ts\nexport function add(a: number, b: number): number {\n  // 加算する\n  return a + b;\n}\nconst values = [1, 2, 3].map((v) => add(v, 1));\nconsole.log(values);\n```",
  "```python\ndef fib(n: int) -> int:\n    # フィボナッチ数\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n\nprint([fib(i) for i in range(10)])\n```",
  '```rust\nfn main() {\n    let v: Vec<u32> = (1..=5).collect();\n    let s: u32 = v.iter().sum();\n    println!("{s}");\n}\n```',
  '```json\n{\n  "name": "md-peruse",\n  "version": "0.1.0",\n  "items": [1, 2, 3]\n}\n```',
  '```bash\nset -euo pipefail\nfor f in *.md; do\n  echo "$f"\ndone\n```',
  "```css\n.markdown-body pre {\n  overflow: auto;\n  padding: 1rem;\n}\n```",
];

function section(n: number, mixed: boolean): string {
  const parts = [
    `## セクション ${n}`,
    "",
    paragraph(n),
    "",
    paragraph(n + 1),
    "",
    list(n),
    "",
    table(n),
    "",
    `> 引用文 ${n}。本文中の注意書きを引用で示す。`,
    "",
  ];
  if (mixed) {
    parts.push(codeSamples[n % codeSamples.length] ?? "", "");
    parts.push(
      `インライン数式 $x_${n % 9}^2 + y^2 = z^2$ と $\\alpha + \\beta$ を含む文。`,
      "",
    );
    if (n % 10 === 0)
      parts.push("$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$", "");
  }
  return parts.join("\n");
}

/** UTF-8 のバイト数が `bytes` に届くまで、節を並べる。 */
function byBytes(title: string, mixed: boolean, bytes: number): string {
  let text = `# ${title}\n\n`;
  for (let n = 0; Buffer.byteLength(text, "utf8") < bytes; n++)
    text += `${section(n, mixed)}\n`;
  return text;
}

/** 文字数が `chars` に届くまで、コードと数式を含む節を並べる（リスト項目は少ない）。 */
function byChars(title: string, chars: number): string {
  let text = `# ${title}\n\n`;
  for (let n = 0; text.length < chars; n++) text += `${section(n, true)}\n`;
  return text;
}

function repeated(
  title: string,
  unit: (n: number) => string,
  bytes: number,
): string {
  let text = `# ${title}\n\n`;
  for (let n = 0; Buffer.byteLength(text, "utf8") < bytes; n++) text += unit(n);
  return text;
}

const write = (name: string, text: string) =>
  writeFileSync(join(root, name), text);

write(
  "doc-plain-1mib.md",
  byBytes("性能測定用の文書（1 MiB、素の Markdown）", false, ONE_MIB),
);
write(
  "doc-mixed-1mib.md",
  byBytes("性能測定用の文書（1 MiB、コードと数式を含む）", true, ONE_MIB),
);
write("doc-small.md", "# 小さな文書\n\n本文。\n");
for (const kib of [50, 100, 250, 500]) {
  write(
    `doc-mixed-${kib}k.md`,
    byBytes(
      `性能測定用の文書（${kib} KiB、コードと数式を含む）`,
      true,
      kib * 1024,
    ),
  );
}
for (const mib of [2, 4]) {
  write(
    `doc-mixed-${mib}mib.md`,
    byBytes(
      `性能測定用の文書（${mib} MiB、コードと数式を含む）`,
      true,
      mib * 1024 * 1024 - 2000,
    ),
  );
}
write(
  "doc-mixed-10mib.md",
  byBytes("性能測定用の文書（10 MiB、コードと数式を含む）", true, 10_400_000),
);

for (let k = 1; k <= 5; k++) {
  const files = join(root, `many-${k}`);
  mkdirSync(files);
  for (let i = 0; i < 1000; i++) {
    writeFileSync(
      join(files, `note-${String(i).padStart(4, "0")}.md`),
      `# note ${i}\n`,
    );
  }
  const dirs = join(root, `many-dirs-${k}`);
  mkdirSync(dirs);
  for (let i = 0; i < 1000; i++) {
    const dir = join(dirs, `dir-${String(i).padStart(4, "0")}`);
    mkdirSync(dir);
    writeFileSync(join(dir, "x.md"), "# x\n");
  }
}

const smallLists = (n: number) =>
  `${Array.from({ length: 8 }, (_, i) => `- 項目 ${n}-${i}: 箇条書きの内容`).join("\n")}\n\n段落 ${n}\n\n`;
const oneList = (n: number) => `- 項目 ${n}: 箇条書きの内容\n`;
const nested = (n: number) => `- 親 ${n}\n  - 子 ${n}\n`;
write(
  "doc-lists-500k.md",
  repeated("リスト主体（500 KiB）", smallLists, 500 * 1024),
);
write(
  "doc-lists-1mib.md",
  repeated("リスト主体（1 MiB）", smallLists, 1024 * 1024),
);
write(
  "doc-onelist-500k.md",
  repeated("単一リスト（500 KiB）", oneList, 500 * 1024),
);
write(
  "doc-onelist-1mib.md",
  repeated("単一リスト（1 MiB）", oneList, 1024 * 1024),
);
write(
  "doc-nested-250k.md",
  repeated("ネストしたリスト（250 KiB）", nested, 250 * 1024),
);
write(
  "doc-nested-500k.md",
  repeated("ネストしたリスト（500 KiB）", nested, 500 * 1024),
);
write(
  "doc-nested-1mib.md",
  repeated("ネストしたリスト（1 MiB）", nested, 1024 * 1024),
);

// 書式なしへ切り替わる上限（文字数60万、項目数 × 文字数50億、ブロック10万文字）の、内側と外側。
const nestedByItems = (title: string, items: number) => {
  let text = `# ${title}\n\n`;
  for (let n = 0; n < items / 2; n++) text += `- 親 ${n}\n  - 子 ${n}\n`;
  return text;
};
write(
  "doc-edge-items-in.md",
  nestedByItems("ネストしたリスト（項目数の境界の内側）", 22_000),
);
write(
  "doc-edge-items-out.md",
  nestedByItems("ネストしたリスト（項目数の境界の外側）", 24_000),
);
write("doc-edge-chars-in.md", byChars("境界内の文字数", 590_000));
write("doc-edge-chars-out.md", byChars("境界外の文字数", 620_000));

// 改行のない1行（書式なしの表示の、長い行のレイアウトとアクセシビリティの確認用）。
write(
  "doc-oneline.md",
  byBytes("1行の文書", true, 2 * 1024 * 1024 - 2000).replaceAll("\n", " "),
);

console.log(`生成した: ${root}`);
