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
});
