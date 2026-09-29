import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { LanguageProvider } from "../i18n/LanguageContext";
import { MERMAID_LIMITS } from "../markdown/limits";
import {
  type MermaidFailure,
  MermaidRenderError,
  type MermaidTheme,
} from "../markdown/mermaid";
import {
  MERMAID_DIAGRAM_CLASS,
  MERMAID_ERROR_CLASS,
  MermaidDiagram,
} from "./MermaidDiagram";

afterEach(() => {
  cleanup();
});

const SOURCE = "flowchart LR\n  A --> B";

describe("MermaidDiagram", () => {
  test("描画を待つ間は定義をコードブロックとして表示し、描画後はSVGに置き換える", async () => {
    let resolve: (svg: string) => void = () => {};
    const renderDiagram = mock(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const { container } = render(
      <MermaidDiagram source={SOURCE} index={0} render={renderDiagram} />,
    );

    expect(container.querySelector("pre code")?.textContent).toBe(SOURCE);

    resolve('<svg id="mermaid-diagram-1"><g></g></svg>');
    await waitFor(() => {
      expect(
        container.querySelector(`.${MERMAID_DIAGRAM_CLASS} svg`),
      ).not.toBeNull();
    });
    expect(container.querySelector("pre")).toBeNull();
    expect(renderDiagram).toHaveBeenCalledWith(SOURCE, "default");
  });

  test("描画できなければ、定義を残してブロックの直後に理由を示す（12章）", async () => {
    const { container } = render(
      <MermaidDiagram
        source={SOURCE}
        index={0}
        render={() =>
          Promise.reject(
            new MermaidRenderError({
              kind: "renderFailed",
              detail: "Parse error",
            }),
          )
        }
      />,
    );

    const error = await waitFor(() => {
      const element = container.querySelector(`.${MERMAID_ERROR_CLASS}`);
      expect(element).not.toBeNull();
      return element;
    });
    expect(error?.textContent).toBe("図を描画できません（Parse error）。");
    expect(error?.previousElementSibling?.tagName).toBe("PRE");
    expect(container.querySelector("pre code")?.textContent).toBe(SOURCE);
  });

  test("1文書の上限を超えた図は描画せず、理由を示す", () => {
    const renderDiagram = mock((_: string, __: MermaidTheme) =>
      Promise.resolve("<svg></svg>"),
    );
    const { container } = render(
      <MermaidDiagram
        source={SOURCE}
        index={MERMAID_LIMITS.perDocumentDiagrams}
        render={renderDiagram}
      />,
    );

    expect(renderDiagram).not.toHaveBeenCalled();
    expect(
      container.querySelector(`.${MERMAID_ERROR_CLASS}`)?.textContent,
    ).toContain("図が多すぎる");
  });
});

describe("MermaidDiagram のテーマ（8.4）", () => {
  const original = globalThis.matchMedia;
  afterEach(() => {
    globalThis.matchMedia = original;
  });

  /** 指定したメディアクエリだけが一致する `matchMedia` に差し替え、一致を切り替える関数を返す。 */
  function fakeMedia(initial: string[]) {
    const matching = new Set(initial);
    const listeners = new Set<() => void>();
    globalThis.matchMedia = ((query: string) => ({
      matches: matching.has(query),
      addEventListener: (_: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        listeners.delete(listener),
    })) as unknown as typeof matchMedia;
    return (next: string[]) => {
      matching.clear();
      for (const query of next) matching.add(query);
      for (const listener of listeners) listener();
    };
  }

  test.each([
    [[], "default"],
    [["(prefers-color-scheme: dark)"], "dark"],
    [["(prefers-color-scheme: dark)", "(forced-colors: active)"], "neutral"],
  ] as const)(
    "一致するメディアクエリが %p ならテーマは %s",
    async (queries, theme) => {
      fakeMedia([...queries]);
      const renderDiagram = mock((_: string, __: MermaidTheme) =>
        Promise.resolve("<svg></svg>"),
      );

      render(
        <MermaidDiagram source={SOURCE} index={0} render={renderDiagram} />,
      );

      await waitFor(() => {
        expect(renderDiagram).toHaveBeenCalledWith(SOURCE, theme);
      });
    },
  );

  test("テーマが変わったら描画し直す", async () => {
    const change = fakeMedia([]);
    const renderDiagram = mock((_: string, __: MermaidTheme) =>
      Promise.resolve("<svg></svg>"),
    );
    render(<MermaidDiagram source={SOURCE} index={0} render={renderDiagram} />);
    await waitFor(() => {
      expect(renderDiagram).toHaveBeenCalledWith(SOURCE, "default");
    });

    act(() => change(["(prefers-color-scheme: dark)"]));

    await waitFor(() => {
      expect(renderDiagram).toHaveBeenLastCalledWith(SOURCE, "dark");
    });
  });
});

describe("MermaidDiagram: UI言語（10.5）", () => {
  test.each([
    [
      "ja",
      { kind: "timeout" },
      "図の描画に時間がかかりすぎたため中断しました。",
    ],
    [
      "en",
      { kind: "timeout" },
      "Rendering the diagram took too long and was stopped.",
    ],
    [
      "ja",
      { kind: "loadFailed", detail: "chunk" },
      "図の描画機能を読み込めませんでした（chunk）。",
    ],
    [
      "en",
      { kind: "loadFailed", detail: "chunk" },
      "Could not load the diagram renderer (chunk).",
    ],
    ["ja", { kind: "tooLarge" }, "図が大きすぎるため描画していません。"],
    [
      "en",
      { kind: "tooLarge" },
      "The diagram is too large and was not rendered.",
    ],
    [
      "en",
      { kind: "renderFailed", detail: "Parse error" },
      "Cannot render the diagram (Parse error).",
    ],
  ] as const satisfies readonly (readonly [
    "ja" | "en",
    MermaidFailure,
    string,
  ])[])(
    "%s: 失敗の種類（%p）から、現在の言語の理由を示す",
    async (language, failure, expected) => {
      const { container } = render(
        <LanguageProvider language={language}>
          <MermaidDiagram
            source={SOURCE}
            index={0}
            render={() => Promise.reject(new MermaidRenderError(failure))}
          />
        </LanguageProvider>,
      );

      const error = await waitFor(() => {
        const element = container.querySelector(`.${MERMAID_ERROR_CLASS}`);
        expect(element).not.toBeNull();
        return element;
      });
      expect(error?.textContent).toBe(expected);
    },
  );

  test.each([
    ["ja", "1つの文書に図が多すぎるため描画していません。"],
    ["en", "Too many diagrams in one document. This diagram is not rendered."],
  ] as const)("%s: 1文書の上限を超えた図の理由を示す", (language, expected) => {
    const { container } = render(
      <LanguageProvider language={language}>
        <MermaidDiagram
          source={SOURCE}
          index={MERMAID_LIMITS.perDocumentDiagrams}
          render={mock(() => Promise.resolve("<svg></svg>"))}
        />
      </LanguageProvider>,
    );

    expect(
      container.querySelector(`.${MERMAID_ERROR_CLASS}`)?.textContent,
    ).toBe(expected);
  });
});
