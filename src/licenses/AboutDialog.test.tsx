import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { LanguageProvider } from "../i18n/LanguageContext";
import type { Language } from "../types/generated/Language";
import { AboutDialog } from "./AboutDialog";
import type { LicensesFile } from "./licenses";

const FILE: LicensesFile = {
  application: {
    name: "md-peruse",
    version: "1.2.3",
    license: "MIT",
    texts: [{ label: "LICENSE", index: 0 }],
  },
  licenseTexts: [
    "MIT License (md-peruse)",
    "Apache License text",
    "Eclipse Public License text",
  ],
  packages: [
    {
      name: "alpha",
      version: "1.0.0",
      license: "MIT",
      texts: [{ label: "LICENSE", index: 0 }],
    },
    {
      name: "Beta-Lib",
      version: "2.0.0",
      license: "Apache-2.0 OR MIT",
      texts: [
        { label: "Apache-2.0", index: 1 },
        { label: "MIT", index: 0 },
      ],
    },
    {
      name: "elkjs",
      version: "0.9.3",
      license: "EPL-2.0",
      sourceUrl: "https://github.com/kieler/elkjs",
      texts: [{ label: "LICENSE.md", index: 2 }],
    },
  ],
};

function renderDialog({
  load = () => Promise.resolve(FILE),
  onClose = () => {},
  language = "ja",
}: {
  load?: () => Promise<LicensesFile>;
  onClose?: () => void;
  language?: Language;
} = {}) {
  return render(
    <LanguageProvider language={language}>
      <AboutDialog load={load} onClose={onClose} />
    </LanguageProvider>,
  );
}

/** ダイアログが一覧を読み終えるまで待つ。 */
async function loaded() {
  await screen.findByText(/バージョン|Version/);
}

/** 行の見出しを選んで、本文を開く。 */
function open(name: string) {
  fireEvent.click(screen.getByText(name));
}

afterEach(cleanup);

describe("AboutDialog", () => {
  test("モーダルで開き、読み込み中は案内を示す", async () => {
    let release: (file: LicensesFile) => void = () => {};
    renderDialog({
      load: () =>
        new Promise<LicensesFile>((resolve) => {
          release = resolve;
        }),
    });

    const dialog = screen.getByRole("dialog", { name: "md-peruse について" });
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(within(dialog).getByText("読み込み中…")).toBeTruthy();

    await act(async () => release(FILE));
    expect(within(dialog).queryByText("読み込み中…")).toBeNull();
  });

  test("読み込めたら、バージョンと件数と自身のライセンスの行を示す", async () => {
    renderDialog();
    await loaded();

    expect(screen.getByText("バージョン 1.2.3")).toBeTruthy();
    expect(screen.getByText("サードパーティのライセンス（3件）")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("3 / 3 件");
    // 自身の行と、依存の行の両方を持つ。
    expect(screen.getAllByRole("group")).toHaveLength(4);
  });

  test("本文は行を開いたときにだけ描く", async () => {
    renderDialog();
    await loaded();
    expect(screen.queryByText("Apache License text")).toBeNull();

    open("Beta-Lib");

    await waitFor(() =>
      expect(screen.getByText("Apache License text")).toBeTruthy(),
    );
    // 別の行の本文は、開くまで描かない。
    expect(screen.queryByText("Eclipse Public License text")).toBeNull();
  });

  test("本文が複数ある依存は、見出しで区別する", async () => {
    renderDialog();
    await loaded();

    open("Beta-Lib");

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Apache-2.0" })).toBeTruthy(),
    );
    expect(screen.getByRole("heading", { name: "MIT" })).toBeTruthy();
  });

  test("本文が1つの依存は、見出しを付けない", async () => {
    renderDialog();
    await loaded();

    open("alpha");

    await waitFor(() =>
      expect(screen.getByText("MIT License (md-peruse)")).toBeTruthy(),
    );
    expect(screen.queryByRole("heading", { name: "LICENSE" })).toBeNull();
  });

  test("ソースコードの入手先を持つ依存は、それを示す", async () => {
    renderDialog();
    await loaded();

    open("elkjs");

    await waitFor(() =>
      expect(screen.getByText("https://github.com/kieler/elkjs").tagName).toBe(
        "CODE",
      ),
    );
    expect(screen.getByText(/ソースコード/)).toBeTruthy();
    // 持たない依存には示さない。
    open("alpha");
    expect(screen.getAllByText(/ソースコード/)).toHaveLength(1);
  });

  test.each([
    ["beta", ["Beta-Lib"], "1 / 3 件"],
    ["  ALPHA ", ["alpha"], "1 / 3 件"],
    ["a", ["alpha", "Beta-Lib"], "2 / 3 件"],
    ["", ["alpha", "Beta-Lib", "elkjs"], "3 / 3 件"],
  ])("「%s」で絞り込む", async (query, names, status) => {
    renderDialog();
    await loaded();

    fireEvent.change(screen.getByLabelText("名前で絞り込む"), {
      target: { value: query },
    });

    const list = screen.getByRole("list");
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.querySelector(".license-name")?.textContent),
    ).toEqual(names);
    expect(screen.getByRole("status").textContent).toBe(status);
  });

  test("一致する項目が無いときは、一覧の代わりに案内を示す", async () => {
    renderDialog();
    await loaded();

    fireEvent.change(screen.getByLabelText("名前で絞り込む"), {
      target: { value: "zzz" },
    });

    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("一致する項目はありません。")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("0 / 3 件");
  });

  test("読み込めなかったときは、理由を示す", async () => {
    renderDialog({ load: () => Promise.reject(new Error("HTTP 404")) });

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toBe(
      "ライセンス一覧を読み込めません（Error: HTTP 404）。",
    );
  });

  test("閉じるボタンで閉じる", async () => {
    const onClose = mock(() => {});
    renderDialog({ onClose });
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Esc でブラウザーが閉じたときも閉じる", async () => {
    const onClose = mock(() => {});
    renderDialog({ onClose });
    await loaded();

    // ブラウザーは `Esc` で `close` eventを発火する。
    fireEvent(screen.getByRole("dialog"), new Event("close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("閉じたあとは、開く前にフォーカスのあった要素へ戻す", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const view = renderDialog();
    await loaded();
    // ブラウザーはモーダルを開くと、フォーカスをダイアログの中へ移す。happy-domは動かさない。
    screen.getByRole("button", { name: "閉じる" }).focus();
    expect(document.activeElement).not.toBe(opener);

    view.unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  test("英語のUI言語では、英語で示す", async () => {
    renderDialog({ language: "en" });

    await screen.findByText("Version 1.2.3");

    expect(
      screen.getByRole("dialog", { name: "About md-peruse" }),
    ).toBeTruthy();
    expect(screen.getByText("Third-party licenses (3)")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("3 of 3");
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});
