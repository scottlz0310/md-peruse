import { describe, expect, test } from "bun:test";
import mermaid from "mermaid";
import { assessReport } from "./usage-health";
import { parseUsageTable } from "./usage-merged";
import { renderOverview } from "./usage-overview";

const HEADER =
  "SubscriptionName,DeviceType,PackageVersion,Market,Date,DailySessionCount,EngagementDurationMinutes,DailyActiveUsers,DailyActiveDevices,DailyNewUsers,MonthlyActiveUsers";
const table = (...rows: string[]) =>
  parseUsageTable([HEADER, ...rows, ""].join("\r\n"));

// 全体の集計行は、SubscriptionName・DeviceType・Market がすべて All。
// 版別の行は PackageVersion が版、全版の合計は PackageVersion が All。
const overall = (
  version: string,
  date: string,
  sessions: string,
  dau: string,
  minutes = "10.5",
) =>
  `All,All,${version},All,${date},${sessions},${minutes},${dau},${dau},0,${dau}`;

const GENERATED = new Date("2026-10-12T09:00:00Z");

describe("renderOverview", () => {
  const data = table(
    overall("0.1.1.0", "2026-10-06", "4", "1"),
    overall("All", "2026-10-06", "4", "1"),
    overall("0.1.1.0", "2026-10-07", "7", "1"),
    overall("All", "2026-10-07", "7", "1"),
    // 2026-10-08 は行が無い日。
    overall("0.2.1.0", "2026-10-09", "8", "2"),
    overall("All", "2026-10-09", "8", "2"),
    // 個別の行（All でない）は、全体の値に数えない。
    "null,PC,0.2.1.0,JP,2026-10-09,8,5.6,2,2,0,2",
  );

  test("要約・日別の表・グラフ・版別・行が無い日を出す（個別の行は二重に数えない）", () => {
    const md = renderOverview(data, { generatedAt: GENERATED });

    expect(md).toContain("# 日別の利用統計の概観");
    expect(md).toContain("作成: 2026-10-12T09:00:00.000Z");
    expect(md).toContain(
      "| データの期間 | 2026-10-06 〜 2026-10-09（行がある日: 3 日） |",
    );
    expect(md).toContain("| 最新日の DAU（日次のアクティブユーザー） | 2 |");
    // 4 + 7 + 8（個別の行の 8 を足さない）。
    expect(md).toContain("| 直近 4 日のセッション合計 | 19 |");
    // 新しい順。
    const rows = md.split("\n").filter((l) => /^\| 2026-10-\d\d \|/.test(l));
    expect(rows.map((l) => l.slice(2, 12))).toEqual([
      "2026-10-09",
      "2026-10-07",
      "2026-10-06",
    ]);
    expect(md).toContain("| 2026-10-09 | 8 | 10.5 | 2 | 2 | 0 | 2 |");
    // 版別（All の行は版別に出さない）。
    expect(md).toContain("| 0.1.1.0 | 2026-10-06 | 2026-10-07 | 2 | 11 |");
    expect(md).toContain("| 0.2.1.0 | 2026-10-09 | 2026-10-09 | 1 | 8 |");
    expect(md).not.toMatch(/\| All \| 2026/);
    // 行が無い日。
    expect(md).toContain("- 2026-10-08");
  });

  test("Mermaid の xychart-beta で、暦日ごとに出す（行が無い日は 0）", () => {
    const md = renderOverview(data, { generatedAt: GENERATED });
    expect(md).toContain("```mermaid\nxychart-beta");
    expect(md).toContain('x-axis ["10-06", "10-07", "10-08", "10-09"]');
    expect(md).toContain("bar [4, 7, 0, 8]");
    expect(md).toContain("line [1, 1, 0, 2]");
    expect(md).toContain('y-axis "セッション" 0 --> 10');
  });

  test("出力した全ての Mermaid のブロックは、アプリと同じ版の Mermaid で構文として有効", async () => {
    const md = renderOverview(data, { generatedAt: GENERATED });
    const blocks = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(
      (m) => m[1] as string,
    );
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(await mermaid.parse(block)).toBeTruthy();
    }
  });

  test("直近 N 日だけを出す（古い日は、表にもグラフにも出さない）", () => {
    const md = renderOverview(data, { generatedAt: GENERATED, days: 2 });
    expect(md).toContain("直近 2 日のセッション合計 | 8 |");
    expect(md).toContain('x-axis ["10-08", "10-09"]');
    expect(md).not.toContain("| 2026-10-06 | 4 |");
  });

  test("行が無い日が無ければ、その旨を書く", () => {
    const md = renderOverview(
      table(
        overall("All", "2026-10-06", "4", "1"),
        overall("All", "2026-10-07", "7", "1"),
      ),
      { generatedAt: GENERATED },
    );
    expect(md).toContain(
      "2026-10-06 〜 2026-10-07 の全ての日に、行があります。",
    );
    expect(md).toContain("版別の行がまだありません。");
  });

  test("空・数値でない値は、表では `-`、グラフでは 0", () => {
    const md = renderOverview(table("All,All,All,All,2026-10-06,x,,,,,"), {
      generatedAt: GENERATED,
    });
    expect(md).toContain("| 2026-10-06 | - | - | - | - | - | - |");
    expect(md).toContain("bar [0]");
  });

  describe("運用状況", () => {
    const health = (extra: Record<string, unknown> = {}) =>
      assessReport(
        {
          reportGeneratedTime: "2026-10-11T23:42:19Z",
          endTime: "2027-10-11T06:50:42Z",
          ...extra,
        },
        GENERATED,
      );

    test("健全なら、表だけを出し、警告は出さない（要約より前）", () => {
      const md = renderOverview(data, {
        generatedAt: GENERATED,
        health: health(),
      });
      expect(md).toContain("## 運用状況");
      expect(md).toContain(
        "| 最新の完了した実行 | 2026-10-11T23:42:19Z（0 日前） |",
      );
      expect(md).toContain(
        "| 繰り返しレポートの終了予定 | 2027-10-11T06:50:42Z（残り 363 日） |",
      );
      expect(md).not.toContain("⚠");
      expect(md.indexOf("## 運用状況")).toBeLessThan(md.indexOf("## 要約"));
    });

    test("古い・終了前の警告は、引用の行で出す（失敗の理由が先）", () => {
      const md = renderOverview(data, {
        generatedAt: GENERATED,
        health: assessReport(
          {
            reportGeneratedTime: "2026-09-20T00:00:00Z",
            endTime: "2026-10-20T00:00:00Z",
          },
          GENERATED,
        ),
      });
      const notices = md.split("\n").filter((l) => l.startsWith("> ⚠ "));
      expect(notices).toHaveLength(2);
      expect(notices[0]).toContain("22 日前です");
      expect(notices[1]).toContain("残り 7 日です");
    });

    test("health が無ければ、運用状況の節を出さない", () => {
      expect(renderOverview(data, { generatedAt: GENERATED })).not.toContain(
        "## 運用状況",
      );
    });

    test("データがまだ無くても、運用状況は出す", () => {
      const md = renderOverview(
        table("null,PC,0.1.1.0,JP,2026-10-06,4,1,1,1,0,1"),
        { generatedAt: GENERATED, health: health() },
      );
      expect(md).toContain("## 運用状況");
      expect(md).toContain("全体の集計行");
    });
  });

  test("全体の集計行が無ければ、その旨だけを書く", () => {
    const md = renderOverview(
      table("null,PC,0.1.1.0,JP,2026-10-06,4,1,1,1,0,1"),
      { generatedAt: GENERATED },
    );
    expect(md).toContain("全体の集計行");
    expect(md).not.toContain("xychart-beta");
  });

  test("行が無い版は `（空）` と書く", () => {
    const md = renderOverview(
      table(
        overall("", "2026-10-06", "4", "1"),
        overall("All", "2026-10-06", "4", "1"),
      ),
      {
        generatedAt: GENERATED,
      },
    );
    expect(md).toContain("| （空） | 2026-10-06 | 2026-10-06 | 1 | 4 |");
  });
});
