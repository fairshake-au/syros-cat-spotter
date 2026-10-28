import { catsTable, db, foldName, photosTable, sightingsTable } from "@workspace/db";
import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { liveCats } from "./catIdentity";
import { currentColonyOf } from "./colonyMembership";
import { areaFor } from "./areas/namedAreas";
import { placeLabel } from "./areas/placeLabel";
import { COAT_COLOURS, COAT_PATTERNS, type CoatColour, type CoatPattern } from "./appearance";
import { loadCatRecords } from "./observations";
import { resolveCat, type CatSnapshot } from "./resolve";
import { QUERY_MAX, SYR_RE, syrNumber } from "./teamCatView";
import { NOT_SEEN_LATELY_DAYS } from "./dashboard/countedCats";

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
// "quiet" is Home's Not seen lately (SYC-485): NOT_SEEN_LATELY_DAYS or more,
// at least one matched sighting. Named for what it means, not the number,
// because Syros Cats may change the number (SYC-442).
export const LAST_SEEN = ["week", "month", "1to3", "over3", "quiet", "never"] as const;
export const LIVES: readonly Lives[] = ["street", "homed", "in_care", "gone"];
export const MARKS: readonly SterilisedMark[] = ["sterilised", "probably", "not_sterilised", "not_known"];

/**
 * The grid's colour filter: the five colours (SYC-398 §2), plus "not_sure",
 * which is the grid's own "colour not known" choice, never a coat code.
 */
export type ColourFilter = CoatColour | "not_sure";
export const COLOUR_FILTERS: readonly ColourFilter[] = [...COAT_COLOURS, "not_sure"];

/**
 * The grid's pattern filter: the three patterns (SYC-398 §2), plus
 * "not_known", the grid's own "pattern not known" choice, never a coat code.
 * Like the colour filter, a cat with no pattern shows only when it is picked.
 */
export type PatternFilter = CoatPattern | "not_known";
export const PATTERN_FILTERS: readonly PatternFilter[] = [...COAT_PATTERNS, "not_known"];

/**
 * Solid and Patched are forgiving (coat spec §5, as "Find the cat"): Plain or
 * Patches is a judgement call, so a cat with White among its colours and either
 * of those two recorded shows under both. Tabby is exact.
 */
export function patternPicked(i: { coat: readonly CoatColour[]; pattern: CoatPattern | null }, picked: readonly PatternFilter[]): boolean {
  if (i.pattern === null) return false;
  if (picked.includes(i.pattern)) return true;
  const flexible = i.pattern !== "stripes" && i.coat.includes("white");
  return flexible && (picked.includes("plain") || picked.includes("patches"));
}

export interface CatListFilters {
  colours?: ColourFilter[];
  /** Any of these patterns (stored codes: plain, stripes, patches, not_known). */
  patterns?: PatternFilter[];
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
  /** SYC-677 D: Syros Cats left it for spotters to name; `name` is then its SYR number. */
  namePending: boolean;
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
 * days and "Over 3 months" is more than 90. "Quiet" is NOT_SEEN_LATELY_DAYS or
 * more (it overlaps the two above).
 */
function inLastSeenBand(band: (typeof LAST_SEEN)[number], at: Date | null, now: Date): boolean {
  if (band === "never") return at === null;
  if (at === null) return false;
  const days = (now.getTime() - at.getTime()) / DAY;
  if (band === "week") return days <= 7;
  if (band === "month") return days <= 30;
  if (band === "1to3") return days > 30 && days <= 90;
  if (band === "quiet") return days >= NOT_SEEN_LATELY_DAYS;
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
export async function allTeamCats(
  f: CatListFilters,
  now: Date = new Date(),
): Promise<{ cats: CatListItem[]; catCount: number }> {
  const { matched, catCount } = await matchTeamCats(f, now);
  return { cats: matched, catCount };
}

/**
 * One cat as every team figure sees it (SYC-396 PR 2.0; spec §9.5): the
 * grid's card, plus what Home, the colonies and the reports need beyond it.
 * Server-side only, like `CatListItem`'s positions.
 */
export interface TeamCat extends CatListItem {
  /** cats.created_at: "new to the records". */
  createdAt: Date;
  /** The resolved cat, for figures that need more than the card. */
  snapshot: CatSnapshot;
  /** `areaFor(placedAt).key`; "off" for Off Syros. */
  areaKey: string;
}

/**
 * Every cat the team can see, active or not, resolved once (SYC-396 PR 2.0).
 * Merged-away halves are left out: their records are read through the cat
 * they were merged into (`loadCatRecords`), so counting them again would
 * count one cat twice. Both read merges through lib/catIdentity.ts (SYC-410),
 * so they agree: an undone merge counts for nothing, chains are followed, and
 * a cat in a merge loop stays listed with only its own records.
 *
 * `opts.asOf` (SYC-396 PR 3.0, Decision 10): the cats as they stood then.
 * Cats, sightings and merges entered after it are left out, the
 * records and colonies are read as of it, and `now` defaults to it. A cat's
 * name and photo are today's: they aren't dated.
 */
export async function loadTeamCats(now?: Date, opts: { asOf?: Date } = {}): Promise<TeamCat[]> {
  const asOf = opts.asOf;
  const at = now ?? asOf ?? new Date();
  const cats = await liveCats(
    {
      id: catsTable.id,
      name: catsTable.name,
      namePending: catsTable.namePending,
      lat: catsTable.lat,
      lng: catsTable.lng,
      createdAt: catsTable.createdAt,
      photoPublicId: photosTable.publicId,
    },
    { asOf, where: asOf ? lte(catsTable.createdAt, asOf) : undefined },
  ).leftJoin(photosTable, eq(photosTable.id, catsTable.primaryPhotoId));
  const ids = cats.map((c) => c.id);

  const [records, colonies, seen] = await Promise.all([
    loadCatRecords(ids, db, { asOf }),
    currentColonyOf(ids, db, { asOf }),
    // The newest resolved sighting of each cat: one query, not one per cat.
    db.execute<{ cat_id: number; lat: number; lng: number; created_at: Date }>(sql`
      select distinct on (cat_id) cat_id, lat, lng, created_at
      from ${sightingsTable}
      where ${and(
        eq(sightingsTable.status, "resolved"),
        isNotNull(sightingsTable.catId),
        asOf ? lte(sightingsTable.createdAt, asOf) : undefined,
      )}
      order by cat_id, created_at desc, id desc`),
  ]);
  const lastSighting = new Map<number, { lat: number; lng: number; at: Date }>();
  for (const r of seen.rows) {
    lastSighting.set(r.cat_id, { lat: r.lat, lng: r.lng, at: new Date(r.created_at) });
  }

  return cats.map((c) => {
    const rec = records.get(c.id);
    const snap = resolveCat(rec?.observations ?? [], rec?.evidenceOfLife ?? null, at);
    const sighting = lastSighting.get(c.id) ?? null;
    // Where it was last seen, else where it was first found.
    const where = sighting ?? { lat: c.lat, lng: c.lng };
    return {
      id: c.id,
      name: c.name,
      namePending: c.namePending,
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
      createdAt: c.createdAt,
      snapshot: snap,
      areaKey: areaFor(where.lat, where.lng).key,
    };
  });
}

async function matchTeamCats(
  f: CatListFilters,
  now: Date,
): Promise<{ matched: CatListItem[]; catCount: number }> {
  const team = await loadTeamCats(now);
  // The grid's cards are `CatListItem`s: the snapshot and the rest stay here.
  const all: CatListItem[] = team.map(({ createdAt: _c, snapshot: _s, areaKey: _a, ...card }) => card);
  const created = new Map(team.map((c) => [c.id, c.createdAt.getTime()]));
  const areaOf = new Map(team.map((c) => [c.id, c.areaKey]));

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
    if (f.patterns?.length) {
      const hit = i.pattern === null ? f.patterns.includes("not_known") : patternPicked(i, f.patterns);
      if (!hit) return false;
    }
    if (f.area !== undefined && areaOf.get(i.id) !== f.area) return false;
    if (f.colony !== undefined && i.colonyId !== f.colony) return false;
    if (f.sterilised?.length && !f.sterilised.includes(i.mark)) return false;
    if (f.lastSeen !== undefined && !inLastSeenBand(f.lastSeen, i.lastSeenAt, now)) return false;
    // Off Syros is never counted in any figure (spec §3.3), so Home's count
    // and the list its "and N more" opens agree: this band leaves it out.
    if (f.lastSeen === "quiet" && areaOf.get(i.id) === "off") return false;
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
 * then its newest resolved sightings, TRAIL_MAX points in all. Null when
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
    .limit(TRAIL_MAX - 1);
  // Where it was first found always stays, then the newest sightings (review of PR #230).
  const points = [
    { lat: cat.lat, lng: cat.lng, at: cat.createdAt, first: true },
    ...sightings.reverse().map((s) => ({ lat: s.lat, lng: s.lng, at: s.at, first: false })),
  ];
  return { id: cat.id, name: cat.name, points };
}
