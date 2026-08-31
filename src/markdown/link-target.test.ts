import { describe, expect, test } from "bun:test";
import type { LinkRejectionReason, LinkTarget } from "./link-target";
import { resolveLinkTarget } from "./link-target";

function resolve(href: string, documentPath: string): LinkTarget {
  return resolveLinkTarget(href, { documentPath });
}

describe("解決できるリンク", () => {
  const cases: Array<[string, string, LinkTarget]> = [
    // 同一文書内アンカー
    ["#sec", "a.md", { kind: "anchor", elementId: "user-content-sec" }],
    [
      // remarkは断片をパーセントエンコードして出力する（実測）。
      "#%E8%A6%8B%E5%87%BA%E3%81%97",
      "a.md",
      { kind: "anchor", elementId: "user-content-見出し" },
    ],
    // 相対リンク。基準はリンクを含むファイルの所在フォルダー（design-decisions.md 7.2）
    ["./b.md", "a.md", { kind: "document", path: "b.md", elementId: null }],
    [
      "b.md",
      "docs/a.md",
      { kind: "document", path: "docs/b.md", elementId: null },
    ],
    [
      "../c.md",
      "docs/a.md",
      { kind: "document", path: "c.md", elementId: null },
    ],
    [
      "sub/c.md",
      "docs/a.md",
      { kind: "document", path: "docs/sub/c.md", elementId: null },
    ],
    [
      "../guide/c.md",
      "docs/a.md",
      { kind: "document", path: "guide/c.md", elementId: null },
    ],
    // ルート絶対リンクはワークスペースルート基準で解決する
    [
      "/docs/a.md",
      "other/x.md",
      { kind: "document", path: "docs/a.md", elementId: null },
    ],
    // アンカー付き相対リンク
    [
      "./b.md#sec",
      "a.md",
      { kind: "document", path: "b.md", elementId: "user-content-sec" },
    ],
    // クエリは捨てる
    ["./b.md?x=1", "a.md", { kind: "document", path: "b.md", elementId: null }],
    // 拡張子の判定は大文字小文字を区別しない（design-decisions.md 6.3）
    [
      "./B.MARKDOWN",
      "a.md",
      { kind: "document", path: "B.MARKDOWN", elementId: null },
    ],
    // セグメントを1回だけ復号する
    [
      "./%E6%97%A5%E6%9C%AC%E8%AA%9E.md",
      "a.md",
      { kind: "document", path: "日本語.md", elementId: null },
    ],
    // 名前に `%` を含むファイル。remarkは `%` を `%25` へ変換する（実測）
    [
      "./a%25b.md",
      "a.md",
      { kind: "document", path: "a%b.md", elementId: null },
    ],
    // 復号は1回だけなので、`%2F` という文字列を名前に含むファイルを指す
    [
      "./a%252Fb.md",
      "a.md",
      { kind: "document", path: "a%2Fb.md", elementId: null },
    ],
    // 外部URL。sanitizeが通すのは http と https だけである
    [
      "https://example.com/",
      "a.md",
      { kind: "external", url: "https://example.com/" },
    ],
    [
      "HTTP://example.com/",
      "a.md",
      { kind: "external", url: "HTTP://example.com/" },
    ],
  ];

  test.each(cases)("%s（%s から）", (href, documentPath, expected) => {
    expect(resolve(href, documentPath)).toEqual(expected);
  });
});

describe("拒否するリンク", () => {
  const cases: Array<[string, string, LinkRejectionReason]> = [
    ["", "a.md", "emptyTarget"],
    ["#", "a.md", "emptyTarget"],
    ["?x=1", "a.md", "emptyTarget"],
    // スキーム相対URL。UNCパスにも見える
    ["//server/share/a.md", "a.md", "schemeRelative"],
    // ルート外（design-decisions.md 7.2）
    ["../../etc.md", "a.md", "outsideRoot"],
    ["../../../Users/dev/secret.md", "docs/a.md", "outsideRoot"],
    // 区切りをエンコードで隠したトラバーサル。セグメント単位の復号で1つの名前になる
    ["./..%2F..%2Fetc.md", "a.md", "invalidFileName"],
    ["./..%5C..%5Cetc.md", "a.md", "invalidFileName"],
    // バックスラッシュ。remarkは生の `\` を `%5C` へ変換する（実測）
    ["%5Cserver%5Cshare%5Ca.md", "a.md", "invalidFileName"],
    // 代替データストリーム表記（design-decisions.md 7.1）
    ["./a.md:stream", "a.md", "invalidFileName"],
    // 復号できないパーセントエンコード
    ["./%ZZ.md", "a.md", "malformedEncoding"],
    ["./b.md#%ZZ", "a.md", "malformedEncoding"],
    // 対象拡張子ではない。OS既定アプリへは渡さない（design-decisions.md 7.2）
    ["./readme", "a.md", "notMarkdown"],
    ["./image.png", "a.md", "notMarkdown"],
    ["./setup.ps1", "a.md", "notMarkdown"],
    ["./sub/", "a.md", "notMarkdown"],
    ["./", "a.md", "notMarkdown"],
    // 末尾のドットと空白はWindowsが除去するため、対象拡張子として扱わない
    ["./a.md.", "a.md", "notMarkdown"],
    ["./a.md%20", "a.md", "notMarkdown"],
  ];

  test.each(cases)("%s（%s から）", (href, documentPath, reason) => {
    expect(resolve(href, documentPath)).toEqual({ kind: "rejected", reason });
  });
});
