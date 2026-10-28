import { catsTable, coloniesTable, db, sightingsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { namedAreasAt } from "../areas/areaHistory";
import { liveCats } from "../catIdentity";
import { areaForIn, type NamedArea } from "../areas/namedAreas";
import { currentColonyOf } from "../colonyMembership";
import { wholePct } from "../dashboard/colonyFigures";
import { headline, splitOf, type Headline, type Split } from "../dashboard/countedCats";
import { loadCatRecords, resolveAt, type CatRecords } from "../observations";
import { livesOf, loadTeamCats, markOf, type TeamCat } from "../teamCatList";
import { isShort, monthsIn, weeksIn, type Range } from "./range";

// Sterilisation progress (SYC-396 PR 3.3a, Task 3.3a.3; spec §9.3 report 1).
//
// - The island headline, as on Home, at the end of the range.
// - A line over time of confirmed sterilised against all street cats known:
//   each point is the records **as they stood on that date** ("as of" means
//   entered by then, Decision 10). The island is loaded once and each point
//   asks `resolveAt`, never a second load per point.
// - Every colony as a bar, fewest confirmed sterilised first, as the
//   Colonies list's "Fewest confirmed sterilised" sort.
//
// Who is counted is countedCats' (§9.5): `splitOf` and `headline` over
// TeamCats, never a filter of our own. A past point's TeamCat is today's card
// with that moment's mark, lives and area.
//
// Team-only: it reads the island's colonies with no Visible, so
// guardianView.source.test.ts holds every call to a route behind
// view_reports (island rows only until the guardian variant, SYC-472).
//
// Known limit: a cat merged into another since is counted only through the
// cat it was merged into, so a point before the merge counts the pair once.

export const MAX_POINTS = 24;

export interface ProgressPoint {
  at: Date;
  confirmed: number;
  street: number;
}

export interface ProgressColony {
  colonyId: number;
  name: string;
  split: Split;
}

export interface ProgressReport {
  headline: Headline;
  over: ProgressPoint[];
  colonies: ProgressColony[];
  /** The named areas' version at the end of the range (PR 2.4's namedAreasAt). */
  areasVersion: number;
  workedOutAt: Date;
  ms: number;
}

/** Everything the points are worked out from, loaded once. */
export interface ProgressInputs {
  /** Today's cards: who the cats are. */
  cats: TeamCat[];
  /** Each cat's records with their history, for resolveAt. */
  records: Map<number, CatRecords>;
  /** Where each cat was first found. */
  found: Map<number, { lat: number; lng: number }>;
  /** Each cat's resolved sightings, oldest first, with when they were entered. */
  seen: Map<number, { lat: number; lng: number; at: number }[]>;
}

export async function loadProgressInputs(now: Date): Promise<ProgressInputs> {
  const cats = await loadTeamCats(now);
  const ids = cats.map((c) => c.id);
  const [records, foundRows, seenRows] = await Promise.all([
    loadCatRecords(ids, db, { withHistory: true }),
    ids.length === 0
      ? Promise.resolve([])
      : liveCats({ id: catsTable.id, lat: catsTable.lat, lng: catsTable.lng }, { where: inArray(catsTable.id, ids) }),
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select({ catId: sightingsTable.catId, lat: sightingsTable.lat, lng: sightingsTable.lng, at: sightingsTable.createdAt })
          .from(sightingsTable)
          .where(and(eq(sightingsTable.status, "resolved"), isNotNull(sightingsTable.catId), inArray(sightingsTable.catId, ids)))
          .orderBy(sightingsTable.createdAt, sightingsTable.id),
  ]);
  const found = new Map(foundRows.map((r) => [r.id, { lat: r.lat, lng: r.lng }]));
  const seen = new Map<number, { lat: number; lng: number; at: number }[]>();
  for (const r of seenRows) {
    if (r.catId === null) continue;
    const list = seen.get(r.catId) ?? [];
    list.push({ lat: r.lat, lng: r.lng, at: r.at.getTime() });
    seen.set(r.catId, list);
  }
  return { cats, records, found, seen };
}

/**
 * The cats as they stood at `at`: each card with that moment's mark, lives
 * and area (where it was last seen by then, else where it was found, against
 * the named areas of then). A cat not yet entered is left out. Pure.
 */
export function catsAt(inputs: ProgressInputs, at: Date, areas: readonly NamedArea[]): TeamCat[] {
  const t = at.getTime();
  const out: TeamCat[] = [];
  for (const c of inputs.cats) {
    const rec = inputs.records.get(c.id);
    if (!rec) continue;
    const snap = resolveAt(rec, at, at);
    if (snap === null) continue;
    let where = inputs.found.get(c.id) ?? c.placedAt;
    for (const s of inputs.seen.get(c.id) ?? []) {
      if (s.at > t) break;
      where = s;
    }
    out.push({ ...c, snapshot: snap, mark: markOf(snap.sterilised), lives: livesOf(snap), areaKey: areaForIn(areas, where.lat, where.lng).key });
  }
  return out;
}

/** Confirmed sterilised and all street cats known, at one moment. */
export function pointOf(cats: readonly TeamCat[], at: Date): ProgressPoint {
  const split = splitOf(cats);
  return { at, confirmed: split.sterilised, street: split.sterilised + split.probably + split.not_sterilised + split.not_known };
}

/**
 * When the points fall: the end of each week for 3 months or less, else the
 * end of each month, and always the range's own end. At most MAX_POINTS,
 * spread evenly when there are more, keeping the first and the last.
 */
export function pointTimes(range: Range, firstEvent: Date): Date[] {
  const starts = isShort(range, firstEvent) ? weeksIn(range, firstEvent) : monthsIn(range, firstEvent);
  const ends = starts.map((s, i) => {
    const next = starts[i + 1];
    const end = next ? new Date(next.getTime() - 1) : range.to;
    return end.getTime() > range.to.getTime() ? range.to : end;
  });
  const from = range.from?.getTime() ?? -Infinity;
  const times = ends.filter((e) => e.getTime() >= from);
  if (times.length === 0 || times[times.length - 1]!.getTime() !== range.to.getTime()) times.push(range.to);
  if (times.length <= MAX_POINTS) return times;
  const step = (times.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (_, i) => times[Math.round(i * step)]!);
}

/**
 * The colonies' rows in the Colonies list's "Fewest confirmed sterilised"
 * order: lowest % confirmed first; colonies with no street cats last; ties
 * by name.
 */
export function fewestFirst<T extends { name: string; split: Split }>(rows: readonly T[]): T[] {
  const pct = (s: Split) => {
    const street = s.sterilised + s.probably + s.not_sterilised + s.not_known;
    return street === 0 ? null : wholePct(s.sterilised, street);
  };
  return [...rows].sort((a, b) => {
    const pa = pct(a.split);
    const pb = pct(b.split);
    if (pa === null || pb === null) {
      const nulls = (pa === null ? 1 : 0) - (pb === null ? 1 : 0);
      if (nulls !== 0) return nulls;
    } else if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name, "el");
  });
}

export async function progressReport(range: Range, now: Date): Promise<ProgressReport> {
  const started = Date.now();
  const [inputs, areas, colonyRows] = await Promise.all([
    loadProgressInputs(now),
    namedAreasAt(range.to),
    // Today's names (a past report names a colony as it is called now), for colonies there by then.
    db.select({ id: coloniesTable.id, name: coloniesTable.name }).from(coloniesTable).where(lte(coloniesTable.createdAt, range.to)),
  ]);
  const firstEvent = inputs.cats.reduce<Date>((m, c) => (c.createdAt < m ? c.createdAt : m), range.to);
  const over = pointTimes(range, firstEvent).map((t) => pointOf(catsAt(inputs, t, areas.areas), t));

  // The headline and the colony bars, at the end of the range.
  const atEnd = catsAt(inputs, range.to, areas.areas);
  const colonyOf =
    range.to.getTime() === now.getTime()
      ? new Map(inputs.cats.flatMap((c) => (c.colonyId === null ? [] : [[c.id, c.colonyId] as const])))
      : await currentColonyOf(inputs.cats.map((c) => c.id), db, { asOf: range.to });
  const byColony = new Map<number, TeamCat[]>();
  for (const c of atEnd) {
    const colonyId = colonyOf.get(c.id);
    if (colonyId === undefined) continue;
    const list = byColony.get(colonyId) ?? [];
    list.push(c);
    byColony.set(colonyId, list);
  }
  const colonies = fewestFirst(
    colonyRows.map((r) => ({ colonyId: r.id, name: r.name, split: splitOf(byColony.get(r.id) ?? []) })),
  );

  return {
    headline: headline(atEnd, range.to),
    over,
    colonies,
    areasVersion: areas.version,
    workedOutAt: now,
    ms: Date.now() - started,
  };
}
