import { createHash } from "node:crypto";
import {
  db,
  catsTable,
  sightingsTable,
  profilesTable,
  photosTable,
  catUpdatesTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { badgesFor, type ProfileStats } from "./badges";
import {
  STREAK_TIMEZONE,
  streakFromDays,
  todayInStreakTimezone,
} from "./streak";
import { loadCatRecords } from "./observations";
import { resolveCat, type Confidence, type LifeStatusValue } from "./resolve";
import { pr3Recorded } from "./pr3Gate";
import { LIKELY_STERILISED_PUBLIC_LIVE } from "./likelyGate";

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
 */
export function spotterCode(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex").slice(0, 4).toUpperCase();
}

/**
 * The single place in the codebase that builds a photo URL
 * (hosting-and-photo-storage.md §6.2 item 1 / SYC-98). Looks up the
 * unguessable public_id for a photo row and returns null rather than
 * minting a link for `routes/cats.ts`'s `primaryPhotoId: 0` sentinel —
 * zero is not a real row, so there's nothing to look up.
 */
export async function photoUrl(photoId: number): Promise<string | null> {
  if (photoId === 0) return null;
  const [photo] = await db
    .select({ publicId: photosTable.publicId })
    .from(photosTable)
    .where(eq(photosTable.id, photoId));
  return photo ? `/api/photos/${photo.publicId}` : null;
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

export interface CatWithStats extends DerivedCatStatus {
  id: number;
  name: string;
  description: string;
  photoUrl: string | null;
  lat: number;
  lng: number;
  sightingsCount: number;
  lastSeenAt: string;
  distanceKm?: number;
  discovererSpotterCode: string;
  discovererNickname: string | null;
  ownerName: string | null;
  homeDescription: string | null;
  discovererUsername: string | null;
}

const UNKNOWN_STERILISED: SterilisedStatus = {
  value: null,
  confidence: "unknown",
  clippedTipSightings: 0,
};

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
 */
export async function deriveCatStatuses(
  cats: readonly { id: number; ownerDeviceId: string | null }[],
): Promise<Map<number, DerivedCatStatus>> {
  const result = new Map<number, DerivedCatStatus>();
  if (cats.length === 0) return result;
  const catIds = cats.map((c) => c.id);

  const live = await pr3Recorded();

  if (!live) {
    // Legacy fallback (plan, PR 4): hasHome from owner_device_id, the
    // sterilised line from the legacy `desexed` cat_updates row. One
    // batched query for every id in the page, never one per cat (§2.3).
    const desexedRows = await db
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

  const records = await loadCatRecords(catIds);
  const now = new Date();
  for (const cat of cats) {
    const rec = records.get(cat.id);
    const snapshot = resolveCat(rec?.observations ?? [], rec?.evidenceOfLife ?? null, now);
    result.set(cat.id, {
      hasHome: snapshot.lifeStatus === "homed",
      lifeStatus: snapshot.lifeStatus,
      notSeenSince: snapshot.notSeenSince,
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

export async function listCatsWithStats(
  lat?: number,
  lng?: number,
): Promise<CatWithStats[]> {
  // SYC-98 Fable review, finding 7: photosTable is joined here rather than
  // calling photoUrl(r.cat.primaryPhotoId) per cat (an N+1 — one round trip
  // to Neon per row, serialised 5 at a time behind the pool's default
  // max: 10) — 50 cats would otherwise cost 50 extra round trips to
  // Frankfurt from Replit EU on every /api/cats call. The join is 1:1
  // (primaryPhotoId -> photos.id, the real primary key), so it can't
  // multiply the sightings aggregate rows the groupBy depends on.
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
      photoPublicId: photosTable.publicId,
    })
    .from(catsTable)
    .leftJoin(
      sightingsTable,
      and(
        eq(sightingsTable.catId, catsTable.id),
        eq(sightingsTable.status, "resolved"),
      ),
    )
    .leftJoin(photosTable, eq(photosTable.id, catsTable.primaryPhotoId))
    .groupBy(catsTable.id, photosTable.publicId);

  // §2.3: every cat's derived status loaded in one batch (loadCatRecords'
  // own fixed query count), never one query per cat.
  const derived = await deriveCatStatuses(
    rows.map((r) => ({ id: r.cat.id, ownerDeviceId: r.cat.ownerDeviceId })),
  );

  const cats = rows.map((r) => {
    const status = derived.get(r.cat.id)!;
    const c: CatWithStats = {
      id: r.cat.id,
      name: r.cat.name,
      description: r.cat.description,
      photoUrl: r.photoPublicId ? `/api/photos/${r.photoPublicId}` : null,
      lat: r.cat.lat,
      lng: r.cat.lng,
      sightingsCount: r.sightingsCount,
      lastSeenAt: r.lastSeenAt ?? r.cat.createdAt.toISOString(),
      discovererSpotterCode: spotterCode(r.cat.discovererDeviceId),
      discovererNickname: r.discovererNickname ?? null,
      ownerName: r.cat.ownerName,
      homeDescription: r.cat.homeDescription,
      discovererUsername: r.discovererUsername ?? null,
      ...status,
    };
    if (lat !== undefined && lng !== undefined) {
      c.distanceKm = haversineKm(lat, lng, c.lat, c.lng);
    }
    return c;
  });

  if (lat !== undefined && lng !== undefined) {
    cats.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  } else {
    cats.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }
  return cats;
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

/** How many distinct devices have spotted this cat — the design's "Fans" tile. */
export async function fansCount(catId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${sightingsTable.deviceId})::int` })
    .from(sightingsTable)
    .where(
      and(
        eq(sightingsTable.catId, catId),
        eq(sightingsTable.status, "resolved"),
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
