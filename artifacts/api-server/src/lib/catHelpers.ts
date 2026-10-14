import { createHash } from "node:crypto";
import {
  db,
  catsTable,
  sightingsTable,
  profilesTable,
  catUpdatesTable,
} from "@workspace/db";
import { eq, and, inArray, isNotNull, sql } from "drizzle-orm";
import { badgesFor, type ProfileStats } from "./badges";
import {
  STREAK_TIMEZONE,
  streakFromDays,
  todayInStreakTimezone,
} from "./streak";
import { loadCatRecords, type DbOrTx } from "./observations";
import { resolveCat, type Confidence, type LifeStatusValue } from "./resolve";
import { pr3Recorded } from "./pr3Gate";
import { LIKELY_STERILISED_PUBLIC_LIVE } from "./likelyGate";
import { BLUR_CELL_METRES, blurPosition, publicDistanceKm } from "./blur";
import { catDisplayPhotos, type PublicPhotoUrl } from "./photoVisibility";

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Opaque public identifier for a device profile. Device IDs act as the
 * bearer credential in this anonymous-profile model, so they must never
 * appear in public API responses (leaderboard, cat credits, sightings).
 *
 * Null for nobody: a spotter who deleted their data (SYC-63). The app shows
 * "a spotter".
 */
export function spotterCode(deviceId: string): string;
export function spotterCode(deviceId: string | null): string | null;
export function spotterCode(deviceId: string | null): string | null {
  if (deviceId === null) return null;
  return createHash("sha256").update(deviceId).digest("hex").slice(0, 4).toUpperCase();
}

export interface SterilisedStatus {
  value: boolean | null;
  confidence: Confidence;
  clippedTipSightings: number;
}

export interface DerivedCatStatus {
  hasHome: boolean;
  lifeStatus: LifeStatusValue;
  notSeenSince: string | null;
  sterilised: SterilisedStatus;
}

/**
 * A cat as it leaves the server (cat-record-data-spine.md §10.6–10.7).
 * `lat`/`lng` keep their meaning, "where this cat is"; `locationPrecision`
 * says how to draw it. Only {@link serialiseCat} builds one.
 */
export interface CatWithStats extends DerivedCatStatus {
  id: number;
  name: string;
  description: string;
  photoUrl: string | null;
  lat: number;
  lng: number;
  locationPrecision: "exact" | "approximate";
  locationCellM: number | null;
  sightingsCount: number;
  /** A UTC calendar date (YYYY-MM-DD), never a time (§6.4.4). */
  lastSeenAt: string;
  distanceKm?: number;
  // Null once the discoverer has deleted their data (SYC-63).
  discovererSpotterCode: string | null;
  discovererNickname: string | null;
  /** The owner tier only; null for everyone else (claiming-a-cat.md D9). */
  ownerName: string | null;
  /** The owner tier only; null for everyone else (D9). */
  homeDescription: string | null;
  /** The owner tier only; null for everyone else (§5, D9). */
  homePin: { lat: number; lng: number } | null;
  discovererUsername: string | null;
}

/**
 * Who is asking (§6.5, §10.6). Every user of the mobile app is `public`. The
 * one exception is Option B: a device that has proved it holds its secret,
 * looking at the detail page of a cat it owns, sees that cat exactly. The
 * list is always public, so the offline cache only ever holds one precision.
 * Team pages never use this serialiser; they read exact positions directly
 * behind requireTeam.
 */
export type Viewer =
  | { tier: "public"; from?: { lat: number; lng: number } }
  | { tier: "owner"; deviceId: string; from?: { lat: number; lng: number } };

export const PUBLIC_VIEWER: Viewer = { tier: "public" };

/** Everything the serialiser needs to know about one cat, exact position included. */
export interface CatSource {
  id: number;
  name: string;
  description: string;
  /** Only lib/photoVisibility.ts makes one: null when hidden (PR 6). */
  photoUrl: PublicPhotoUrl | null;
  /** Exact, as stored. Never copied to the output for a public viewer. */
  lat: number;
  lng: number;
  ownerDeviceId: string | null;
  sightingsCount: number;
  lastSeenAt: Date | string;
  // Null once the discoverer has deleted their data (SYC-63).
  discovererDeviceId: string | null;
  discovererNickname: string | null;
  discovererUsername: string | null;
  ownerName: string | null;
  /** The owner's note and pin. Never copied to the output for a public
   * viewer (claiming-a-cat.md §5, D9). */
  homeDescription: string | null;
  homeLat: number | null;
  homeLng: number | null;
  derived: DerivedCatStatus;
}

/** An ISO timestamp or Date, cut to its UTC calendar date. */
export function toPublicDay(at: Date | string): string {
  return (typeof at === "string" ? at : at.toISOString()).slice(0, 10);
}

/**
 * **The one serialiser** (§10.6). Every route that sends a cat to the app
 * builds it here: `GET /cats`, `catPayload` (`GET /cats/:id`, claim, `PATCH`),
 * and the resolve response. Built field by field from an allow-list, never by
 * spreading a row, so a new column can't leak.
 *
 * Public: the centre of the cat's 250 m cell (secret grid origin, blur.ts),
 * `locationPrecision: "approximate"`, `locationCellM: 250`, distance to the
 * cell centre rounded to 100 m, last seen as a date. An owner viewing their
 * own cat gets its exact position and `locationPrecision: "exact"`.
 */
export function serialiseCat(cat: CatSource, viewer: Viewer): CatWithStats {
  const exact =
    viewer.tier === "owner" && cat.ownerDeviceId !== null && cat.ownerDeviceId === viewer.deviceId;
  const position = exact ? { lat: cat.lat, lng: cat.lng } : blurPosition(cat.lat, cat.lng);
  const out: CatWithStats = {
    id: cat.id,
    name: cat.name,
    description: cat.description,
    photoUrl: cat.photoUrl,
    lat: position.lat,
    lng: position.lng,
    locationPrecision: exact ? "exact" : "approximate",
    locationCellM: exact ? null : BLUR_CELL_METRES,
    sightingsCount: cat.sightingsCount,
    lastSeenAt: toPublicDay(cat.lastSeenAt),
    discovererSpotterCode: spotterCode(cat.discovererDeviceId),
    discovererNickname: cat.discovererNickname,
    discovererUsername: cat.discovererUsername,
    // claiming-a-cat.md D9: where an owned cat lives, and who its owner is,
    // are for the owner (and the team, who never use this serialiser) only.
    ownerName: exact ? cat.ownerName : null,
    homeDescription: exact ? cat.homeDescription : null,
    homePin:
      exact && cat.homeLat !== null && cat.homeLng !== null
        ? { lat: cat.homeLat, lng: cat.homeLng }
        : null,
    hasHome: cat.derived.hasHome,
    lifeStatus: cat.derived.lifeStatus,
    notSeenSince: cat.derived.notSeenSince,
    sterilised: {
      value: cat.derived.sterilised.value,
      confidence: cat.derived.sterilised.confidence,
      clippedTipSightings: cat.derived.sterilised.clippedTipSightings,
    },
  };
  if (viewer.from) {
    // Always to the published cell centre, even for an owner: the list
    // sorts on this and must agree with what everyone else sees (§6.4.3).
    out.distanceKm = publicDistanceKm(viewer.from.lat, viewer.from.lng, cat.lat, cat.lng);
  }
  return out;
}

/**
 * A sighting in a cat's public history (§6.4.1): photo, spotter and date. No
 * position, and no sighting id: ids are handed out in upload order, so
 * anyone who uploads their own sightings and notes the times could read the
 * time of day of every public one back from its id (review of #95, finding
 * 4; the same clock §6.4.4 names for photo ids).
 */
export interface PublicSighting {
  catId: number | null;
  spotterCode: string | null;
  spotterUsername: string | null;
  spotterNickname: string | null;
  photoUrl: string | null;
  createdAt: string;
}

export function serialiseSighting(s: {
  id: number;
  catId: number | null;
  // Null once the spotter has deleted their data (SYC-63).
  deviceId: string | null;
  createdAt: Date;
  spotterUsername: string | null;
  spotterNickname: string | null;
  /** Only lib/photoVisibility.ts makes one: null when hidden (PR 6). */
  photoUrl: PublicPhotoUrl | null;
}): PublicSighting {
  return {
    catId: s.catId,
    spotterCode: spotterCode(s.deviceId),
    spotterUsername: s.spotterUsername,
    spotterNickname: s.spotterNickname,
    photoUrl: s.photoUrl,
    createdAt: toPublicDay(s.createdAt),
  };
}

const UNKNOWN_STERILISED: SterilisedStatus = {
  value: null,
  confidence: "unknown",
  clippedTipSightings: 0,
};

/**
 * Truncates a full ISO timestamp to its UTC calendar date (YYYY-MM-DD) for
 * the public API, matching `lastSeenAt`'s own UTC-day convention (the
 * `to_char(... at time zone 'UTC', ...)` below). resolve.ts's `notSeenSince`
 * keeps full timestamp precision internally for its own month-threshold
 * math — only the value handed to the public Cat payload is truncated,
 * since the app only ever renders a date ("Not seen since 3 June 2023"),
 * never a time.
 */
function toPublicDate(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/**
 * One cat's derived status — `lifeStatus`, `notSeenSince` and `sterilised`
 * (cat-record-data-spine.md §10.7), plus `hasHome` redefined as
 * `lifeStatus === "homed"` (plan `data-spine.md`, PR 4) — for a batch of
 * cats in a fixed number of queries, whatever the batch size (§2.3).
 *
 * **The PR 3 code gate** (plan, PR 4; `pr3Gate.ts`): before PR 3's backfill
 * has run, a claimed cat has no `homed` observation at all, so deriving
 * straight from `resolveCat` would show every one of them as `street` and
 * strip their home badge (plan R1/R28). Gated as a whole snapshot, not
 * field by field, so a page never shows `hasHome: true` next to a life line
 * that says "Lives on the street" for the same cat: while the gate is
 * closed, `lifeStatus` and `hasHome` both come from the legacy
 * `owner_device_id` column, and `sterilised` both comes from the legacy
 * `desexed` `cat_updates` row — exactly what the cat page showed before
 * this PR. The one visible change once the gate opens is named in the plan:
 * a cat marked "adopted" through the old admin route, with no owner in the
 * app, starts showing "Has a home" (its life_status becomes derivable),
 * which the plan says is what the team meant.
 *
 * `exec` reads through the caller's transaction when given (claiming-a-cat.md
 * §5). The PR 3 gate (`pr3Recorded`) still reads the migrations table on its
 * own connection: it says nothing about any one cat.
 */
export async function deriveCatStatuses(
  cats: readonly { id: number; ownerDeviceId: string | null }[],
  exec: DbOrTx = db,
): Promise<Map<number, DerivedCatStatus>> {
  const result = new Map<number, DerivedCatStatus>();
  if (cats.length === 0) return result;
  const catIds = cats.map((c) => c.id);

  const live = await pr3Recorded();

  if (!live) {
    // Legacy fallback (plan, PR 4): hasHome from owner_device_id, the
    // sterilised line from the legacy `desexed` cat_updates row. One
    // batched query for every id in the page, never one per cat (§2.3).
    const desexedRows = await exec
      .select({ catId: catUpdatesTable.catId })
      .from(catUpdatesTable)
      .where(
        and(
          inArray(catUpdatesTable.catId, catIds),
          eq(catUpdatesTable.updateType, "desexed"),
        ),
      );
    const desexedCatIds = new Set(desexedRows.map((r) => r.catId));

    for (const cat of cats) {
      const hasHome = cat.ownerDeviceId !== null;
      result.set(cat.id, {
        hasHome,
        lifeStatus: hasHome ? "homed" : "street",
        notSeenSince: null,
        sterilised: desexedCatIds.has(cat.id)
          ? { value: true, confidence: "confirmed", clippedTipSightings: 0 }
          : UNKNOWN_STERILISED,
      });
    }
    return result;
  }

  const records = await loadCatRecords(catIds, exec);
  const now = new Date();
  for (const cat of cats) {
    const rec = records.get(cat.id);
    const snapshot = resolveCat(rec?.observations ?? [], rec?.evidenceOfLife ?? null, now);
    result.set(cat.id, {
      hasHome: snapshot.lifeStatus === "homed",
      lifeStatus: snapshot.lifeStatus,
      notSeenSince: toPublicDate(snapshot.notSeenSince),
      sterilised: publicSterilised(snapshot.sterilised),
    });
  }
  return result;
}

/**
 * Decision Q2's gate (`likelyGate.ts`): the public line never shows *Likely*
 * until Syros Cats can correct it. Downgraded to `unknown` rather than
 * hidden, so the API never claims a stronger negative or positive than it
 * means — "Not known yet" is the honest thing to say about a cat sitting on
 * one uncorrectable photo. Also strips the resolver's internal `asOf` (not
 * part of the API's `sterilised` shape, §10.7).
 */
function publicSterilised(sterilised: {
  value: boolean | null;
  confidence: Confidence;
  clippedTipSightings: number;
}): SterilisedStatus {
  if (sterilised.confidence === "likely" && !LIKELY_STERILISED_PUBLIC_LIVE) {
    return {
      value: null,
      confidence: "unknown",
      clippedTipSightings: sterilised.clippedTipSightings,
    };
  }
  return {
    value: sterilised.value,
    confidence: sterilised.confidence,
    clippedTipSightings: sterilised.clippedTipSightings,
  };
}

/**
 * Is this cat's resolved life status currently `deceased`? Used by:
 *
 * - the resolve route's hand-pick guard (SYC-119 Slice D,
 *   `choose-a-different-cat.md` §4.8): a hand pick of a cat recorded as
 *   deceased is refused with the same `NOT_NEARBY`-style refusal, so a
 *   refusal never tells a prober *why* a cat couldn't be picked. A
 *   *suggested* match is exempt — "a suggested match still clears the
 *   death" (§3.2) — so this is only ever consulted for a hand pick.
 * - the fan-out (`notificationFanout.ts`, `notifications.ts`): "Agatha was
 *   spotted again!" must never reach anyone for a cat the team has recorded
 *   as dead (§3.3's "cruellest bug in the app").
 *
 * Deliberately **not** behind the PR 3 gate: that gate exists because a
 * claimed cat's *homed* status can be missing from `observations` until the
 * backfill runs. A `deceased` status is never missing that way — nothing
 * before this plan could write one at all, so every `deceased` observation
 * that exists was written through `writeObservation` and is real evidence,
 * backfill or not. (No PR before PR 8 writes one yet, so this is a no-op in
 * practice until PR 8 ships — exactly as the plan expects.)
 */
export async function isResolvedDeceased(catId: number): Promise<boolean> {
  const records = await loadCatRecords([catId]);
  const rec = records.get(catId);
  const snapshot = resolveCat(rec?.observations ?? [], rec?.evidenceOfLife ?? null, new Date());
  return snapshot.lifeStatus === "deceased";
}

/** `GET /cats` pages (§2.3). The app walks every page to fill its offline cache. */
export const CATS_PAGE_SIZE_DEFAULT = 100;
export const CATS_PAGE_SIZE_MAX = 200;

export interface CatsPage {
  cats: CatWithStats[];
  page: number;
  pageSize: number;
  total: number;
  nextPage: number | null;
}

/**
 * One page of the public catalogue (§2.3, §6.4.3). Always the public tier:
 * the list is the payload that lands in every phone's offline cache, so it
 * never carries an exact position (§10.6 Option B).
 *
 * Order, stable and coarse: with a viewer position, by distance to each
 * cat's published cell centre, rounded to 100 m; otherwise by last-seen
 * date, newest first. Ties always break on cat id, never on anything
 * exact. Two queries whatever the page size: a light one that orders every
 * cat, then the full rows and their derived status for this page only.
 */
export async function listCatsWithStats(
  opts: { from?: { lat: number; lng: number }; page?: number; pageSize?: number } = {},
): Promise<CatsPage> {
  const pageSize = Math.min(
    Math.max(1, Math.floor(opts.pageSize ?? CATS_PAGE_SIZE_DEFAULT)),
    CATS_PAGE_SIZE_MAX,
  );
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const viewer: Viewer = { tier: "public", from: opts.from };

  const order = await db
    .select({
      id: catsTable.id,
      lat: catsTable.lat,
      lng: catsTable.lng,
      lastSeenDay: sql<string>`to_char(coalesce(max(${sightingsTable.createdAt}), ${catsTable.createdAt}) at time zone 'UTC', 'YYYY-MM-DD')`,
    })
    .from(catsTable)
    .leftJoin(
      sightingsTable,
      and(eq(sightingsTable.catId, catsTable.id), eq(sightingsTable.status, "resolved")),
    )
    .groupBy(catsTable.id);

  const from = opts.from;
  const ranked = from
    ? order
        .map((o) => ({ id: o.id, km: publicDistanceKm(from.lat, from.lng, o.lat, o.lng) }))
        .sort((a, b) => a.km - b.km || a.id - b.id)
    : [...order].sort(
        (a, b) => b.lastSeenDay.localeCompare(a.lastSeenDay) || a.id - b.id,
      );
  const total = ranked.length;
  const pageIds = ranked.slice((page - 1) * pageSize, page * pageSize).map((r) => r.id);
  const nextPage = page * pageSize < total ? page + 1 : null;
  if (pageIds.length === 0) return { cats: [], page, pageSize, total, nextPage };

  const rows = await db
    .select({
      cat: catsTable,
      sightingsCount: sql<number>`count(${sightingsTable.id})::int`,
      lastSeenAt: sql<string | null>`to_char(max(${sightingsTable.createdAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      discovererNickname: sql<string | null>`(
        select ${profilesTable.nickname} from ${profilesTable}
        where ${profilesTable.deviceId} = ${catsTable.discovererDeviceId}
      )`,
      discovererUsername: sql<string | null>`(
        select ${profilesTable.username} from ${profilesTable}
        where ${profilesTable.deviceId} = ${catsTable.discovererDeviceId}
      )`,
    })
    .from(catsTable)
    .leftJoin(
      sightingsTable,
      and(
        eq(sightingsTable.catId, catsTable.id),
        eq(sightingsTable.status, "resolved"),
      ),
    )
    .where(inArray(catsTable.id, pageIds))
    .groupBy(catsTable.id);

  // §2.3: this page's derived status and photos in one batch each, never one
  // query per cat. A hidden main photo falls back to the cat's newest visible
  // one, or none (PR 6, Decision 4).
  const [derived, photos] = await Promise.all([
    deriveCatStatuses(rows.map((r) => ({ id: r.cat.id, ownerDeviceId: r.cat.ownerDeviceId }))),
    catDisplayPhotos(rows.map((r) => r.cat)),
  ]);

  const byId = new Map(
    rows.map((r) => [
      r.cat.id,
      serialiseCat(
        {
          id: r.cat.id,
          name: r.cat.name,
          description: r.cat.description,
          photoUrl: photos.get(r.cat.id) ?? null,
          lat: r.cat.lat,
          lng: r.cat.lng,
          ownerDeviceId: r.cat.ownerDeviceId,
          sightingsCount: r.sightingsCount,
          lastSeenAt: r.lastSeenAt ?? r.cat.createdAt,
          discovererDeviceId: r.cat.discovererDeviceId,
          discovererNickname: r.discovererNickname ?? null,
          discovererUsername: r.discovererUsername ?? null,
          ownerName: r.cat.ownerName,
          homeDescription: r.cat.homeDescription,
          homeLat: r.cat.homeLat,
          homeLng: r.cat.homeLng,
          derived: derived.get(r.cat.id)!,
        },
        viewer,
      ),
    ]),
  );
  // A cat deleted between the two queries simply drops out of this page.
  const cats = pageIds.flatMap((id) => {
    const c = byId.get(id);
    return c ? [c] : [];
  });
  return { cats, page, pageSize, total, nextPage };
}

export async function getProfileStats(deviceId: string): Promise<ProfileStats> {
  let [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.deviceId, deviceId));
  if (!profile) {
    [profile] = await db
      .insert(profilesTable)
      .values({ deviceId })
      .onConflictDoNothing()
      .returning();
    if (!profile) {
      [profile] = await db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.deviceId, deviceId));
    }
  }

  const [counts] = await db
    .select({
      totalSightings: sql<number>`count(*)::int`,
      catsSpotted: sql<number>`count(distinct ${sightingsTable.catId})::int`,
    })
    .from(sightingsTable)
    .where(
      and(
        eq(sightingsTable.deviceId, deviceId),
        eq(sightingsTable.status, "resolved"),
      ),
    );

  const [disc] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catsTable)
    .where(eq(catsTable.discovererDeviceId, deviceId));

  return {
    points: profile?.points ?? 0,
    totalSightings: counts?.totalSightings ?? 0,
    catsSpotted: counts?.catsSpotted ?? 0,
    uniqueCatsDiscovered: disc?.n ?? 0,
  };
}

/** Consecutive days this device has resolved at least one sighting. */
export async function computeStreak(deviceId: string): Promise<number> {
  const rows = await db
    .selectDistinct({
      day: sql<string>`to_char(${sightingsTable.createdAt} at time zone ${STREAK_TIMEZONE}, 'YYYY-MM-DD')`,
    })
    .from(sightingsTable)
    .where(
      and(
        eq(sightingsTable.deviceId, deviceId),
        eq(sightingsTable.status, "resolved"),
      ),
    );

  return streakFromDays(
    rows.map((r) => r.day),
    todayInStreakTimezone(),
  );
}

/**
 * Cat ids this device has personally spotted — drives the design's
 * collected-vs-"Spot to unlock" treatment on the Home and Cat-alog grids.
 */
export async function spottedCatIds(deviceId: string): Promise<number[]> {
  const rows = await db
    .selectDistinct({ catId: sightingsTable.catId })
    .from(sightingsTable)
    .where(
      and(
        eq(sightingsTable.deviceId, deviceId),
        eq(sightingsTable.status, "resolved"),
      ),
    );
  return rows
    .map((r) => r.catId)
    .filter((id): id is number => id !== null)
    .sort((a, b) => a - b);
}

/**
 * How many distinct devices have spotted this cat — the design's "Fans" tile.
 * A spotter who deleted their data stops counting (SYC-63 decision C), so
 * unlinked sightings are left out rather than counted as one more fan.
 */
export async function fansCount(catId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${sightingsTable.deviceId})::int` })
    .from(sightingsTable)
    .where(
      and(
        eq(sightingsTable.catId, catId),
        eq(sightingsTable.status, "resolved"),
        isNotNull(sightingsTable.deviceId),
      ),
    );
  return row?.n ?? 0;
}

/** Size of the whole cat-alog — the denominator in "12 of 142 cats spotted". */
export async function totalCatCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(catsTable);
  return row?.n ?? 0;
}

export async function profilePayload(deviceId: string) {
  const stats = await getProfileStats(deviceId);
  const [profile] = await db
    .select({
      nickname: profilesTable.nickname,
      username: profilesTable.username,
    })
    .from(profilesTable)
    .where(eq(profilesTable.deviceId, deviceId));
  // Safe to return here: the deviceId path param is itself the credential for
  // this profile, so listing the cats it owns leaks nothing to other users.
  const ownedCats = await db
    .select({ id: catsTable.id })
    .from(catsTable)
    .where(eq(catsTable.ownerDeviceId, deviceId));
  const [currentStreakDays, spotted, totalCats] = await Promise.all([
    computeStreak(deviceId),
    spottedCatIds(deviceId),
    totalCatCount(),
  ]);
  return {
    deviceId,
    spotterCode: spotterCode(deviceId),
    username: profile?.username ?? null,
    nickname: profile?.nickname ?? null,
    points: stats.points,
    totalSightings: stats.totalSightings,
    uniqueCatsDiscovered: stats.uniqueCatsDiscovered,
    catsSpotted: stats.catsSpotted,
    badges: badgesFor(stats),
    ownedCatIds: ownedCats.map((c) => c.id),
    currentStreakDays,
    spottedCatIds: spotted,
    totalCats,
  };
}
