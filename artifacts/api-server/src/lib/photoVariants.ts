import sharp from "sharp";
import { and, eq, sql } from "drizzle-orm";
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

/** Tests only (SYC-462 T15): lets a test land a removal between the read and the save. */
export const __variantHooks: { afterRead?: () => Promise<void> } = {};

/**
 * The stored version, or one made now, stored and returned. Null when the
 * photo is missing, removed for good (SYC-462), or its stored bytes can't be
 * read as an image (nothing is stored in that case, so a later fix is picked
 * up).
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
  // Missing, or removed for good: there is nothing to make a version from.
  if (!p || p.data === null) return null;
  await __variantHooks.afterRead?.();
  let bytes: Buffer;
  try {
    bytes = await makeVariant(Buffer.from(p.data, "base64"), size);
  } catch (err) {
    logger.warn({ err: safeError(err), size }, "photo version could not be made");
    return null;
  }
  // Saved only while the photo still has its picture, in one statement (SYC-462
  // spec §4.3): a removal that commits while the version was being made wins,
  // and nothing is saved. A check and then a save would leave a gap.
  const saved = await db.execute(sql`
    insert into photo_variants (photo_id, size, bytes)
    select ${photoId}, ${size}, ${bytes}
     where exists (select 1 from photos where id = ${photoId} and data is not null)
    on conflict do nothing`);
  if (saved.rowCount === 0) {
    // Either it was removed meanwhile, or another request saved the same version first.
    const [still] = await db
      .select({ data: photosTable.data })
      .from(photosTable)
      .where(eq(photosTable.id, photoId));
    if (!still || still.data === null) return null;
  }
  return bytes;
}

// Hook points (spec §11):
//  - remove_photo (SYC-462): the photos row stays; lib/db/src/photoRemoval/remove.ts
//    deletes the versions itself, and variantFor above never makes one again.
//  - 12-month shrink (not built): must call clearVariants(photoId) after shrinking.
export async function clearVariants(photoId: number): Promise<void> {
  await db.delete(photoVariantsTable).where(eq(photoVariantsTable.photoId, photoId));
}
