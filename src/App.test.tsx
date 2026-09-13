import { afterEach, describe, expect, test } from "bun:test";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import type { FileContent } from "./types/generated/FileContent";
import type { ImageResource } from "./types/generated/ImageResource";
import type { ImageResourceRequest } from "./types/generated/ImageResourceRequest";
import type { IpcError } from "./types/generated/IpcError";
import type { ScanResult } from "./types/generated/ScanResult";
import type { WorkspaceOpenedEvent } from "./types/generated/WorkspaceOpenedEvent";

type Handlers = {
  scan: (path: string) => ScanResult | Promise<ScanResult>;
  read?: (path: string) => FileContent | Promise<FileContent>;
  openUrl?: (url: string) => void;
  issue?: (request: ImageResourceRequest) => ImageResource[];
};

/** Rust側のcommandを差し替え、eventを模擬できるようにする。 */
function mockBackend(handlers: Handlers) {
  mockIPC(
    (command, payload) => {
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
    screen.getByRole("button", { name: "README.md" }).click();
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
  test("ワークスペースを開くまでは案内を表示する", () => {
    mockBackend({ scan: () => ROOT });
    render(<App />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "md-peruse",
    );
    expect(screen.getByText(/フォルダーを開く/)).toBeTruthy();
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
      screen.getByRole("button", { name: "README.md" }).click();
    });

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "見出し",
      ),
    );
  });

  test("走査の失敗は文言を表示する", async () => {
    const failure: IpcError = {
      code: "directoryAccessDenied",
      message: "このフォルダーへアクセスできません。",
      detail: null,
    };
    mockBackend({ scan: () => Promise.reject(failure) });
    render(<App />);
    await openWorkspace({ scopeId: "scope-1", label: "docs" });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(failure.message),
    );
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
      screen.getByRole("button", { name: "slow.md" }).click();
    });
    const pendingSlow = releaseSlow;
    await act(async () => {
      screen.getByRole("button", { name: "fast.md" }).click();
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
