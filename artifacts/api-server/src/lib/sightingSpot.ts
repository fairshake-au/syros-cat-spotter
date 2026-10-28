import { db, sightingsTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { inIsland, type Position } from "./island";

// Where a sighting was, for the cat page's two buttons "Make a feeding site
// here" and "Show on our map" (SYC-209 PR 3.4; plan K13). The cat page's
// forms carry only the sighting's number; the position is read here on the
// server, so it never has to travel in an address.

export type SightingSpot =
  | { kind: "found"; sightingId: number; catId: number; spot: Position }
  /** No such sighting, or one that isn't a cat's resolved sighting. */
  | { kind: "missing" }
  /** The stored position isn't on Syros: not something to put a site on. */
  | { kind: "outside" };

/**
 * The exact position of one of a cat's sightings (a resolved sighting, the
 * kind the cat page lists), checked to be inside the island box.
 */
export async function sightingSpot(sightingId: number): Promise<SightingSpot> {
  const [row] = await db
    .select({
      id: sightingsTable.id,
      catId: sightingsTable.catId,
      lat: sightingsTable.lat,
      lng: sightingsTable.lng,
    })
    .from(sightingsTable)
    .where(
      and(
        eq(sightingsTable.id, sightingId),
        eq(sightingsTable.status, "resolved"),
        isNotNull(sightingsTable.catId),
      ),
    );
  if (!row || row.catId === null) return { kind: "missing" };
  const spot = { lat: row.lat, lng: row.lng };
  if (!inIsland(spot)) return { kind: "outside" };
  return { kind: "found", sightingId: row.id, catId: row.catId, spot };
}
