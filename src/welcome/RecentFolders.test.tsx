import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../i18n/LanguageContext";
import type { Language } from "../types/generated/Language";
import type { RecentFolderView } from "../types/generated/RecentFolderView";
import { RecentFolders } from "./RecentFolders";

const FOLDERS: RecentFolderView[] = [
  { id: "recent-1-0", label: "dev\\docs" },
  { id: "recent-1-1", label: "R&D\\notes" },
];

function renderList(
  folders: readonly RecentFolderView[],
  onOpen: (id: string) => void = () => {},
  language: Language = "ja",
) {
  return render(
    <LanguageProvider language={language}>
      <RecentFolders folders={folders} onOpen={onOpen} />
    </LanguageProvider>,
  );
}

afterEach(cleanup);

describe("RecentFolders", () => {
  test("一覧の並びのまま、表示名のボタンにする", () => {
    renderList(FOLDERS);

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["dev\\docs", "R&D\\notes"]);
  });

  test("項目を選ぶと、その項目のIDで開く", () => {
    const onOpen = mock((_id: string) => {});
    renderList(FOLDERS, onOpen);

    fireEvent.click(screen.getByRole("button", { name: "R&D\\notes" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("recent-1-1");
  });

  test("一覧が空のときは何も描かない", () => {
    const view = renderList([]);

    expect(view.container.innerHTML).toBe("");
  });

  test.each([
    ["ja", "最近使ったフォルダー"],
    ["en", "Recent folders"],
  ] as const)("見出しはUI言語に従う（%s）", (language, heading) => {
    renderList(FOLDERS, () => {}, language);

    expect(screen.getByRole("region", { name: heading })).toBeTruthy();
  });
});
