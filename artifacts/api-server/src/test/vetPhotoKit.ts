import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  addPerson,
  db,
  photosTable,
  vetBatchCatsTable,
  vetBatchesTable,
  vetBatchPhotosTable,
  vetVisitPhotosTable,
} from "@workspace/db";
import { removeTestPerson } from "./removeTestPerson";

// Tests only (SYC-677): a vet visit's photos, written straight into the
// tables, as nothing in the app writes them yet. A staged photo is in a
// batch's draft; a kept photo is linked to a saved visit. Clean up with
// cleanUpVetPhotos() before removing anyone (vet_batches names its author).

if (!process.env["VITEST"]) {
  throw new Error("vetPhotoKit is for tests only (VITEST is not set).");
}

const RUN = randomBytes(3).toString("hex");
const batches: number[] = [];
const kept: number[] = [];
let authorEmail: string | null = null;
let authorId: string | null = null;

async function author(): Promise<string> {
  if (authorId) return authorId;
  authorEmail = `vitest-vetphoto-${RUN}@example.com`;
  const p = await addPerson({ email: authorEmail, name: "Vt vet", addedBy: "cli:vitest", roles: ["staff"] });
  authorId = p.id;
  return authorId;
}

/** A new photo row with these bytes; its id and public id. */
export async function newPhoto(bytes: Buffer = Buffer.from(`vet-${randomBytes(6).toString("hex")}`)) {
  const [p] = await db
    .insert(photosTable)
    .values({ data: bytes.toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id, publicId: photosTable.publicId });
  return { id: p!.id, publicId: p!.publicId };
}

/**
 * Stages `photoId` for `catId` (or a new cat when null) in a fresh batch.
 * `saved` marks the batch saved.
 */
export async function stagePhoto(photoId: number, catId: number | null, opts: { saved?: boolean } = {}) {
  const [b] = await db
    .insert(vetBatchesTable)
    .values({ createdBy: await author(), date: "2026-10-24", savedAt: opts.saved ? new Date() : null })
    .returning({ id: vetBatchesTable.id });
  batches.push(b!.id);
  const [bc] = await db
    .insert(vetBatchCatsTable)
    .values({
      batchId: b!.id,
      position: 0,
      catId,
      newCat: catId === null ? { name: null, description: "" } : null,
    })
    .returning({ id: vetBatchCatsTable.id });
  await db.insert(vetBatchPhotosTable).values({ batchCatId: bc!.id, photoId, position: 0 });
  return b!.id;
}

/** Keeps `photoId` as a saved visit's photo of `catId`. */
export async function keepPhoto(photoId: number, catId: number): Promise<void> {
  await db.insert(vetVisitPhotosTable).values({ photoId, visitId: 900_000 + kept.length, catId });
  kept.push(photoId);
}

/** Removes every batch and kept-photo link this kit wrote, then its author. */
export async function cleanUpVetPhotos(): Promise<void> {
  if (kept.length) await db.delete(vetVisitPhotosTable).where(inArray(vetVisitPhotosTable.photoId, kept));
  for (const id of batches) await db.delete(vetBatchesTable).where(eq(vetBatchesTable.id, id));
  kept.length = 0;
  batches.length = 0;
  if (authorEmail) await removeTestPerson(authorEmail);
  authorEmail = null;
  authorId = null;
}
