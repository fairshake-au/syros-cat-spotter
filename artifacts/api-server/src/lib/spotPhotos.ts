import { createHash } from "node:crypto";
import {
  db,
  photosTable,
  sightingsTable,
  sightingPhotosTable,
  type SightingPhotoRole,
} from "@workspace/db";
import { validatePhotoBase64 } from "./imageValidation";

// SYC-415 (docs/specs/photo-tips-and-extra-photos.md §5.1, §6.2): a spot's
// photos — its first photo, and optionally a face and a body photo — are all
// checked first, then saved with the sighting in one transaction.

export type SpotPhotoInput = { role: SightingPhotoRole; photoBase64: string };
export type ValidatedSpotPhoto = { role: SightingPhotoRole; buffer: Buffer; mime: string };
export type SavedSpotPhoto = {
  role: SightingPhotoRole;
  photoId: number;
  base64: string;
  mime: string;
};

/** Spec §5.1: the face photo if there is one, otherwise the first photo. The
 * phone applies the same fixed rule, so it knows the cover without asking. */
export function coverRole(roles: readonly SightingPhotoRole[]): SightingPhotoRole {
  return roles.includes("face") ? "face" : "first";
}

/** The spot's photos in the order taken: the first photo, then the extras in
 * the order sent. At most one face and one body (the contract caps extras
 * at two). */
export function spotPhotoList(body: {
  photoBase64: string;
  extraPhotos?: { role: "face" | "body"; photoBase64: string }[] | null;
}): { ok: true; photos: SpotPhotoInput[] } | { ok: false; error: string } {
  const extras = body.extraPhotos ?? [];
  const roles = extras.map((e) => e.role);
  if (new Set(roles).size !== roles.length) {
    return { ok: false, error: "Only one face photo and one body photo per spot." };
  }
  return {
    ok: true,
    photos: [
      { role: "first", photoBase64: body.photoBase64 },
      ...extras.map((e) => ({ role: e.role, photoBase64: e.photoBase64 })),
    ],
  };
}

/** Every photo through the one photo-saving step (spec §6.2 point 1). The
 * first failure stops it and names that photo. The same photo twice is
 * refused by comparing the normalised output, not the bytes sent: the phone
 * re-encodes extras, so raw strings would never match. */
export async function validateSpotPhotos(
  photos: SpotPhotoInput[],
): Promise<
  | { ok: true; photos: ValidatedSpotPhoto[] }
  | { ok: false; error: string; photo: SightingPhotoRole }
> {
  const out: ValidatedSpotPhoto[] = [];
  const seen = new Set<string>();
  // One at a time: sharp and the HEIC fallback are memory-hungry.
  for (const p of photos) {
    const v = await validatePhotoBase64(p.photoBase64);
    if ("error" in v) return { ok: false, error: v.error, photo: p.role };
    const digest = createHash("sha256").update(v.buffer).digest("hex");
    if (seen.has(digest)) {
      return {
        ok: false,
        error: "The same photo can only be used once in a spot.",
        photo: p.role,
      };
    }
    seen.add(digest);
    out.push({ role: p.role, buffer: v.buffer, mime: v.mime });
  }
  return { ok: true, photos: out };
}

/** Spec §6.2 point 2: the photos, the sighting (recording its cover photo in
 * `sightings.photo_id`, which every older reader uses) and the note of which
 * photo is which, all together or not at all. */
export async function saveSpotWithPhotos(input: {
  deviceId: string;
  lat: number;
  lng: number;
  capturedAt: Date;
  photos: ValidatedSpotPhoto[];
}): Promise<{ sightingId: number; photos: SavedSpotPhoto[] }> {
  return db.transaction(async (tx) => {
    const saved: SavedSpotPhoto[] = [];
    for (const p of input.photos) {
      const base64 = p.buffer.toString("base64");
      const [row] = await tx
        .insert(photosTable)
        .values({ data: base64, mime: p.mime })
        .returning({ id: photosTable.id });
      saved.push({ role: p.role, photoId: row!.id, base64, mime: p.mime });
    }
    const cover = saved.find((s) => s.role === coverRole(saved.map((x) => x.role)))!;
    const [sighting] = await tx
      .insert(sightingsTable)
      .values({
        deviceId: input.deviceId,
        photoId: cover.photoId,
        lat: input.lat,
        lng: input.lng,
        status: "pending",
        createdAt: input.capturedAt,
      })
      .returning({ id: sightingsTable.id });
    await tx.insert(sightingPhotosTable).values(
      saved.map((s, i) => ({
        sightingId: sighting!.id,
        photoId: s.photoId,
        role: s.role,
        position: i + 1,
      })),
    );
    return { sightingId: sighting!.id, photos: saved };
  });
}
