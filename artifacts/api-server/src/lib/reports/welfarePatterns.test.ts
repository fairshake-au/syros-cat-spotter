import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { seedReport } from "../teamAuth/__fixtures__/queueKit";
import { SEED_AREAS } from "../areas/namedAreas";
import { WELFARE_ORDER } from "../dashboard/welfareKinds";
import { renderWelfarePage, welfareTables } from "../teamPages/reportPages";
import { parseRange } from "./range";
import { patternsFrom, welfarePatterns, type WelfareRow, type WelfarePatterns } from "./welfarePatterns";

// SYC-396 PR 3.3b, Task 3.3b.2 (spec §9.3 report 4): Welfare patterns,
// patterns not performance. The database test reads a custom range in 2003,
// where only this file seeds, and asserts on deltas.

const NOW = new Date("2026-10-21T10:00:00Z");
const RANGE = parseRange({ range: "3months" }, NOW);
const VAPORIA = { lat: 37.4447, lng: 24.9475 };
const KINI = { lat: 37.4436, lng: 24.8889 };

const row = (o: Partial<WelfareRow> & { at?: Date; isDraft?: boolean }): WelfareRow => {
  const { at = new Date("2026-10-05T10:00:00Z"), isDraft = false, ...rest } = o;
  return { kind: "welfare", severity: "attention", isLitter: false, ...VAPORIA, createdAt: at, sentAt: isDraft ? null : at, ...rest };
};

const ROWS: WelfareRow[] = [
  row({ severity: "urgent", isLitter: true }),
  row({ severity: "urgent" }),
  row({ severity: "urgent", at: new Date("2026-10-14T10:00:00Z") }),
  row({ ...KINI }),
  row({ isDraft: true }),
  row({ kind: "content", lat: null, lng: null }),
];

const total = (r: { perWeek: { counts: Record<string, number> }[] }) =>
  r.perWeek.reduce((n, w) => n + WELFARE_ORDER.reduce((m, k) => m + w.counts[k]!, 0), 0);

describe("patternsFrom", () => {
  it("counts an urgent litter as litter only", () => {
    const r = patternsFrom([row({ severity: "urgent", isLitter: true })], SEED_AREAS, RANGE);
    const sums = Object.fromEntries(WELFARE_ORDER.map((k) => [k, r.perWeek.reduce((n, w) => n + w.counts[k], 0)]));
    expect(sums).toEqual({ urgent: 0, attention: 0, litter: 1 });
  });

  it("the kinds sum to the total of welfare reports sent", () => {
    const r = patternsFrom(ROWS, SEED_AREAS, RANGE);
    expect(r.total).toBe(4);
    expect(total(r)).toBe(4);
  });

  it("a content report raises contentReports and nothing else", () => {
    const without = patternsFrom(ROWS.filter((x) => x.kind !== "content"), SEED_AREAS, RANGE);
    const withIt = patternsFrom(ROWS, SEED_AREAS, RANGE);
    expect(withIt.contentReports - without.contentReports).toBe(1);
    expect({ ...withIt, contentReports: 0 }).toEqual({ ...without, contentReports: 0 });
  });

  it("a draft is counted as started, not sent, and is off the chart and the areas", () => {
    const r = patternsFrom([row({ isDraft: true })], SEED_AREAS, RANGE);
    expect(r).toMatchObject({ drafts: 1, total: 0, topAreas: [] });
    expect(total(r)).toBe(0);
  });

  it("a report started in the range but sent after it ends was a draft as things stood then (review of PR 3.3b)", () => {
    const past = parseRange({ range: "custom", from: "2026-09-01", to: "2026-09-30" }, NOW);
    const r = patternsFrom([row({ createdAt: new Date("2026-09-28T10:00:00Z"), sentAt: new Date("2026-10-03T10:00:00Z") })], SEED_AREAS, past);
    expect(r).toMatchObject({ drafts: 1, total: 0 });
    // The same report, read for October: sent, not a draft.
    const oct = parseRange({ range: "custom", from: "2026-10-01", to: "2026-10-20" }, NOW);
    expect(patternsFrom([row({ createdAt: new Date("2026-09-28T10:00:00Z"), sentAt: new Date("2026-10-03T10:00:00Z") })], SEED_AREAS, oct)).toMatchObject({ drafts: 0, total: 1 });
  });

  it("lists the areas with the most reports first", () => {
    const r = patternsFrom(ROWS, SEED_AREAS, RANGE);
    expect(r.topAreas).toEqual([
      { area: "Vaporia", count: 3 },
      { area: "Kini", count: 1 },
    ]);
  });
});

describe("the page", () => {
  const report = (): WelfarePatterns => ({ ...patternsFrom(ROWS, SEED_AREAS, RANGE), areasVersion: 21, workedOutAt: NOW, ms: 1 });

  it("splits the bars into the three kinds, each named in the legend with its own pattern, never colour alone", () => {
    const html = renderWelfarePage(report(), { personName: "Jacky", range: RANGE, canExport: true });
    expect(html).toContain('aria-label="Welfare reports per week, by kind"');
    for (const word of ["Urgent", "Needs attention", "Litter"]) expect(html).toContain(`${word}</li>`);
    expect(html).toContain('fill="#a08000"');
    expect(html).toContain('fill="url(#pat-hatch)"');
    expect(html).toContain('fill="url(#pat-dots)"');
    expect(html).toContain("<summary>Show as table</summary>");
  });

  it("counts drafts and problems with photos or names apart, and says there are no response times", () => {
    const html = renderWelfarePage(report(), { personName: "Jacky", range: RANGE, canExport: true });
    expect(html).toContain('<li id="drafts"><strong>1</strong> started, not sent');
    expect(html).toContain('<li id="content"><strong>1</strong> problems reported with photos or names');
    expect(html).toContain("No response times and nothing about who sent or handled a report.");
  });

  it("the weeks table's columns are the kinds, and each week adds up", () => {
    const t = welfareTables(report(), true);
    expect(t.weeks.columns.map((c) => c.label)).toEqual(["Week starting", "Urgent", "Needs attention", "Litter", "All welfare reports"]);
    for (const w of t.weeks.rows) expect(Number(w["urgent"]) + Number(w["attention"]) + Number(w["litter"])).toBe(w["total"]);
    // No position in either file.
    expect(JSON.stringify(t)).not.toMatch(/\d+\.\d{3,}/);
  });
});

describe("D6, made structural: no response times or who handled a report", () => {
  const src = readFileSync(new URL("./welfarePatterns.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("welfarePatterns.ts never names the state change columns", () => {
    expect(src).not.toMatch(/state_changed|stateChanged/);
  });

  it("nor the state itself, the team's note, or who sent a report", () => {
    expect(code).not.toMatch(/\.state\b|teamNote|team_note|reporterDevice|reporterContact|\.note\b/);
  });
});

describe("welfarePatterns, from the database", () => {
  afterAll(async () => {
    await pool.end();
  });

  const minutesBefore = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60_000;

  it("counts by kind, drafts and content reports apart, and nothing outside the range", async () => {
    const range = parseRange({ range: "custom", from: "2003-05-01", to: "2003-05-31" }, NOW);
    const before = await welfarePatterns(range, NOW);
    const inRange = minutesBefore("2003-05-10T10:00:00Z");
    await seedReport({ severity: "urgent", isLitter: true, sentMinutesAgo: inRange });
    await seedReport({ severity: "urgent", sentMinutesAgo: inRange });
    await seedReport({ severity: "attention", sentMinutesAgo: inRange });
    await seedReport({ isDraft: true, sentMinutesAgo: inRange });
    await seedReport({ kind: "content", sentMinutesAgo: inRange });
    // The day after the range ends.
    await seedReport({ severity: "urgent", sentMinutesAgo: minutesBefore("2003-06-01T10:00:00Z") });
    const after = await welfarePatterns(range, NOW);
    const sums = (r: WelfarePatterns) => Object.fromEntries(WELFARE_ORDER.map((k) => [k, r.perWeek.reduce((n, w) => n + w.counts[k], 0)]));
    const b = sums(before);
    const a = sums(after);
    expect({ urgent: a["urgent"]! - b["urgent"]!, attention: a["attention"]! - b["attention"]!, litter: a["litter"]! - b["litter"]! }).toEqual({
      urgent: 1,
      attention: 1,
      litter: 1,
    });
    expect(after.drafts - before.drafts).toBe(1);
    expect(after.contentReports - before.contentReports).toBe(1);
    expect(after.total - before.total).toBe(3);
  });
});
