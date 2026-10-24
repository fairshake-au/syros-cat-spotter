import { athensToday } from "../athensTime";
import { wholePct, type ColonyFlag } from "../dashboard/colonyFigures";
import { WELFARE_COLOUR, WELFARE_ORDER, WELFARE_PATTERN, WELFARE_WORD } from "../dashboard/welfareKinds";
import { barChart, lineChart, sortedBars, tableFor, tableHtml, type TableColumn, type TableSpec } from "../reports/charts";
import type { CoverageReport } from "../reports/coverage";
import { coverageMap } from "../reports/coverageMap";
import type { WelfarePatterns } from "../reports/welfarePatterns";
import { toCsv } from "../reports/csv";
import { HEALTH_SORTS, sortHealth, type HealthReport, type HealthRow, type HealthSort, type SortDir } from "../reports/colonyHealth";
import type { ProgressReport } from "../reports/progress";
import { PURPOSE_ORDER, type VetCostsReport } from "../reports/vetCosts";
import { euroText } from "../euros";
import { visitDidWords } from "./catPages";
import { DID_WORDS, PAID_WORDS } from "./vetVisitForm";
import { dayWords, rangeQuery, type Range, type RangeKey } from "../reports/range";
import { escapeHtml as esc } from "./escape";
import { backLink } from "./backLink";
import { renderPage } from "./layout";
import { markBar } from "./marks";

// The Reports area and its first two reports (SYC-396 PR 3.3a; spec §9.3).
// Server-drawn, no scripts: every chart is an SVG picture with its numbers in
// "Show as table", and every table downloads as a spreadsheet file whose
// columns are the table's own (the same TableColumn list feeds both).
//
// Team-only at launch (Samuel, 18 Oct, Q1): a cat guardian's reports, in her
// language, arrive on 16 Nov (SYC-472). Team pages are English (Decision 12).

export const INSIGHTS = "/api/team/insights";

/** The seven reports (§9.3), in the spec's order. Only built ones are linked. */
export const REPORTS: readonly { key: string; title: string; about: string; built: boolean; pending?: string }[] = [
  { key: "progress", title: "Sterilisation progress", about: "The island's progress over time, and every colony's.", built: true },
  { key: "health", title: "Colony health", about: "Every colony in one table: cats, change, kittens, cat guardians and visits.", built: true },
  { key: "coverage", title: "Coverage and spotting", about: "Where spotters have looked, and where to send them next.", built: true },
  { key: "welfare", title: "Welfare patterns", about: "Welfare reports per week, by kind.", built: true },
  { key: "vet", title: "Vet visits and costs", about: "Visits and Syros Cats' spend per month.", built: true },
  { key: "impact", title: "Impact report for funders", about: "What the work has achieved, to share with funders.", built: false },
  { key: "donations", title: "Donations", about: "Money received, and what it paid for.", built: false, pending: "Coming once donations are set up" },
];

export const NOTHING_IN_PERIOD = "Nothing recorded in this period";
export const CORRECTED = "Figures change as records are corrected";
export const AS_STOOD = "Each point shows the records as they stood on that date";

const FLAG_WORD: Record<ColonyFlag, string> = {
  kittens: "Kittens reported",
  growing: "Growing",
  not_visited: "Not visited lately",
  no_guardian: "No cat guardian",
};

/** "18 Oct 2026, 16:40", on Syros. */
function stamp(at: Date): string {
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" });
  return `${dayWords(at)}, ${time}`;
}

/** YYYY-MM-DD on Syros, for a spreadsheet. */
const isoDay = (at: Date) => athensToday(at);

// ─── The list ───────────────────────────────────────────────────────────

/** Vet visits and costs needs view_vet_costs too (§8.4): without it the card isn't a link. */
export const VET_COSTS_ONLY = "For team members who can see vet costs";

export function renderReportsList(o: { personName: string; vetCosts: boolean }): string {
  const cards = REPORTS.map((r) => {
    const open = r.built && (r.key !== "vet" || o.vetCosts);
    const head = open
      ? `<h2><a href="${INSIGHTS}/${r.key}">${esc(r.title)}</a></h2>`
      : `<h2>${esc(r.title)}</h2>`;
    const status = open ? "" : `<p class="hint">${esc(r.built ? VET_COSTS_ONLY : (r.pending ?? "Coming soon"))}</p>`;
    return `<li class="card reportcard" id="report-${r.key}">${head}<p>${esc(r.about)}</p>${status}</li>`;
  }).join("");
  return renderPage({
    title: "Reports",
    active: "reports",
    personName: o.personName,
    body:
      '<p class="hint">Each report is worked out from the records when you open it, for the time range you choose.</p>' +
      `<ul class="reportlist">${cards}</ul>`,
  });
}

// ─── The parts every report shares ──────────────────────────────────────

const QUICK: { key: Exclude<RangeKey, "custom">; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "3months", label: "Last 3 months" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

/** The time range at the top: four links and a form for dates you choose (dates only in the address). */
function rangeBar(path: string, range: Range, extra = "", keep: Record<string, string> = {}): string {
  const links = QUICK.map((q) =>
    q.key === range.key
      ? `<a class="tap here" href="${path}?range=${q.key}${extra}" aria-current="true">${esc(q.label)}</a>`
      : `<a class="tap" href="${path}?range=${q.key}${extra}">${esc(q.label)}</a>`,
  ).join("");
  const today = athensToday(range.to);
  const from = range.dates?.from ?? "";
  const to = range.dates?.to ?? "";
  return (
    `<nav class="rangebar" aria-label="Time range">${links}</nav>` +
    `<details class="astable"${range.key === "custom" ? " open" : ""}><summary>Dates you choose</summary>` +
    `<form method="get" action="${path}" class="rangeform">` +
    '<input type="hidden" name="range" value="custom">' +
    Object.entries(keep)
      .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
      .join("") +
    `<label>From <input type="date" name="from" value="${esc(from)}" max="${esc(today)}" required></label>` +
    `<label>To <input type="date" name="to" value="${esc(to)}" max="${esc(today)}" required></label>` +
    '<button type="submit">Show</button></form></details>'
  );
}

/** The method lines (§9.3): when it was worked out, for what period, and the areas' version (null: the report names no places). */
function methodNote(range: Range, workedOutAt: Date, areasVersion: number | null, lines: string[]): string {
  return (
    '<div class="method">' +
    lines.map((l) => `<p class="hint">${esc(l)}.</p>`).join("") +
    `<p class="hint">${esc(CORRECTED)}.</p>` +
    `<p class="hint" id="worked-out">Worked out ${esc(stamp(workedOutAt))} · ${esc(lowerFirst(range.label))}</p>` +
    (areasVersion === null ? "" : `<p class="hint" id="areas-version">Place names from the named areas, version ${areasVersion}.</p>`) +
    "</div>"
  );
}

/** "Last 3 months" reads "last 3 months" mid-sentence; a date range starts with a number and keeps its months. */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function nothing(path: string): string {
  return `<p class="empty" id="nothing">${esc(NOTHING_IN_PERIOD)}. <a href="${path}?range=all">See all time</a></p>`;
}

function download(key: string, range: Range, words: string, extra = ""): string {
  return `<p><a class="tap" href="${INSIGHTS}/${key}.csv?${rangeQuery(range)}${extra}" download>${esc(words)}</a></p>`;
}

const back = backLink(INSIGHTS, "Reports");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ─── Sterilisation progress ─────────────────────────────────────────────

const OVER_COLUMNS: TableColumn[] = [
  { key: "date", label: "Date" },
  { key: "confirmed", label: "Confirmed sterilised", numeric: true },
  { key: "street", label: "All street cats known", numeric: true },
];

const COLONY_COLUMNS: TableColumn[] = [
  { key: "colony", label: "Colony" },
  { key: "street", label: "Street cats", numeric: true },
  { key: "sterilised", label: "Sterilised", numeric: true },
  { key: "probably", label: "Probably sterilised", numeric: true },
  { key: "not_known", label: "Not known yet", numeric: true },
  { key: "not_sterilised", label: "Not sterilised", numeric: true },
  { key: "pct", label: "% confirmed sterilised", numeric: true },
];

const streetOf = (s: { sterilised: number; probably: number; not_sterilised: number; not_known: number }) =>
  s.sterilised + s.probably + s.not_sterilised + s.not_known;

const pctOf = (part: number, whole: number): number | null => (whole === 0 ? null : wholePct(part, whole));

/** The progress tables' rows. `forCsv`: numbers stay numbers and dates are YYYY-MM-DD. */
export function progressTables(r: ProgressReport, forCsv = false): { over: TableSpec; colonies: TableSpec } {
  return {
    over: {
      caption: "Confirmed sterilised and all street cats known, by date",
      columns: OVER_COLUMNS,
      rows: r.over.map((p) => ({ date: forCsv ? isoDay(p.at) : dayWords(p.at), confirmed: p.confirmed, street: p.street })),
    },
    colonies: {
      caption: "Every colony, fewest confirmed sterilised first",
      columns: COLONY_COLUMNS,
      rows: r.colonies.map((c) => {
        const street = streetOf(c.split);
        const pct = pctOf(c.split.sterilised, street);
        return {
          colony: c.name,
          street,
          sterilised: c.split.sterilised,
          probably: c.split.probably,
          not_known: c.split.not_known,
          not_sterilised: c.split.not_sterilised,
          pct: pct === null ? (forCsv ? "" : "–") : pct,
        };
      }),
    },
  };
}

export function renderProgressPage(r: ProgressReport, o: { personName: string; range: Range; canExport: boolean }): string {
  const path = `${INSIGHTS}/progress`;
  const h = r.headline;
  const empty = r.over.every((p) => p.street === 0) && h.street === 0;
  const t = progressTables(r);
  const pct = pctOf(h.split.sterilised, h.street);
  const also =
    h.homed + h.inCare > 0 ? `<p class="hint">Also ${esc(plural(h.homed, "cat", "cats"))} with homes and ${h.inCare} in care.</p>` : "";
  const body = empty
    ? rangeBar(path, o.range) + nothing(path) + methodNote(o.range, r.workedOutAt, r.areasVersion, [])
    : rangeBar(path, o.range) +
      '<section id="headline"><h2 class="sr">Street cats on Syros</h2>' +
      `<p class="hbig"><strong>${h.street}</strong> ${h.street === 1 ? "street cat" : "street cats"} known on Syros` +
      (pct === null ? "" : `, ${pct}% confirmed sterilised`) +
      "</p>" +
      markBar(h.split) +
      also +
      "</section>" +
      '<section id="over"><h2>Confirmed sterilised over time</h2><div class="chartbox">' +
      lineChart({
        title: "Confirmed sterilised and all street cats known, over time",
        series: [
          { label: "All street cats known", neutral: true, points: r.over.map((p) => ({ at: p.at, value: p.street })) },
          { label: "Confirmed sterilised", mark: "sterilised", points: r.over.map((p) => ({ at: p.at, value: p.confirmed })) },
        ],
      }) +
      `<p class="hint">${esc(AS_STOOD)}.</p></div>` +
      tableFor(t.over) +
      (o.canExport ? download("progress-over", o.range, "Download these figures as a spreadsheet (CSV)") : "") +
      "</section>" +
      '<section id="colonies"><h2>Every colony, fewest confirmed sterilised first</h2>' +
      (r.colonies.length === 0
        ? '<p class="empty">No colonies yet.</p>'
        : sortedBars({
            title: "Every colony, fewest confirmed sterilised first",
            rows: r.colonies.map((c) => ({ label: c.name, split: c.split, href: `/api/team/colonies/${c.colonyId}` })),
          }) +
          tableFor(t.colonies) +
          (o.canExport ? download("progress-colonies", o.range, "Download the colonies as a spreadsheet (CSV)") : "")) +
      "</section>" +
      methodNote(o.range, r.workedOutAt, r.areasVersion, [AS_STOOD]);
  return renderPage({ title: "Sterilisation progress", active: "reports", personName: o.personName, beforeTitle: back, body, mainClass: "wide" });
}

// ─── Colony health ──────────────────────────────────────────────────────

const HEALTH_COLUMNS: (TableColumn & { key: HealthSort | "flags" })[] = [
  { key: "name", label: "Colony" },
  { key: "cats", label: "Cats now", numeric: true },
  { key: "change", label: "Change over 90 days", numeric: true },
  { key: "kittens", label: "Kittens reported" },
  { key: "notseen", label: "Not seen lately", numeric: true },
  { key: "guardian", label: "Cat guardian" },
  { key: "lastvisit", label: "Last visit" },
  { key: "flags", label: "Flags" },
];

/** Which way a column sorts first: counts and dates most first, names and yes/no A to Z. */
const FIRST_DIR: Record<HealthSort, SortDir> = {
  name: "asc",
  cats: "desc",
  change: "desc",
  kittens: "desc",
  notseen: "desc",
  guardian: "asc",
  lastvisit: "desc",
};

export function parseHealthSort(q: unknown): { sort: HealthSort; dir: SortDir } {
  const get = (k: string) => (q !== null && typeof q === "object" ? (q as Record<string, unknown>)[k] : undefined);
  const s = get("sort");
  const sort: HealthSort = typeof s === "string" && (HEALTH_SORTS as readonly string[]).includes(s) ? (s as HealthSort) : "name";
  const d = get("dir");
  const dir: SortDir = d === "asc" || d === "desc" ? d : FIRST_DIR[sort];
  return { sort, dir };
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

/** The health table's rows, sorted. `forCsv`: numbers stay numbers and dates are YYYY-MM-DD. */
export function healthTable(r: HealthReport, sort: HealthSort, dir: SortDir, forCsv = false): TableSpec {
  const rows = sortHealth(r.rows, sort, dir).map((h: HealthRow) => ({
    name: h.name,
    cats: h.catsNow,
    change: forCsv ? h.change : signed(h.change),
    kittens: h.kittens ? "Yes" : "No",
    notseen: h.notSeenLately,
    guardian: h.guardian ? "Yes" : "No",
    lastvisit: h.lastVisit === null ? (forCsv ? "" : "Never") : forCsv ? isoDay(h.lastVisit) : dayWords(h.lastVisit),
    flags: h.flags.map((f) => FLAG_WORD[f]).join(forCsv ? "; " : ", "),
  }));
  return { caption: "Every colony", columns: HEALTH_COLUMNS, rows, sorted: { key: sort, dir } };
}

export function renderHealthPage(
  r: HealthReport,
  o: { personName: string; range: Range; sort: HealthSort; dir: SortDir; canExport: boolean },
): string {
  const path = `${INSIGHTS}/health`;
  const keep = `&sort=${o.sort}&dir=${o.dir}`;
  const table = healthTable(r, o.sort, o.dir);
  // Every column header is a sort link (no script); the sorted one turns round.
  const headers: Record<string, string> = {};
  for (const c of HEALTH_COLUMNS) {
    if (c.key === "flags") continue;
    const key = c.key as HealthSort;
    const dir = key === o.sort ? (o.dir === "asc" ? "desc" : "asc") : FIRST_DIR[key];
    const arrow = key === o.sort ? (o.dir === "asc" ? " ▲" : " ▼") : "";
    headers[c.key] = `<a href="${path}?${rangeQuery(o.range)}&amp;sort=${key}&amp;dir=${dir}">${esc(c.label)}${arrow}</a>`;
  }
  const body =
    rangeBar(path, o.range, keep.replace(/&/g, "&amp;"), { sort: o.sort, dir: o.dir }) +
    (r.rows.length === 0
      ? nothing(path)
      : '<p class="hint">Figures at the end of the range. Change over 90 days compares with the records as they stood 90 days before. Tap a column to sort by it.</p>' +
        tableHtml({ ...table, headers }) +
        (o.canExport ? download("health", o.range, "Download this table as a spreadsheet (CSV)", `&amp;sort=${o.sort}&amp;dir=${o.dir}`) : "")) +
    methodNote(o.range, r.workedOutAt, r.areasVersion, []);
  return renderPage({ title: "Colony health", active: "reports", personName: o.personName, beforeTitle: back, body, mainClass: "wide" });
}

// ─── Coverage and spotting ──────────────────────────────────────────────

/** A total that isn't a status (§12.2): neutral ink #1d1d1b at 55%. */
const NEUTRAL_TOTAL = "rgba(29,29,27,0.55)";

export const NO_SPOTTER = "Sightings from spotters who have since deleted their account count as sightings, but not as spotters";

const WEEK_COLUMNS: TableColumn[] = [
  { key: "week", label: "Week starting" },
  { key: "sightings", label: "Sightings", numeric: true },
];

const COVERAGE_AREA_COLUMNS: TableColumn[] = [
  { key: "area", label: "Area" },
  { key: "not_looked_at", label: "Squares not looked at yet", numeric: true },
  { key: "seen", label: "Squares with a sighting", numeric: true },
  { key: "sightings", label: "Sightings", numeric: true },
];

/** The coverage tables' rows: no position, only areas, weeks and counts. `forCsv`: dates are YYYY-MM-DD. */
export function coverageTables(r: CoverageReport, forCsv = false): { weeks: TableSpec; areas: TableSpec } {
  return {
    weeks: {
      caption: "Sightings per week",
      columns: WEEK_COLUMNS,
      rows: r.perWeek.map((w) => ({ week: forCsv ? isoDay(w.at) : dayWords(w.at), sightings: w.sightings })),
    },
    areas: {
      caption: "Every named area, most squares not looked at yet first",
      columns: COVERAGE_AREA_COLUMNS,
      rows: r.areas.map((a) => ({ area: a.area, not_looked_at: a.notLookedAt, seen: a.seen, sightings: a.sightings })),
    },
  };
}

export function renderCoveragePage(r: CoverageReport, o: { personName: string; range: Range; canExport: boolean }): string {
  const path = `${INSIGHTS}/coverage`;
  const t = coverageTables(r);
  const notLooked = r.cells.filter((c) => !c.seen).length;
  const seen = r.cells.length - notLooked;
  const lines = ["Counted by the date each sighting was sent"];
  const body =
    rangeBar(path, o.range) +
    (r.sightings === 0 ? nothing(path) : "") +
    '<section id="spotting"><h2>Spotting</h2>' +
    `<p class="hbig"><strong>${r.sightings}</strong> ${r.sightings === 1 ? "sighting" : "sightings"}, from ` +
    `<strong>${r.spotters}</strong> ${r.spotters === 1 ? "spotter" : "spotters"}</p>` +
    '<p class="hint">Spotters are counted, never named.' +
    (r.withoutSpotter > 0 ? ` ${esc(NO_SPOTTER)}.` : "") +
    "</p>" +
    (r.sightings === 0
      ? ""
      : '<div class="chartbox">' +
        barChart({
          title: "Sightings per week",
          bars: r.perWeek.map((w) => ({ at: w.at, parts: [{ key: "sightings", label: "Sightings", value: w.sightings, colour: NEUTRAL_TOTAL }] })),
        }) +
        "</div>" +
        tableFor(t.weeks) +
        (o.canExport ? download("coverage-weeks", o.range, "Download sightings per week as a spreadsheet (CSV)") : "")) +
    "</section>" +
    '<section id="coverage"><h2>Where spotters have looked</h2>' +
    `<p class="hint">Squares of about 250 m. ${esc(plural(seen, "square", "squares"))} with a sighting in this period; ` +
    `${esc(plural(notLooked, "square", "squares"))} within 500 m of an area's centre not looked at yet.</p>` +
    '<div class="chartbox">' +
    coverageMap({ cells: r.cells, labels: r.labels, title: "Squares sighted in this period, and squares not looked at yet" }) +
    "</div>" +
    (r.offSyros > 0 ? `<p class="hint">Also ${esc(plural(r.offSyros, "sighting", "sightings"))} more than 2 km from every area, not drawn.</p>` : "") +
    tableFor(t.areas) +
    (o.canExport ? download("coverage-areas", o.range, "Download the areas as a spreadsheet (CSV)") : "") +
    "</section>" +
    methodNote(o.range, r.workedOutAt, r.areasVersion, lines);
  return renderPage({ title: "Coverage and spotting", active: "reports", personName: o.personName, beforeTitle: back, body, mainClass: "wide" });
}

// ─── Welfare patterns ───────────────────────────────────────────────────

export const DRAFTS = "Started, not sent";
export const CONTENT = "Problems reported with photos or names";

const WELFARE_WEEK_COLUMNS: TableColumn[] = [
  { key: "week", label: "Week starting" },
  ...WELFARE_ORDER.map((k) => ({ key: k, label: WELFARE_WORD[k], numeric: true as const })),
  { key: "total", label: "All welfare reports", numeric: true },
];

const WELFARE_AREA_COLUMNS: TableColumn[] = [
  { key: "area", label: "Area" },
  { key: "count", label: "Welfare reports", numeric: true },
];

export function welfareTables(r: WelfarePatterns, forCsv = false): { weeks: TableSpec; areas: TableSpec } {
  return {
    weeks: {
      caption: "Welfare reports per week, by kind",
      columns: WELFARE_WEEK_COLUMNS,
      rows: r.perWeek.map((w) => ({
        week: forCsv ? isoDay(w.at) : dayWords(w.at),
        ...w.counts,
        total: WELFARE_ORDER.reduce((n, k) => n + w.counts[k], 0),
      })),
    },
    areas: {
      caption: "The areas with the most welfare reports",
      columns: WELFARE_AREA_COLUMNS,
      rows: r.topAreas.map((a) => ({ area: a.area, count: a.count })),
    },
  };
}

export function renderWelfarePage(r: WelfarePatterns, o: { personName: string; range: Range; canExport: boolean }): string {
  const path = `${INSIGHTS}/welfare`;
  const t = welfareTables(r);
  const sums = Object.fromEntries(WELFARE_ORDER.map((k) => [k, r.perWeek.reduce((n, w) => n + w.counts[k], 0)]));
  const split = WELFARE_ORDER.map((k) => `${sums[k]} ${WELFARE_WORD[k].toLowerCase()}`).join(", ");
  const body =
    rangeBar(path, o.range) +
    (r.total === 0 && r.drafts === 0 && r.contentReports === 0 ? nothing(path) : "") +
    '<section id="welfare"><h2>Welfare reports per week</h2>' +
    `<p class="hbig"><strong>${r.total}</strong> welfare ${r.total === 1 ? "report" : "reports"} sent` +
    (r.total === 0 ? "" : `: ${esc(split)}`) +
    "</p>" +
    '<p class="hint">Each report is in one kind only: a report with kittens is Litter, however urgent.</p>' +
    (r.total === 0
      ? ""
      : '<div class="chartbox">' +
        barChart({
          title: "Welfare reports per week, by kind",
          bars: r.perWeek.map((w) => ({
            at: w.at,
            parts: WELFARE_ORDER.map((k) => ({ key: k, label: WELFARE_WORD[k], value: w.counts[k], colour: WELFARE_COLOUR[k], pattern: WELFARE_PATTERN[k] })),
          })),
        }) +
        "</div>" +
        tableFor(t.weeks) +
        (o.canExport ? download("welfare-weeks", o.range, "Download reports per week as a spreadsheet (CSV)") : "")) +
    "</section>" +
    '<section id="counted-apart"><h2>Counted separately</h2><ul class="counts">' +
    `<li id="drafts"><strong>${r.drafts}</strong> ${esc(DRAFTS.toLowerCase())}: welfare reports someone began but didn't send.</li>` +
    `<li id="content"><strong>${r.contentReports}</strong> ${esc(CONTENT.toLowerCase())}. These are about the catalogue, not a cat's welfare, so they aren't on the chart.</li>` +
    "</ul></section>" +
    '<section id="areas"><h2>Where reports came from</h2>' +
    (r.topAreas.length === 0
      ? '<p class="empty">No welfare reports in this period.</p>'
      : tableHtml(t.areas) + (o.canExport ? download("welfare-areas", o.range, "Download the areas as a spreadsheet (CSV)") : "")) +
    "</section>" +
    methodNote(o.range, r.workedOutAt, r.areasVersion, ["Counted by the date each report was sent", "No response times and nothing about who sent or handled a report"]);
  return renderPage({ title: "Welfare patterns", active: "reports", personName: o.personName, beforeTitle: back, body, mainClass: "wide" });
}

// ─── Vet visits and costs ───────────────────────────────────────────────

export const OWNER_PAID = "Owner-paid visits are listed, but never added into spend";

const VET_MONTH_COLUMNS: TableColumn[] = [
  { key: "month", label: "Month" },
  { key: "visits", label: "Visits", numeric: true },
  { key: "spend", label: "Syros Cats' spend (€)", numeric: true },
];

const VET_PURPOSE_COLUMNS: TableColumn[] = [
  { key: "purpose", label: "What was done" },
  { key: "visits", label: "Visits", numeric: true },
  { key: "spend", label: "Syros Cats' spend (€)", numeric: true },
];

const VET_VISIT_COLUMNS: TableColumn[] = [
  { key: "cat", label: "Cat" },
  { key: "date", label: "Date" },
  { key: "clinic", label: "Clinic" },
  { key: "did", label: "What was done" },
  { key: "cost", label: "Cost (€)", numeric: true },
  { key: "paid", label: "Paid by" },
];

/** "Oct 2026" on the page; the month's first day, "2026-10-01", in a spreadsheet (which reads it as a date, not text). */
const monthWords = (at: Date, forCsv: boolean) => (forCsv ? isoDay(at) : dayWords(at).replace(/^\d+ /, ""));

/** An amount: "€55.50" on the page, 55.5 in a spreadsheet. */
const money = (eur: number, forCsv: boolean) => (forCsv ? eur : euroText(eur));

/** The vet report's tables. `forCsv`: numbers stay numbers, dates are YYYY-MM-DD, no cost is empty. */
export function vetTables(r: VetCostsReport, forCsv = false): { months: TableSpec; purposes: TableSpec; visits: TableSpec } {
  return {
    months: {
      caption: "Visits and Syros Cats' spend per month",
      columns: VET_MONTH_COLUMNS,
      rows: r.perMonth.map((m) => ({ month: monthWords(m.at, forCsv), visits: m.visits, spend: money(m.spendEur, forCsv) })),
    },
    purposes: {
      caption: "Syros Cats' spend by what was done",
      columns: VET_PURPOSE_COLUMNS,
      rows: PURPOSE_ORDER.map((p) => ({ purpose: DID_WORDS[p], visits: r.visitsByPurpose[p], spend: money(r.byPurpose[p], forCsv) })),
    },
    visits: {
      caption: "Every visit, newest first",
      columns: VET_VISIT_COLUMNS,
      rows: r.visits.map((v) => ({
        cat: v.catName,
        date: forCsv ? isoDay(v.at) : dayWords(v.at),
        clinic: v.clinic,
        did: visitDidWords(v),
        cost: v.costEur === null ? (forCsv ? "" : "Not recorded") : money(v.costEur, forCsv),
        paid: PAID_WORDS[v.paidBy],
      })),
    },
  };
}

export function renderVetPage(r: VetCostsReport, o: { personName: string; range: Range; canExport: boolean }): string {
  const path = `${INSIGHTS}/vet`;
  const t = vetTables(r);
  const visits = r.visits.length;
  const spend = r.perMonth.reduce((c, m) => c + Math.round(m.spendEur * 100), 0) / 100;
  const per = r.perSterilisation;
  const body =
    rangeBar(path, o.range) +
    (visits === 0 && r.noCost === 0 ? nothing(path) : "") +
    '<section id="spend"><h2>Visits and spend per month</h2>' +
    `<p class="hbig"><strong>${visits}</strong> vet ${visits === 1 ? "visit" : "visits"}, ` +
    `<strong>${esc(euroText(spend))}</strong> spent by Syros Cats</p>` +
    `<p class="hint">Spend is Syros Cats' money and donations given for a cat. ${esc(OWNER_PAID)}.</p>` +
    (visits === 0
      ? ""
      : '<div class="chartbox">' +
        barChart({
          title: "Syros Cats' spend per month",
          bars: r.perMonth.map((m) => ({ at: m.at, parts: [{ key: "spend", label: "Spend (€)", value: m.spendEur, colour: NEUTRAL_TOTAL }] })),
        }) +
        "</div>" +
        tableFor(t.months) +
        (o.canExport ? download("vet-months", o.range, "Download visits and spend per month as a spreadsheet (CSV)") : "")) +
    "</section>" +
    '<section id="by-purpose"><h2>Spend by what was done</h2>' +
    '<p class="hint">Each visit is counted once, under its main purpose: Sterilised if ticked, else Vaccinated, else Treated, else Checked only.</p>' +
    tableHtml(t.purposes) +
    (o.canExport ? download("vet-purposes", o.range, "Download spend by what was done as a spreadsheet (CSV)") : "") +
    "</section>" +
    '<section id="per-sterilisation"><h2>Cost per sterilisation</h2>' +
    (per === null
      ? '<p class="empty">No sterilisation with a cost paid by Syros Cats in this period.</p>'
      : `<p class="hbig">Average <strong>${esc(euroText(per.avg))}</strong></p>` +
        `<p>From ${esc(euroText(per.min))} to ${esc(euroText(per.max))}, over ${esc(plural(per.n, "sterilisation", "sterilisations"))} Syros Cats paid for.</p>` +
        '<p class="hint">A visit that also vaccinated or treated the cat counts its whole cost.</p>') +
    "</section>" +
    '<section id="no-cost"><h2>Sterilisations with no cost recorded</h2>' +
    `<p class="hbig"><strong>${r.noCost}</strong> ${r.noCost === 1 ? "sterilisation" : "sterilisations"} with no cost recorded</p>` +
    '<p class="hint">Cats marked sterilised with “Update this cat” and never at a vet visit, and vet visits with Sterilised saved without a cost, whoever paid. They aren\'t in the cost per sterilisation.</p>' +
    "</section>" +
    '<section id="visits"><h2>Every visit</h2>' +
    (visits === 0
      ? '<p class="empty">No vet visits in this period.</p>'
      : tableHtml(t.visits) + (o.canExport ? download("vet-visits", o.range, "Download every visit as a spreadsheet for the accounts (CSV)") : "")) +
    "</section>" +
    methodNote(o.range, r.workedOutAt, null, ["Counted by the date of the visit", "An undone visit isn't counted anywhere"]);
  return renderPage({ title: "Vet visits and costs", active: "reports", personName: o.personName, beforeTitle: back, body, mainClass: "wide" });
}

// ─── The spreadsheet files ──────────────────────────────────────────────

/** The downloads, by the name in their address. */
export const CSV_REPORTS = [
  "progress-over",
  "progress-colonies",
  "health",
  "coverage-weeks",
  "coverage-areas",
  "welfare-weeks",
  "welfare-areas",
  "vet-months",
  "vet-purposes",
  "vet-visits",
] as const;

/** The vet report's files need view_vet_costs too (§8.4). */
export const VET_CSV_REPORTS: readonly CsvReport[] = ["vet-months", "vet-purposes", "vet-visits"];
export type CsvReport = (typeof CSV_REPORTS)[number];

export const csvOf = (t: TableSpec): string => toCsv(t.columns, t.rows);

/** "sterilisation-progress-2026-10-18.csv": the report and the day, nothing else. */
export function csvFilename(report: CsvReport, now: Date): string {
  const name = {
    "progress-over": "sterilisation-progress",
    "progress-colonies": "sterilisation-progress-colonies",
    health: "colony-health",
    "coverage-weeks": "sightings-per-week",
    "coverage-areas": "coverage-by-area",
    "welfare-weeks": "welfare-reports-per-week",
    "welfare-areas": "welfare-reports-by-area",
    "vet-months": "vet-spend-per-month",
    "vet-purposes": "vet-spend-by-what-was-done",
    "vet-visits": "vet-visits",
  }[report];
  return `${name}-${isoDay(now)}.csv`;
}
