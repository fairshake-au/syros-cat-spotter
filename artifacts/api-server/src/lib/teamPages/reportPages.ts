import { athensToday } from "../athensTime";
import { wholePct, type ColonyFlag } from "../dashboard/colonyFigures";
import { lineChart, sortedBars, tableFor, tableHtml, type TableColumn, type TableSpec } from "../reports/charts";
import { toCsv } from "../reports/csv";
import { HEALTH_SORTS, sortHealth, type HealthReport, type HealthRow, type HealthSort, type SortDir } from "../reports/colonyHealth";
import type { ProgressReport } from "../reports/progress";
import { dayWords, rangeQuery, type Range, type RangeKey } from "../reports/range";
import { escapeHtml as esc } from "./escape";
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
  { key: "coverage", title: "Coverage and spotting", about: "Where spotters have looked, and where to send them next.", built: false },
  { key: "welfare", title: "Welfare patterns", about: "Welfare reports per week, by kind.", built: false },
  { key: "vet", title: "Vet visits and costs", about: "Visits and Syros Cats' spend per month.", built: false },
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

export function renderReportsList(o: { personName: string }): string {
  const cards = REPORTS.map((r) => {
    const head = r.built
      ? `<h2><a href="${INSIGHTS}/${r.key}">${esc(r.title)}</a></h2>`
      : `<h2>${esc(r.title)}</h2>`;
    const status = r.built ? "" : `<p class="hint">${esc(r.pending ?? "Coming soon")}</p>`;
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

/** The method lines (§9.3): when it was worked out, for what period, and the areas' version. */
function methodNote(range: Range, workedOutAt: Date, areasVersion: number, lines: string[]): string {
  return (
    '<div class="method">' +
    lines.map((l) => `<p class="hint">${esc(l)}.</p>`).join("") +
    `<p class="hint">${esc(CORRECTED)}.</p>` +
    `<p class="hint" id="worked-out">Worked out ${esc(stamp(workedOutAt))} · ${esc(lowerFirst(range.label))}</p>` +
    `<p class="hint" id="areas-version">Place names from the named areas, version ${areasVersion}.</p>` +
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

const back = `<p class="back"><a href="${INSIGHTS}">&larr; All reports</a></p>`;
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
  { key: "probably", label: "Probably", numeric: true },
  { key: "not_known", label: "Not known", numeric: true },
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

// ─── The spreadsheet files ──────────────────────────────────────────────

/** The downloads, by the name in their address. */
export const CSV_REPORTS = ["progress-over", "progress-colonies", "health"] as const;
export type CsvReport = (typeof CSV_REPORTS)[number];

export const csvOf = (t: TableSpec): string => toCsv(t.columns, t.rows);

/** "sterilisation-progress-2026-10-18.csv": the report and the day, nothing else. */
export function csvFilename(report: CsvReport, now: Date): string {
  const name = { "progress-over": "sterilisation-progress", "progress-colonies": "sterilisation-progress-colonies", health: "colony-health" }[report];
  return `${name}-${isoDay(now)}.csv`;
}
