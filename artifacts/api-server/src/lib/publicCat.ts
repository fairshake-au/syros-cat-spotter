import { catsTable, db, profilesTable, sightingsTable, type Cat } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  PUBLIC_VIEWER,
  deriveCatStatuses,
  serialiseCat,
  type CatWithStats,
  type DerivedCatStatus,
  type Viewer,
} from "./catHelpers";
import { catDisplayPhoto } from "./photoVisibility";
import { isTeamDesk, TEAM_DESK_NAME } from "./teamDesk";

// A cat as the app sees it, through the one serialiser (catHelpers.serialiseCat,
// data spine §10.6). Moved here from routes/cats.ts (SYC-53 PR 2.1) so that a
// cat guardian asking about a cat outside her colonies gets EXACTLY what the
// public app gets, from the very same function (roles-and-invites.md §2.2:
// "For any cat outside her colonies, and for any cat in no colony, she sees
// exactly what the public sees").

/**
 * The discoverer's public name, or nothing once they've deleted their data
 * (SYC-63): an unlinked cat has no discoverer to look up.
 */
export async function lookupDiscoverer(
  discovererDeviceId: string | null,
): Promise<{ nickname: string | null; username: string | null } | undefined> {
  if (discovererDeviceId === null) return undefined;
  // SYC-677 R22b: a cat Syros Cats recorded is credited to "Syros Cats".
  if (isTeamDesk(discovererDeviceId)) return { nickname: TEAM_DESK_NAME, username: null };
  const [profile] = await db
    .select({
      nickname: profilesTable.nickname,
      username: profilesTable.username,
    })
    .from(profilesTable)
    .where(eq(profilesTable.deviceId, discovererDeviceId));
  return profile;
}

/**
 * A cat for the app, through the one serialiser (catHelpers.serialiseCat,
 * §10.6). `viewer` is public unless the route has proved the caller is this
 * cat's owner.
 */
export async function catPayload(
  cat: Cat,
  sightingsCount: number,
  lastSeenAt: Date | string,
  viewer: Viewer,
  derived?: DerivedCatStatus,
) {
  const [profile, status] = await Promise.all([
    lookupDiscoverer(cat.discovererDeviceId),
    derived
      ? Promise.resolve(derived)
      : deriveCatStatuses([{ id: cat.id, ownerDeviceId: cat.ownerDeviceId }]).then(
          (m) => m.get(cat.id)!,
        ),
  ]);
  return serialiseCat(
    {
      id: cat.id,
      name: cat.name,
      namePending: cat.namePending,
      description: cat.description,
      // The main photo, or the stand-in if the team hid it (PR 6, Decision 4).
      photoUrl: await catDisplayPhoto(cat),
      lat: cat.lat,
      lng: cat.lng,
      ownerDeviceId: cat.ownerDeviceId,
      sightingsCount,
      lastSeenAt,
      discovererDeviceId: cat.discovererDeviceId,
      discovererNickname: profile?.nickname ?? null,
      discovererUsername: profile?.username ?? null,
      ownerName: cat.ownerName,
      homeDescription: cat.homeDescription,
      homeLat: cat.homeLat,
      homeLng: cat.homeLng,
      derived: status,
    },
    viewer,
  );
}

/**
 * One cat's public view by id, as `GET /api/cats/:id` builds its `cat`: the
 * resolved sightings' count, and the newest one's time as "last seen" (the
 * cat's own creation when it has none). Null for no such cat.
 */
export async function publicCatView(catId: number): Promise<CatWithStats | null> {
  const [cat] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
  if (!cat) return null;
  const [row] = await db
    .select({
      n: sql<number>`count(*)::int`,
      newest: sql<Date | null>`max(${sightingsTable.createdAt})`,
    })
    .from(sightingsTable)
    .where(and(eq(sightingsTable.catId, catId), eq(sightingsTable.status, "resolved")));
  const newest = row?.newest ? new Date(row.newest) : null;
  return catPayload(cat, row?.n ?? 0, newest ?? cat.createdAt, PUBLIC_VIEWER);
}
