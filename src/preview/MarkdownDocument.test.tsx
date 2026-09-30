import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MESSAGES } from "../i18n/messages";
import { DOCUMENT_LIMITS } from "../markdown/limits";
import type { LinkTarget } from "../markdown/link-target";
import type { ViewTarget } from "../state/document-tab";
import type { ImageResource } from "../types/generated/ImageResource";
import { MarkdownDocument } from "./MarkdownDocument";

/**
 * `scrollIntoView` の呼び出しと、スクロール領域の `scrollTop` への書き込みを記録する。
 * happy-domは実際にはスクロールしない。
 */
let scrolled: (string | number)[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;

/** `scrollTop` への書き込みを記録するスクロール領域。 */
const scroller = {
  current: Object.defineProperty(document.createElement("main"), "scrollTop", {
    set: (value: number) => scrolled.push(value),
  }),
};

beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
});

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

const TOP: ViewTarget = { anchor: null, scrollTop: 0 };

/** 画像を含まない本文用。参照が変わらないよう、モジュールで1つだけ持つ。 */
const noImages = async (): Promise<ImageResource[]> => [];

function mount(
  text: string,
  options: {
    path?: string;
    view?: ViewTarget;
    issueImages?: (
      documentPath: string,
      references: string[],
    ) => Promise<ImageResource[]>;
  } = {},
) {
  const navigated: LinkTarget[] = [];
  // 描画の結果の通知（Store向けカスタムイベントの発火点。11.4）。
  const rendered: string[] = [];
  const failures: unknown[] = [];
  const props = {
    path: options.path ?? "docs/guide.md",
    onNavigate: (target: LinkTarget) => navigated.push(target),
    issueImages: options.issueImages ?? noImages,
    imageRevision: 0,
    scroller,
    onRendered: () => rendered.push("ok"),
    onRenderFailed: (error: unknown) => failures.push(error),
  };
  const initialView = options.view ?? TOP;
  const mounted = render(
    <MarkdownDocument text={text} view={initialView} {...props} />,
  );
  return {
    navigated,
    rendered,
    failures,
    rerender: (next: string, view: ViewTarget = initialView) =>
      mounted.rerender(<MarkdownDocument text={next} view={view} {...props} />),
  };
}

/** 本文の描画パイプラインを失敗させる画像の発行。同期の例外は、パイプラインの例外になる。 */
const throwingIssuer = (): Promise<ImageResource[]> => {
  throw new Error("画像の発行に失敗した");
};

describe("MarkdownDocument", () => {
  test("描画が完了するたびに知らせる（11.4）", async () => {
    const { rendered, failures, rerender } = mount("# 一つ目\n");
    await waitFor(() => expect(rendered).toHaveLength(1));

    rerender("# 二つ目\n");

    await waitFor(() => expect(rendered).toHaveLength(2));
    expect(failures).toEqual([]);
  });

  test("本文全体を描画できないときは、失敗を知らせ、前の本文を残さない（11.4）", async () => {
    // 画像の発行がパイプラインの例外になる本文。数式・図・画像の位置だけの失敗ではなく、
    // 本文全体の失敗である。
    const { rendered, failures, rerender } = mount("# 前の文書\n", {
      issueImages: (_path, references) =>
        references.length > 0 ? throwingIssuer() : noImages(),
    });
    await waitFor(() => expect(rendered).toHaveLength(1));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "前の文書",
    );

    rerender("![図](a.png)\n");

    await waitFor(() => expect(failures).toHaveLength(1));
    expect((failures[0] as Error).message).toBe("画像の発行に失敗した");
    // 別の文書の内容を、いまの文書として見せない。
    expect(screen.queryByRole("heading")).toBeNull();
    expect(rendered).toHaveLength(1);
  });

  test("差し替えられた本文の描画の失敗は捨てる", async () => {
    const { rendered, failures, rerender } = mount("![図](bad.png)\n", {
      issueImages: (_path, references) =>
        references.includes("bad.png") ? throwingIssuer() : noImages(),
    });

    // 失敗が届く前に、別の本文へ差し替える。
    rerender("# 次の文書\n");

    await waitFor(() => expect(rendered).toHaveLength(1));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "次の文書",
    );
    expect(failures).toEqual([]);
  });

  test("本文を描画する", async () => {
    mount("# 見出し\n\n本文\n");

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "見出し",
      ),
    );
  });

  test("別の文書へのリンクは、文書の位置を基点に解決して知らせる（7.2）", async () => {
    const { navigated } = mount("[次](../next.md#setup)");
    const link = await waitFor(() => screen.getByRole("link"));

    const event = createEvent.click(link, { button: 0 });
    fireEvent(link, event);

    expect(event.defaultPrevented).toBe(true);
    expect(navigated).toEqual([
      { kind: "document", path: "next.md", elementId: "user-content-setup" },
    ]);
  });

  test.each([
    [
      "外部リンク",
      "[外](https://example.com/)",
      { kind: "external", url: "https://example.com/" },
    ],
    [
      "ルート外",
      "[外](../../up.md)",
      { kind: "rejected", reason: "outsideRoot" },
    ],
    [
      "Markdown以外",
      "[画像](./a.png)",
      { kind: "rejected", reason: "notMarkdown" },
    ],
  ] as const)("%sは解決した結果を知らせる", async (_, markdown, expected) => {
    const { navigated } = mount(markdown);
    const link = await waitFor(() => screen.getByRole("link"));

    fireEvent.click(link, { button: 0 });

    expect(navigated).toEqual([expected]);
  });

  test("同一文書内のアンカーは自分では移動せず、履歴へ積めるよう知らせる（9.3）", async () => {
    const { navigated } = mount("[節](#使い方)\n\n## 使い方\n");
    const link = await waitFor(() => screen.getByRole("link"));
    await waitFor(() => expect(scrolled).toEqual([0]));

    const event = createEvent.click(link, { button: 0 });
    fireEvent(link, event);

    expect(event.defaultPrevented).toBe(true);
    expect(scrolled).toEqual([0]);
    expect(navigated).toEqual([
      { kind: "anchor", elementId: "user-content-使い方" },
    ]);
  });

  test("脚注の相互参照は前置済みのIDを知らせる", async () => {
    const { navigated } = mount("本文[^1]\n\n[^1]: 注\n");
    const reference = await waitFor(() =>
      screen
        .getAllByRole("link")
        .find((link) => link.hasAttribute("data-footnote-ref")),
    );
    if (reference === undefined) throw new Error("脚注参照が描画されていない");

    fireEvent.click(reference, { button: 0 });

    expect(navigated).toEqual([
      { kind: "anchor", elementId: "user-content-fn-1" },
    ]);
  });

  test("hrefを落とされたリンクは何もしない", async () => {
    const { navigated } = mount("[危険](javascript:alert(1))");
    const link = await waitFor(() => screen.getByText("危険"));

    fireEvent.click(link, { button: 0 });

    expect(navigated).toEqual([]);
  });

  test.each([
    ["Ctrl + クリック", { button: 0, ctrlKey: true }],
    ["Shift + クリック", { button: 0, shiftKey: true }],
  ])("%sは遷移させず、同じタブでも開かない", async (_, init) => {
    const { navigated } = mount("[次](./next.md)");
    const link = await waitFor(() => screen.getByRole("link"));

    const event = createEvent.click(link, init);
    fireEvent(link, event);

    expect(event.defaultPrevented).toBe(true);
    expect(navigated).toEqual([]);
  });

  test("中クリックは遷移させない", async () => {
    const { navigated } = mount("[次](./next.md)");
    const link = await waitFor(() => screen.getByRole("link"));

    const event = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    fireEvent(link, event);

    expect(event.defaultPrevented).toBe(true);
    expect(navigated).toEqual([]);
  });

  test("リンクの外のクリックは止めない", async () => {
    mount("本文\n");
    const paragraph = await waitFor(() => screen.getByText("本文"));

    const event = createEvent.click(paragraph);
    fireEvent(paragraph, event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("開いたときのアンカーへは描画の完了後に移動する", async () => {
    mount("## 導入\n\n## 設定\n", {
      view: { anchor: "user-content-設定", scrollTop: 0 },
    });

    await waitFor(() => expect(scrolled).toEqual(["user-content-設定"]));
  });

  test("位置の指示が変わるたびに移し、同じ指示では移し直さない", async () => {
    const text = "## 導入\n\n## 設定\n";
    const { rerender } = mount(text);
    await waitFor(() => expect(scrolled).toEqual([0]));

    // 戻る／進むでは離れたときのスクロール位置へ戻す（9.3）。
    const back: ViewTarget = { anchor: null, scrollTop: 320 };
    rerender(text, back);
    rerender(text, back);
    // 同じ場所への移動でも、新しい指示なら移し直す。
    rerender(text, { anchor: null, scrollTop: 320 });

    await waitFor(() => expect(scrolled).toEqual([0, 320, 320]));
  });

  test("本文を差し替えると新しい本文を表示し、古い描画で上書きしない", async () => {
    const { rerender } = mount("# 古い\n");
    // 最初の描画の完了を待たずに差し替える。
    rerender("# 新しい\n");

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "新しい",
      ),
    );
    // 古い描画が後から完了しても上書きされない。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "新しい",
    );
  });

  test("画像のresource IDは文書のパスを基点に発行する（5.4）", async () => {
    const requests: [string, string[]][] = [];
    const issueImages = async (
      documentPath: string,
      references: string[],
    ): Promise<ImageResource[]> => {
      requests.push([documentPath, references]);
      return references.map((reference) => ({
        status: "issued",
        reference,
        resourceId: "abc",
      }));
    };
    render(
      <MarkdownDocument
        text={"![図](../img/a.png)\n"}
        path="docs/guide.md"
        view={TOP}
        onNavigate={() => {}}
        issueImages={issueImages}
        imageRevision={0}
        scroller={scroller}
        onRendered={() => {}}
        onRenderFailed={() => {}}
      />,
    );

    const image = await waitFor(() => screen.getByRole("img", { name: "図" }));
    expect(image.getAttribute("src")).toBe("http://mdperuse-img.localhost/abc");
    expect(requests).toEqual([["docs/guide.md", ["../img/a.png"]]]);
  });

  test("画像の書き換えを知らされたら、本文が同じでも画像を発行し直す（5.4）", async () => {
    let issued = 0;
    const issueImages = async (
      _documentPath: string,
      references: string[],
    ): Promise<ImageResource[]> => {
      issued += 1;
      return references.map((reference) => ({
        status: "issued",
        reference,
        resourceId: `id-${issued}`,
      }));
    };
    const element = (imageRevision: number) => (
      <MarkdownDocument
        text={"![図](a.png)\n"}
        path="guide.md"
        view={TOP}
        onNavigate={() => {}}
        issueImages={issueImages}
        imageRevision={imageRevision}
        scroller={scroller}
        onRendered={() => {}}
        onRenderFailed={() => {}}
      />
    );
    const { rerender } = render(element(0));
    const src = async () =>
      (
        await waitFor(() => screen.getByRole("img", { name: "図" }))
      ).getAttribute("src");
    expect(await src()).toBe("http://mdperuse-img.localhost/id-1");

    // 同じ値の再描画では発行し直さない。
    rerender(element(0));
    expect(issued).toBe(1);

    rerender(element(1));
    await waitFor(async () =>
      expect(await src()).toBe("http://mdperuse-img.localhost/id-2"),
    );
    expect(issued).toBe(2);
  });
});

describe("文書の切り替えでの部分木の作り直し（8.7）", () => {
  /** 描画したあと、`rerender` で本文とパスを替えられるようにする。 */
  function mountAt(path: string, text: string) {
    const handlers = {
      onNavigate: () => {},
      issueImages: noImages,
      imageRevision: 0,
      scroller,
      onRendered: () => {},
      onRenderFailed: () => {},
    };
    const mounted = render(
      <MarkdownDocument text={text} path={path} view={TOP} {...handlers} />,
    );
    return (nextPath: string, nextText: string) =>
      mounted.rerender(
        <MarkdownDocument
          text={nextText}
          path={nextPath}
          view={TOP}
          {...handlers}
        />,
      );
  }

  test("同じ文書の再読込は、DOMを作り直さず差分で更新する", async () => {
    // 作り直すと、Mermaidの図などの状態が再読込のたびに失われる。
    const rerender = mountAt("docs/a.md", "# 一つ目\n");
    const before = await waitFor(() => screen.getByRole("heading"));

    rerender("docs/a.md", "# 二つ目\n");

    await waitFor(() =>
      expect(screen.getByRole("heading").textContent).toBe("二つ目"),
    );
    expect(screen.getByRole("heading")).toBe(before);
  });

  test("別の文書へ替えると、新しい部分木を作る", async () => {
    // 永続する親へ大量の兄弟要素を1件ずつ挿入すると、Reactの挿入が二乗になる。
    const rerender = mountAt("docs/a.md", "# 一つ目\n");
    const before = await waitFor(() => screen.getByRole("heading"));

    rerender("docs/b.md", "# 二つ目\n");

    await waitFor(() =>
      expect(screen.getByRole("heading").textContent).toBe("二つ目"),
    );
    expect(screen.getByRole("heading")).not.toBe(before);
    expect(document.querySelector("article")?.children).toHaveLength(1);
  });

  test("別の文書へ替えるとき、新しい本文が描画されるまでは前の本文を作り直さない", async () => {
    // パスだけが先に替わる間、前の本文を新しいパスの鍵で作り直すと、無駄に作って捨てる。
    const rerender = mountAt("docs/a.md", "# 一つ目\n");
    const before = await waitFor(() => screen.getByRole("heading"));

    rerender("docs/b.md", "# 一つ目\n");
    // 描画が完了するまでの間も、前の部分木がそのまま残る。
    expect(screen.getByRole("heading")).toBe(before);
    await waitFor(() => expect(screen.getByRole("heading")).not.toBe(before));
  });
});

describe("大きい・複雑な文書の書式なし表示（8.7）", () => {
  /** 文字数の上限を超える本文。1行にRaw HTMLと、書式の記法を含める。 */
  const longText = `# 見出し\n\n<script>alert(1)</script>\n\n![図](a.png)\n\n${"a\n".repeat(DOCUMENT_LIMITS.richMaxChars)}`;
  /** 文字数は上限内だが、リストの項目が多すぎる本文。 */
  const manyItems = "- a\n\n".repeat(
    Math.floor(Math.sqrt(DOCUMENT_LIMITS.richMaxListItemChars / 5)) + 1,
  );
  /** 文字数の上限内だが、空行のない1つの段落が長すぎる本文。 */
  const longBlock = `# 見出し\n\n${"a\n".repeat(DOCUMENT_LIMITS.richMaxBlockChars)}`;

  test.each([
    // 説明, 本文, 理由
    ["文字数が上限を超える", longText, "tooLong"],
    ["空行のない1つのまとまりが長い", longBlock, "tooLongBlock"],
    ["リストの項目が多い", manyItems, "tooManyListItems"],
  ] as const)(
    "%s ときは、パースせずにソースをそのまま示し、理由を添える",
    async (_name, text, reason) => {
      let issued = 0;
      const { rendered, failures } = mount(text, {
        issueImages: async () => {
          issued += 1;
          return [];
        },
      });
      await waitFor(() => expect(rendered).toHaveLength(1));

      const source = document.querySelector(".plain-source");
      expect(source?.tagName).toBe("PRE");
      // ソースは1文字も変えずに示す。
      expect(source?.textContent).toBe(text);
      expect(screen.getByRole("note").textContent).toBe(
        MESSAGES.ja.plainDocument[reason],
      );
      // パースしないため、見出し、Raw HTMLの要素、画像は生じず、画像の発行も行わない。
      expect(screen.queryByRole("heading")).toBeNull();
      expect(document.querySelector("script")).toBeNull();
      expect(screen.queryByRole("img")).toBeNull();
      expect(issued).toBe(0);
      expect(failures).toEqual([]);
    },
  );

  test("上限内の文書は書式を付けて描画する", async () => {
    const { rendered } = mount("# 見出し\n\n- a\n- b\n");
    await waitFor(() => expect(rendered).toHaveLength(1));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "見出し",
    );
    expect(document.querySelector(".plain-source")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  test("書式なしの文書から書式ありの文書へ替えると、案内とソースを残さない", async () => {
    const { rendered, rerender } = mount(longText);
    await waitFor(() => expect(rendered).toHaveLength(1));
    expect(document.querySelector(".plain-source")).not.toBeNull();

    rerender("# 次の文書\n");

    await waitFor(() => expect(rendered).toHaveLength(2));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "次の文書",
    );
    expect(document.querySelector(".plain-source")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  test("描画中の書式ありの文書を、書式なしの文書で差し替えても、古い描画で上書きしない", async () => {
    // 先に始めた書式ありの描画が、後から書式なしの表示を上書きしないこと。
    const { rendered, rerender } = mount("# 前の文書\n");
    rerender(longText);

    await waitFor(() =>
      expect(document.querySelector(".plain-source")).not.toBeNull(),
    );
    // 前の描画が完了する時間を与えても、書式なしのままである。
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector(".plain-source")).not.toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(rendered.length).toBeGreaterThanOrEqual(1);
  });
});
