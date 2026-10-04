import { describe, expect, test } from "bun:test";

// プライバシーポリシー（docs/privacy-policy.md）が、実際に送るイベントと食い違わないことを固定する。
// イベントの集合の正本は src-tauri/src/telemetry.rs とし、ポリシーには同じイベント名を載せる
// （design-decisions.md 11.4、13）。イベントを足したのにポリシーを更新し忘れる状態を防ぐ。

const telemetry = await Bun.file(
  new URL("../src-tauri/src/telemetry.rs", import.meta.url),
).text();
const policy = await Bun.file(
  new URL("../docs/privacy-policy.md", import.meta.url),
).text();

// `Self::SessionStart => "session_start",` の形の対応から、イベント名を取り出す。
const eventNames = [...telemetry.matchAll(/Self::\w+\s*=>\s*"([a-z_]+)"/g)].map(
  (m) => m[1] ?? "",
);

describe("プライバシーポリシー", () => {
  test("telemetry.rs からイベント名を取り出せている", () => {
    expect(eventNames.length).toBe(5);
  });

  test("送るイベントの名前を、日本語と英語の両方に載せている", () => {
    const [japanese = "", english = ""] = policy.split(/^## English$/m);
    for (const name of eventNames) {
      expect(japanese).toContain(`\`${name}\``);
      expect(english).toContain(`\`${name}\``);
    }
  });

  // クラッシュ情報の収集は Windows と Partner Center の機能で、アプリは送らない旨（#144）を、両言語に載せる。
  test.each([
    ["日本語", 0, "Windows エラー報告"],
    ["English", 1, "Windows Error Reporting"],
  ] as const)(
    "Windows の診断情報についての説明を、%s に載せている",
    (_language, index, term) => {
      const section = policy.split(/^## English$/m)[index] ?? "";
      expect(section).toContain(term);
    },
  );
});
