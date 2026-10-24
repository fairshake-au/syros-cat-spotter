import { describe, expect, it } from "vitest";
import {
  AS_STOOD,
  renderCoveragePage,
  renderHealthPage,
  renderProgressPage,
  renderReportsList,
  renderVetPage,
  renderWelfarePage,
} from "./reportPages";
import { CHART_CSS } from "../reports/chartCss";
import { parseRange } from "../reports/range";
import type { ProgressReport } from "../reports/progress";
import type { HealthReport } from "../reports/colonyHealth";
import type { CoverageReport } from "../reports/coverage";
import type { WelfarePatterns } from "../reports/welfarePatterns";
import type { VetCostsReport } from "../reports/vetCosts";

// SYC-619 task 16 (spec §8.1–§8.3): the Reports pages, rendered from fixed
// reports, so no database is involved.

const d = (s: string) => new Date(`${s}T10:00:00Z`);
const base = { areasVersion: 3, workedOutAt: d("2026-10-18"), ms: 1 };
const range = parseRange({ range: "3months" }, d("2026-10-18"));
const o = { personName: "Test", range, canExport: true };
const FOLD = '<details class="method">';
const foldOf = (html: string) => html.slice(html.indexOf(FOLD), html.indexOf("</details>", html.indexOf(FOLD)));
const outsideFold = (html: string) => html.replace(foldOf(html), "");
const count = (html: string, s: string) => html.split(s).length - 1;

const progress = {
  ...base,
  headline: { street: 10, homed: 0, inCare: 0, split: { sterilised: 4, probably: 1, not_sterilised: 3, not_known: 2 } },
  over: [
    { at: d("2026-09-01"), confirmed: 2, street: 8 },
    { at: d("2026-10-01"), confirmed: 4, street: 10 },
  ],
  colonies: [],
} as unknown as ProgressReport;

const coverage = (sightings: number) =>
  ({
    ...base,
    cells: [],
    labels: [],
    perWeek: sightings ? [{ at: d("2026-10-05"), sightings }] : [],
    sightings,
    spotters: sightings ? 2 : 0,
    withoutSpotter: sightings ? 1 : 0,
    offSyros: 0,
    areas: [],
  }) as unknown as CoverageReport;

const welfare = (total: number) =>
  ({
    ...base,
    perWeek: total ? [{ at: d("2026-10-05"), counts: { urgent: total, attention: 0, litter: 0 } }] : [],
    total,
    drafts: 0,
    contentReports: 0,
    topAreas: total ? [{ area: "Kini", count: total }] : [],
  }) as unknown as WelfarePatterns;

const vet = (n: number) =>
  ({
    workedOutAt: d("2026-10-18"),
    ms: 1,
    perMonth: n ? [{ at: d("2026-10-01"), visits: n, spendEur: 60 }] : [],
    byPurpose: { sterilised: 60, vaccinated: 0, treated: 0, checked: 0 },
    visitsByPurpose: { sterilised: n, vaccinated: 0, treated: 0, checked: 0 },
    perSterilisation: n ? { avg: 60, min: 60, max: 60, n } : null,
    noCost: 0,
    visits: n ? [{ visitId: 1, catId: 1, catName: "Tom", at: d("2026-10-10"), clinic: "Symviosis", did: ["sterilised"], costEur: 60, paidBy: "syros_cats" }] : [],
  }) as unknown as VetCostsReport;

describe("the Reports index (§8.1)", () => {
  const html = renderReportsList({ personName: "Test", vetCosts: true });
  const card = (h: string, key: string) => new RegExp(`<li class="card reportcard" id="report-${key}">([\\s\\S]*?)</li>`).exec(h)![1]!;

  it("has no intro line", () => {
    expect(html).not.toContain("worked out from the records when you open it");
  });
  it("Impact is muted with a grey Coming soon chip", () => {
    expect(card(html, "impact")).toContain('<span class="chip">Coming soon</span>');
    expect(card(html, "impact")).toContain('<h2 class="muted">');
  });
  it("Donations keeps its own words, muted, with no chip", () => {
    expect(card(html, "donations")).toContain("Coming once donations are set up");
    expect(card(html, "donations")).not.toContain("chip");
  });
  it("Vet without cost access is muted words with no chip", () => {
    const c = card(renderReportsList({ personName: "Test", vetCosts: false }), "vet");
    expect(c).toContain("For team members who can see vet costs");
    expect(c).not.toContain("chip");
    expect(c).not.toContain("Coming soon");
  });
  it("the period choices have no underline", () => {
    expect(CHART_CSS).toMatch(/nav\.rangebar a\{[^}]*text-decoration:none/);
  });
});

describe("the worked-out line and the fold (§8.2)", () => {
  const html = renderProgressPage(progress, o);
  it("#worked-out is outside the fold and says Syros time", () => {
    const line = /<p class="hint" id="worked-out">([^<]*)<\/p>/.exec(outsideFold(html))!;
    expect(line[1]).toMatch(/^Worked out \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} Syros time · last 3 months$/);
    expect(foldOf(html)).not.toContain("worked-out");
  });
  it("#areas-version is inside the fold, and the corrected line too", () => {
    expect(foldOf(html)).toContain('id="areas-version">Place names from the named areas, version 3.</p>');
    expect(foldOf(html)).toContain("Figures change as records are corrected.");
    expect(outsideFold(html)).not.toContain("areas-version");
  });
  it("the fold closes the page", () => {
    expect(html.indexOf('id="worked-out"')).toBeLessThan(html.indexOf(FOLD));
  });
});

describe("Sterilisation progress (§8.3)", () => {
  it("says Each point shows… once, under the chart", () => {
    const html = renderProgressPage(progress, o);
    expect(count(html, AS_STOOD)).toBe(1);
    expect(outsideFold(html)).toContain(AS_STOOD);
  });
});

describe("Colony health with no colonies (§8.2)", () => {
  const html = renderHealthPage({ ...base, rows: [] } as HealthReport, { ...o, sort: "name", dir: "asc" });
  it("says there are no colonies and links to the Colonies page, not See all time", () => {
    expect(html.replace(/<[^>]+>/g, "")).toContain("No colonies yet. Colonies are set up on the Colonies page.");
    expect(html).toContain('href="/api/team/colonies"');
    expect(html).not.toContain("See all time");
  });
});

describe("Coverage and spotting (§8.2, §8.3)", () => {
  const empty = renderCoveragePage(coverage(0), o);
  const full = renderCoveragePage(coverage(5), o);
  it("empty: no spotting chart, table or download; the headline and the coverage map stay", () => {
    expect(empty).toContain("<strong>0</strong> sightings, from <strong>0</strong> spotters");
    expect(empty).toContain("Where spotters have looked");
    expect(empty).not.toContain('aria-label="Sightings per week"');
    expect(empty).not.toContain("coverage-weeks.csv");
    expect(empty).not.toContain("<caption>Sightings per week");
  });
  it("full: the chart, its table and its download are there", () => {
    expect(full).toContain('aria-label="Sightings per week"');
    expect(full).toContain("coverage-weeks.csv");
  });
  it("the counting rules are in the fold; Spotters are counted, never named is not", () => {
    expect(foldOf(full)).toContain("Counted by the date each sighting was sent.");
    expect(foldOf(full)).toContain("Sightings from spotters who have since deleted their account count as sightings, but not as spotters.");
    expect(outsideFold(full)).not.toContain("Counted by the date");
    expect(outsideFold(full)).not.toContain("since deleted their account");
    expect(outsideFold(full)).toContain("Spotters are counted, never named.");
    expect(foldOf(full)).not.toContain("never named");
  });
});

describe("Welfare patterns (§8.2, §8.3)", () => {
  const empty = renderWelfarePage(welfare(0), o);
  const full = renderWelfarePage(welfare(2), o);
  const PROMISE = "No response times and nothing about who sent or handled a report.";
  it("empty: leaves out the three sections; the promise stays", () => {
    for (const gone of ["Welfare reports per week", "Counted separately", "Where reports came from"]) expect(empty).not.toContain(gone);
    expect(outsideFold(empty)).toContain(PROMISE);
    expect(empty).toContain("Nothing recorded in this period");
  });
  it("full: the sections are back and the promise is visible", () => {
    for (const here of ["Welfare reports per week", "Counted separately", "Where reports came from"]) expect(full).toContain(here);
    expect(outsideFold(full)).toContain(PROMISE);
    expect(foldOf(full)).not.toContain("No response times");
  });
  it("the two rules are in the fold", () => {
    expect(foldOf(full)).toContain("Each report is in one kind only: a report with kittens is Litter, however urgent.");
    expect(foldOf(full)).toContain("Counted by the date each report was sent.");
    expect(outsideFold(full)).not.toContain("one kind only");
    expect(outsideFold(full)).not.toContain("Counted by the date");
  });
});

describe("Vet visits and costs (§8.2, §8.3)", () => {
  const empty = renderVetPage(vet(0), o);
  const full = renderVetPage(vet(1), o);
  it("empty: the headline stays; the four sections are left out", () => {
    expect(empty).toContain("<strong>0</strong> vet visits");
    expect(empty).toContain("€0");
    for (const id of ["by-purpose", "per-sterilisation", "no-cost", 'id="visits"']) expect(empty).not.toContain(id);
    for (const gone of ["Spend by what was done", "Cost per sterilisation", "Sterilisations with no cost recorded", "Every visit"]) expect(empty).not.toContain(gone);
  });
  it("full: the sections are back", () => {
    for (const id of ['id="by-purpose"', 'id="per-sterilisation"', 'id="no-cost"', 'id="visits"']) expect(full).toContain(id);
  });
  it("the rule lines are in the fold", () => {
    const fold = foldOf(full);
    expect(fold).toContain("Each visit is counted once, under its main purpose: Sterilised if ticked, else Vaccinated, else Treated, else Checked only.");
    expect(fold).toContain("A visit that also vaccinated or treated the cat counts its whole cost.");
    expect(fold).toContain("never at a vet visit");
    expect(fold).toContain("Counted by the date of the visit.");
    expect(fold).toContain("An undone visit isn&#39;t counted anywhere.");
    const out = outsideFold(full);
    for (const s of ["counted once, under its main purpose", "counts its whole cost", "never at a vet visit", "Counted by the date", "An undone visit"]) expect(out).not.toContain(s);
  });
  it("what the main figure is stays visible", () => {
    expect(outsideFold(full)).toContain("Spend is Syros Cats' money and donations given for a cat. Owner-paid visits are listed, but never added into spend.");
    expect(foldOf(full)).not.toContain("Owner-paid");
  });
});
