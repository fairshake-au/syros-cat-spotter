import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPerson, db, photosTable, photoVisibilityEventsTable, pool, vetBatchesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  abandonBatch,
  addCat,
  BATCH_KEEP_DAYS,
  BATCH_PHOTOS_MAX,
  createBatch,
  getBatch,
  removeCat,
  removeStaleBatches,
  updateCat,
  updateShared,
} from "./vetBatches";
import { removeTestPerson } from "../test/removeTestPerson";
import { getAppSettings } from "./appSettings";
import { athensToday } from "./athensTime";
import { ROUND_MAX } from "./vetVisits";
import { hidePhoto, seedCat } from "../test/roleKit";
import { cleanUpVetPhotos, keepPhoto } from "../test/vetPhotoKit";

// SYC-677 Task 3: the batch store. A batch is a draft round of cats at the
// vet; its photos are staged (hard-deleted if the draft goes).

const RUN = randomBytes(3).toString("hex");
const email = `vitest-vetbatch-${RUN}@example.com`;
let person: { id: string; scopes: { role: string; colonyId: number | null }[] };
const made: number[] = [];

async function jpeg(seed: number, exif = false): Promise<Buffer> {
  let img = sharp({ create: { width: 40, height: 30, channels: 3, background: { r: seed % 256, g: 80, b: 120 } } });
  if (exif) img = img.withExif({ IFD0: { Copyright: `secret-${RUN}` } });
  return img.jpeg().toBuffer();
}

async function newBatch(start: { colonyId?: number; areaKey?: string } = {}, now?: Date) {
  const id = await createBatch(person, start, now);
  made.push(id);
  return id;
}

async function photoRows(ids: number[]) {
  if (ids.length === 0) return [];
  return db.select({ id: photosTable.id, removedAt: photosTable.removedAt }).from(photosTable).where(inArray(photosTable.id, ids));
}

beforeAll(async () => {
  const p = await addPerson({ email, name: "Vt batch", addedBy: "cli:vitest", roles: ["staff"] });
  person = { id: p.id, scopes: [{ role: "staff", colonyId: null }] };
});

afterAll(async () => {
  await cleanUpVetPhotos();
  if (made.length) await db.delete(vetBatchesTable).where(inArray(vetBatchesTable.id, made));
  await removeTestPerson(email);
  await pool.end();
});

describe("the batch store", () => {
  it("round trip: create, add 2 cats (3 photos and 1), update, read back", async () => {
    const id = await newBatch({ areaKey: "ano-syros" });
    const price = (await getAppSettings()).sterilisationPriceEur;
    const fresh = await getBatch(id);
    expect(fresh).toMatchObject({ id, createdBy: person.id, savedAt: null, cats: [] });
    expect(fresh!.shared).toMatchObject({
      date: athensToday(),
      areaKey: "ano-syros",
      colonyId: null,
      clinicId: null,
      paidBy: "syros_cats",
      vaccines: [],
      note: "",
    });
    expect(Number(fresh!.shared.priceEur)).toBe(price);

    const a = await addCat(id, [await jpeg(1), await jpeg(2), await jpeg(3)]);
    const b = await addCat(id, [await jpeg(4)]);
    if (!a.ok || !b.ok) throw new Error("add failed");

    await updateShared(id, {
      ...fresh!.shared,
      date: "2026-10-20",
      clinicId: "clinic-x",
      priceEur: "55.50",
      vaccines: ["fvrcp"],
      vaccineOther: "rabies",
      note: "busy day",
    });
    await updateCat(a.batchCatId, { did: ["sterilised", "vaccinated"], confirmed: true, costEur: "50", note: "calm", alsoSameDay: true });
    await updateCat(b.batchCatId, { newCat: { name: null, description: "ginger, torn ear" }, did: ["treated"], treatedNote: "eye drops" });

    const got = (await getBatch(id))!;
    expect(got.shared).toMatchObject({ date: "2026-10-20", clinicId: "clinic-x", vaccines: ["fvrcp"], vaccineOther: "rabies", note: "busy day" });
    expect(Number(got.shared.priceEur)).toBe(55.5);
    expect(got.cats.map((c) => [c.id, c.position, c.photos.length])).toEqual([
      [a.batchCatId, 0, 3],
      [b.batchCatId, 1, 1],
    ]);
    expect(got.cats[0]).toMatchObject({ did: ["sterilised", "vaccinated"], confirmed: true, costEur: "50", note: "calm", alsoSameDay: true, newCat: null, catId: null });
    expect(got.cats[0]!.photos.every((p) => p.publicId.length > 10)).toBe(true);
    expect(got.cats[1]).toMatchObject({ newCat: { name: null, description: "ginger, torn ear" }, did: ["treated"], treatedNote: "eye drops" });
  });

  it("a colony and an area are not both allowed (kept to one place)", async () => {
    await expect(createBatch(person, { colonyId: 1, areaKey: "x" })).rejects.toThrow();
  });

  it("a 41st cat is batch_full; a 7th photo is too_many_photos", async () => {
    const id = await newBatch();
    const one = await jpeg(9);
    for (let i = 0; i < ROUND_MAX; i++) {
      const r = await addCat(id, []);
      expect(r.ok).toBe(true);
    }
    expect(await addCat(id, [one])).toEqual({ ok: false, reason: "batch_full" });
    const id2 = await newBatch();
    const seven = await Promise.all(Array.from({ length: BATCH_PHOTOS_MAX + 1 }, (_, i) => jpeg(i)));
    expect(await addCat(id2, seven)).toEqual({ ok: false, reason: "too_many_photos" });
    expect((await getBatch(id2))!.cats).toEqual([]);
  });

  it("a non-image is bad_photo and stores nothing", async () => {
    const id = await newBatch();
    const before = (await pool.query(`select count(*)::int n from photos`)).rows[0].n as number;
    const r = await addCat(id, [await jpeg(5), Buffer.from("this is not an image")]);
    expect(r).toEqual({ ok: false, reason: "bad_photo" });
    expect((await getBatch(id))!.cats).toEqual([]);
    expect((await pool.query(`select count(*)::int n from photos`)).rows[0].n as number).toBeGreaterThanOrEqual(before);
    const staged = (await pool.query(`select count(*)::int n from vet_batch_photos bp join vet_batch_cats bc on bc.id = bp.batch_cat_id where bc.batch_id = $1`, [id])).rows[0].n;
    expect(staged).toBe(0);
  });

  it("a stored photo has no EXIF", async () => {
    const id = await newBatch();
    const input = await jpeg(6, true);
    expect((await sharp(input).metadata()).exif).toBeTruthy();
    const r = await addCat(id, [input]);
    if (!r.ok) throw new Error(r.reason);
    const [p] = (await getBatch(id))!.cats[0]!.photos;
    const [row] = await db.select({ data: photosTable.data }).from(photosTable).where(eq(photosTable.publicId, p!.publicId));
    const meta = await sharp(Buffer.from(row!.data!, "base64")).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("a saved batch refuses every write", async () => {
    const id = await newBatch();
    const r = await addCat(id, [await jpeg(7)]);
    if (!r.ok) throw new Error(r.reason);
    await db.update(vetBatchesTable).set({ savedAt: new Date() }).where(eq(vetBatchesTable.id, id));
    const b = (await getBatch(id))!;
    expect(await addCat(id, [])).toEqual({ ok: false, reason: "saved" });
    await expect(updateShared(id, b.shared)).rejects.toThrow(/saved/);
    await expect(updateCat(r.batchCatId, { note: "x" })).rejects.toThrow(/saved/);
    await expect(removeCat(r.batchCatId)).rejects.toThrow(/saved/);
    await expect(abandonBatch(id)).rejects.toThrow(/saved/);
    expect((await getBatch(id))!.cats).toHaveLength(1);
  });

  it("every write sets updated_at", async () => {
    const id = await newBatch();
    const old = new Date("2026-01-01T00:00:00Z");
    const stamp = async () => (await db.select().from(vetBatchesTable).where(eq(vetBatchesTable.id, id)))[0]!.updatedAt;
    const reset = () => db.update(vetBatchesTable).set({ updatedAt: old }).where(eq(vetBatchesTable.id, id));
    await reset();
    const r = await addCat(id, []);
    if (!r.ok) throw new Error(r.reason);
    expect((await stamp()).getTime()).toBeGreaterThan(old.getTime());
    await reset();
    await updateCat(r.batchCatId, { note: "n" });
    expect((await stamp()).getTime()).toBeGreaterThan(old.getTime());
    await reset();
    await updateShared(id, (await getBatch(id))!.shared);
    expect((await stamp()).getTime()).toBeGreaterThan(old.getTime());
  });

  it("removeCat deletes the cat's staged photos, and only its own", async () => {
    const id = await newBatch();
    const a = await addCat(id, [await jpeg(11), await jpeg(12)]);
    const b = await addCat(id, [await jpeg(13)]);
    if (!a.ok || !b.ok) throw new Error("add failed");
    const batch = (await getBatch(id))!;
    const aIds = batch.cats[0]!.photos.map((p) => p.photoId);
    const bIds = batch.cats[1]!.photos.map((p) => p.photoId);
    await removeCat(a.batchCatId);
    expect(await photoRows(aIds)).toEqual([]);
    expect((await photoRows(bIds)).length).toBe(1);
    expect((await getBatch(id))!.cats.map((c) => c.id)).toEqual([b.batchCatId]);
  });

  it("abandonBatch deletes the batch, its cats and its staged photos", async () => {
    const id = await newBatch();
    const a = await addCat(id, [await jpeg(21), await jpeg(22)]);
    if (!a.ok) throw new Error(a.reason);
    const ids = (await getBatch(id))!.cats[0]!.photos.map((p) => p.photoId);
    await abandonBatch(id);
    expect(await getBatch(id)).toBeNull();
    expect(await photoRows(ids)).toEqual([]);
  });

  it("removeStaleBatches removes an untouched unsaved batch and its photos; keeps a 6-day-old one and a saved one", async () => {
    const base = new Date();
    const stale = await newBatch();
    const fresh = await newBatch();
    const saved = await newBatch();
    const s = await addCat(stale, [await jpeg(31)]);
    const f = await addCat(fresh, [await jpeg(32)]);
    const v = await addCat(saved, [await jpeg(33)]);
    if (!s.ok || !f.ok || !v.ok) throw new Error("add failed");
    const staleIds = (await getBatch(stale))!.cats[0]!.photos.map((p) => p.photoId);
    const freshIds = (await getBatch(fresh))!.cats[0]!.photos.map((p) => p.photoId);
    const savedIds = (await getBatch(saved))!.cats[0]!.photos.map((p) => p.photoId);
    const day = 24 * 3600 * 1000;
    // Measured back from the real now, so only batches really older than 7
    // days (none of another test file's live ones) are swept in the shared DB.
    const at = (ms: number) => new Date(base.getTime() + ms);
    await db.update(vetBatchesTable).set({ updatedAt: at(-(BATCH_KEEP_DAYS * day + 60_000)) }).where(eq(vetBatchesTable.id, stale));
    await db.update(vetBatchesTable).set({ updatedAt: at(-(BATCH_KEEP_DAYS - 1) * day) }).where(eq(vetBatchesTable.id, fresh));
    await db.update(vetBatchesTable).set({ updatedAt: at(-30 * day), savedAt: at(-30 * day) }).where(eq(vetBatchesTable.id, saved));
    expect((await removeStaleBatches(base)).removed).toBeGreaterThanOrEqual(1);
    expect(await getBatch(stale)).toBeNull();
    expect(await photoRows(staleIds)).toEqual([]);
    expect(await getBatch(fresh)).not.toBeNull();
    expect((await photoRows(freshIds)).length).toBe(1);
    expect(await getBatch(saved)).not.toBeNull();
    expect((await photoRows(savedIds)).length).toBe(1);
  });

  // photo_visibility_events is append-only and references the photo, so a
  // staged photo that has an event can't be deleted: it is marked removed.
  async function hideEvent(photoId: number) {
    await hidePhoto(photoId);
  }
  async function removedState(ids: number[]) {
    return (await photoRows(ids)).map((r) => r.removedAt !== null);
  }

  // A photo marked removed names who removed it (removed_by, no cascade), so
  // that person can never be deleted afterwards: this one is left in the
  // shared test database on purpose, like other tests' people with history.
  async function historyBatch() {
    const p = await addPerson({ email: `vitest-vetbatch-hist-${RUN}-${made.length}@example.com`, name: "Vt hist", addedBy: "cli:vitest", roles: ["staff"] });
    const id = await createBatch({ id: p.id }, {});
    made.push(id);
    return id;
  }

  it("a staged photo with a visibility event is still taken out by removeCat, abandonBatch and the sweep (marked removed)", async () => {
    const day = 24 * 3600 * 1000;
    const id = await historyBatch();
    const a = await addCat(id, [await jpeg(41)]);
    const b = await addCat(id, [await jpeg(42)]);
    if (!a.ok || !b.ok) throw new Error("add failed");
    const batch = (await getBatch(id))!;
    const aIds = batch.cats[0]!.photos.map((p) => p.photoId);
    const bIds = batch.cats[1]!.photos.map((p) => p.photoId);
    await hideEvent(aIds[0]!);
    await removeCat(a.batchCatId);
    expect(await removedState(aIds)).toEqual([true]);
    const [kept] = await db.select({ data: photosTable.data }).from(photosTable).where(eq(photosTable.id, aIds[0]!));
    expect(kept!.data).toBeNull();
    await hideEvent(bIds[0]!);
    await abandonBatch(id);
    expect(await getBatch(id)).toBeNull();
    expect(await removedState(bIds)).toEqual([true]);

    const stale = await historyBatch();
    const s = await addCat(stale, [await jpeg(43)]);
    if (!s.ok) throw new Error(s.reason);
    const sIds = (await getBatch(stale))!.cats[0]!.photos.map((p) => p.photoId);
    await hideEvent(sIds[0]!);
    await db.update(vetBatchesTable).set({ updatedAt: new Date(Date.now() - (BATCH_KEEP_DAYS * day + 60_000)) }).where(eq(vetBatchesTable.id, stale));
    expect((await removeStaleBatches()).removed).toBeGreaterThanOrEqual(1);
    expect(await getBatch(stale)).toBeNull();
    expect(await removedState(sIds)).toEqual([true]);
  });

  it("a sweep with one failing batch still removes the others", async () => {
    const day = 24 * 3600 * 1000;
    const bad = await newBatch();
    const good = await newBatch();
    const bc = await addCat(bad, [await jpeg(51)]);
    const gc = await addCat(good, [await jpeg(52)]);
    if (!bc.ok || !gc.ok) throw new Error("add failed");
    const badIds = (await getBatch(bad))!.cats[0]!.photos.map((p) => p.photoId);
    const goodIds = (await getBatch(good))!.cats[0]!.photos.map((p) => p.photoId);
    // A kept-visit link on the bad batch's photo blocks deleting the photo (FK).
    const cat = await seedCat(null);
    await keepPhoto(badIds[0]!, cat.id);
    const old = new Date(Date.now() - (BATCH_KEEP_DAYS * day + 60_000));
    await db.update(vetBatchesTable).set({ updatedAt: old }).where(inArray(vetBatchesTable.id, [bad, good]));
    expect((await removeStaleBatches()).removed).toBeGreaterThanOrEqual(1);
    expect(await getBatch(good)).toBeNull();
    expect(await photoRows(goodIds)).toEqual([]);
    expect(await getBatch(bad)).not.toBeNull();
    expect((await photoRows(badIds)).length).toBe(1);
  });
});
