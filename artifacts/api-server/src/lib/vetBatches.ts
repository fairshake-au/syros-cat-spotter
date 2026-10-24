import { and, asc, eq, inArray, lt, isNull, sql } from "drizzle-orm";
import {
  db,
  photosTable,
  photoVisibilityEventsTable,
  vetBatchCatsTable,
  vetBatchesTable,
  vetBatchPhotosTable,
} from "@workspace/db";
import { athensToday } from "./athensTime";
import { getAppSettings } from "./appSettings";
import type { FindResult } from "./findFromPhoto";
import { logger, safeError } from "./logger";
import { validatePhotoBase64 } from "./imageValidation";
import { ROUND_MAX } from "./vetVisits";

// Vet visit batches (SYC-677): a day's round of cats at the vet, entered as a
// draft until it is saved. This module is the draft's store.
//
// - Every write sets updated_at, and a write to a saved batch is refused
//   (BatchSavedError; addCat answers "saved").
// - A staged photo was never published, so removing it (removeCat,
//   abandonBatch, removeStaleBatches) hard-deletes its `photos` row in the
//   same transaction as the link rows. Nothing forbids that: photos has no
//   delete guard, and variants and fingerprints cascade.
// - Photos are re-encoded on upload (validatePhotoBase64), which strips EXIF
//   and GPS.
// - An unfinished batch is kept BATCH_KEEP_DAYS from its last change.

type Person = { id: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const BATCH_KEEP_DAYS = 7;
export const BATCH_PHOTOS_MAX = 6; // per cat

export interface BatchShared {
  date: string;
  clinicId: string | null;
  colonyId: number | null;
  areaKey: string | null;
  priceEur: string;
  paidBy: string;
  vaccines: string[];
  vaccineOther: string;
  note: string;
}

export interface BatchCat {
  id: number;
  position: number;
  catId: number | null;
  newCat: { name: string | null; description: string } | null;
  confirmed: boolean;
  did: string[];
  treatedNote: string;
  costEur: string;
  paidBy: string;
  note: string;
  alsoSameDay: boolean;
  photos: { photoId: number; publicId: string }[];
  suggestions: FindResult[] | null;
}

export interface Batch {
  id: number;
  createdBy: string;
  savedAt: Date | null;
  shared: BatchShared;
  cats: BatchCat[];
}

export class BatchSavedError extends Error {
  constructor() {
    super("This batch is saved, so it can't be changed.");
    this.name = "BatchSavedError";
  }
}

const DAY_MS = 24 * 3600 * 1000;

function priceOrNull(price: string): string | null {
  const t = price.trim();
  if (t === "") return null;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) throw new Error("The price needs to be an amount in euros.");
  return t;
}

/** Locks the batch row; null if it is gone; throws BatchSavedError if saved. */
async function lockDraft(tx: Tx, id: number): Promise<{ id: number; createdBy: string } | null> {
  const [row] = await tx
    .select({ id: vetBatchesTable.id, savedAt: vetBatchesTable.savedAt, createdBy: vetBatchesTable.createdBy })
    .from(vetBatchesTable)
    .where(eq(vetBatchesTable.id, id))
    .for("update");
  if (!row) return null;
  if (row.savedAt) throw new BatchSavedError();
  return { id: row.id, createdBy: row.createdBy };
}

const touch = (tx: Tx, id: number, now = new Date()) =>
  tx.update(vetBatchesTable).set({ updatedAt: now }).where(eq(vetBatchesTable.id, id));

export async function createBatch(
  person: Person,
  start: { colonyId?: number; areaKey?: string },
  now: Date = new Date(),
): Promise<number> {
  const price = (await getAppSettings()).sterilisationPriceEur;
  const [row] = await db
    .insert(vetBatchesTable)
    .values({
      createdBy: person.id,
      createdAt: now,
      updatedAt: now,
      date: athensToday(now),
      colonyId: start.colonyId ?? null,
      areaKey: start.areaKey ?? null,
      priceEur: String(price),
      paidBy: "syros_cats",
    })
    .returning({ id: vetBatchesTable.id });
  return row!.id;
}

/**
 * The batch, or null when it is absent (or has been removed). Inside a
 * transaction, pass its `tx`: the read then never waits for a second pool
 * connection (saveBatch reads the batch it has locked this way).
 */
export async function getBatch(id: number, q: typeof db | Tx = db): Promise<Batch | null> {
  const [b] = await q.select().from(vetBatchesTable).where(eq(vetBatchesTable.id, id));
  if (!b) return null;
  const cats = await q
    .select()
    .from(vetBatchCatsTable)
    .where(eq(vetBatchCatsTable.batchId, id))
    .orderBy(asc(vetBatchCatsTable.position), asc(vetBatchCatsTable.id));
  const photos = cats.length
    ? await q
        .select({
          batchCatId: vetBatchPhotosTable.batchCatId,
          photoId: vetBatchPhotosTable.photoId,
          publicId: photosTable.publicId,
        })
        .from(vetBatchPhotosTable)
        .innerJoin(photosTable, eq(photosTable.id, vetBatchPhotosTable.photoId))
        .where(
          inArray(
            vetBatchPhotosTable.batchCatId,
            cats.map((c) => c.id),
          ),
        )
        .orderBy(asc(vetBatchPhotosTable.position), asc(vetBatchPhotosTable.id))
    : [];
  return {
    id: b.id,
    createdBy: b.createdBy,
    savedAt: b.savedAt,
    shared: {
      date: b.date,
      clinicId: b.clinicId,
      colonyId: b.colonyId,
      areaKey: b.areaKey,
      priceEur: b.priceEur ?? "",
      paidBy: b.paidBy,
      vaccines: b.vaccines as string[],
      vaccineOther: b.vaccineOther,
      note: b.note,
    },
    cats: cats.map((c) => ({
      id: c.id,
      position: c.position,
      catId: c.catId,
      newCat: c.newCat as BatchCat["newCat"],
      confirmed: c.confirmed,
      did: c.did as string[],
      treatedNote: c.treatedNote,
      costEur: c.costEur,
      paidBy: c.paidBy,
      note: c.note,
      alsoSameDay: c.alsoSameDay,
      photos: photos.filter((p) => p.batchCatId === c.id).map((p) => ({ photoId: p.photoId, publicId: p.publicId })),
      suggestions: c.suggestions as FindResult[] | null,
    })),
  };
}

export async function updateShared(id: number, shared: BatchShared): Promise<void> {
  const price = priceOrNull(shared.priceEur);
  await db.transaction(async (tx) => {
    if (!(await lockDraft(tx, id))) return;
    await tx
      .update(vetBatchesTable)
      .set({
        date: shared.date,
        clinicId: shared.clinicId,
        colonyId: shared.colonyId,
        areaKey: shared.areaKey,
        priceEur: price,
        paidBy: shared.paidBy,
        vaccines: shared.vaccines,
        vaccineOther: shared.vaccineOther,
        note: shared.note,
        updatedAt: new Date(),
      })
      .where(eq(vetBatchesTable.id, id));
  });
}

export type AddCatResult =
  | { ok: true; batchCatId: number }
  | { ok: false; reason: "bad_photo" | "too_many_photos" | "batch_full" | "saved" };

export async function addCat(id: number, photos: Buffer[]): Promise<AddCatResult> {
  if (photos.length > BATCH_PHOTOS_MAX) return { ok: false, reason: "too_many_photos" };
  // Validate and re-encode before any write, so a bad photo stores nothing.
  const clean: { data: string; mime: string }[] = [];
  for (const p of photos) {
    const v = await validatePhotoBase64(p.toString("base64"));
    if ("error" in v) return { ok: false, reason: "bad_photo" };
    clean.push({ data: v.buffer.toString("base64"), mime: v.mime });
  }
  return db.transaction(async (tx): Promise<AddCatResult> => {
    let locked;
    try {
      locked = await lockDraft(tx, id);
    } catch (err) {
      if (err instanceof BatchSavedError) return { ok: false, reason: "saved" };
      throw err;
    }
    if (!locked) throw new Error("No such batch");
    const [{ n, top }] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        top: sql<number>`coalesce(max(${vetBatchCatsTable.position}), -1)::int`,
      })
      .from(vetBatchCatsTable)
      .where(eq(vetBatchCatsTable.batchId, id));
    if (n! >= ROUND_MAX) return { ok: false, reason: "batch_full" };
    const [cat] = await tx
      .insert(vetBatchCatsTable)
      .values({ batchId: id, position: top! + 1 })
      .returning({ id: vetBatchCatsTable.id });
    for (const [i, p] of clean.entries()) {
      const [row] = await tx.insert(photosTable).values(p).returning({ id: photosTable.id });
      await tx.insert(vetBatchPhotosTable).values({ batchCatId: cat!.id, photoId: row!.id, position: i });
    }
    await touch(tx, id);
    return { ok: true, batchCatId: cat!.id };
  });
}

export async function updateCat(
  batchCatId: number,
  fields: Partial<Omit<BatchCat, "id" | "photos" | "suggestions">>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [cat] = await tx
      .select({ batchId: vetBatchCatsTable.batchId })
      .from(vetBatchCatsTable)
      .where(eq(vetBatchCatsTable.id, batchCatId));
    if (!cat || !(await lockDraft(tx, cat.batchId))) return;
    const set: Partial<typeof vetBatchCatsTable.$inferInsert> = {};
    if (fields.position !== undefined) set.position = fields.position;
    if (fields.confirmed !== undefined) set.confirmed = fields.confirmed;
    if (fields.did !== undefined) set.did = fields.did;
    if (fields.treatedNote !== undefined) set.treatedNote = fields.treatedNote;
    if (fields.costEur !== undefined) set.costEur = fields.costEur;
    if (fields.paidBy !== undefined) set.paidBy = fields.paidBy;
    if (fields.note !== undefined) set.note = fields.note;
    if (fields.alsoSameDay !== undefined) set.alsoSameDay = fields.alsoSameDay;
    // A cat is a known cat or a new one, never both (vet_batch_cats_identity_ck).
    if (fields.catId !== undefined) {
      set.catId = fields.catId;
      if (fields.catId !== null && fields.newCat === undefined) set.newCat = null;
    }
    if (fields.newCat !== undefined) {
      set.newCat = fields.newCat;
      if (fields.newCat !== null && fields.catId === undefined) set.catId = null;
    }
    if (Object.keys(set).length) await tx.update(vetBatchCatsTable).set(set).where(eq(vetBatchCatsTable.id, batchCatId));
    await touch(tx, cat.batchId);
  });
}

/**
 * Deletes these batch cats, their link rows and their staged photos. A photo
 * is hard-deleted (it was never published). One that has a visibility event
 * can't be: photo_visibility_events is append-only (a trigger refuses
 * deletes) and references the photo, so, per Ruling R2, it is marked removed
 * instead (bytes nulled, removed_by the batch's author), in the same
 * transaction.
 */
async function deleteCats(tx: Tx, batchCatIds: number[], removedBy: string): Promise<void> {
  if (batchCatIds.length === 0) return;
  const staged = await tx
    .select({ photoId: vetBatchPhotosTable.photoId })
    .from(vetBatchPhotosTable)
    .where(inArray(vetBatchPhotosTable.batchCatId, batchCatIds));
  // The link rows go first (the cascade), then the photos they pointed at.
  await tx.delete(vetBatchCatsTable).where(inArray(vetBatchCatsTable.id, batchCatIds));
  if (staged.length === 0) return;
  const ids = staged.map((r) => r.photoId);
  const withEvents = new Set(
    (
      await tx
        .select({ photoId: photoVisibilityEventsTable.photoId })
        .from(photoVisibilityEventsTable)
        .where(inArray(photoVisibilityEventsTable.photoId, ids))
    ).map((r) => r.photoId),
  );
  const plain = ids.filter((id) => !withEvents.has(id));
  if (plain.length) await tx.delete(photosTable).where(inArray(photosTable.id, plain));
  if (withEvents.size) {
    await tx
      .update(photosTable)
      .set({ data: null, removedAt: new Date(), removedBy, removedReason: "SYC-677 staged vet photo discarded" })
      .where(and(inArray(photosTable.id, [...withEvents]), isNull(photosTable.removedAt)));
  }
}

/** Removes a cat from its batch, and its staged photos for good. */
export async function removeCat(batchCatId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [cat] = await tx
      .select({ batchId: vetBatchCatsTable.batchId })
      .from(vetBatchCatsTable)
      .where(eq(vetBatchCatsTable.id, batchCatId));
    const locked = cat ? await lockDraft(tx, cat.batchId) : null;
    if (!cat || !locked) return;
    await deleteCats(tx, [batchCatId], locked.createdBy);
    await touch(tx, cat.batchId);
  });
}

async function deleteBatch(tx: Tx, id: number, removedBy: string): Promise<void> {
  const cats = await tx
    .select({ id: vetBatchCatsTable.id })
    .from(vetBatchCatsTable)
    .where(eq(vetBatchCatsTable.batchId, id));
  await deleteCats(tx, cats.map((c) => c.id), removedBy);
  await tx.delete(vetBatchesTable).where(eq(vetBatchesTable.id, id));
}

/** Throws the draft away: the batch, its cats and their staged photos. */
export async function abandonBatch(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const locked = await lockDraft(tx, id);
    if (!locked) return;
    await deleteBatch(tx, id, locked.createdBy);
  });
}

/** Removes every unsaved batch untouched for BATCH_KEEP_DAYS; how many went, and how many could not. */
export async function removeStaleBatches(now: Date = new Date()): Promise<{ removed: number; failed: number }> {
  const cutoff = new Date(now.getTime() - BATCH_KEEP_DAYS * DAY_MS);
  const stale = await db
    .select({ id: vetBatchesTable.id })
    .from(vetBatchesTable)
    .where(and(isNull(vetBatchesTable.savedAt), lt(vetBatchesTable.updatedAt, cutoff)));
  let removed = 0;
  let failed = 0;
  for (const { id } of stale) {
    // One batch that can't be removed must not stop the others.
    try {
      const did = await db.transaction(async (tx) => {
        // Locked, then looked at again: it may have been touched or saved since.
        const [row] = await tx
          .select({ id: vetBatchesTable.id, createdBy: vetBatchesTable.createdBy })
          .from(vetBatchesTable)
          .where(and(eq(vetBatchesTable.id, id), isNull(vetBatchesTable.savedAt), lt(vetBatchesTable.updatedAt, cutoff)))
          .for("update");
        if (!row) return false;
        await deleteBatch(tx, id, row.createdBy);
        return true;
      });
      if (did) removed++;
    } catch (err) {
      failed++;
      // Never the batch, a person or a photo: the error's safe fields only.
      logger.error({ err: safeError(err) }, "vet batch clean-up: one batch could not be removed");
    }
  }
  if (failed) logger.warn({ failed, removed }, "vet batch clean-up: some batches were left");
  return { removed, failed };
}
