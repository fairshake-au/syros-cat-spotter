import { catsTable, photosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { haversineKm } from "./catHelpers";
import { liveCats } from "./catIdentity";
import { apartWords } from "./duplicateCards";
import { shownName, syrNumber, teamPhotoUrl } from "./teamCatView";

// The nearby cats' photos beside each cat on "New cats to check" (SYC-531;
// which-cat-is-which.md §3.3; SYC-59 PR 5.1): the cats a new cat may really
// be, nearest first, so the team can compare at a glance. Team-only: exact
// positions are used here and never leave as numbers, only as "120 m apart".

/** How far a neighbour may be, and how many are shown (the app's own 1.5 km "nearby"). */
export const NEARBY_KM = 1.5;
export const NEARBY_SHOWN = 6;

export interface NearbyCat {
  id: number;
  name: string;
  syr: string;
  /** The team photo route's small variant, or null. */
  photoUrl: string | null;
  apart: string;
}

export async function nearbyCatsOf(catIds: readonly number[]): Promise<Map<number, NearbyCat[]>> {
  const out = new Map<number, NearbyCat[]>();
  if (catIds.length === 0) return out;
  const all = await liveCats({
    id: catsTable.id,
    name: catsTable.name,
    namePending: catsTable.namePending,
    lat: catsTable.lat,
    lng: catsTable.lng,
    photoPublicId: photosTable.publicId,
  }).leftJoin(photosTable, eq(photosTable.id, catsTable.primaryPhotoId));
  for (const id of catIds) {
    const me = all.find((c) => c.id === id);
    if (!me) {
      out.set(id, []);
      continue;
    }
    out.set(
      id,
      all
        .filter((c) => c.id !== id)
        .map((c) => ({ c, d: haversineKm(me.lat, me.lng, c.lat, c.lng) }))
        .filter(({ d }) => d <= NEARBY_KM)
        .sort((x, y) => x.d - y.d || x.c.id - y.c.id)
        .slice(0, NEARBY_SHOWN)
        .map(({ c, d }) => ({
          id: c.id,
          name: shownName(c),
          syr: syrNumber(c.id),
          photoUrl: c.photoPublicId ? `${teamPhotoUrl(c.photoPublicId)}/small` : null,
          apart: apartWords(d),
        })),
    );
  }
  return out;
}
