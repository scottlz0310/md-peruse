import { describe, expect, test } from "bun:test";
import { renderIndexPage, renderPrivacyPolicyPage } from "./build-pages";

const sample = [
  "# タイトル / Title",
  "",
  "- [日本語](#日本語)",
  "- [English](#english)",
  "",
  "## 日本語",
  "",
  "本文。`code` と [リンク](https://example.com)。",
  "",
  "| 名前 | 値 |",
  "| --- | --- |",
  "| `a` | b |",
  "",
  "## English",
  "",
  "Body.",
].join("\n");

describe("renderPrivacyPolicyPage", () => {
  const html = renderPrivacyPolicyPage(sample);

  test("見出しへIDを付け、目次のリンクの行き先になる", () => {
    expect(html).toContain('<h2 id="日本語">日本語</h2>');
    expect(html).toContain('<h2 id="english">English</h2>');
    // 目次のリンクはパーセントエンコードされる。ブラウザーは、デコードしてIDと照合する。
    expect(html).toContain('href="#%E6%97%A5%E6%9C%AC%E8%AA%9E"');
    expect(html).toContain('href="#english"');
  });

  test("文書は日本語で、英語の節だけを lang=en の section で囲む", () => {
    expect(html).toContain('<html lang="ja">');
    const english = html.slice(html.indexOf('<section lang="en">'));
    expect(english).toContain("English");
    expect(english).toContain("Body.");
    expect(english).not.toContain("本文");
  });

  test("表とコードを描画する", () => {
    expect(html).toContain("<table>");
    expect(html).toContain("<code>a</code>");
  });

  test("生のHTMLは通さない", () => {
    const evil = renderPrivacyPolicyPage(
      `${sample}\n\n<script>alert(1)</script>\n`,
    );
    expect(evil).not.toContain("<script>");
  });

  test("英語の節が無ければ失敗する", () => {
    expect(() => renderPrivacyPolicyPage("# だけ\n\n## 日本語\n")).toThrow();
  });
});

describe("実際のポリシー", () => {
  test("イベント名と連絡先を含む", async () => {
    const markdown = await Bun.file(
      new URL("../docs/privacy-policy.md", import.meta.url),
    ).text();
    const html = renderPrivacyPolicyPage(markdown);
    for (const name of [
      "session_start",
      "open_md_ok",
      "open_md_fail",
      "open_folder",
      "launch_by_association",
    ]) {
      expect(html).toContain(`<code>${name}</code>`);
    }
    expect(html).toContain("https://github.com/scottlz0310/md-peruse/issues");
    expect(html).toContain('<section lang="en">');
  });
});

describe("renderIndexPage", () => {
  test("ポリシーのページへ転送する", () => {
    expect(renderIndexPage()).toContain("url=privacy-policy.html");
  });
});
