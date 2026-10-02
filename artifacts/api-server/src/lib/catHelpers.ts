import { createHash } from "node:crypto";
import {
  db,
  catsTable,
  sightingsTable,
  profilesTable,
  photosTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { badgesFor, type ProfileStats } from "./badges";
import {
  STREAK_TIMEZONE,
  streakFromDays,
  todayInStreakTimezone,
} from "./streak";

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

export interface CatWithStats {
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
  hasHome: boolean;
  discovererUsername: string | null;
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

  const cats = rows.map((r) => {
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
      hasHome: r.cat.ownerDeviceId !== null,
      discovererUsername: r.discovererUsername ?? null,
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
