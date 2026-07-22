import { createHash } from "node:crypto";
import { db, catsTable, sightingsTable, profilesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { badgesFor, type ProfileStats } from "./badges";

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

export function photoUrl(photoId: number): string {
  return `/api/photos/${photoId}`;
}

export interface CatWithStats {
  id: number;
  name: string;
  description: string;
  photoUrl: string;
  lat: number;
  lng: number;
  sightingsCount: number;
  lastSeenAt: string;
  distanceKm?: number;
  discovererSpotterCode: string;
  discovererNickname: string | null;
}

export async function listCatsWithStats(
  lat?: number,
  lng?: number,
): Promise<CatWithStats[]> {
  const rows = await db
    .select({
      cat: catsTable,
      sightingsCount: sql<number>`count(${sightingsTable.id})::int`,
      lastSeenAt: sql<string | null>`to_char(max(${sightingsTable.createdAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      discovererNickname: sql<string | null>`(
        select ${profilesTable.nickname} from ${profilesTable}
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
    .groupBy(catsTable.id);

  const cats = rows.map((r) => {
    const c: CatWithStats = {
      id: r.cat.id,
      name: r.cat.name,
      description: r.cat.description,
      photoUrl: photoUrl(r.cat.primaryPhotoId),
      lat: r.cat.lat,
      lng: r.cat.lng,
      sightingsCount: r.sightingsCount,
      lastSeenAt: r.lastSeenAt ?? r.cat.createdAt.toISOString(),
      discovererSpotterCode: spotterCode(r.cat.discovererDeviceId),
      discovererNickname: r.discovererNickname ?? null,
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

export async function profilePayload(deviceId: string) {
  const stats = await getProfileStats(deviceId);
  const [profile] = await db
    .select({
      nickname: profilesTable.nickname,
      username: profilesTable.username,
    })
    .from(profilesTable)
    .where(eq(profilesTable.deviceId, deviceId));
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
  };
}
