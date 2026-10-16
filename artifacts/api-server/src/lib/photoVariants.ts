import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { db, photosTable, photoVariantsTable } from "@workspace/db";
import { logger, safeError } from "./logger";

// Small and medium versions of a catalogue photo (SYC-396 PR 1.2; team
// dashboard redesign spec §11). Lists and grids load these, never the
// full-size photo. They are made on first request and kept in
// photo_variants. They are served only by the visibility-checked team photo
// route (routes/teamReports.ts), so a hidden photo's versions are hidden too.

export const VARIANT_WIDTH = { small: 160, medium: 640 } as const;
export type VariantSize = keyof typeof VARIANT_WIDTH;

export function isVariantSize(s: string): s is VariantSize {
  return Object.prototype.hasOwnProperty.call(VARIANT_WIDTH, s);
}

/** A JPEG no wider than the size, with no location data. Pure. */
export async function makeVariant(original: Buffer, size: VariantSize): Promise<Buffer> {
  // Never withMetadata(): sharp drops EXIF (and GPS) by default. The exif test guards this.
  return sharp(original)
    .rotate()
    .resize({ width: VARIANT_WIDTH[size], withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}

/**
 * The stored version, or one made now, stored and returned. Null when the
 * photo is missing, or its stored bytes can't be read as an image (nothing is
 * stored in that case, so a later fix is picked up).
 */
export async function variantFor(photoId: number, size: VariantSize): Promise<Buffer | null> {
  const [hit] = await db
    .select({ bytes: photoVariantsTable.bytes })
    .from(photoVariantsTable)
    .where(and(eq(photoVariantsTable.photoId, photoId), eq(photoVariantsTable.size, size)));
  if (hit) return hit.bytes;
  const [p] = await db
    .select({ data: photosTable.data })
    .from(photosTable)
    .where(eq(photosTable.id, photoId));
  if (!p) return null;
  let bytes: Buffer;
  try {
    bytes = await makeVariant(Buffer.from(p.data, "base64"), size);
  } catch (err) {
    logger.warn({ err: safeError(err), size }, "photo version could not be made");
    return null;
  }
  await db.insert(photoVariantsTable).values({ photoId, size, bytes }).onConflictDoNothing();
  return bytes;
}

// Hook points (spec §11). Nothing calls these yet, because neither feature exists (checked 15 Oct 2026):
//  - remove_photo: deleting the photos row cascades to its versions.
//  - 12-month shrink: must call clearVariants(photoId) after shrinking.
export async function clearVariants(photoId: number): Promise<void> {
  await db.delete(photoVariantsTable).where(eq(photoVariantsTable.photoId, photoId));
}
