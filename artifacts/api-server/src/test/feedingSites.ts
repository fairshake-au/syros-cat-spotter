import { db, feedingSitesTable } from "@workspace/db";
import { deleteTestRows } from "./deleteGuarded";

/**
 * Test seeding for feeding sites (SYC-245). Every seeded site is named
 * `vitest-site-...`, so cleanup can find them without touching other rows.
 */
const SITE_PREFIX = "vitest-site-";

/** One degree of latitude, in metres (mean earth radius 6,371 km). */
const METRES_PER_DEGREE_LAT = (Math.PI / 180) * 6_371_000;

/** `lat` moved north by this many metres (longitude unchanged). */
export function northOf(lat: number, metres: number): number {
  return lat + metres / METRES_PER_DEGREE_LAT;
}

export async function seedFeedingSite(lat: number, lng: number): Promise<void> {
  await db
    .insert(feedingSitesTable)
    .values({ name: `${SITE_PREFIX}${lat},${lng}`, lat, lng });
}

export async function deleteTestFeedingSites(): Promise<void> {
  await deleteTestRows("feeding_sites", "name like $1", [`${SITE_PREFIX}%`]);
}
