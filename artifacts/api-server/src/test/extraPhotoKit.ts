import { randomBytes } from "node:crypto";
import {
  db,
  photosTable,
  sightingMatchesTable,
  sightingsTable,
  type SightingPhotoRole,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { saveSpotWithPhotos } from "../lib/spotPhotos";

// Tests only (SYC-415 PR 3): a spot with extra photos, saved the way the
// upload route saves it (lib/spotPhotos.ts), then resolved to a cat the way
// the resolve route moves it (status pending -> resolved, cat_id set; the one
// update the append-only trigger allows).

if (!process.env["VITEST"]) {
  throw new Error("extraPhotoKit is for tests only (VITEST is not set).");
}

export interface SeededSpot {
  sightingId: number;
  /** role -> that photo's row id and public id. */
  photos: Record<string, { id: number; publicId: string }>;
}

/**
 * A spot with these roles (default: first, face, body), saved in one
 * transaction. With `catId` it is resolved to that cat; without, it stays
 * pending (a spot nobody has matched yet).
 */
export async function seedSpot(opts: {
  deviceId: string;
  catId?: number;
  roles?: SightingPhotoRole[];
  lat?: number;
  lng?: number;
  createdAt?: Date;
}): Promise<SeededSpot> {
  const roles = opts.roles ?? ["first", "face", "body"];
  const saved = await saveSpotWithPhotos({
    deviceId: opts.deviceId,
    lat: opts.lat ?? 37.445,
    lng: opts.lng ?? 24.942,
    capturedAt: opts.createdAt ?? new Date(Date.now() - 86_400_000),
    photos: roles.map((role) => ({
      role,
      buffer: Buffer.from(`fake-jpeg-${role}-${randomBytes(4).toString("hex")}`),
      mime: "image/jpeg",
    })),
  });
  if (opts.catId !== undefined) {
    await db
      .update(sightingsTable)
      .set({ catId: opts.catId, status: "resolved" })
      .where(eq(sightingsTable.id, saved.sightingId));
  }
  const rows = await db
    .select({ id: photosTable.id, publicId: photosTable.publicId })
    .from(photosTable)
    .where(inArray(photosTable.id, saved.photos.map((p) => p.photoId)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const photos: SeededSpot["photos"] = {};
  for (const p of saved.photos) photos[p.role] = byId.get(p.photoId)!;
  return { sightingId: saved.sightingId, photos };
}

/** Writes a match record for a spot, as the upload route does. */
export async function seedMatchRecord(
  sightingId: number,
  fields: { mixedCats?: boolean | null; noCatInAnyPhoto?: boolean | null } = {},
): Promise<void> {
  await db.insert(sightingMatchesTable).values({
    sightingId,
    mixedCats: fields.mixedCats ?? null,
    noCatInAnyPhoto: fields.noCatInAnyPhoto ?? null,
  });
}
