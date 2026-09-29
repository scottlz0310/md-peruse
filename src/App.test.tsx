import { afterEach, describe, expect, test } from "bun:test";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
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
import type { FileChange } from "./types/generated/FileChange";
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
  read?: (path: string, scopeId: string) => FileContent | Promise<FileContent>;
  /** loose tabのスコープを閉じる要求（`close_loose_scope_command`）。 */
  closeLoose?: (scopeId: string) => void | Promise<void>;
  /** loose tabの監視先を付け替える要求（`watch_loose_document_command`）。 */
  watchLoose?: (request: {
    scopeId: string;
    path: string;
    tabId: string;
    generation: number;
  }) => void | Promise<void>;
  openUrl?: (url: string) => void;
  issue?: (request: ImageResourceRequest) => ImageResource[];
  updateSettings?: (update: UiSettingsUpdate) => void;
  setTitle?: (title: string) => void;
  /** 起動時に返す設定の上書き。 */
  ui?: Partial<UiSettings>;
  /** 設定の取得を受けたときの処理。応答を遅らせたり、その間に何かを起こしたりするために使う。 */
  onLoadUi?: () => void | Promise<void>;
  /** 起動時の問い合わせ（`get_workspace_command`）への応答。既定は「開いていない」。 */
  currentWorkspace?: () =>
    | WorkspaceOpenedEvent
    | null
    | Promise<WorkspaceOpenedEvent | null>;
  /** 最近使ったフォルダーの項目を開く要求（`open_recent_folder_command`）。 */
  openRecent?: (id: string) => void | Promise<void>;
};

const UI_SETTINGS: UiSettings = {
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
      if (command === "get_workspace_command")
        return Promise.resolve(handlers.currentWorkspace?.() ?? null);
      if (command === "open_recent_folder_command")
        return handlers.openRecent?.((payload as { id: string }).id);
      if (command === "get_ui_settings_command")
        return Promise.resolve(handlers.onLoadUi?.()).then(() => ({
          ...UI_SETTINGS,
          ...handlers.ui,
        }));
      if (command === "update_ui_settings_command") {
        handlers.updateSettings?.(
          (payload as { update: UiSettingsUpdate }).update,
        );
        return null;
      }
      if (command === "plugin:window|set_title") {
        handlers.setTitle?.((payload as { value: string }).value);
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
      if (command === "watch_loose_document_command") {
        return handlers.watchLoose?.(
          (
            payload as {
              request: Parameters<NonNullable<Handlers["watchLoose"]>>[0];
            }
          ).request,
        );
      }
      if (command === "close_loose_scope_command") {
        return handlers.closeLoose?.((payload as { scopeId: string }).scopeId);
      }
      const request = (
        payload as { request: { path: string; scopeId: string } }
      ).request;
      if (command === "scan_directory_command")
        return handlers.scan(request.path);
      if (command === "read_file_command" && handlers.read)
        return handlers.read(request.path, request.scopeId);
      throw new Error(`想定外のcommand: ${command}`);
    },
    { shouldMockEvents: true },
  );
  // `getCurrentWindow` が現在のウィンドウのラベルを読むため。
  mockWindows("main");
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

  test.each([
    ["ja", "メニューの「ファイル」から「フォルダーを開く」を選んでください。"],
    ["en", 'Choose "Open Folder..." from the "File" menu.'],
  ] as const)(
    "設定の effectiveLanguage（%s）で案内を表示し、html の lang を合わせる（10.5）",
    async (language, welcome) => {
      mockBackend({ scan: () => ROOT, ui: { effectiveLanguage: language } });
      render(<App />);

      await waitFor(() => expect(screen.getByText(welcome)).toBeTruthy());
      expect(document.documentElement.lang).toBe(language);
    },
  );

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

  test("英語の設定では、ワークスペースの画面の文言も英語になる（10.5）", async () => {
    mockBackend({ scan: () => ROOT, ui: { effectiveLanguage: "en" } });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Open Folder/)).toBeTruthy());
    await openWorkspace({ scopeId: "scope-1", label: "docs" });

    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Explorer" })).toBeTruthy(),
    );
    expect(screen.getByRole("tree", { name: "Files" })).toBeTruthy();
    expect(
      screen.getByRole("separator", { name: "Sidebar width" }),
    ).toBeTruthy();
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

  describe("ワークスペースを閉じる（6.1）", () => {
    async function closeWorkspace() {
      await act(async () => {
        await emit("workspace-closed");
      });
    }

    test("タブとツリーを破棄してwelcome状態へ戻る", async () => {
      mockBackend({
        scan: () => ROOT,
        read: (path) => fileContent(path, "## 本文\n"),
      });
      render(<App />);
      await openReadme();
      await waitFor(() => expect(screen.getByRole("tablist")).toBeTruthy());

      await closeWorkspace();

      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "md-peruse",
      );
      expect(screen.queryByRole("navigation")).toBeNull();
      expect(screen.queryByRole("tablist")).toBeNull();
    });

    test("閉じる前に始めた読込の応答は表示しない", async () => {
      let release: (content: FileContent) => void = () => {};
      mockBackend({
        scan: () => ROOT,
        read: () =>
          new Promise<FileContent>((resolve) => {
            release = resolve;
          }),
      });
      render(<App />);
      await openReadme();
      const pending = release;

      await closeWorkspace();
      await act(async () => {
        pending(fileContent("README.md", "## 古い本文\n"));
      });

      expect(screen.queryByText("古い本文")).toBeNull();
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "md-peruse",
      );
    });

    test("開き直すと、閉じる前に変えた幅で表示する", async () => {
      mockBackend({ scan: () => ROOT });
      render(<App />);
      await openWorkspace({ scopeId: "scope-1", label: "docs" });
      const separator = await waitFor(() => screen.getByRole("separator"));
      fireEvent.keyDown(separator, { key: "ArrowRight" });

      await closeWorkspace();
      await openWorkspace({ scopeId: "scope-2", label: "docs" });

      const reopened = await waitFor(() => screen.getByRole("separator"));
      expect(reopened.getAttribute("aria-valuenow")).toBe("296");
      await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());
    });
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
        // タブバーが自分のタブを見える位置へ動かす呼び出し（9.1）は、見出しへの移動ではない。
        if (this.getAttribute("role") === "tab") return;
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

    test("「タブを閉じる」はアクティブタブを閉じ、隣のタブを表示する（10.1）", async () => {
      await openTwoFiles();
      await act(async () => fireEvent.click(treeItem("a.md"), { detail: 2 }));
      await waitFor(() => expect(heading()).toBe("a.md"));
      await act(async () => fireEvent.click(treeItem("b.md"), { detail: 2 }));
      await waitFor(() => expect(heading()).toBe("b.md"));

      await act(async () => {
        await emit("menu-command", "closeTab");
      });

      await waitFor(() => expect(heading()).toBe("a.md"));
      expect(tabNames()).toEqual(["a.md"]);
    });

    test("タブが無いときの「タブを閉じる」は何もしない（10.1）", async () => {
      await openTwoFiles();

      await act(async () => {
        await emit("menu-command", "closeTab");
      });

      expect(screen.queryByRole("tablist")).toBeNull();
      expect(heading()).toBeUndefined();
    });
  });

  describe("表示メニュー（10.1、10.3）", () => {
    function menuCommand(command: string) {
      return act(async () => {
        await emit("menu-command", command);
      });
    }

    /** 本文の文字サイズを渡す `style` 要素の倍率。 */
    function fontScale() {
      const style = [...document.querySelectorAll("style")].find((element) =>
        element.textContent?.includes("--font-scale"),
      );
      return style?.textContent?.match(/--font-scale: ([\d.]+)/)?.[1];
    }

    test("サイドバーの表示を切り替え、表示状態を保存する", async () => {
      const updates: UiSettingsUpdate[] = [];
      mockBackend({ scan: () => ROOT, updateSettings: (u) => updates.push(u) });
      render(<App />);
      await openWorkspace({ scopeId: "scope-1", label: "docs" });
      await waitFor(() => expect(screen.getByRole("navigation")).toBeTruthy());

      await menuCommand("toggleSidebar");
      expect(screen.queryByRole("navigation")).toBeNull();
      expect(screen.queryByRole("separator")).toBeNull();

      await menuCommand("toggleSidebar");
      expect(screen.getByRole("navigation")).toBeTruthy();
      await waitFor(() =>
        expect(updates).toEqual([
          { sidebarVisible: false },
          { sidebarVisible: true },
        ]),
      );
    });

    type FontAction =
      | { menu: string }
      | { key: { key: string; code: string; shiftKey?: boolean } };

    test.each<[string, FontAction[], number[], string]>([
      ["メニューで大きくする", [{ menu: "increaseFontSize" }], [110], "1.1"],
      ["メニューで小さくする", [{ menu: "decreaseFontSize" }], [90], "0.9"],
      [
        "既定に戻す",
        [{ menu: "increaseFontSize" }, { menu: "resetFontSize" }],
        [110, 100],
        "1",
      ],
      [
        "US配列の Ctrl+Shift+= で大きくする",
        [{ key: { key: "+", code: "Equal", shiftKey: true } }],
        [110],
        "1.1",
      ],
      [
        "JIS配列の Ctrl+Shift+; で大きくする",
        [{ key: { key: "+", code: "Semicolon", shiftKey: true } }],
        [110],
        "1.1",
      ],
      [
        "テンキーの + で大きくする",
        [{ key: { key: "+", code: "NumpadAdd" } }],
        [110],
        "1.1",
      ],
      [
        "テンキーの - で小さくする",
        [{ key: { key: "-", code: "NumpadSubtract" } }],
        [90],
        "0.9",
      ],
      [
        "テンキーの 0 で既定に戻す",
        [
          { key: { key: "+", code: "NumpadAdd" } },
          { key: { key: "0", code: "Numpad0" } },
        ],
        [110, 100],
        "1",
      ],
      // `Ctrl+=` はメニューのアクセラレータとしてRust側が受ける。ページでも扱うと二重になる。
      [
        "Ctrl+= はページで扱わない",
        [{ key: { key: "=", code: "Equal" } }],
        [],
        "1",
      ],
      // 既定のまま既定に戻しても書き込まない。
      ["変わらなければ保存しない", [{ menu: "resetFontSize" }], [], "1"],
    ])("文字サイズ: %s", async (_, actions, saved, scale) => {
      const updates: UiSettingsUpdate[] = [];
      mockBackend({ scan: () => ROOT, updateSettings: (u) => updates.push(u) });
      render(<App />);
      await openWorkspace({ scopeId: "scope-1", label: "docs" });
      await waitFor(() => expect(fontScale()).toBe("1"));

      for (const action of actions) {
        if ("menu" in action) {
          await menuCommand(action.menu);
        } else {
          await act(async () =>
            fireEvent.keyDown(window, { ...action.key, ctrlKey: true }),
          );
        }
      }

      expect(fontScale()).toBe(scale);
      await waitFor(() =>
        expect(updates).toEqual(
          saved.map((fontScalePercent) => ({ fontScalePercent })),
        ),
      );
    });

    test("再読み込みは表示中の文書を読み直し、失敗しても表示を保つ", async () => {
      const missing: IpcError = {
        code: "fileNotFound",
        message: "ファイルが見つかりません。",
        detail: "README.md",
      };
      const versions: (FileContent | IpcError)[] = [
        fileContent("README.md", "## 1版\n"),
        fileContent("README.md", "## 2版\n"),
        missing,
      ];
      mockBackend({
        scan: () => ROOT,
        read: () => {
          const next = versions.shift();
          if (next === undefined) throw new Error("想定外の読込");
          return "code" in next ? Promise.reject(next) : next;
        },
      });
      render(<App />);
      await openReadme();
      const heading = () =>
        screen.getByRole("heading", { level: 2 }).textContent;
      await waitFor(() => expect(heading()).toBe("1版"));

      await menuCommand("reloadDocument");
      await waitFor(() => expect(heading()).toBe("2版"));

      await menuCommand("reloadDocument");
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(missing.message),
      );
      expect(heading()).toBe("2版");
      expect(screen.getAllByRole("tab")).toHaveLength(1);
    });

    test("タブが無いときの再読み込みは何もしない", async () => {
      mockBackend({ scan: () => ROOT });
      render(<App />);
      await openWorkspace({ scopeId: "scope-1", label: "docs" });
      await waitFor(() => expect(screen.getByRole("navigation")).toBeTruthy());

      // 読込を始めれば、`read` を用意していないため想定外のcommandで失敗する。
      await menuCommand("reloadDocument");

      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("ウィンドウタイトル（10.1.2）", () => {
    test("welcome、ワークスペース、表示中の文書に合わせて変わり、閉じると戻る", async () => {
      const titles: string[] = [];
      mockBackend({
        scan: () => ROOT,
        read: (path) => fileContent(path, "## 本文\n"),
        setTitle: (title) => titles.push(title),
      });
      render(<App />);
      await waitFor(() => expect(titles.at(-1)).toBe("md-peruse"));

      await openWorkspace({ scopeId: "scope-1", label: "src\\docs" });
      await waitFor(() => expect(titles.at(-1)).toBe("src\\docs - md-peruse"));

      await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());
      await act(async () => {
        screen.getByText("README.md").click();
      });
      await waitFor(() =>
        expect(titles.at(-1)).toBe("README.md - src\\docs - md-peruse"),
      );

      await act(async () => {
        await emit("menu-command", "closeTab");
      });
      await waitFor(() => expect(titles.at(-1)).toBe("src\\docs - md-peruse"));

      await act(async () => {
        await emit("workspace-closed");
      });
      await waitFor(() => expect(titles.at(-1)).toBe("md-peruse"));
    });

    test.each([
      ["welcome", "md-peruse", false],
      ["ワークスペースの表示中", "docs - md-peruse", true],
    ])(
      "%sにタイトルを設定できなければ理由を示す",
      async (_, failing, opens) => {
        mockBackend({
          scan: () => ROOT,
          setTitle: (title) => {
            if (title === failing) throw new Error("タイトルを設定できない");
          },
        });
        render(<App />);
        if (opens) await openWorkspace({ scopeId: "scope-1", label: "docs" });

        await waitFor(() =>
          expect(screen.getByRole("alert").textContent).toContain(
            "タイトルを設定できない",
          ),
        );
      },
    );
  });

  describe("パンくず（10.1.1）", () => {
    const DEEP: Record<string, ScanResult> = {
      "": ROOT,
      docs: {
        path: "docs",
        entries: [
          {
            path: "docs/guide",
            name: "guide",
            kind: "directory",
            hasChildren: true,
          },
        ],
      },
      "docs/guide": {
        path: "docs/guide",
        entries: [
          {
            path: "docs/guide/a.md",
            name: "a.md",
            kind: "markdown",
            hasChildren: null,
          },
        ],
      },
    };

    /**
     * READMEのリンクで docs/guide/a.md を開く。ツリーは畳んだまま（docs 以下は未走査）に
     * なる。`scan` を渡すと、docs 以下の走査をその応答に差し替える。
     */
    async function openDeepDocument(
      options: {
        scan?: (path: string) => ScanResult | Promise<ScanResult>;
        updateSettings?: (update: UiSettingsUpdate) => void;
      } = {},
    ) {
      const scanned: string[] = [];
      mockBackend({
        scan: (path) => {
          scanned.push(path);
          if (path !== "" && options.scan) return options.scan(path);
          const result = DEEP[path];
          if (result === undefined) throw new Error(`想定外の走査: ${path}`);
          return result;
        },
        read: (path) =>
          path === "README.md"
            ? fileContent(path, "[ガイド](docs/guide/a.md)\n")
            : fileContent(path, "## ガイド\n"),
        updateSettings: options.updateSettings,
      });
      render(<App />);
      await waitFor(() =>
        expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
      );
      await openWorkspace({ scopeId: "scope-1", label: "ws" });
      expect(breadcrumb()).toBeNull();
      await act(async () =>
        fireEvent.click(await waitFor(() => screen.getByText("README.md"))),
      );
      const link = await waitFor(() =>
        screen.getByRole("link", { name: "ガイド" }),
      );
      await act(async () => link.click());
      await waitFor(() => expect(breadcrumb()?.textContent).toContain("a.md"));
      return scanned;
    }

    const breadcrumb = () =>
      screen.queryByRole("navigation", { name: "パンくずリスト" });
    const selectCrumb = (name: string) =>
      act(async () => {
        const nav = breadcrumb();
        if (nav === null) throw new Error("パンくずが無い");
        fireEvent.click(within(nav).getByRole("button", { name }));
      });
    const treeItemOf = (label: string) =>
      within(screen.getByRole("tree"))
        .getByText(label)
        .closest('[role="treeitem"]');
    const expandedItems = () =>
      screen
        .getAllByRole("treeitem")
        .filter((item) => item.getAttribute("aria-expanded") === "true")
        .map((item) => item.querySelector(".tree-label")?.textContent);

    test.each([
      ["先頭のセグメントはツリーの先頭へ移る", "ws", "docs", [""], []],
      ["フォルダーを展開して移る", "docs", "docs", ["", "docs"], ["docs"]],
      [
        "未走査の祖先も走査して展開し、見えてから移る",
        "guide",
        "guide",
        ["", "docs", "docs/guide"],
        ["docs", "guide"],
      ],
    ])("%s", async (_, crumb, focused, scans, expanded) => {
      const scanned = await openDeepDocument();

      await selectCrumb(crumb);

      await waitFor(() =>
        expect(document.activeElement).toBe(treeItemOf(focused)),
      );
      expect(scanned).toEqual(scans);
      expect(expandedItems()).toEqual(expanded);
    });

    test("サイドバーが非表示なら表示して保存してから移る", async () => {
      const updates: UiSettingsUpdate[] = [];
      await openDeepDocument({ updateSettings: (u) => updates.push(u) });
      await act(async () => {
        await emit("menu-command", "toggleSidebar");
      });
      expect(screen.queryByRole("tree")).toBeNull();

      await selectCrumb("guide");

      await waitFor(() =>
        expect(document.activeElement).toBe(treeItemOf("guide")),
      );
      await waitFor(() =>
        expect(updates).toEqual([
          { sidebarVisible: false },
          { sidebarVisible: true },
        ]),
      );
    });

    test("走査を待つ間にワークスペースを閉じたら、開き直したツリーでフォーカスを動かさない", async () => {
      // docs 以下の走査は応答しない。
      await openDeepDocument({ scan: () => new Promise<ScanResult>(() => {}) });
      await selectCrumb("guide");
      await waitFor(() =>
        expect(document.activeElement).toBe(treeItemOf("docs")),
      );

      await act(async () => {
        await emit("workspace-closed");
      });
      await openWorkspace({ scopeId: "scope-2", label: "ws" });
      await waitFor(() => screen.getByRole("tree"));

      expect(document.activeElement).toBe(document.body);
      expect(breadcrumb()).toBeNull();
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
      {
        scopeId: "scope-1",
        documentPath: "README.md",
        references: ["assets/logo.png"],
      },
    ]);
  });
});

describe("App: UI言語の切り替え（10.5）", () => {
  const changeLanguage = (
    preference: "system" | "ja" | "en",
    language: "ja" | "en",
  ) =>
    act(async () => {
      await emit("language-changed", { preference, language });
    });

  test("言語の切り替えのeventを受けると、案内の文言とhtmlのlangが切り替わる", async () => {
    mockBackend({ scan: () => ROOT });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    expect(document.documentElement.lang).toBe("ja");

    await changeLanguage("en", "en");

    expect(screen.getByText(/Open Folder/)).toBeTruthy();
    expect(screen.queryByText(/フォルダーを開く/)).toBeNull();
    expect(document.documentElement.lang).toBe("en");

    // `system` を選ぶと、OSの表示言語で決め直した実際の言語が届く。
    await changeLanguage("system", "ja");

    expect(screen.getByText(/フォルダーを開く/)).toBeTruthy();
    expect(document.documentElement.lang).toBe("ja");
  });

  test("設定の応答より先に切り替えのeventが届いても、その言語で表示する", async () => {
    // 起動直後に言語を選ぶと、設定の応答（旧言語）より先にeventが届くことがある。
    let release: () => void = () => {};
    let requested = false;
    mockBackend({
      scan: () => ROOT,
      onLoadUi: () =>
        new Promise<void>((resolve) => {
          requested = true;
          release = resolve;
        }),
    });
    render(<App />);
    await waitFor(() => expect(requested).toBe(true));

    await changeLanguage("en", "en");
    await act(async () => release());

    await waitFor(() => expect(screen.getByText(/Open Folder/)).toBeTruthy());
    expect(screen.queryByText(/フォルダーを開く/)).toBeNull();
    expect(document.documentElement.lang).toBe("en");
  });

  test("設定を読み始める時点で、言語の切り替えの購読は済んでいる", async () => {
    // 設定を読んだ直後の切り替えは、応答が届く前にeventになる。読み取りを購読より先に発行すると、
    // その切り替えは誰にも届かず、旧言語の応答だけが残る。
    mockBackend({
      scan: () => ROOT,
      onLoadUi: () =>
        emit("language-changed", { preference: "en", language: "en" }),
    });
    render(<App />);

    await waitFor(() => expect(screen.getByText(/Open Folder/)).toBeTruthy());
    expect(document.documentElement.lang).toBe("en");
  });

  test("eventを受けなければ、文言は変わらない", async () => {
    mockBackend({ scan: () => ROOT, ui: { effectiveLanguage: "en" } });
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Open Folder/)).toBeTruthy());

    // 設定の `language` が `system` のままでも、OSの表示言語を監視して切り替えない。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(screen.getByText(/Open Folder/)).toBeTruthy();
  });

  test("ワークスペースの画面のラベルも切り替わる", async () => {
    mockBackend({ scan: () => ROOT });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openWorkspace({ scopeId: "scope-1", label: "docs" });
    await waitFor(() => screen.getByRole("tree", { name: "ファイル" }));

    await changeLanguage("en", "en");

    expect(screen.getByRole("tree", { name: "Files" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Explorer" })).toBeTruthy();
    expect(screen.queryByRole("tree", { name: "ファイル" })).toBeNull();
  });

  test("文書の中の数式の理由も、切り替えたあとの言語で組み立て直す", async () => {
    mockBackend({
      scan: () => ROOT,
      read: (path) => fileContent(path, "前 $\\frac{1}{$ 後\n"),
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openWorkspace({ scopeId: "scope-1", label: "docs" });
    await waitFor(() => screen.getByRole("tree"));
    await act(async () =>
      fireEvent.click(within(screen.getByRole("tree")).getByText("README.md"), {
        detail: 2,
      }),
    );
    const reason = () =>
      document.querySelector(".math-error-reason")?.textContent;
    await waitFor(() => expect(reason()).toContain("数式を解釈できません"));

    await changeLanguage("en", "en");

    await waitFor(() => expect(reason()).toContain("Cannot parse the formula"));
  });

  test("言語を切り替える前に発行した要求の応答が旧言語で届いても、そのまま表示する", async () => {
    // Rust側はIPCの応答を、要求を受けた時点の言語で組み立てる。切り替えの直後に旧言語の
    // 応答が届いても、表示は壊れず、同じ操作をやり直せば新しい言語になる（10.5）。
    let release: (result: ScanResult) => void = () => {};
    mockBackend({
      scan: () =>
        new Promise<ScanResult>((resolve) => {
          release = resolve;
        }),
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openWorkspace({ scopeId: "scope-1", label: "docs" });
    await waitFor(() => screen.getByRole("tree", { name: "ファイル" }));

    await changeLanguage("en", "en");
    await act(async () => release(ROOT));

    expect(
      await screen.findByText("README.md", {}, { timeout: 1000 }),
    ).toBeTruthy();
    expect(screen.getByRole("tree", { name: "Files" })).toBeTruthy();
  });
});

describe("App: md-peruse について（11.3）", () => {
  const LICENSES = {
    application: {
      name: "md-peruse",
      version: "9.8.7",
      license: "MIT",
      texts: [{ label: "LICENSE", index: 0 }],
    },
    licenseTexts: ["MIT License"],
    packages: [
      {
        name: "react",
        version: "19.0.0",
        license: "MIT",
        texts: [{ label: "LICENSE", index: 0 }],
      },
    ],
  };

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** 同梱したライセンス一覧を返す `fetch` へ差し替え、要求したURLを控える。 */
  function serveLicenses() {
    const requested: string[] = [];
    globalThis.fetch = (async (url: string) => {
      requested.push(url);
      return new Response(JSON.stringify(LICENSES));
    }) as unknown as typeof fetch;
    return requested;
  }

  const aboutCommand = () =>
    act(async () => {
      await emit("menu-command", "about");
    });

  test("ワークスペースを開いていなくても、ダイアログを開ける", async () => {
    const requested = serveLicenses();
    mockBackend({ scan: () => ROOT });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );

    await aboutCommand();

    const dialog = screen.getByRole("dialog", { name: "md-peruse について" });
    expect(await within(dialog).findByText("バージョン 9.8.7")).toBeTruthy();
    expect(requested).toEqual(["/third-party-licenses.json"]);
  });

  test("ワークスペースを開いているときも開け、閉じると本文へ戻る", async () => {
    serveLicenses();
    mockBackend({ scan: () => ROOT });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openWorkspace({ scopeId: "scope-1", label: "docs" });
    await waitFor(() => screen.getByRole("tree", { name: "ファイル" }));

    await aboutCommand();
    const dialog = screen.getByRole("dialog", { name: "md-peruse について" });
    await within(dialog).findByText("バージョン 9.8.7");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "閉じる" }));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("tree", { name: "ファイル" })).toBeTruthy();
  });

  test("言語を切り替えると、開いているダイアログの文言も切り替わる", async () => {
    serveLicenses();
    mockBackend({ scan: () => ROOT });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await aboutCommand();
    await screen.findByText("バージョン 9.8.7");

    await act(async () => {
      await emit("language-changed", { preference: "en", language: "en" });
    });

    expect(
      screen.getByRole("dialog", { name: "About md-peruse" }),
    ).toBeTruthy();
    expect(screen.getByText("Version 9.8.7")).toBeTruthy();
  });
});

describe("App: ワークスペースの復元と最近使ったフォルダー（9.2、11.1）", () => {
  const RESTORED: WorkspaceOpenedEvent = {
    scopeId: "scope-restored",
    label: "dev\\docs",
  };
  const OTHER: WorkspaceOpenedEvent = {
    scopeId: "scope-other",
    label: "work\\notes",
  };
  const RECENTS = [
    { id: "recent-1-0", label: "dev\\docs" },
    { id: "recent-1-1", label: "work\\notes" },
  ];

  const sidebarLabel = () =>
    screen.getByRole("heading", { level: 1 }).textContent;

  const recentLabels = (section: HTMLElement) =>
    within(section)
      .getAllByRole("button")
      .map((button) => button.textContent);

  test("起動時に問い合わせて、Rustが開き直したワークスペースを表示する", async () => {
    // Rustは、WebViewが購読する前にワークスペースを開き直している。通知は誰にも届かない。
    mockBackend({ scan: () => ROOT, currentWorkspace: () => RESTORED });
    render(<App />);

    await waitFor(() => screen.getByRole("tree", { name: "ファイル" }));

    expect(sidebarLabel()).toBe("dev\\docs");
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  test("問い合わせの時点で、開閉の購読は済んでいる", async () => {
    // 問い合わせの直後にワークスペースが開かれても、その通知は購読済みで受け取れる。
    // 購読より先に問い合わせると、その通知を逃す。
    mockBackend({
      scan: () => ROOT,
      currentWorkspace: async () => {
        await emit("workspace-opened", RESTORED);
        return null;
      },
    });
    render(<App />);

    await waitFor(() => screen.getByRole("tree", { name: "ファイル" }));

    expect(sidebarLabel()).toBe("dev\\docs");
  });

  test("問い合わせの応答より先に通知が届いたときは、古い応答で上書きしない", async () => {
    let release: (opened: WorkspaceOpenedEvent | null) => void = () => {};
    let requested = false;
    mockBackend({
      scan: () => ROOT,
      currentWorkspace: () =>
        new Promise((resolve) => {
          requested = true;
          release = resolve;
        }),
    });
    render(<App />);
    await waitFor(() => expect(requested).toBe(true));

    await openWorkspace(OTHER);
    await act(async () => release(RESTORED));

    await waitFor(() => screen.getByRole("tree", { name: "ファイル" }));
    expect(sidebarLabel()).toBe("work\\notes");
  });

  test("問い合わせの応答より先に閉じる通知が届いたときも、古い応答で開き直さない", async () => {
    let release: (opened: WorkspaceOpenedEvent | null) => void = () => {};
    let requested = false;
    mockBackend({
      scan: () => ROOT,
      currentWorkspace: () =>
        new Promise((resolve) => {
          requested = true;
          release = resolve;
        }),
    });
    render(<App />);
    await waitFor(() => expect(requested).toBe(true));

    await act(async () => {
      await emit("workspace-closed");
    });
    await act(async () => release(RESTORED));

    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    expect(screen.queryByRole("tree")).toBeNull();
  });

  test("同じワークスペースが応答と通知の両方で届いても、走査は1回だけ行う", async () => {
    const scanned: string[] = [];
    mockBackend({
      scan: (path) => {
        scanned.push(path);
        return ROOT;
      },
      currentWorkspace: () => RESTORED,
    });
    render(<App />);
    await waitFor(() => screen.getByRole("tree", { name: "ファイル" }));

    await openWorkspace(RESTORED);

    expect(scanned).toEqual([""]);
  });

  test.each([
    ["ja", "最近使ったフォルダー"],
    ["en", "Recent folders"],
  ] as const)(
    "ワークスペースを開いていないとき、最近使ったフォルダーを並べる（%s）",
    async (language, heading) => {
      mockBackend({
        scan: () => ROOT,
        ui: { effectiveLanguage: language, recentFolders: RECENTS },
      });
      render(<App />);

      const section = await screen.findByRole("region", { name: heading });

      expect(recentLabels(section)).toEqual(["dev\\docs", "work\\notes"]);
    },
  );

  test("一覧が空のときは、見出しも出さない", async () => {
    mockBackend({ scan: () => ROOT, ui: { recentFolders: [] } });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );

    expect(screen.queryByText("最近使ったフォルダー")).toBeNull();
  });

  test("一覧の変化の通知で、一覧を丸ごと置き換える", async () => {
    mockBackend({ scan: () => ROOT, ui: { recentFolders: RECENTS } });
    render(<App />);
    await screen.findByRole("region", { name: "最近使ったフォルダー" });

    await act(async () => {
      await emit("recent-folders-changed", {
        folders: [{ id: "recent-2-0", label: "a\\b" }],
      });
    });

    const section = screen.getByRole("region", {
      name: "最近使ったフォルダー",
    });
    expect(recentLabels(section)).toEqual(["a\\b"]);
  });

  test("設定の応答より先に一覧の変化が届いても、新しい一覧を使う", async () => {
    // 設定の応答は、変化より前の一覧を持っている。
    mockBackend({
      scan: () => ROOT,
      ui: { recentFolders: RECENTS },
      onLoadUi: () =>
        emit("recent-folders-changed", {
          folders: [{ id: "recent-2-0", label: "a\\b" }],
        }),
    });
    render(<App />);

    const section = await screen.findByRole("region", {
      name: "最近使ったフォルダー",
    });

    expect(recentLabels(section)).toEqual(["a\\b"]);
  });

  test("項目を選ぶと、IDでRustへ開くよう求め、開いたワークスペースを表示する", async () => {
    const requested: string[] = [];
    mockBackend({
      scan: () => ROOT,
      ui: { recentFolders: RECENTS },
      // 成功はフォルダー選択と同じく、`workspace-opened` で届く。
      openRecent: async (id) => {
        requested.push(id);
        await emit("workspace-opened", OTHER);
      },
    });
    render(<App />);
    const section = await screen.findByRole("region", {
      name: "最近使ったフォルダー",
    });

    await act(async () => {
      fireEvent.click(
        within(section).getByRole("button", { name: "work\\notes" }),
      );
    });

    expect(requested).toEqual(["recent-1-1"]);
    await waitFor(() => screen.getByRole("tree", { name: "ファイル" }));
    expect(sidebarLabel()).toBe("work\\notes");
    // ワークスペースを開いている間は、一覧を出さない。
    expect(screen.queryByText("最近使ったフォルダー")).toBeNull();
  });

  test("開けなかったときは、案内の下に理由を示し、welcome状態のままにする", async () => {
    const notFound: IpcError = {
      code: "workspaceNotFound",
      message: "このフォルダーは見つかりません。",
      detail: null,
    };
    mockBackend({
      scan: () => ROOT,
      ui: { recentFolders: RECENTS },
      openRecent: () => Promise.reject(notFound),
    });
    render(<App />);
    const section = await screen.findByRole("region", {
      name: "最近使ったフォルダー",
    });

    await act(async () => {
      fireEvent.click(
        within(section).getByRole("button", { name: "dev\\docs" }),
      );
    });

    expect((await screen.findByRole("alert")).textContent).toBe(
      "このフォルダーは見つかりません。",
    );
    expect(screen.queryByRole("tree")).toBeNull();
  });
});

describe("App: ファイル変更への追従（6.4、6.5、5.4）", () => {
  const TWO_DOCS: ScanResult = {
    path: "",
    entries: [
      {
        path: "README.md",
        name: "README.md",
        kind: "markdown",
        hasChildren: null,
      },
      {
        path: "NOTES.md",
        name: "NOTES.md",
        kind: "markdown",
        hasChildren: null,
      },
    ],
  };

  const heading = () => screen.getByRole("heading", { level: 2 }).textContent;
  const treeItem = (name: string) =>
    within(screen.getByRole("tree")).getByText(name);

  /**
   * 固定タブで開く（ダブルクリック）。タブが増えても、ツリーの項目を名前で引ける。ツリーは
   * 2回目のクリック（`detail >= 2`）を、ダブルクリックとして扱う。
   */
  async function openPinned(name: string) {
    await act(async () => {
      fireEvent.click(treeItem(name), { detail: 2 });
    });
  }

  function fileChange(change: FileChange, scopeId = "scope-1") {
    return act(async () => {
      await emit("file-change", { scopeId, change });
    });
  }

  test("外部で変更されたアクティブな文書は、読み直して表示する", async () => {
    const versions = ["## 1版\n", "## 2版\n"];
    const reads: string[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path) => {
        reads.push(path);
        return fileContent(path, versions.shift() ?? "## 想定外\n");
      },
    });
    render(<App />);
    await openReadme();
    await waitFor(() => expect(heading()).toBe("1版"));

    await fileChange({ kind: "fileModified", path: "README.md" });

    await waitFor(() => expect(heading()).toBe("2版"));
    expect(reads).toEqual(["README.md", "README.md"]);
  });

  test.each([
    ["別のスコープの同じパス", "README.md", "scope-2"],
    ["別のパス", "other.md", "scope-1"],
  ])("%sの変更では読み直さない", async (_, path, scopeId) => {
    const reads: string[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (requested) => {
        reads.push(requested);
        return fileContent(requested, "## 本文\n");
      },
    });
    render(<App />);
    await openReadme();
    await waitFor(() => expect(heading()).toBe("本文"));

    await fileChange({ kind: "fileModified", path }, scopeId);

    expect(reads).toEqual(["README.md"]);
  });

  test("変更のたびに読み直しても、遅れて届いた古い応答で新しい表示を上書きしない（6.5）", async () => {
    const answers: ((content: FileContent) => void)[] = [];
    mockBackend({
      scan: () => ROOT,
      read: () =>
        new Promise<FileContent>((resolve) => {
          answers.push(resolve);
        }),
    });
    render(<App />);
    await openReadme();
    // 最初の読込が終わらないうちに、文書が変更された。
    await waitFor(() => expect(answers).toHaveLength(1));
    await fileChange({ kind: "fileModified", path: "README.md" });
    await waitFor(() => expect(answers).toHaveLength(2));

    // 後に始めた読込が先に完了し、先に始めた読込があとから届く。
    await act(async () => answers[1]?.(fileContent("README.md", "## 新\n")));
    await waitFor(() => expect(heading()).toBe("新"));
    await act(async () => answers[0]?.(fileContent("README.md", "## 旧\n")));

    expect(heading()).toBe("新");
  });

  test("読み直しに失敗したら、表示を保ち、原因を示す（6.5）", async () => {
    const busy: IpcError = {
      code: "fileNotFound",
      message: "ファイルが見つかりません。",
      detail: "README.md",
    };
    const results: (FileContent | IpcError)[] = [
      fileContent("README.md", "## 1版\n"),
      busy,
    ];
    mockBackend({
      scan: () => ROOT,
      read: () => {
        const next = results.shift();
        if (next === undefined) throw new Error("想定外の読込");
        return "code" in next ? Promise.reject(next) : next;
      },
    });
    render(<App />);
    await openReadme();
    await waitFor(() => expect(heading()).toBe("1版"));

    await fileChange({ kind: "fileModified", path: "README.md" });

    expect((await screen.findByRole("alert")).textContent).toBe(busy.message);
    expect(heading()).toBe("1版");
  });

  describe("削除", () => {
    test("アクティブな文書が削除されたら、最後に読めた内容を保って削除された旨を示し、読み直さない", async () => {
      const reads: string[] = [];
      mockBackend({
        scan: () => ROOT,
        read: (path) => {
          reads.push(path);
          return fileContent(path, "## 本文\n");
        },
      });
      render(<App />);
      await openReadme();
      await waitFor(() => expect(heading()).toBe("本文"));

      await fileChange({ kind: "fileRemoved", path: "README.md" });

      expect(screen.getByRole("status").textContent).toBe(
        "このファイルは削除されました。最後に読めた内容を表示しています。",
      );
      expect(heading()).toBe("本文");
      expect(
        within(screen.getByRole("tablist")).getByText("削除済み"),
      ).toBeTruthy();
      // メニューの「再読み込み」も、削除されたタブは読み直さない。
      await act(async () => {
        await emit("menu-command", "reloadDocument");
      });
      expect(reads).toEqual(["README.md"]);
    });

    test("離れている間に削除されたタブは、切り替えても読み直さず、削除された旨だけを示す（9.1）", async () => {
      const reads: string[] = [];
      mockBackend({
        scan: () => TWO_DOCS,
        read: (path) => {
          reads.push(path);
          return fileContent(path, `## ${path}\n`);
        },
      });
      render(<App />);
      await openWorkspace({ scopeId: "scope-1", label: "docs" });
      await waitFor(() => treeItem("README.md"));
      await openPinned("README.md");
      await waitFor(() => expect(heading()).toBe("README.md"));
      await openPinned("NOTES.md");
      await waitFor(() => expect(heading()).toBe("NOTES.md"));

      await fileChange({ kind: "fileRemoved", path: "README.md" });
      await act(async () => {
        fireEvent.click(screen.getByRole("tab", { name: /README\.md/ }));
      });

      expect(screen.getByRole("status").textContent).toBe(
        "このファイルは削除されました。表示できる内容はありません。",
      );
      expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
      expect(reads).toEqual(["README.md", "NOTES.md"]);
    });

    test("削除された文書の本文のリンクは、新しいタブで開く", async () => {
      mockBackend({
        scan: () => TWO_DOCS,
        read: (path) =>
          fileContent(
            path,
            path === "README.md" ? "[ノート](NOTES.md)\n" : "## ノート\n",
          ),
      });
      render(<App />);
      await openWorkspace({ scopeId: "scope-1", label: "docs" });
      await waitFor(() => treeItem("README.md"));
      await openPinned("README.md");
      await screen.findByRole("link", { name: "ノート" });
      await fileChange({ kind: "fileRemoved", path: "README.md" });

      await act(async () => {
        fireEvent.click(screen.getByRole("link", { name: "ノート" }));
      });

      await waitFor(() => expect(heading()).toBe("ノート"));
      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(2);
      // 元のタブは削除されたまま残る。
      expect(within(tabs[0] as HTMLElement).getByText("削除済み")).toBeTruthy();
    });
  });

  test("renameされた文書は、タブのパスを追従させ、以後の変更を新しいパスで読み直す", async () => {
    const reads: string[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path) => {
        reads.push(path);
        return fileContent(path, "## 本文\n");
      },
    });
    render(<App />);
    await openReadme();
    await waitFor(() => expect(heading()).toBe("本文"));

    await fileChange({
      kind: "fileRenamed",
      oldPath: "README.md",
      path: "docs/GUIDE.md",
    });

    const tab = screen.getByRole("tab");
    expect(tab.getAttribute("title")).toBe("docs/GUIDE.md");
    expect(tab.textContent).toContain("GUIDE.md");
    // 内容は変わらないため、renameだけでは読み直さない。
    expect(reads).toEqual(["README.md"]);

    await fileChange({ kind: "fileModified", path: "docs/GUIDE.md" });

    await waitFor(() => expect(reads).toEqual(["README.md", "docs/GUIDE.md"]));
  });

  test("展開しているフォルダーの子要素が増減したら、その階層を取り直してツリーへ反映する（6.4）", async () => {
    const scanned: string[] = [];
    mockBackend({
      scan: (path) => {
        scanned.push(path);
        return scanned.length === 1
          ? ROOT
          : {
              ...ROOT,
              entries: [
                ...ROOT.entries,
                {
                  path: "NEW.md",
                  name: "NEW.md",
                  kind: "markdown" as const,
                  hasChildren: null,
                },
              ],
            };
      },
    });
    render(<App />);
    await openWorkspace({ scopeId: "scope-1", label: "docs" });
    await waitFor(() => treeItem("README.md"));
    expect(screen.queryByText("NEW.md")).toBeNull();

    await fileChange({ kind: "directoryChanged", path: "" });

    await waitFor(() => expect(screen.getByText("NEW.md")).toBeTruthy());
    expect(scanned).toEqual(["", ""]);
  });

  test.each([
    ["プレビューで開いていたタブ", 1, 1],
    ["固定で開いていたタブ", 2, 2],
  ])(
    "削除されたファイルが同じパスに作り直されたら、ツリーから開き直せる: %s（6.5）",
    async (_, clicks, tabCount) => {
      const versions = ["## 削除前\n", "## 作り直し\n"];
      mockBackend({
        scan: () => ROOT,
        read: (path) => fileContent(path, versions.shift() ?? "## 想定外\n"),
      });
      render(<App />);
      await openWorkspace({ scopeId: "scope-1", label: "docs" });
      await waitFor(() => treeItem("README.md"));
      await act(async () => {
        fireEvent.click(treeItem("README.md"), { detail: clicks });
      });
      await waitFor(() => expect(heading()).toBe("削除前"));
      await fileChange({ kind: "fileRemoved", path: "README.md" });
      expect(screen.getByRole("status")).toBeTruthy();

      // ファイルが同じパスに作り直され、ツリーから開く。
      await act(async () => {
        fireEvent.click(treeItem("README.md"));
      });

      await waitFor(() => expect(heading()).toBe("作り直し"));
      expect(screen.getAllByRole("tab")).toHaveLength(tabCount);
      // 開き直したタブは削除済みではない。
      expect(screen.queryByRole("status")).toBeNull();
      const deletedMarks = screen.queryAllByText("削除済み");
      expect(deletedMarks).toHaveLength(tabCount - 1);
    },
  );

  test("最初の読込の途中でrenameされたら、新しいパスから読み込み、履歴も新しいパスを指す（6.5）", async () => {
    const answers: ((content: FileContent) => void)[] = [];
    const reads: string[] = [];
    mockBackend({
      scan: () => TWO_DOCS,
      read: (path) => {
        reads.push(path);
        // 最初の2回（rename前の読込と、rename後の読み直し）は、応答の順序を制御する。
        if (reads.length <= 2) {
          return new Promise<FileContent>((resolve) => answers.push(resolve));
        }
        return fileContent(path, `## ${path}\n`);
      },
    });
    render(<App />);
    await openWorkspace({ scopeId: "scope-1", label: "docs" });
    await waitFor(() => treeItem("README.md"));
    await act(async () => {
      fireEvent.click(treeItem("README.md"), { detail: 2 });
    });
    await waitFor(() => expect(reads).toEqual(["README.md"]));

    await fileChange({
      kind: "fileRenamed",
      oldPath: "README.md",
      path: "docs/GUIDE.md",
    });
    await waitFor(() => expect(reads).toEqual(["README.md", "docs/GUIDE.md"]));
    // 新しいパスの読込が先に完了し、旧パスの読込があとから届く。
    await act(async () =>
      answers[1]?.(fileContent("docs/GUIDE.md", "## ガイド\n")),
    );
    await waitFor(() => expect(heading()).toBe("ガイド"));
    await act(async () => answers[0]?.(fileContent("README.md", "## 旧\n")));
    expect(heading()).toBe("ガイド");

    // 別のタブへ移って戻る。履歴が空だと、読み込む項目がなく本文の空のタブになる。
    await openPinned("NOTES.md");
    await waitFor(() => expect(heading()).toBe("NOTES.md"));
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /GUIDE\.md/ }));
    });

    await waitFor(() => expect(heading()).toBe("docs/GUIDE.md"));
    expect(reads).toEqual([
      "README.md",
      "docs/GUIDE.md",
      "NOTES.md",
      "docs/GUIDE.md",
    ]);
  });

  test.each([
    [
      "rename",
      { kind: "fileRenamed", oldPath: "README.md", path: "docs/GUIDE.md" },
      "docs/GUIDE.md",
      /GUIDE\.md/,
    ],
    [
      "変更",
      { kind: "fileModified", path: "README.md" },
      "README.md",
      /README/,
    ],
  ] as const)(
    "最初の読込の途中で別のタブへ移り、そのあとで%sを受けたタブは、アクティブにしたときに読み込み直す（6.5）",
    async (_, change, readPath, tabName) => {
      const answers: ((content: FileContent) => void)[] = [];
      const reads: string[] = [];
      mockBackend({
        scan: () => TWO_DOCS,
        read: (path) => {
          reads.push(path);
          // 最初の読込だけ、応答を遅らせる。
          if (reads.length === 1) {
            return new Promise<FileContent>((resolve) => answers.push(resolve));
          }
          return fileContent(path, `## ${path}\n`);
        },
      });
      render(<App />);
      await openWorkspace({ scopeId: "scope-1", label: "docs" });
      await waitFor(() => treeItem("README.md"));
      await openPinned("README.md");
      await waitFor(() => expect(reads).toEqual(["README.md"]));
      await openPinned("NOTES.md");
      await waitFor(() => expect(heading()).toBe("NOTES.md"));

      // 離れている間に、最初の読込が無効になる。遅れて届く旧い応答は捨てられる。
      await fileChange({ ...change });
      await act(async () => answers[0]?.(fileContent("README.md", "## 旧\n")));
      expect(heading()).toBe("NOTES.md");
      await act(async () => {
        fireEvent.click(screen.getByRole("tab", { name: tabName }));
      });

      await waitFor(() => expect(heading()).toBe(readPath));
      expect(reads).toEqual(["README.md", "NOTES.md", readPath]);
    },
  );

  test("別のスコープの通知では、ツリーの取り直しも監視の断念の処理も行わない", async () => {
    const scanned: string[] = [];
    const reads: string[] = [];
    mockBackend({
      scan: (path) => {
        scanned.push(path);
        return ROOT;
      },
      read: (path) => {
        reads.push(path);
        return fileContent(path, "## 本文\n");
      },
    });
    render(<App />);
    await openReadme();
    await waitFor(() => expect(heading()).toBe("本文"));

    await fileChange({ kind: "directoryChanged", path: "" }, "scope-2");
    await act(async () => {
      await emit("watcher-error", {
        scopeId: "scope-2",
        error: { code: "watcherStopped", message: "止まった", detail: null },
      });
    });

    expect(scanned).toEqual([""]);
    expect(reads).toEqual(["README.md"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("変更を個別に追えないときは、フォルダーとアクティブ文書を取り直し、原因を示す（6.4）", async () => {
    const scanned: string[] = [];
    const reads: string[] = [];
    mockBackend({
      scan: (path) => {
        scanned.push(path);
        return ROOT;
      },
      read: (path) => {
        reads.push(path);
        return fileContent(path, "## 本文\n");
      },
    });
    render(<App />);
    await openReadme();
    await waitFor(() => expect(heading()).toBe("本文"));

    await act(async () => {
      await emit("watcher-error", {
        scopeId: "scope-1",
        error: {
          code: "watcherOverflow",
          message: "変更が多すぎて追えません。",
          detail: null,
        },
      });
    });

    await waitFor(() => expect(reads).toEqual(["README.md", "README.md"]));
    expect(scanned).toEqual(["", ""]);
    // 読み直しの成功で、通知を消さない。
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "変更が多すぎて追えません。",
      ),
    );
  });

  test("監視が止まったときの読み直しが失敗しても、開き直しを案内する通知を書き換えない（6.4）", async () => {
    const missing: IpcError = {
      code: "fileNotFound",
      message: "ファイルが見つかりません。",
      detail: "README.md",
    };
    const results: (FileContent | IpcError)[] = [
      fileContent("README.md", "## 本文\n"),
      missing,
    ];
    mockBackend({
      scan: () => ROOT,
      read: () => {
        const next = results.shift();
        if (next === undefined) throw new Error("想定外の読込");
        return "code" in next ? Promise.reject(next) : next;
      },
    });
    render(<App />);
    await openReadme();
    await waitFor(() => expect(heading()).toBe("本文"));

    await act(async () => {
      await emit("watcher-error", {
        scopeId: "scope-1",
        error: {
          code: "watcherStopped",
          message: "監視が止まりました。フォルダーを開き直してください。",
          detail: null,
        },
      });
    });

    // 読み直しは失敗する。その結果を待ってから、通知が残っていることを確かめる。
    await waitFor(() => expect(results).toHaveLength(0));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toBe(
      "監視が止まりました。フォルダーを開き直してください。",
    );
  });

  test("発行済みの画像が書き換わったら、本文が同じでも画像を発行し直して表示する（5.4）", async () => {
    let issued = 0;
    mockBackend({
      scan: () => ROOT,
      read: (path) => fileContent(path, "![ロゴ](logo.png)\n"),
      issue: (request) => {
        issued += 1;
        return request.references.map((reference) => ({
          status: "issued",
          reference,
          resourceId: `logo-${issued}`,
        }));
      },
    });
    render(<App />);
    await openReadme();
    const src = () =>
      screen.getByRole("img", { name: "ロゴ" }).getAttribute("src");
    await waitFor(() => expect(src()).toContain("logo-1"));

    await act(async () => {
      await emit("images-changed", { scopeId: "scope-2" });
    });
    expect(issued).toBe(1);

    await act(async () => {
      await emit("images-changed", { scopeId: "scope-1" });
    });

    await waitFor(() => expect(src()).toContain("logo-2"));
  });
});

describe("App: ワークスペース外のファイルとドラッグ＆ドロップ（9.1、10.4）", () => {
  const LOOSE = "loose-1";
  const LABEL = "work\\notes";

  /** Rust側が、ドロップされたファイルの開き先を決めて知らせる。 */
  function openDocumentEvent(
    scopeId: string,
    path: string,
    label: string | null = null,
  ) {
    return act(async () => {
      await emit("open-document", { scopeId, path, label });
    });
  }

  const heading = () => screen.getByRole("heading", { level: 2 }).textContent;
  const breadcrumb = () =>
    screen.getByRole("navigation", { name: "パンくずリスト" });

  test("ワークスペースがなくても、loose tabの文書を表示する（9.2）", async () => {
    const reads: [string, string][] = [];
    const titles: string[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path, scopeId) => {
        reads.push([scopeId, path]);
        return fileContent(path, "## メモ\n");
      },
      setTitle: (title) => titles.push(title),
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );

    await openDocumentEvent(LOOSE, "note.md", LABEL);

    await waitFor(() => expect(heading()).toBe("メモ"));
    // 読むスコープは、タブが持つloose tabのスコープである。
    expect(reads).toEqual([[LOOSE, "note.md"]]);
    // ツリーとサイドバーの境界は出さない。ワークスペースを開いていない。
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
    // パンくずは所在フォルダーの表示名から始まり、フォルダーは選べない（ツリーがない）。
    expect(breadcrumb().textContent).toContain(LABEL);
    expect(within(breadcrumb()).queryAllByRole("button")).toHaveLength(0);
    // タイトルの「ワークスペース名」は、所在フォルダーの表示名になる。
    await waitFor(() =>
      expect(titles.at(-1)).toBe(`note.md - ${LABEL} - md-peruse`),
    );
  });

  test("ウィンドウタイトルの名前は、アクティブなタブのルートの表示名になる（10.1.2）", async () => {
    const titles: string[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path) => fileContent(path, "## 本文\n"),
      setTitle: (title) => titles.push(title),
    });
    render(<App />);
    await openWorkspace({ scopeId: "scope-1", label: "docs" });
    await waitFor(() => expect(screen.getByRole("tree")).toBeTruthy());

    await openDocumentEvent("scope-1", "README.md");
    await waitFor(() =>
      expect(titles.at(-1)).toBe("README.md - docs - md-peruse"),
    );
    // ワークスペースを開いたまま、外のファイルをアクティブにすると、所在フォルダーの表示名になる。
    await openDocumentEvent(LOOSE, "note.md", LABEL);
    await waitFor(() =>
      expect(titles.at(-1)).toBe(`note.md - ${LABEL} - md-peruse`),
    );
    // ワークスペースのタブへ戻すと、ワークスペース名に戻る。
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /README\.md/ }));
    });
    await waitFor(() =>
      expect(titles.at(-1)).toBe("README.md - docs - md-peruse"),
    );
  });

  test("開いているタブがなくなると、welcome状態へ戻り、loose tabのスコープを閉じるよう求める（6.4）", async () => {
    const closed: string[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path) => fileContent(path, "## メモ\n"),
      closeLoose: (scopeId) => {
        closed.push(scopeId);
      },
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openDocumentEvent(LOOSE, "note.md", LABEL);
    await waitFor(() => expect(heading()).toBe("メモ"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "note.md を閉じる" }));
    });

    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    expect(closed).toEqual([LOOSE]);
  });

  test("ワークスペースを開くと、loose tabは破棄され、そのスコープを閉じるよう求める（6.1）", async () => {
    const closed: string[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path) => fileContent(path, "## メモ\n"),
      closeLoose: (scopeId) => {
        closed.push(scopeId);
      },
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openDocumentEvent(LOOSE, "note.md", LABEL);
    await waitFor(() => expect(heading()).toBe("メモ"));

    await openWorkspace({ scopeId: "scope-1", label: "docs" });

    await waitFor(() => expect(screen.getByRole("tree")).toBeTruthy());
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    await waitFor(() => expect(closed).toEqual([LOOSE]));
  });

  test("ワークスペースの中のファイルは、ワークスペースのスコープの通常タブで開く", async () => {
    const reads: [string, string][] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path, scopeId) => {
        reads.push([scopeId, path]);
        return fileContent(path, "## 本文\n");
      },
    });
    render(<App />);
    await openWorkspace({ scopeId: "scope-1", label: "docs" });
    await waitFor(() => expect(screen.getByRole("tree")).toBeTruthy());

    await openDocumentEvent("scope-1", "README.md");

    await waitFor(() => expect(heading()).toBe("本文"));
    expect(reads).toEqual([["scope-1", "README.md"]]);
    // 通常タブのパンくずは、ワークスペース名から始まり、フォルダーを選べる。
    expect(within(breadcrumb()).getAllByRole("button")).toHaveLength(1);
    expect(breadcrumb().textContent).toContain("docs");
  });

  test("loose tabの文書は、同じ相対パスのワークスペースの文書とは別物である（6.4）", async () => {
    const closed: string[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path, scopeId) =>
        fileContent(path, scopeId === LOOSE ? "## 外\n" : "## 中\n"),
      closeLoose: (scopeId) => {
        closed.push(scopeId);
      },
    });
    render(<App />);
    await openWorkspace({ scopeId: "scope-1", label: "docs" });
    await waitFor(() => expect(screen.getByRole("tree")).toBeTruthy());
    await openDocumentEvent("scope-1", "README.md");
    await waitFor(() => expect(heading()).toBe("中"));

    // 同じ相対パスのloose tabを開く。ワークスペースのタブへ切り替えず、別のタブで開く。
    await openDocumentEvent(LOOSE, "README.md", LABEL);

    await waitFor(() => expect(heading()).toBe("外"));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // ツリーで選択されるのは、ワークスペースの文書だけである。
    const readme = within(screen.getByRole("tree"))
      .getByText("README.md")
      .closest('[role="treeitem"]');
    expect(readme?.getAttribute("aria-selected")).toBe("false");

    // 同じスコープの同じ文書を開き直すと、新しいタブは作らない。
    await openDocumentEvent(LOOSE, "README.md", LABEL);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(closed).toEqual([]);
  });

  test("loose tabの本文のリンクは、同じ暗黙のルートの文書を同じタブで開く（7.2、9.1）", async () => {
    const reads: [string, string][] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path, scopeId) => {
        reads.push([scopeId, path]);
        return fileContent(
          path,
          path === "note.md" ? "[次](sub/b.md)\n" : "## 次の文書\n",
        );
      },
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openDocumentEvent(LOOSE, "note.md", LABEL);
    await screen.findByRole("link", { name: "次" });

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "次" }));
    });

    await waitFor(() => expect(heading()).toBe("次の文書"));
    expect(reads).toEqual([
      [LOOSE, "note.md"],
      [LOOSE, "sub/b.md"],
    ]);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  test("loose tabの文書も、外部での変更に追従する。別のスコープの変更は無関係（6.4）", async () => {
    const versions = ["## 1版\n", "## 2版\n"];
    const reads: string[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path, scopeId) => {
        reads.push(`${scopeId}:${path}`);
        return fileContent(path, versions.shift() ?? "## 想定外\n");
      },
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openDocumentEvent(LOOSE, "note.md", LABEL);
    await waitFor(() => expect(heading()).toBe("1版"));

    await act(async () => {
      await emit("file-change", {
        scopeId: "other-scope",
        change: { kind: "fileModified", path: "note.md" },
      });
    });
    expect(reads).toEqual([`${LOOSE}:note.md`]);

    await act(async () => {
      await emit("file-change", {
        scopeId: LOOSE,
        change: { kind: "fileModified", path: "note.md" },
      });
    });

    await waitFor(() => expect(heading()).toBe("2版"));
  });

  test("loose tabの文書が替わったときだけ、採用した読込の文書へ監視の付け替えを求める（6.4）", async () => {
    const watched: { scopeId: string; path: string; generation: number }[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path) =>
        fileContent(
          path,
          path === "note.md" ? "[次](sub/b.md)\n" : "## 次の文書\n",
        ),
      watchLoose: (request) => {
        watched.push({
          scopeId: request.scopeId,
          path: request.path,
          generation: request.generation,
        });
      },
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openDocumentEvent(LOOSE, "note.md", LABEL);
    await screen.findByRole("link", { name: "次" });
    // 最初の読込では求めない。Rust側が開いたときから監視している。
    expect(watched).toEqual([]);

    // 再読み込み（同じ文書）でも求めない。
    await act(async () => {
      await emit("menu-command", "reloadDocument");
    });
    expect(watched).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "次" }));
    });
    await waitFor(() => expect(heading()).toBe("次の文書"));
    expect(watched.map(({ scopeId, path }) => [scopeId, path])).toEqual([
      [LOOSE, "sub/b.md"],
    ]);

    // 戻ると、戻った先の文書へ付け替えさせる。世代は前へ進む。
    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    });
    await screen.findByRole("link", { name: "次" });
    expect(watched.map(({ path }) => path)).toEqual(["sub/b.md", "note.md"]);
    expect(watched[1]?.generation).toBeGreaterThan(watched[0]?.generation ?? 0);
  });

  test("リンクを素早く辿って読込が逆順に完了しても、捨てた読込の文書へ監視の付け替えを求めない（6.4）", async () => {
    const watched: string[] = [];
    const answers: ((content: FileContent) => void)[] = [];
    let reads = 0;
    mockBackend({
      scan: () => ROOT,
      read: (path) => {
        reads += 1;
        if (reads === 1) return fileContent(path, "[B](b.md) [C](c.md)\n");
        // 2回目（B）と3回目（C）は、応答を遅らせて完了の順序を制御する。
        return new Promise<FileContent>((resolve) => answers.push(resolve));
      },
      watchLoose: (request) => {
        watched.push(request.path);
      },
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openDocumentEvent(LOOSE, "note.md", LABEL);
    await screen.findByRole("link", { name: "B" });

    // Bへ移る読込の途中で、Cへ移る。表示中なのは元の文書のままである。
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "B" }));
    });
    await waitFor(() => expect(answers).toHaveLength(1));
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "C" }));
    });
    await waitFor(() => expect(answers).toHaveLength(2));

    // Cの読込が先に完了し、Bの読込があとから完了する。Bの応答は世代の判定で捨てられる。
    await act(async () => answers[1]?.(fileContent("c.md", "## Cの文書\n")));
    await waitFor(() => expect(heading()).toBe("Cの文書"));
    await act(async () => answers[0]?.(fileContent("b.md", "## Bの文書\n")));

    expect(heading()).toBe("Cの文書");
    expect(watched).toEqual(["c.md"]);
  });

  test("ワークスペースの文書では、監視の付け替えを求めない", async () => {
    const watched: string[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path) =>
        fileContent(
          path,
          path === "README.md" ? "[次](docs/a.md)\n" : "## 次\n",
        ),
      watchLoose: (request) => {
        watched.push(request.path);
      },
    });
    render(<App />);
    await openReadme();
    await screen.findByRole("link", { name: "次" });

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "次" }));
    });

    await waitFor(() => expect(heading()).toBe("次"));
    expect(watched).toEqual([]);
  });

  test("loose tabの監視が止まったときは、原因を示す", async () => {
    mockBackend({
      scan: () => ROOT,
      read: (path) => fileContent(path, "## メモ\n"),
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );
    await openDocumentEvent(LOOSE, "note.md", LABEL);
    await waitFor(() => expect(heading()).toBe("メモ"));

    await act(async () => {
      await emit("watcher-error", {
        scopeId: LOOSE,
        error: {
          code: "watcherStopped",
          message: "監視が止まりました。",
          detail: null,
        },
      });
    });

    expect((await screen.findByRole("alert")).textContent).toBe(
      "監視が止まりました。",
    );
  });

  test("画像resource IDは、表示中のタブのスコープで発行する（5.4）", async () => {
    const requests: ImageResourceRequest[] = [];
    mockBackend({
      scan: () => ROOT,
      read: (path) => fileContent(path, "![図](a.png)\n"),
      issue: (request) => {
        requests.push(request);
        return request.references.map((reference) => ({
          status: "issued",
          reference,
          resourceId: "id",
        }));
      },
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
    );

    await openDocumentEvent(LOOSE, "note.md", LABEL);

    await waitFor(() =>
      expect(requests).toEqual([
        { scopeId: LOOSE, documentPath: "note.md", references: ["a.png"] },
      ]),
    );
  });

  test.each([
    ["acceptable", "ここにドロップして開く"],
    ["rejected", "開けません。Markdownのファイルとフォルダーだけ開けます。"],
  ])(
    "ドラッグ中は、%sの旨をオーバーレイで示し、離れたら消す（10.4）",
    async (state, text) => {
      mockBackend({
        scan: () => ROOT,
        read: (path) => fileContent(path, "## 本文\n"),
      });
      render(<App />);
      await waitFor(() =>
        expect(screen.getByText(/フォルダーを開く/)).toBeTruthy(),
      );
      expect(screen.queryByText(text)).toBeNull();

      await act(async () => {
        await emit("drag-state", state);
      });
      expect(screen.getByText(text)).toBeTruthy();

      await act(async () => {
        await emit("drag-state", "idle");
      });
      expect(screen.queryByText(text)).toBeNull();
    },
  );

  test("ドラッグのオーバーレイは、文書を表示している間も出る", async () => {
    mockBackend({
      scan: () => ROOT,
      read: (path) => fileContent(path, "## 本文\n"),
    });
    render(<App />);
    await openWorkspace({ scopeId: "scope-1", label: "docs" });
    await waitFor(() => expect(screen.getByRole("tree")).toBeTruthy());

    await act(async () => {
      await emit("drag-state", "acceptable");
    });

    expect(screen.getByText("ここにドロップして開く")).toBeTruthy();
  });
});
