import { afterEach, describe, expect, test } from "bun:test";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import App from "./App";
import type { FileContent } from "./types/generated/FileContent";
import type { ImageResource } from "./types/generated/ImageResource";
import type { ImageResourceRequest } from "./types/generated/ImageResourceRequest";
import type { IpcError } from "./types/generated/IpcError";
import type { ScanResult } from "./types/generated/ScanResult";
import type { UiSettings } from "./types/generated/UiSettings";
import type { UiSettingsUpdate } from "./types/generated/UiSettingsUpdate";
import type { WorkspaceOpenedEvent } from "./types/generated/WorkspaceOpenedEvent";

type Handlers = {
  scan: (path: string) => ScanResult | Promise<ScanResult>;
  read?: (path: string) => FileContent | Promise<FileContent>;
  openUrl?: (url: string) => void;
  issue?: (request: ImageResourceRequest) => ImageResource[];
  updateSettings?: (update: UiSettingsUpdate) => void;
};

const UI_SETTINGS: UiSettings = {
  theme: "system",
  language: "system",
  effectiveLanguage: "ja",
  sidebarWidth: 280,
  sidebarVisible: true,
  fontScalePercent: 100,
  recentFolders: [],
};

/** Rust側のcommandを差し替え、eventを模擬できるようにする。 */
function mockBackend(handlers: Handlers) {
  mockIPC(
    (command, payload) => {
      if (command === "get_ui_settings_command") return UI_SETTINGS;
      if (command === "update_ui_settings_command") {
        handlers.updateSettings?.(
          (payload as { update: UiSettingsUpdate }).update,
        );
        return null;
      }
      if (command === "plugin:opener|open_url" && handlers.openUrl) {
        handlers.openUrl((payload as { url: string }).url);
        return null;
      }
      if (command === "issue_image_resources_command" && handlers.issue) {
        return handlers.issue(
          (payload as { request: ImageResourceRequest }).request,
        );
      }
      const request = (payload as { request: { path: string } }).request;
      if (command === "scan_directory_command")
        return handlers.scan(request.path);
      if (command === "read_file_command" && handlers.read)
        return handlers.read(request.path);
      throw new Error(`想定外のcommand: ${command}`);
    },
    { shouldMockEvents: true },
  );
}

function fileContent(path: string, text: string): FileContent {
  return { path, text, encoding: "utf8", byteSize: text.length };
}

/** READMEを開き、本文の描画を待つ。 */
async function openReadme() {
  await openWorkspace({ scopeId: "scope-1", label: "docs" });
  await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());
  await act(async () => {
    screen.getByText("README.md").click();
  });
}

async function openWorkspace(opened: WorkspaceOpenedEvent) {
  await act(async () => {
    await emit("workspace-opened", opened);
  });
}

const ROOT: ScanResult = {
  path: "",
  entries: [
    { path: "docs", name: "docs", kind: "directory", hasChildren: true },
    {
      path: "README.md",
      name: "README.md",
      kind: "markdown",
      hasChildren: null,
    },
  ],
};

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("App", () => {
  test("ワークスペースを開くまでは案内を表示する", async () => {
    mockBackend({ scan: () => ROOT });
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "md-peruse",
      ),
    );
    expect(screen.getByText(/フォルダーを開く/)).toBeTruthy();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  test("ワークスペースを開くと、設定の幅で2ペインを表示し、変えた幅を保存する（10.2、11.1）", async () => {
    const updates: UiSettingsUpdate[] = [];
    mockBackend({ scan: () => ROOT, updateSettings: (u) => updates.push(u) });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openWorkspace({ scopeId: "scope-1", label: "docs" });

    const separator = await waitFor(() => screen.getByRole("separator"));
    expect(separator.getAttribute("aria-valuenow")).toBe("280");
    expect(screen.getByRole("navigation").textContent).toContain("README.md");

    fireEvent.keyDown(separator, { key: "ArrowRight" });

    expect(separator.getAttribute("aria-valuenow")).toBe("296");
    await waitFor(() => expect(updates).toEqual([{ sidebarWidth: 296 }]));
  });

  test("ワークスペースを開いたらルート直下を走査して表示する", async () => {
    const scanned: string[] = [];
    mockBackend({
      scan: (path) => {
        scanned.push(path);
        return ROOT;
      },
    });
    render(<App />);
    // 購読の完了を待つ。
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );

    await openWorkspace({ scopeId: "scope-1", label: "src\\docs" });

    await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "src\\docs",
    );
    expect(scanned).toEqual([""]);
  });

  test("Markdownを選ぶと読み込んだ本文を描画する", async () => {
    mockBackend({
      scan: () => ROOT,
      read: (path) => ({
        path,
        // 本文の `h1` は画面の見出し（ワークスペース名）と区別するため `h2` にする。
        text: "## 見出し\n",
        encoding: "utf8",
        byteSize: 12,
      }),
    });
    render(<App />);
    await openWorkspace({ scopeId: "scope-1", label: "docs" });
    await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());

    await act(async () => {
      screen.getByText("README.md").click();
    });

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "見出し",
      ),
    );
  });

  test("走査の失敗はツリーの該当する位置に文言を表示する（6.2）", async () => {
    const failure: IpcError = {
      code: "directoryAccessDenied",
      message: "このフォルダーへアクセスできません。",
      detail: null,
    };
    const scanned: string[] = [];
    mockBackend({
      scan: (path) => {
        scanned.push(path);
        return path === "" ? ROOT : Promise.reject(failure);
      },
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openWorkspace({ scopeId: "scope-1", label: "root" });

    // フォルダーは展開したときに初めて走査する。
    const docs = await waitFor(() => screen.getByText("docs"));
    expect(scanned).toEqual([""]);
    await act(async () => {
      docs.click();
    });

    const group = await waitFor(() => screen.getByRole("group"));
    await waitFor(() => expect(group.textContent).toBe(failure.message));
    expect(scanned).toEqual(["", "docs"]);
    // ツリー全体の失敗にはしない。
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  test("切り替える前に要求した走査の応答は反映しない", async () => {
    let releaseFirst: (result: ScanResult) => void = () => {};
    let calls = 0;
    // `mockIPC` を張り直すとeventの購読も消えるため、1つのモックで呼ばれた順に応答を変える。
    // 1回目（1つ目のワークスペース）は保留し、2回目は空で即座に返す。
    mockBackend({
      scan: () => {
        calls += 1;
        if (calls > 1) return { path: "", entries: [] };
        return new Promise<ScanResult>((resolve) => {
          releaseFirst = resolve;
        });
      },
    });
    render(<App />);
    await openWorkspace({ scopeId: "scope-1", label: "first" });
    const pendingFirst = releaseFirst;

    await openWorkspace({ scopeId: "scope-2", label: "second" });
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "second",
      ),
    );

    await act(async () => {
      pendingFirst(ROOT);
    });

    expect(screen.queryByText("README.md")).toBeNull();
  });

  test("本文中の相対リンクで別の文書を開く（7.2）", async () => {
    const read: string[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path) => {
        read.push(path);
        return path === "README.md"
          ? fileContent(path, "[ガイド](docs/guide.md)\n")
          : fileContent(path, "## ガイド本文\n");
      },
    });
    render(<App />);
    await openReadme();
    const link = await waitFor(() =>
      screen.getByRole("link", { name: "ガイド" }),
    );

    await act(async () => {
      link.click();
    });

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "ガイド本文",
      ),
    );
    expect(read).toEqual(["README.md", "docs/guide.md"]);
  });

  test("開けないリンクは遷移せず、理由を表示する（7.2）", async () => {
    const missing: IpcError = {
      code: "fileNotFound",
      message: "ファイルが見つかりません。",
      detail: "missing.md",
    };
    mockBackend({
      scan: () => ROOT,
      read: (path) =>
        path === "README.md"
          ? fileContent(path, "## 目次\n\n[外](../up.md) [無い](missing.md)\n")
          : Promise.reject(missing),
    });
    render(<App />);
    await openReadme();

    // Frontendで解決できないリンクは、IPCを待たずに理由を示す。
    const outside = await waitFor(() =>
      screen.getByRole("link", { name: "外" }),
    );
    await act(async () => {
      outside.click();
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "開いているフォルダーの外は表示できません。",
    );

    // 存在しない文書は読込の失敗を示し、表示中の文書は保つ。
    await act(async () => {
      screen.getByRole("link", { name: "無い" }).click();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(missing.message),
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("目次");
  });

  test("外部リンクはOS既定のブラウザーで開く", async () => {
    const opened: string[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path) => fileContent(path, "[サイト](https://example.com/)\n"),
      openUrl: (url) => opened.push(url),
    });
    render(<App />);
    await openReadme();
    const link = await waitFor(() =>
      screen.getByRole("link", { name: "サイト" }),
    );

    await act(async () => {
      link.click();
    });

    await waitFor(() => expect(opened).toEqual(["https://example.com/"]));
  });

  test("後から開いた文書を、先に始めた読込の結果で上書きしない", async () => {
    let releaseSlow: (content: FileContent) => void = () => {};
    mockBackend({
      scan: () => ({
        path: "",
        entries: [
          {
            path: "slow.md",
            name: "slow.md",
            kind: "markdown",
            hasChildren: null,
          },
          {
            path: "fast.md",
            name: "fast.md",
            kind: "markdown",
            hasChildren: null,
          },
        ],
      }),
      read: (path) =>
        path === "slow.md"
          ? new Promise<FileContent>((resolve) => {
              releaseSlow = resolve;
            })
          : fileContent(path, "## 速い\n"),
    });
    render(<App />);
    await openWorkspace({ scopeId: "scope-1", label: "docs" });
    await waitFor(() => expect(screen.getByText("slow.md")).toBeTruthy());

    await act(async () => {
      screen.getByText("slow.md").click();
    });
    const pendingSlow = releaseSlow;
    await act(async () => {
      screen.getByText("fast.md").click();
    });
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "速い",
      ),
    );

    await act(async () => {
      pendingSlow(fileContent("slow.md", "## 遅い\n"));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("速い");
  });

  describe("戻る／進む（9.3）", () => {
    /** READMEからリンクでガイドへ移った状態を作る。読込の順を記録する。 */
    async function openGuideFromReadme(
      read: (path: string) => FileContent | Promise<FileContent> = (path) =>
        path === "README.md"
          ? fileContent(path, "## 目次\n\n[ガイド](docs/guide.md)\n")
          : fileContent(path, "## ガイド本文\n"),
    ) {
      const requested: string[] = [];
      mockBackend({
        scan: () => ROOT,
        read: (path) => {
          requested.push(path);
          return read(path);
        },
      });
      render(<App />);
      await openReadme();
      const link = await waitFor(() =>
        screen.getByRole("link", { name: "ガイド" }),
      );
      await act(async () => {
        link.click();
      });
      await waitFor(() => expect(heading()).toBe("ガイド本文"));
      return requested;
    }

    function heading() {
      return screen.queryByRole("heading", { level: 2 })?.textContent;
    }

    test.each([
      [
        "Alt+← / Alt+→",
        () =>
          new KeyboardEvent("keydown", {
            key: "ArrowLeft",
            altKey: true,
            cancelable: true,
          }),
        () =>
          new KeyboardEvent("keydown", {
            key: "ArrowRight",
            altKey: true,
            cancelable: true,
          }),
      ],
      [
        "マウスのサイドボタン",
        () => new MouseEvent("auxclick", { button: 3, cancelable: true }),
        () => new MouseEvent("auxclick", { button: 4, cancelable: true }),
      ],
    ])(
      "%sで文書を行き来し、WebViewの既定動作を止める",
      async (_, back, forward) => {
        const historyLength = window.history.length;
        const requested = await openGuideFromReadme();

        const backEvent = back();
        await act(async () => {
          window.dispatchEvent(backEvent);
        });
        await waitFor(() => expect(heading()).toBe("目次"));
        expect(backEvent.defaultPrevented).toBe(true);

        const forwardEvent = forward();
        await act(async () => {
          window.dispatchEvent(forwardEvent);
        });
        await waitFor(() => expect(heading()).toBe("ガイド本文"));
        expect(forwardEvent.defaultPrevented).toBe(true);
        // WebViewのHistory APIへは何も積まない。
        expect(window.history.length).toBe(historyLength);
        expect(requested).toEqual([
          "README.md",
          "docs/guide.md",
          "README.md",
          "docs/guide.md",
        ]);
      },
    );

    test("戻った先を読めなければ理由を示し、その項目を履歴から取り除く", async () => {
      const missing: IpcError = {
        code: "fileNotFound",
        message: "ファイルが見つかりません。",
        detail: "README.md",
      };
      let readmeReads = 0;
      const requested = await openGuideFromReadme((path) => {
        if (path !== "README.md") return fileContent(path, "## ガイド本文\n");
        readmeReads += 1;
        return readmeReads === 1
          ? fileContent(path, "## 目次\n\n[ガイド](docs/guide.md)\n")
          : Promise.reject(missing);
      });
      const pressBack = () =>
        act(async () => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true }),
          );
        });

      await pressBack();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(missing.message),
      );
      expect(heading()).toBe("ガイド本文");

      // 取り除いたので、もう一度戻っても読込を試みない。
      await pressBack();
      expect(requested).toEqual(["README.md", "docs/guide.md", "README.md"]);
    });

    test("見出しへの移動も履歴へ積み、同じ文書の中では読み直さない", async () => {
      const requested: string[] = [];
      mockBackend({
        scan: () => ROOT,
        read: (path) => {
          requested.push(path);
          return fileContent(path, "[設定へ](#設定)\n\n## 設定\n");
        },
      });
      render(<App />);
      await openReadme();
      const link = await waitFor(() =>
        screen.getByRole("link", { name: "設定へ" }),
      );
      await act(async () => {
        link.click();
      });
      // 同じ文書をツリーから選んでも読み直さない。
      await act(async () => {
        within(screen.getByRole("tree")).getByText("README.md").click();
      });

      const back = new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        altKey: true,
        cancelable: true,
      });
      await act(async () => {
        window.dispatchEvent(back);
      });

      expect(back.defaultPrevented).toBe(true);
      expect(requested).toEqual(["README.md"]);
    });
  });

  describe("タブ（9.1）", () => {
    const TWO_FILES: ScanResult = {
      path: "",
      entries: ["a.md", "b.md"].map((name) => ({
        path: name,
        name,
        kind: "markdown" as const,
        hasChildren: null,
      })),
    };

    /** 2つのファイルがあるワークスペースを開き、読込の順を記録する。 */
    async function openTwoFiles(
      text: (path: string) => string = (path) => `## ${path}\n`,
    ) {
      const requested: string[] = [];
      mockBackend({
        scan: () => TWO_FILES,
        read: (path) => {
          requested.push(path);
          return fileContent(path, text(path));
        },
      });
      render(<App />);
      await waitFor(() =>
        expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
      );
      await openWorkspace({ scopeId: "scope-1", label: "docs" });
      await waitFor(() => screen.getByRole("tree"));
      return requested;
    }

    const treeItem = (name: string) =>
      within(screen.getByRole("tree")).getByText(name);
    const tabNames = () =>
      screen
        .queryAllByRole("tab")
        .map(
          (tab) =>
            `${tab.querySelector(".tab-title")?.textContent}${tab.classList.contains("tab-preview") ? "(preview)" : ""}`,
        );
    const heading = () =>
      screen.queryByRole("heading", { level: 2 })?.textContent;

    test("シングルクリックはプレビュータブを差し替え、ダブルクリックで固定する", async () => {
      await openTwoFiles();

      await act(async () => fireEvent.click(treeItem("a.md"), { detail: 1 }));
      await waitFor(() => expect(heading()).toBe("a.md"));
      await act(async () => fireEvent.click(treeItem("b.md"), { detail: 1 }));
      await waitFor(() => expect(heading()).toBe("b.md"));
      expect(tabNames()).toEqual(["b.md(preview)"]);

      await act(async () => fireEvent.click(treeItem("b.md"), { detail: 2 }));
      await act(async () => fireEvent.click(treeItem("a.md"), { detail: 1 }));
      await waitFor(() => expect(heading()).toBe("a.md"));

      expect(tabNames()).toEqual(["b.md", "a.md(preview)"]);
      expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
        screen
          .getAllByRole("tab")
          .find((tab) => tab.getAttribute("aria-selected") === "true")?.id ??
          null,
      );
    });

    test("プレビュータブの中でリンクをたどると固定する", async () => {
      await openTwoFiles((path) =>
        path === "a.md" ? "[次へ](b.md)\n" : "## b.md\n",
      );
      await act(async () => fireEvent.click(treeItem("a.md"), { detail: 1 }));
      const link = await waitFor(() =>
        screen.getByRole("link", { name: "次へ" }),
      );

      await act(async () => link.click());

      await waitFor(() => expect(heading()).toBe("b.md"));
      expect(tabNames()).toEqual(["b.md"]);
    });

    test("タブを切り替えると読み直し、閉じると隣のタブを表示する", async () => {
      const requested = await openTwoFiles();
      await act(async () => fireEvent.click(treeItem("a.md"), { detail: 2 }));
      await waitFor(() => expect(heading()).toBe("a.md"));
      await act(async () => fireEvent.click(treeItem("b.md"), { detail: 2 }));
      await waitFor(() => expect(heading()).toBe("b.md"));

      // `Ctrl+Tab` は次のタブへ（端では先頭へ回る）。
      const next = new KeyboardEvent("keydown", {
        key: "Tab",
        ctrlKey: true,
        cancelable: true,
      });
      await act(async () => {
        window.dispatchEvent(next);
      });
      await waitFor(() => expect(heading()).toBe("a.md"));
      expect(next.defaultPrevented).toBe(true);

      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "a.md を閉じる" })),
      );
      await waitFor(() => expect(heading()).toBe("b.md"));

      expect(tabNames()).toEqual(["b.md"]);
      expect(requested).toEqual(["a.md", "b.md", "a.md", "b.md"]);
    });

    test("タブを切り替えて戻っても、各タブの離れたときのスクロール位置で表示する", async () => {
      await openTwoFiles();
      const panel = () => screen.getByRole("tabpanel");
      await act(async () => fireEvent.click(treeItem("a.md"), { detail: 2 }));
      await waitFor(() => expect(heading()).toBe("a.md"));
      panel().scrollTop = 500;
      await act(async () => fireEvent.click(treeItem("b.md"), { detail: 2 }));
      await waitFor(() => expect(heading()).toBe("b.md"));
      panel().scrollTop = 200;

      const tabNamed = (name: string) =>
        screen.getByRole("tab", { name: new RegExp(`^${name}`) });
      // 切り替えた直後のプレビュー領域には前のタブの本文が残っている。その位置を
      // 切り替え先の履歴へ書き込まない。
      await act(async () => fireEvent.click(tabNamed("a.md")));
      await waitFor(() => expect(heading()).toBe("a.md"));
      await waitFor(() => expect(panel().scrollTop).toBe(500));

      await act(async () => fireEvent.click(tabNamed("b.md")));
      await waitFor(() => expect(heading()).toBe("b.md"));
      await waitFor(() => expect(panel().scrollTop).toBe(200));
    });

    test("見出しを指すリンクの文書が別のタブで開いていれば、そのタブで見出しへ移る", async () => {
      const scrolled: string[] = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this.id);
      };
      try {
        await openTwoFiles((path) =>
          path === "a.md" ? "[bの設定](b.md#設定)\n" : "## b.md\n\n### 設定\n",
        );
        await act(async () => fireEvent.click(treeItem("b.md"), { detail: 2 }));
        await waitFor(() => expect(heading()).toBe("b.md"));
        await act(async () => fireEvent.click(treeItem("a.md"), { detail: 2 }));
        const link = await waitFor(() =>
          screen.getByRole("link", { name: "bの設定" }),
        );

        await act(async () => link.click());

        await waitFor(() => expect(scrolled).toEqual(["user-content-設定"]));
        expect(tabNames()).toEqual(["b.md", "a.md"]);
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    test("リンクの読込中に文書内の見出しへ移ると、その読込を捨て、遷移先を後から開ける", async () => {
      let bCalls = 0;
      mockBackend({
        scan: () => ({
          path: "",
          entries: ["a.md", "b.md", "c.md"].map((name) => ({
            path: name,
            name,
            kind: "markdown" as const,
            hasChildren: null,
          })),
        }),
        read: (path) => {
          if (path === "a.md")
            return fileContent(path, "[次へ](b.md) [節へ](#節)\n\n## 節\n");
          if (path === "c.md") return fileContent(path, "## c.md\n");
          bCalls += 1;
          // 最初の読込は応答を返さず、文書内の移動で無効になる。
          return bCalls === 1
            ? new Promise<FileContent>(() => {})
            : fileContent(path, "## b.md\n");
        },
      });
      render(<App />);
      await waitFor(() =>
        expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
      );
      await openWorkspace({ scopeId: "scope-1", label: "docs" });
      await act(async () =>
        fireEvent.click(await waitFor(() => treeItem("a.md")), { detail: 2 }),
      );
      await waitFor(() => screen.getByRole("link", { name: "次へ" }));

      await act(async () => screen.getByRole("link", { name: "次へ" }).click());
      await act(async () => screen.getByRole("link", { name: "節へ" }).click());
      await act(async () => fireEvent.click(treeItem("c.md"), { detail: 2 }));
      await waitFor(() => expect(heading()).toBe("c.md"));
      await act(async () => fireEvent.click(treeItem("b.md"), { detail: 1 }));

      await waitFor(() => expect(heading()).toBe("b.md"));
      expect(tabNames()).toEqual(["a.md", "c.md", "b.md(preview)"]);
      expect(bCalls).toBe(2);
    });

    const NOT_FOUND: IpcError = {
      code: "fileNotFound",
      message: "ファイルが見つかりません。",
      detail: null,
    };

    test.each([
      [
        "完了すれば、そのタブに遷移先を表示する",
        "resolve",
        "b.md",
        ["b.md", "c.md"],
      ],
      [
        "失敗すれば、そのタブに元の文書と理由を表示する",
        "reject",
        "a.md",
        ["a.md", "c.md"],
      ],
    ] as const)(
      "リンクで読み込んでいる最中に別のタブへ移り、同じ文書をツリーから開いても、読込を続けて重複させない（%s）",
      async (_, outcome, expectedHeading, expectedTabs) => {
        let settleB: () => void = () => {};
        const requested: string[] = [];
        mockBackend({
          scan: () => ({
            path: "",
            entries: ["a.md", "b.md", "c.md"].map((name) => ({
              path: name,
              name,
              kind: "markdown" as const,
              hasChildren: null,
            })),
          }),
          read: (path) => {
            requested.push(path);
            if (path === "a.md")
              return fileContent(path, "## a.md\n\n[次へ](b.md)\n");
            if (path === "c.md") return fileContent(path, "## c.md\n");
            return new Promise<FileContent>((resolve, reject) => {
              settleB = () =>
                outcome === "resolve"
                  ? resolve(fileContent(path, "## b.md\n"))
                  : reject(NOT_FOUND);
            });
          },
        });
        render(<App />);
        await waitFor(() =>
          expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
        );
        await openWorkspace({ scopeId: "scope-1", label: "docs" });
        await act(async () =>
          fireEvent.click(await waitFor(() => treeItem("a.md")), {
            detail: 2,
          }),
        );
        const link = await waitFor(() =>
          screen.getByRole("link", { name: "次へ" }),
        );

        await act(async () => link.click());
        await act(async () => fireEvent.click(treeItem("c.md"), { detail: 2 }));
        await waitFor(() => expect(heading()).toBe("c.md"));
        await act(async () => fireEvent.click(treeItem("b.md"), { detail: 1 }));
        await act(async () => settleB());

        await waitFor(() => expect(heading()).toBe(expectedHeading));
        expect(tabNames()).toEqual([...expectedTabs]);
        // 進行中の読込を捨てて、元の文書を読み直さない。
        expect(requested.filter((path) => path === "b.md")).toHaveLength(1);
        if (outcome === "reject") {
          expect(screen.getByText(NOT_FOUND.message)).toBeTruthy();
        }
      },
    );

    test("最後のタブを閉じると本文を表示しない", async () => {
      await openTwoFiles();
      await act(async () => fireEvent.click(treeItem("a.md"), { detail: 1 }));
      await waitFor(() => expect(heading()).toBe("a.md"));

      await act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "a.md を閉じる" })),
      );

      expect(screen.queryByRole("tablist")).toBeNull();
      expect(heading()).toBeUndefined();
    });
  });

  test("文書内検索は本文だけを対象にし、一覧のファイル名に一致しない（8.6）", async () => {
    // happy-domはCSS Custom Highlight APIを持たない。登録された範囲だけを控える。
    // `CSS` はアクセスのたびに新しいオブジェクトを返すため、プロパティごと差し替える。
    const saved = Object.getOwnPropertyDescriptor(globalThis, "CSS");
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { highlights: new Map() },
    });
    const global = globalThis as { Highlight?: unknown };
    global.Highlight = class {};
    try {
      mockBackend({
        scan: () => ROOT,
        read: (path) => fileContent(path, "README.md の説明\n"),
      });
      render(<App />);
      await openReadme();
      await waitFor(() => expect(screen.getByText(/の説明/)).toBeTruthy());

      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "f", ctrlKey: true }),
        );
      });
      fireEvent.change(screen.getByRole("textbox", { name: "文書内を検索" }), {
        target: { value: "readme.md" },
      });

      expect(screen.getByRole("status").textContent).toBe("1 / 1");
      // ハイライトの登録の片付けを、差し替えを戻す前に済ませる。
      cleanup();
    } finally {
      if (saved) Object.defineProperty(globalThis, "CSS", saved);
      delete global.Highlight;
    }
  });

  test("本文の画像はRust側のcommandでresource IDを発行して表示する（5.4）", async () => {
    const requests: ImageResourceRequest[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path) => fileContent(path, "![ロゴ](assets/logo.png)\n"),
      issue: (request) => {
        requests.push(request);
        return request.references.map((reference) => ({
          status: "issued",
          reference,
          resourceId: "logo-id",
        }));
      },
    });
    render(<App />);
    await openReadme();

    const image = await waitFor(() =>
      screen.getByRole("img", { name: "ロゴ" }),
    );
    expect(image.getAttribute("src")).toBe(
      "http://mdperuse-img.localhost/logo-id",
    );
    expect(requests).toEqual([
      { documentPath: "README.md", references: ["assets/logo.png"] },
    ]);
  });
});
