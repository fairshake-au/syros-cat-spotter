import type { TeamCatView, TeamStatement } from "../teamCatView";
import { EAR_TIP_NOT_CLIPPED, FOOD_AND_WATER_OUT } from "../teamCatView";
import type { VisitLine } from "../vetVisits";

// The cat page's one History list, as data (SYC-602 PR 2; spec §3.5, D1).
// Pure: no database, no clock. Task 2.3 draws these rows. Never imports
// catPages.ts, which re-exports from here.

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

const VISIT_KINDS = new Set(["vet_visit", "sterilised", "vaccinated"]);

/**
 * The visit an entry belongs to, or null. Its own `vetVisitId`, except for
 * what undoing a visit writes: each retraction replaces one of the visit's
 * entries, and carries no link of its own (a `sterilised` or `vaccinated`
 * one has none; a `vet_visit` one's `vetVisitId` is its own id). So a
 * visit-kind entry that replaces a visit's entry belongs to that visit, and
 * the visit's row shows who marked it wrong, and when.
 */
function visitOfEntry(byId: ReadonlyMap<number, TeamStatement>): (e: TeamStatement) => number | null {
  const memo = new Map<number, number | null>();
  const find = (e: TeamStatement, seen: Set<number>): number | null => {
    if (memo.has(e.id)) return memo.get(e.id)!;
    let out: number | null = e.kind === "vet_visit" ? null : e.vetVisitId;
    if (out === null && VISIT_KINDS.has(e.kind) && e.replaces != null && !seen.has(e.replaces)) {
      const replaced = byId.get(e.replaces);
      if (replaced && replaced.kind === e.kind) out = find(replaced, new Set([...seen, e.id]));
    }
    if (out === null && e.kind === "vet_visit") out = e.vetVisitId;
    memo.set(e.id, out);
    return out;
  };
  return (e) => find(e, new Set([e.id]));
}

/** Rank for a tie in time: sightings, then visits, then changes. */
const RANK: Record<FlatRow["type"], number> = { sighting: 0, visit: 1, entry: 2 };

/**
 * Every row before filtering or grouping, newest first. Ties in time go
 * sightings, then visits, then changes, then the higher id (sighting id,
 * visit id, entry id) first.
 */
function flatRows(v: TeamCatView, visits: readonly VisitLine[]): FlatRow[] {
  const byId = new Map(v.history.map((e) => [e.id, e]));
  const visitOf = visitOfEntry(byId);
  const sightingIds = new Set(v.sightings.map((s) => s.id));
  const lineOf = new Map(visits.map((l) => [l.visitId, l]));

  const ofSighting = new Map<number, TeamStatement[]>();
  const ofVisit = new Map<number, TeamStatement[]>();
  const loose: TeamStatement[] = [];
  for (const e of v.history) {
    const visitId = visitOf(e);
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

/** A sighting row whose every entry is routine (none at all: "seen" only). */
const routineSighting = (r: FlatRow): r is SightingRow => r.type === "sighting" && r.entries.every(isRoutine);

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
