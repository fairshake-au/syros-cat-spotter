import type { TeamCatView, TeamStatement } from "../teamCatView";
import { EAR_TIP_NOT_CLIPPED, FOOD_AND_WATER_OUT } from "../teamCatView";
import { VISIT_REASON, type VisitLine } from "../vetVisits";
import type { Capability } from "../capabilities";
import { placeLabel } from "../areas/placeLabel";
import { euroText } from "../euros";
import { escapeHtml as esc } from "./escape";
import { byWhom, statementHref, vaccineWord, type Shown } from "./catFacts";
import { dateInput, fold, lifeChoices, reasonInput } from "./catActions";
import { DID_WORDS, PAID_WORDS } from "./vetVisitForm";
import { markWrongInFold } from "./appearancePage";
import { rowMenu } from "./rowMenu";
import { openMapLink } from "./position";
import { t } from "./words";
import type { KeptFields } from "./signedOutPage";

// The cat page's one History list (SYC-602 PR 2; spec §3.5, D1): the rows as
// data (historyRows, historyCounts), and drawn (renderHistory). Pure: no
// database, no clock. Never imports catPages.ts, which re-exports from here.

// ── The history's routine sightings (spec §7.3) ─────────────────────────────

/**
 * A routine row: something a spotter's sighting said that means all is well,
 * "Food and water were out" or "Ear tip not clipped". "No food or water" and
 * "Couldn't tell" are never folded under "looking well". Status, colony,
 * colour, name, notes, welfare reports and vet visits are never routine, nor
 * a clipped ear (it counts towards "Probably"), nor anything corrected or
 * correcting.
 */
export function isRoutine(s: TeamStatement): boolean {
  if (s.author.kind !== "spotter") return false;
  if (s.replacedBy.length > 0 || s.replaces != null || s.movedTo || s.movedFrom) return false;
  if (s.kind === "food_and_water") return s.said === FOOD_AND_WATER_OUT;
  return s.kind === "ear_tip" && s.correction === null && s.said === EAR_TIP_NOT_CLIPPED;
}

type HistoryPart = { one: TeamStatement } | { run: TeamStatement[] };

/** The history in order, with each run of two or more routine rows as one part. */
export function groupHistory(rows: readonly TeamStatement[]): HistoryPart[] {
  const parts: HistoryPart[] = [];
  let run: TeamStatement[] = [];
  const flush = () => {
    if (run.length === 1) parts.push({ one: run[0]! });
    else if (run.length > 1) parts.push({ run });
    run = [];
  };
  for (const s of rows) {
    if (isRoutine(s)) run.push(s);
    else {
      flush();
      parts.push({ one: s });
    }
  }
  flush();
  return parts;
}

const dayMonth = (iso: string, withYear: boolean) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "Europe/Athens",
  });

const yearOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { year: "numeric", timeZone: "Europe/Athens" });

/** "Seen 3 times by spotters between …": `times` sightings, seen on `dates` (any order). */
function seenWords(times: number, dates: readonly string[], now: Date): string {
  // The earliest and latest dates seen. The history is in the order sightings
  // were matched, which isn't always the order they were seen.
  const seen = [...dates].sort((a, b) => Date.parse(a) - Date.parse(b));
  const first = seen[0]!;
  const last = seen[seen.length - 1]!;
  const thisYear = yearOf(now.toISOString());
  const withYear = yearOf(first) !== thisYear || yearOf(last) !== thisYear;
  const from = dayMonth(first, withYear);
  const to = dayMonth(last, withYear);
  if (times === 1) return `Seen once by a spotter on ${to}, looking well`;
  return from === to
    ? `Seen ${times} times by spotters on ${to}, looking well`
    : `Seen ${times} times by spotters between ${from} and ${to}, looking well`;
}

/**
 * "Seen 19 times by spotters between 29 Jul and 24 Sep, looking well". Counted
 * by sighting: one sighting can say two routine things. The year is added
 * when the run isn't all in this year.
 */
export function runWords(run: readonly TeamStatement[], now: Date): string {
  const times = new Set(run.map((s) => (s.sightingId === null ? `row ${s.id}` : `sighting ${s.sightingId}`))).size;
  return seenWords(times, run.map((s) => s.observedAt), now);
}

/**
 * The same words for a run of sighting rows: one time per sighting, dated by
 * when each sighting was. Give it the run's every row (`run.rows`), never the
 * rows a cut-off leaves, so the count is the whole group (SYC-459 item 3).
 */
export function sightingRunWords(rows: readonly SightingRow[], now: Date): string {
  return seenWords(rows.length, rows.map((r) => r.sighting.at), now);
}

// ── The one History list (spec §3.5) ────────────────────────────────────────

export type HistoryShow = "all" | "sightings" | "visits" | "changes";

export type HistoryRow =
  | { type: "sighting"; sighting: TeamCatView["sightings"][number]; entries: TeamStatement[] }
  | { type: "visit"; visit: VisitLine | null; entries: TeamStatement[] } // visit null: an undone visit
  | { type: "entry"; entry: TeamStatement }
  | { type: "run"; rows: Extract<HistoryRow, { type: "sighting" }>[] };

type SightingRow = Extract<HistoryRow, { type: "sighting" }>;
type FlatRow = Exclude<HistoryRow, { type: "run" }>;

/** Rank for a tie in time: sightings, then visits, then changes. */
const RANK: Record<FlatRow["type"], number> = { sighting: 0, visit: 1, entry: 2 };

/**
 * Every row before filtering or grouping, newest first. Ties in time go
 * sightings, then visits, then changes, then the higher id (sighting id,
 * visit id, entry id) first.
 */
function flatRows(v: TeamCatView, visits: readonly VisitLine[]): FlatRow[] {
  const sightingIds = new Set(v.sightings.map((s) => s.id));
  const lineOf = new Map(visits.map((l) => [l.visitId, l]));

  const ofSighting = new Map<number, TeamStatement[]>();
  const ofVisit = new Map<number, TeamStatement[]>();
  const loose: TeamStatement[] = [];
  for (const e of v.history) {
    // An undo's retractions carry their visit's id too (teamCatView).
    const visitId = e.vetVisitId;
    // A visit's own row wins over a sighting's.
    if (visitId !== null) ofVisit.set(visitId, [...(ofVisit.get(visitId) ?? []), e]);
    // A sighting no longer on this cat (moved to another): its entry stands alone.
    else if (e.sightingId !== null && sightingIds.has(e.sightingId)) {
      ofSighting.set(e.sightingId, [...(ofSighting.get(e.sightingId) ?? []), e]);
    } else loose.push(e);
  }
  for (const l of visits) if (!ofVisit.has(l.visitId)) ofVisit.set(l.visitId, []);

  const keyed: { row: FlatRow; at: number; id: number }[] = [
    ...v.sightings.map((s) => ({
      row: { type: "sighting" as const, sighting: s, entries: ofSighting.get(s.id) ?? [] },
      at: Date.parse(s.at),
      id: s.id,
    })),
    ...[...ofVisit].map(([visitId, entries]) => {
      const line = lineOf.get(visitId) ?? null;
      const own = entries.find((e) => e.id === visitId && e.kind === "vet_visit");
      const when = own?.observedAt ?? line?.date ?? entries.map((e) => e.observedAt).sort().at(-1)!;
      return { row: { type: "visit" as const, visit: line, entries }, at: Date.parse(when), id: visitId };
    }),
    ...loose.map((e) => ({ row: { type: "entry" as const, entry: e }, at: Date.parse(e.observedAt), id: e.id })),
  ];
  keyed.sort((a, b) => b.at - a.at || RANK[a.row.type] - RANK[b.row.type] || b.id - a.id);
  return keyed.map((k) => k.row);
}

const SHOWS: Record<HistoryShow, (r: FlatRow) => boolean> = {
  all: () => true,
  sightings: (r) => r.type === "sighting",
  visits: (r) => r.type === "visit",
  changes: (r) => r.type === "entry",
};

/**
 * A sighting row whose every entry is routine (none at all: "seen" only). A
 * sighting that may show more than one cat is never folded away: its amber
 * tag must stay in sight (spec §3.5).
 */
const routineSighting = (r: FlatRow): r is SightingRow =>
  r.type === "sighting" && !r.sighting.mixedCats && r.entries.every(isRoutine);

/**
 * The History list (spec §3.5), newest first, filtered by `show`. A sighting
 * is one row with the entries sent with it; a vet visit is one row with the
 * entries it wrote (and their undoing), `visit: null` when `visits` (from
 * `visitsFor`, which leaves undone visits out) has no line for it; every
 * other entry is its own row. Two or more routine sighting rows next to each
 * other after filtering are one `run`, holding every one of its rows.
 */
export function historyRows(v: TeamCatView, visits: VisitLine[], show: HistoryShow): HistoryRow[] {
  const rows = flatRows(v, visits).filter(SHOWS[show]);
  const out: HistoryRow[] = [];
  let run: SightingRow[] = [];
  const flush = () => {
    if (run.length === 1) out.push(run[0]!);
    else if (run.length > 1) out.push({ type: "run", rows: run });
    run = [];
  };
  for (const r of rows) {
    if (routineSighting(r)) run.push(r);
    else {
      flush();
      out.push(r);
    }
  }
  flush();
  return out;
}

/**
 * How many rows each filter has, before grouping into runs: the same counts
 * whichever filter is set. `all` is the jump link's "History (N)".
 */
export function historyCounts(v: TeamCatView, visits: VisitLine[]): Record<HistoryShow, number> {
  const rows = flatRows(v, visits);
  return {
    all: rows.length,
    sightings: rows.filter(SHOWS.sightings).length,
    visits: rows.filter(SHOWS.visits).length,
    changes: rows.filter(SHOWS.changes).length,
  };
}

// ── Drawing the History list (Task 2.3, spec §3.5) ──────────────────────────

/** How many rows History shows before "Show all" (SYC-219). A run is one row. */
export const HISTORY_SHOWN = 20;

/** The filters, in the order the links show them. */
const SHOW_ORDER: readonly HistoryShow[] = ["all", "sightings", "visits", "changes"];

const FILTER_WORDS: Record<HistoryShow, string> = {
  all: "All",
  sightings: "Sightings",
  visits: "Vet visits",
  changes: "Changes and notes",
};

const EMPTY_WORDS: Record<HistoryShow, string> = {
  all: "Nothing recorded yet.",
  sightings: "No sightings yet.",
  visits: "No vet visits recorded.",
  changes: "No changes or notes yet.",
};

/** `?show=` as the route reads it: anything but the three filters is everything. */
export function historyShowOf(raw: unknown): HistoryShow {
  return raw === "sightings" || raw === "visits" || raw === "changes" ? raw : "all";
}

/** "14 Oct 2026", in Greek time, as the page's other dates. */
const fullDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Athens" });

/** "14 Oct 2026, 11:00", in Greek time. */
const fullWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Athens",
  });

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });

const timeTag = (iso: string, text: string) => `<time datetime="${esc(iso)}">${esc(text)}</time>`;

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Ear tip clipped" → "ear tip clipped", for words joined after "Seen in …:". */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * The date column: the day (with the year when it isn't this year) and the time,
 * "about" when it was recorded well after, or nothing when only the day is known.
 * A vet visit is entered by day and stored at midday UTC, so a clock time would
 * be one nobody entered; the old page drew visits by day only too.
 */
function whenCell(iso: string, now: Date, approx = false, dayOnly = false): string {
  const withYear = yearOf(iso) !== yearOf(now.toISOString());
  return (
    `<div class="when"><time datetime="${esc(iso)}"><b>${esc(dayMonth(iso, withYear))}</b>` +
    `${dayOnly ? "" : esc(approx ? "about" : clock(iso))}</time></div>`
  );
}

/** Kinds that change what the page says about the cat: "Changed by Maria". */
const CHANGE_KINDS = new Set(["life_status", "sterilised", "colony", "name", "coat", "markings", "ear_tip"]);

/**
 * Who wrote an entry, as its row says it: "Changed by Maria", "Changed by Eleni,
 * cat guardian", "Changed by someone who has since deleted their details",
 * "A spotter", "Imported".
 */
function whoWords(s: TeamStatement): string {
  const person = s.author.kind === "team" || s.author.kind === "unknown" || s.author.kind === "deleted";
  if (!person || !CHANGE_KINDS.has(s.kind)) return capFirst(byWhom(s));
  // A deleted author's details are gone, and "guardian" with them.
  return `Changed by ${s.author.kind === "deleted" ? s.author.label : byWhom(s)}`;
}

/** Was it recorded well after it was true? Then the date is "about", and the recording is said. */
const differs = (s: TeamStatement) => Math.abs(Date.parse(s.observedAt) - Date.parse(s.createdAt)) > 60_000;

// Two buttons on each sighting (SYC-209 PR 3.4). Each is a POST form that
// carries only the sighting's number: the server looks the position up, so no
// position is ever in an address (K13). They sit in the sighting's ⋯ menu.
export const sightingButtons = (sightingId: number, may: (c: Capability) => boolean): string[] => [
  may("add_feeding_site")
    ? `<form method="post" action="/api/team/sites/from-sighting" class="sightact"><input type="hidden" name="sightingId" value="${sightingId}"><button type="submit">${esc(t("sighting.makeSite"))}</button></form>`
    : "",
  may("view_exact_location")
    ? `<form method="post" action="/api/team/sites/map-at-sighting#map" class="sightact"><input type="hidden" name="sightingId" value="${sightingId}"><button type="submit">${esc(t("sighting.showOnMap"))}</button></form>`
    : "",
];

/** The system's own colony corrections can't be marked wrong (SYC-331). */
const systemColony = (s: TeamStatement) => s.kind === "colony" && s.author.kind === "system";

/**
 * The capability "Mark wrong" on this entry needs on this page, as wrongForm
 * decides it; null when the page draws no such form here.
 */
export function wrongFormNeeds(s: TeamStatement): Capability | null {
  const c = s.correction;
  if (!c || c.kind === "appearance") return null;
  if (c.kind === "ear_tip_clipped" || c.kind === "sterilised") return "set_sterilisation";
  if (c.kind === "colony") return systemColony(s) ? null : "assign_cat_to_colony";
  return "set_life_status";
}

/**
 * "Mark wrong" on a standing entry (PR 4), when this person may. `what` names
 * the thing in the fold's line ("Mark wrong: ear tip clipped") where a row
 * holds more than one.
 */
export function wrongForm(s: TeamStatement, may: (c: Capability) => boolean, kept?: KeptFields, what?: string): string {
  const c = s.correction;
  const needs = wrongFormNeeds(s);
  if (!c || needs === null || !may(needs)) return "";
  const why = kept?.["reason"];
  const action = `/api/team/statements/${s.id}/wrong`;
  const id = `w${s.id}`;
  const head = `${fold(kept !== undefined)}<summary>${esc(what ? `Mark wrong: ${what}` : "Mark wrong")}</summary><form method="post" action="${action}">`;
  if (c.kind === "ear_tip_clipped") {
    return (
      head +
      '<input type="hidden" name="choice" value="not_clipped">' +
      '<p class="hint">The cat goes back to Not known yet, unless something else says otherwise.</p>' +
      reasonInput(`${id}-why`, "Why it isn't a clip", why) +
      "<button type=\"submit\">Mark wrong: it's not a clip</button></form></details>"
    );
  }
  if (c.kind === "colony") {
    // No choice to make: the server works out what stands instead.
    return (
      head +
      '<input type="hidden" name="choice" value="colony_previous">' +
      '<p class="hint">The cat goes back to the colony it was in before this, or to no colony if there was none.</p>' +
      reasonInput(`${id}-why`, undefined, why) +
      '<button type="submit">Mark wrong</button></form></details>'
    );
  }
  if (c.kind === "sterilised") {
    const to = c.now === true ? "sterilised_no" : "sterilised_yes";
    const toText = c.now === true ? "Not sterilised" : "Sterilised";
    return (
      head +
      `<input type="hidden" name="choice" value="${to}">` +
      `<p>It should say: <strong>${esc(toText)}</strong></p>` +
      reasonInput(`${id}-why`, undefined, why) +
      '<button type="submit">Mark wrong</button></form></details>'
    );
  }
  if (c.kind !== "life_status") return "";
  return (
    head +
    '<fieldset><legend class="label">It should say</legend>' +
    lifeChoices("choice", `${id}-to`, c.now) +
    "</fieldset>" +
    dateInput(`${id}-date`, "Date it happened", "(needed for “No longer with us”)") +
    reasonInput(`${id}-why`, undefined, why) +
    '<button type="submit">Mark wrong</button></form></details>'
  );
}

/** What a visit did, in words: "Sterilised, vaccinated (Rabies)". */
export function visitDidWords(l: Pick<VisitLine, "did" | "vaccines" | "treatedNote">): string {
  return l.did
    .map((d, i) => {
      const w = i === 0 ? DID_WORDS[d] : DID_WORDS[d].toLowerCase();
      if (d === "vaccinated" && l.vaccines?.length) return `${w} (${l.vaccines.map(vaccineWord).join(", ")})`;
      if (d === "treated" && l.treatedNote) return `${w} (${l.treatedNote})`;
      return w;
    })
    .join(", ");
}

const catHref = (id: number) => `/api/team/cats/${id}`;

export interface HistoryOptions {
  show: HistoryShow;
  /** ?history=all: every row, not just the newest HISTORY_SHOWN. */
  all: boolean;
  /** The entry the page lands on after a correction (`?s=`). */
  at?: number;
  /** Trusted HTML: the saved notice History shows, in the `at` row or else at its top. Empty for none. */
  notice: string;
  may: (c: Capability) => boolean;
  /** A form filled in again after signing in (SYC-516 C3). */
  kept?: { formKey: string; fields: KeptFields };
  now: Date;
  /** An island-wide viewer: a sighting's menu has "Open map" (D9). */
  island: boolean;
}

/** The entry ids a row holds, its sightings' too. */
function entryIdsOf(r: HistoryRow): number[] {
  if (r.type === "entry") return [r.entry.id];
  if (r.type === "run") return r.rows.flatMap((x) => x.entries.map((e) => e.id));
  return r.entries.map((e) => e.id);
}

interface Layout {
  /** The filter in force: the one asked for, or "all" when the page lands on a row it leaves out. */
  show: HistoryShow;
  rows: HistoryRow[];
  /** The rows drawn: all of them, or the newest HISTORY_SHOWN. */
  drawn: HistoryRow[];
  /** Entry ids drawn, or null when every entry is. */
  shown: Shown;
  /** The entries the page lands on: `at`, and the one whose Mark wrong was filled in again. */
  targets: ReadonlySet<number>;
}

function layout(
  v: TeamCatView,
  visits: VisitLine[],
  o: Pick<HistoryOptions, "show" | "all" | "at" | "kept">,
): Layout {
  const inHistory = new Set(v.history.map((h) => h.id));
  const targets = new Set<number>();
  if (o.at !== undefined && inHistory.has(o.at)) targets.add(o.at);
  const keptId = /^wrong:(\d+)$/.exec(o.kept?.formKey ?? "")?.[1];
  if (keptId !== undefined && inHistory.has(Number(keptId))) targets.add(Number(keptId));
  let show = o.show;
  let rows = historyRows(v, visits, show);
  const has = (list: HistoryRow[], id: number) => list.some((r) => entryIdsOf(r).includes(id));
  // The page lands on a row the filter leaves out: show it anyway, unfiltered.
  if ([...targets].some((id) => !has(rows, id))) {
    show = "all";
    rows = historyRows(v, visits, show);
  }
  const newest = rows.slice(0, HISTORY_SHOWN);
  // …or one older than the newest rows: then every row is shown (SYC-219).
  const drawn = o.all || [...targets].some((id) => !has(newest, id)) ? rows : newest;
  const whole = show === "all" && drawn.length === rows.length;
  return {
    show,
    rows,
    drawn,
    shown: whole ? null : new Set(drawn.flatMap(entryIdsOf)),
    targets,
  };
}

/**
 * Which entries History draws for these options, so a link from above it
 * ("Why we think so") lands: `#s-<id>` when drawn, else `?history=all#s-<id>`
 * (null: every one is). `sightingHref` is where a map marker for a sighting
 * goes: its row, or the run line holding it (a closed fold isn't a place to
 * land), or the full, unfiltered list when this view leaves it out. Both come
 * from the same layout the list is drawn from, so they can't drift.
 */
export function historyShown(
  v: TeamCatView,
  visits: VisitLine[],
  o: Pick<HistoryOptions, "show" | "all" | "at" | "kept">,
): { entries: Shown; sightingHref: (sightingId: number) => string } {
  const l = layout(v, visits, o);
  const here = sightingAnchors(l.drawn);
  let full: Map<number, string> | null = null;
  return {
    entries: l.shown,
    sightingHref: (id) => {
      const a = here.get(id);
      if (a !== undefined) return `#${a}`;
      full ??= sightingAnchors(historyRows(v, visits, "all"));
      return `?history=all#${full.get(id) ?? `sg-${id}`}`;
    },
  };
}

interface Ctx extends HistoryOptions {
  byId: Map<number, TeamStatement>;
  shown: Shown;
  targets: ReadonlySet<number>;
  /** Entries "Why we think so" or "Says otherwise" link to: a run holding one opens. */
  evidence: ReadonlySet<number>;
  /** Coat and markings changes the fold lists a Mark wrong for (appearancePage.markWrongInFold). */
  inFold: ReadonlySet<number>;
}

/** "the change of 14 Oct 2026", linking to it; never its number. */
function changeLink(id: number, c: Ctx): string {
  const r = c.byId.get(id);
  const words = r ? `the change of ${fullDay(r.observedAt)}` : "an earlier change";
  return `<a href="${statementHref(id, c.shown)}">${esc(words)}</a>`;
}

/** What follows an entry's words: why, what it corrects, its photo, what replaced it, where it went. */
function entryExtras(s: TeamStatement, c: Ctx, skipWhy = false): string {
  const replacements = s.replacedBy
    .map((id) => c.byId.get(id))
    .filter((r): r is TeamStatement => r !== undefined)
    .map(
      (r) =>
        `<p class="replacement">Replaced by ${changeLink(r.id, c)}: ${esc(r.said)}` +
        (r.reason ? `. Why: ${esc(r.reason)}` : "") +
        ` <span class="meta">(${esc(byWhom(r))}, ${timeTag(r.createdAt, fullWhen(r.createdAt))})</span></p>`,
    )
    .join("");
  const moved = s.movedTo
    ? `<p class="replacement">Moved to <a href="${esc(catHref(s.movedTo.cat.id))}">${esc(s.movedTo.cat.name)}</a> ` +
      `<span class="syr">${esc(s.movedTo.cat.syr)}</span>` +
      (s.movedTo.reason ? `. Why: ${esc(s.movedTo.reason)}` : "") +
      ` <span class="meta">(${timeTag(s.movedTo.at, fullWhen(s.movedTo.at))})</span></p>`
    : "";
  const corrects = s.movedFrom
    ? `<p class="meta">Moved here from <a href="${esc(catHref(s.movedFrom.cat.id))}">${esc(s.movedFrom.cat.name)}</a> ` +
      `<span class="syr">${esc(s.movedFrom.cat.syr)}</span></p>`
    : s.replaces != null
      ? `<p class="meta">Corrects ${changeLink(s.replaces, c)}</p>`
      : "";
  return (
    (s.reason && !skipWhy ? `<p class="why">Why: ${esc(s.reason)}</p>` : "") +
    corrects +
    (s.photoUrl ? `<p class="meta"><a class="tap" href="${esc(s.photoUrl)}">See the photo</a></p>` : "") +
    replacements +
    moved +
    (s.ownerClaim
      ? '<p class="hint">This is the owner\'s own claim. To end this claim, use Remove owner under “Update this cat”.</p>'
      : "")
  );
}

const keptFor = (s: TeamStatement, c: Ctx) => (c.kept?.formKey === `wrong:${s.id}` ? c.kept.fields : undefined);

/** The row's ⋯ menu, open when the page lands on the row. */
const dots = (forWhat: string, items: string[], open: boolean) => rowMenu("⋯", forWhat, items, { dots: true, open });

/** The saved notice, in the row the page lands on. */
const rowNotice = (ids: number[], c: Ctx) => (c.at !== undefined && ids.includes(c.at) ? c.notice : "");

/** A change, a note, a welfare report: one row each. */
function entryRow(s: TeamStatement, c: Ctx): string {
  const replaced = s.replacedBy.length > 0 || s.movedTo !== null;
  const said = replaced ? `<del>${esc(s.said)}</del>` : esc(s.said);
  const late = differs(s);
  const tag = s.kind === "team_note" ? ' <span class="tag note">team only</span>' : "";
  // Coat and markings keep their Mark wrong in that section (spec §3.7); the menu points there.
  const coat =
    s.correction?.kind === "appearance" && c.may("set_appearance") && c.inFold.has(s.id)
      ? '<a class="tap" href="?open=coat#appearance">Mark wrong in Coat and markings</a>'
      : "";
  return (
    `<li class="hrow${replaced ? " replaced" : ""}" id="s-${s.id}">` +
    whenCell(s.observedAt, c.now, late) +
    '<div class="what">' +
    rowNotice([s.id], c) +
    `<b>${said}</b>${tag}` +
    `<span class="who">${esc(whoWords(s))}${late ? ` · recorded ${timeTag(s.createdAt, fullWhen(s.createdAt))}` : ""}</span>` +
    entryExtras(s, c) +
    "</div>" +
    dots(`the change on ${fullWhen(s.observedAt)}`, [wrongForm(s, c.may, keptFor(s, c)), coat], c.targets.has(s.id)) +
    "</li>"
  );
}

/** A sighting: "Seen in Ermoupoli: ear tip clipped", who saw it, its photo, and its ⋯ menu. */
function sightingRow(r: SightingRow, c: Ctx): string {
  const s = r.sighting;
  const ids = r.entries.map((e) => e.id);
  const joined = r.entries
    .map((e) => {
      const words = esc(lowerFirst(e.said));
      return `<span id="s-${e.id}">${e.replacedBy.length > 0 || e.movedTo ? `<del>${words}</del>` : words}</span>`;
    })
    .join(", ");
  const who = [...new Set(r.entries.map((e) => capFirst(byWhom(e))))];
  const seen = fullWhen(s.at);
  // Recorded well after it was seen: say when, the way a change row does.
  const lateEntry = r.entries.find(differs);
  const recordedLate = lateEntry ? ` · recorded ${timeTag(lateEntry.createdAt, fullWhen(lateEntry.createdAt))}` : "";
  const thumb = s.photoUrl
    ? `<a class="hthumbs" href="${esc(s.photoUrl)}"><img class="hthumb" src="${esc(s.photoUrl)}" alt="${esc(`Photo from the sighting on ${seen}`)}" loading="lazy" width="56" height="56"></a>`
    : "";
  return (
    `<li class="hrow sighting" id="sg-${s.id}">` +
    whenCell(s.at, c.now) +
    '<div class="what">' +
    rowNotice(ids, c) +
    `<b>Seen in ${esc(placeLabel(s))}</b>${joined ? `: ${joined}` : ""}` +
    // SYC-415 spec §4.5: the matcher thought this spot's photos may be of more than one cat.
    (s.mixedCats ? ' <span class="tag warn">May show more than one cat</span>' : "") +
    // Every sighting comes from a spotter's phone (sightings_attribution_ck).
    `<span class="who">${esc(who.length > 0 ? who.join(", ") : "A spotter")}${recordedLate}</span>` +
    r.entries.map((e) => entryExtras(e, c)).join("") +
    thumb +
    "</div>" +
    dots(
      `the sighting on ${seen}`,
      [
        // D9's own word for the outbound link; "Show on the map" is the team map's button below.
        ...(c.island ? [`<p class="meta">${openMapLink(s.lat, s.lng)}</p>`] : []),
        ...sightingButtons(s.id, c.may),
        ...r.entries.map((e) => wrongForm(e, c.may, keptFor(e, c), lowerFirst(e.said))),
      ],
      ids.some((id) => c.targets.has(id)),
    ) +
    "</li>"
  );
}

/** A vet visit: what was done, the clinic, the cost for those who may see it, and the changes it wrote. */
function visitRow(r: Extract<HistoryRow, { type: "visit" }>, c: Ctx): string {
  const l = r.visit;
  const visitId = l?.visitId ?? r.entries[0]!.vetVisitId!;
  const ids = r.entries.map((e) => e.id);
  const inRow = new Set(ids);
  // An undo's rows: each replaces an entry of this visit.
  const undos = r.entries.filter((e) => e.replaces !== null && inRow.has(e.replaces));
  const undo = undos.find((e) => e.replaces === visitId) ?? undos[0];
  const own = r.entries.find((e) => e.id === visitId && e.kind === "vet_visit");
  const recorded = r.entries.filter((e) => e !== own && !undos.includes(e));
  const undone = l === null && (undo !== undefined || (own?.replacedBy.length ?? 0) > 0);
  const date = l?.date ?? own?.observedAt ?? r.entries[0]!.observedAt;
  const headline = l ? `Vet visit: ${lowerFirst(visitDidWords(l))}` : (own?.said ?? "Vet visit");
  const money =
    l && "costEur" in l
      ? ` · ${l.costEur == null ? "Cost not recorded" : esc(euroText(l.costEur))}` +
        (l.paidBy ? ` · paid by ${esc(PAID_WORDS[l.paidBy].replace(/^A /, "a ").replace(/^The /, "the "))}` : "")
      : "";
  const who = l
    ? `${esc(l.clinicName)}${money} · logged by ${esc(l.by)}`
    : own
      ? `Logged by ${esc(byWhom(own))}`
      : "";
  const wrong =
    l && c.may("log_vet_visit")
      ? `<details><summary class="risky">Mark the visit wrong</summary><form method="post" action="/api/team/vet-visits/${l.visitId}/wrong">` +
        '<p class="hint">Everything this visit recorded is marked wrong with it.</p>' +
        reasonInput(`vw${l.visitId}-why`) +
        '<button type="submit" class="risky">Mark the visit wrong</button></form></details>'
      : "";
  return (
    `<li class="hrow vet${undone ? " replaced" : ""}" id="vv-${visitId}">` +
    whenCell(date, c.now, false, true) +
    '<div class="what">' +
    rowNotice(ids, c) +
    `<b${own ? ` id="s-${own.id}"` : ""}>${undone ? `<del>${esc(headline)}</del>` : esc(headline)}</b> <span class="tag vet">vet</span>` +
    (who ? `<span class="who">${who}</span>` : "") +
    (l && "costReason" in l && l.costReason ? `<p class="meta">Why the cost was different: ${esc(l.costReason)}</p>` : "") +
    (l?.note ? `<p class="meta">${esc(l.note)}</p>` : "") +
    (recorded.length > 0
      ? '<p class="meta">Recorded: ' +
        recorded
          .map((e) => `<span id="s-${e.id}">${e.replacedBy.length > 0 ? `<del>${esc(e.said)}</del>` : esc(e.said)}</span>`)
          .join(" · ") +
        "</p>" +
        // What replaced each, its photo and its own reason (spec §3.5); the visit's
        // own "vet visit" reason says nothing the row doesn't already.
        recorded.map((e) => entryExtras(e, c, e.reason === VISIT_REASON)).join("")
      : "") +
    (undo
      ? `<p class="meta" id="s-${undo.id}">Marked wrong by ${esc(byWhom(undo))} on ${timeTag(undo.createdAt, fullDay(undo.createdAt))}` +
        (undo.reason ? `. Why: ${esc(undo.reason)}` : "") +
        undos
          .filter((e) => e !== undo)
          .map((e) => `<span id="s-${e.id}"></span>`)
          .join("") +
        "</p>"
      : "") +
    "</div>" +
    dots(`the vet visit on ${fullDay(date)}`, [wrong], ids.some((id) => c.targets.has(id))) +
    "</li>"
  );
}

/** A run's own anchor, from its newest sighting: what a map marker into a closed run lands on. */
const runId = (r: Extract<HistoryRow, { type: "run" }>) => `run-${r.rows[0]!.sighting.id}`;

/** Each drawn sighting's landing anchor: its own row, or the run line holding it. */
function sightingAnchors(rows: HistoryRow[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of rows) {
    if (r.type === "sighting") out.set(r.sighting.id, `sg-${r.sighting.id}`);
    if (r.type === "run") for (const x of r.rows) out.set(x.sighting.id, runId(r));
  }
  return out;
}

/** Routine sightings in a row: one line, with the dates and up to three photos; it opens to the rows. */
function runRow(r: Extract<HistoryRow, { type: "run" }>, c: Ctx): string {
  const ids = r.rows.flatMap((x) => x.entries.map((e) => e.id));
  const open = ids.some((id) => c.targets.has(id) || c.evidence.has(id));
  const dates = r.rows.map((x) => x.sighting.at).sort((a, b) => Date.parse(a) - Date.parse(b));
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const thisYear = yearOf(c.now.toISOString());
  const withYear = yearOf(first) !== thisYear || yearOf(last) !== thisYear;
  const from = dayMonth(first, withYear);
  const to = dayMonth(last, withYear);
  const thumbs = r.rows
    .filter((x) => x.sighting.photoUrl)
    .slice(0, 3)
    .map((x) => `<img class="hthumb" src="${esc(x.sighting.photoUrl!)}" alt="" loading="lazy" width="44" height="44">`)
    .join("");
  return (
    `<li class="hgroup" id="${runId(r)}"><details${open ? " open" : ""}><summary>` +
    `<span class="when"><b>${from === to ? esc(to) : `${esc(from)}–<br>${esc(to)}`}</b></span>` +
    `<span class="what"><span class="runwords">${esc(sightingRunWords(r.rows, c.now))}</span>` +
    (thumbs ? `<span class="hthumbs">${thumbs}</span>` : "") +
    "</span></summary>" +
    `<ol class="tl">${r.rows.map((x) => sightingRow(x, c)).join("")}</ol></details></li>`
  );
}

function drawRow(r: HistoryRow, c: Ctx): string {
  if (r.type === "sighting") return sightingRow(r, c);
  if (r.type === "visit") return visitRow(r, c);
  if (r.type === "run") return runRow(r, c);
  return entryRow(r.entry, c);
}

/**
 * The History section (spec §3.5): its filters, one list newest first, "Show
 * all N", and "How changes work". Every row keeps its anchor (`sg-`, `vv-`,
 * `s-`). Server-drawn, no script; every value escaped.
 */
export function renderHistory(v: TeamCatView, visits: VisitLine[], opts: HistoryOptions): string {
  const l = layout(v, visits, opts);
  const counts = historyCounts(v, visits);
  const r = v.records;
  const c: Ctx = {
    ...opts,
    byId: new Map(v.history.map((s) => [s.id, s])),
    shown: l.shown,
    targets: l.targets,
    inFold: new Set(
      [...v.appearance.coat.statements, ...v.appearance.markings.statements].filter(markWrongInFold).map((x) => x.id),
    ),
    evidence: new Set([
      ...r.lifeStatus.supportingStatementIds,
      ...r.lifeStatus.conflictingStatementIds,
      ...r.sterilised.supportingStatementIds,
      ...r.sterilised.conflictingStatementIds,
    ]),
  };
  const inRow = opts.at !== undefined && l.drawn.some((x) => entryIdsOf(x).includes(opts.at!));
  const filters =
    '<nav class="hfilters" aria-label="Show in History">' +
    SHOW_ORDER.map(
      (k) =>
        `<a href="?show=${k}#history"${k === l.show ? ' aria-current="page"' : ""}>${esc(`${FILTER_WORDS[k]} ${counts[k]}`)}</a>`,
    ).join("") +
    "</nav>";
  const more =
    l.drawn.length < l.rows.length
      ? `<p class="more"><a class="tap" href="${l.show === "all" ? "?history=all#history" : `?show=${l.show}&amp;history=all#history`}">Show all ${counts[l.show]}</a></p>`
      : "";
  return (
    '<h2 id="history">History</h2>' +
    // A vet visit's notices land here (#vet-visits), outside every fold.
    `<div id="vet-visits">${inRow ? "" : opts.notice}</div>` +
    '<p class="hint">Newest first. A change marked wrong stays here, crossed out, with what replaced it.</p>' +
    filters +
    (l.rows.length === 0
      ? `<p class="empty">${esc(EMPTY_WORDS[l.show])}</p>`
      : `<ol class="tl">${l.drawn.map((x) => drawRow(x, c)).join("")}</ol>`) +
    more +
    // How changes work, folded into a short note you can open (spec §3.2), in #192's words.
    '<details class="hownote"><summary>How changes work</summary>' +
    '<p class="hint">Every change is saved with your name. Nothing is deleted. A change with an older date won\'t override a newer one. To undo a change, use <strong>Mark wrong</strong> on it in the history below.</p></details>'
  );
}
