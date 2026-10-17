import { catsTable, db, foldName, photosTable, sightingsTable } from "@workspace/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { currentColonyOf } from "./colonyMembership";
import { areaFor } from "./areas/namedAreas";
import { placeLabel } from "./areas/placeLabel";
import { COAT_COLOURS, type CoatColour, type CoatPattern } from "./appearance";
import { loadCatRecords } from "./observations";
import { resolveCat, type CatSnapshot } from "./resolve";
import { QUERY_MAX, SYR_RE, syrNumber } from "./teamCatView";

// The team's list of every cat (SYC-396 PR 1.3; spec §5.1, §9.5, §9.6). Worked
// out from the observation records on each request: no status is stored.
// Filtering, sorting and paging are done in memory, because the catalogue is a
// few hundred cats (spec §9.6) and `foldName` has no SQL twin.
//
// **Photos are read by `publicId` only.** `photos.data` (the picture itself)
// is never selected here: a list must not pull hundreds of images out of the
// database. teamCatList.source.test.ts guards that.

/** The four sterilisation marks (spec §12.2). They mean sterilisation status and nothing else. */
export type SterilisedMark = "sterilised" | "probably" | "not_sterilised" | "not_known";
/** Where a cat lives. `gone` is "No longer with us", which includes cats presumed deceased. */
export type Lives = "street" | "homed" | "in_care" | "gone";

export const SORTS = ["recent", "newest", "name"] as const;
export const LAST_SEEN = ["week", "month", "1to3", "over3", "never"] as const;
export const LIVES: readonly Lives[] = ["street", "homed", "in_care", "gone"];
export const MARKS: readonly SterilisedMark[] = ["sterilised", "probably", "not_sterilised", "not_known"];

/**
 * The grid's colour filter: the five colours (SYC-398 §2), plus "not_sure",
 * which is the grid's own "colour not known" choice, never a coat code.
 */
export type ColourFilter = CoatColour | "not_sure";
export const COLOUR_FILTERS: readonly ColourFilter[] = [...COAT_COLOURS, "not_sure"];

export interface CatListFilters {
  colours?: ColourFilter[];
  /** A named area's short key, never a position. */
  area?: string;
  /** A colony's number, never its name. */
  colony?: number;
  sterilised?: SterilisedMark[];
  lives?: Lives[];
  lastSeen?: (typeof LAST_SEEN)[number];
  q?: string;
  sort?: (typeof SORTS)[number];
  page?: number;
}

export interface CatListItem {
  id: number;
  name: string;
  syr: string;
  photoPublicId: string | null;
  coat: CoatColour[];
  /** The resolved pattern (SYC-398 §2), or null when not known. */
  pattern: CoatPattern | null;
  colonyId: number | null;
  mark: SterilisedMark;
  lives: Lives;
  lastSeenAt: Date | null;
  /** Server-side only: never drawn as numbers on a page or put in an address. */
  lastSeen: { lat: number; lng: number } | null;
  /**
   * Where the cat is placed: last seen, else where it was first found. The
   * island map's dot (SYC-396 PR 1.5). Same rule as `lastSeen`: never drawn
   * as numbers, never in an address.
   */
  placedAt: { lat: number; lng: number };
  /** The named area, in words (spec §3.2). */
  place: string;
  /** "2026-06-12" when the cat is presumed gone, else null. */
  notSeenSince: string | null;
}

export const PAGE_SIZE = 48;

/** Lives shown when no `lives` filter is chosen: everyone but "No longer with us". */
export const DEFAULT_LIVES: readonly Lives[] = ["street", "homed", "in_care"];

/**
 * The mark for a cat's sterilisation answer. Anything the records don't make
 * firm (a bare report, or no answer) is "Not known" rather than a guess.
 */
export function markOf(s: CatSnapshot["sterilised"]): SterilisedMark {
  if (s.value === true && s.confidence === "confirmed") return "sterilised";
  if (s.value === true && s.confidence === "likely") return "probably";
  if (s.value === false && s.confidence === "confirmed") return "not_sterilised";
  return "not_known";
}

export function livesOf(s: CatSnapshot): Lives {
  if (s.presumedDeceased || s.lifeStatus === "deceased") return "gone";
  return s.lifeStatus;
}

const DAY = 86_400_000;

/**
 * Does a last-seen time fall in this band? The first two add up: a cat seen 3
 * days ago is in "This week" and in "This month". "1–3 months" is 31 to 90
 * days and "Over 3 months" is more than 90.
 */
function inLastSeenBand(band: (typeof LAST_SEEN)[number], at: Date | null, now: Date): boolean {
  if (band === "never") return at === null;
  if (at === null) return false;
  const days = (now.getTime() - at.getTime()) / DAY;
  if (band === "week") return days <= 7;
  if (band === "month") return days <= 30;
  if (band === "1to3") return days > 30 && days <= 90;
  return days > 90;
}

export async function listTeamCats(
  f: CatListFilters,
  now: Date = new Date(),
): Promise<{ items: CatListItem[]; total: number; catCount: number }> {
  const { matched, catCount } = await matchTeamCats(f, now);
  const page = Math.max(1, Math.floor(f.page ?? 1));
  return {
    items: matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: matched.length,
    // Every cat there is, before any filter: "none recorded" is not "all hidden".
    catCount,
  };
}

/**
 * Every cat the filters match, sorted, with no paging: the island map's
 * dots (SYC-396 PR 1.5, POST /api/team/cats/positions). `f.page` is ignored.
 */
export async function allTeamCats(f: CatListFilters, now: Date = new Date()): Promise<CatListItem[]> {
  return (await matchTeamCats(f, now)).matched;
}

async function matchTeamCats(
  f: CatListFilters,
  now: Date,
): Promise<{ matched: CatListItem[]; catCount: number }> {
  const cats = await db
    .select({
      id: catsTable.id,
      name: catsTable.name,
      lat: catsTable.lat,
      lng: catsTable.lng,
      createdAt: catsTable.createdAt,
      photoPublicId: photosTable.publicId,
    })
    .from(catsTable)
    .leftJoin(photosTable, eq(photosTable.id, catsTable.primaryPhotoId));
  const ids = cats.map((c) => c.id);

  const [records, colonies, seen] = await Promise.all([
    loadCatRecords(ids),
    currentColonyOf(ids),
    // The newest resolved sighting of each cat: one query, not one per cat.
    db.execute<{ cat_id: number; lat: number; lng: number; created_at: Date }>(sql`
      select distinct on (cat_id) cat_id, lat, lng, created_at
      from ${sightingsTable}
      where ${and(eq(sightingsTable.status, "resolved"), isNotNull(sightingsTable.catId))}
      order by cat_id, created_at desc, id desc`),
  ]);
  const lastSighting = new Map<number, { lat: number; lng: number; at: Date }>();
  for (const r of seen.rows) {
    lastSighting.set(r.cat_id, { lat: r.lat, lng: r.lng, at: new Date(r.created_at) });
  }

  // Where each cat is placed for the area filter: last seen, else first found.
  const placed = new Map<number, { lat: number; lng: number }>();
  const all: CatListItem[] = cats.map((c) => {
    const rec = records.get(c.id);
    const snap = resolveCat(rec?.observations ?? [], rec?.evidenceOfLife ?? null, now);
    const sighting = lastSighting.get(c.id) ?? null;
    // Where it was last seen, else where it was first found.
    const where = sighting ?? { lat: c.lat, lng: c.lng };
    placed.set(c.id, where);
    return {
      id: c.id,
      name: c.name,
      syr: syrNumber(c.id),
      photoPublicId: c.photoPublicId,
      // The resolved colours (SYC-398: the coat's colours part).
      coat: snap.coatColours.value ?? [],
      pattern: snap.coatPattern.value,
      colonyId: colonies.get(c.id) ?? null,
      mark: markOf(snap.sterilised),
      lives: livesOf(snap),
      lastSeenAt: sighting?.at ?? null,
      lastSeen: sighting ? { lat: sighting.lat, lng: sighting.lng } : null,
      placedAt: { lat: where.lat, lng: where.lng },
      place: placeLabel(where),
      notSeenSince: snap.notSeenSince,
    };
  });
  const created = new Map(cats.map((c) => [c.id, c.createdAt.getTime()]));

  // The name box: folded, like searchTeamCats. Its rank orders the results
  // when no sort was chosen, so the best match comes first.
  const q = foldName((f.q ?? "").slice(0, QUERY_MAX));
  const syr = q === "" ? null : SYR_RE.exec(q);
  const syrId = syr ? Number(syr[1]) : null;
  const rank = (i: CatListItem): number => {
    if (q === "") return 0;
    if (i.id === syrId) return 0;
    const name = foldName(i.name);
    if (name === q) return 1;
    if (name.startsWith(q)) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };

  const lives = new Set<Lives>(f.lives?.length ? f.lives : DEFAULT_LIVES);
  const matched = all.filter((i) => {
    if (!lives.has(i.lives)) return false;
    if (rank(i) < 0) return false;
    if (f.colours?.length) {
      const wantsUnsure = f.colours.includes("not_sure");
      const hit =
        (i.coat.length === 0 && wantsUnsure) || i.coat.some((c) => f.colours!.includes(c));
      if (!hit) return false;
    }
    if (f.area !== undefined) {
      const p = placed.get(i.id)!;
      if (areaFor(p.lat, p.lng).key !== f.area) return false;
    }
    if (f.colony !== undefined && i.colonyId !== f.colony) return false;
    if (f.sterilised?.length && !f.sterilised.includes(i.mark)) return false;
    if (f.lastSeen !== undefined && !inLastSeenBand(f.lastSeen, i.lastSeenAt, now)) return false;
    return true;
  });

  const byRecent = (a: CatListItem, b: CatListItem) =>
    (b.lastSeenAt?.getTime() ?? -Infinity) - (a.lastSeenAt?.getTime() ?? -Infinity) || a.id - b.id;
  if (f.sort === "name") {
    matched.sort((a, b) => a.name.localeCompare(b.name, "el") || a.id - b.id);
  } else if (f.sort === "newest") {
    matched.sort((a, b) => created.get(b.id)! - created.get(a.id)! || b.id - a.id);
  } else if (q !== "" && f.sort === undefined) {
    matched.sort((a, b) => rank(a) - rank(b) || byRecent(a, b));
  } else {
    matched.sort(byRecent);
  }

  return { matched, catCount: all.length };
}

/** At most this many points in a cat's trail on the map: the newest. */
export const TRAIL_MAX = 50;

/**
 * Where one cat has been seen, oldest first, for the island map's "Show where
 * else it's been seen" (SYC-396 PR 1.5; spec §6.2): where it was first found,
 * then each resolved sighting, the newest TRAIL_MAX points in all. Null when
 * there is no such cat. Positions for a signed-in team page only; never drawn
 * as numbers, never put in an address.
 */
export async function catTrail(
  catId: number,
): Promise<{ id: number; name: string; points: { lat: number; lng: number; at: Date; first: boolean }[] } | null> {
  const [cat] = await db
    .select({ id: catsTable.id, name: catsTable.name, lat: catsTable.lat, lng: catsTable.lng, createdAt: catsTable.createdAt })
    .from(catsTable)
    .where(eq(catsTable.id, catId));
  if (!cat) return null;
  const sightings = await db
    .select({ lat: sightingsTable.lat, lng: sightingsTable.lng, at: sightingsTable.createdAt })
    .from(sightingsTable)
    .where(and(eq(sightingsTable.catId, catId), eq(sightingsTable.status, "resolved")))
    .orderBy(desc(sightingsTable.createdAt), desc(sightingsTable.id))
    .limit(TRAIL_MAX);
  const points = [
    { lat: cat.lat, lng: cat.lng, at: cat.createdAt, first: true },
    ...sightings.reverse().map((s) => ({ lat: s.lat, lng: s.lng, at: s.at, first: false })),
  ].slice(-TRAIL_MAX);
  return { id: cat.id, name: cat.name, points };
}
