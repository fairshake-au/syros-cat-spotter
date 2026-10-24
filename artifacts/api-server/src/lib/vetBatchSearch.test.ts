import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addPerson, catsTable, db, photosTable, pool, vetBatchesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("./matching", () => ({ matchCatPhoto: vi.fn() }));

import { matchCatPhoto, type CandidateInput } from "./matching";
import { addCat, createBatch, getBatch, updateCat } from "./vetBatches";
import { searchBatchCat } from "./vetBatchSearch";
import {
  _resetBatchFindLimitsForTests,
  _resetFindLimitsForTests,
  BATCH_FIND_PERSON_LIMIT,
  batchFindPersonHits,
  checkBatchFindLimits,
  findPersonHits,
} from "../middlewares/rateLimit";
import { removeTestPerson } from "../test/removeTestPerson";
import { newColony, putInColony } from "../test/roleKit";
import { cleanUpVetPhotos } from "../test/vetPhotoKit";

// SYC-677 Task 5: matching a batch cat by photo. The matching service is
// mocked (no real call); the limits are filled through the limiter.

const RUN = randomBytes(3).toString("hex");
const email = `vitest-vetsearch-${RUN}@example.com`;
const matchMock = vi.mocked(matchCatPhoto);
let person: { id: string; scopes: { role: string; colonyId: number | null }[] };
let colony: number;
const catIds: number[] = [];
const batches: number[] = [];

const jpeg = (r: number) =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g: 90, b: 60 } } }).jpeg().toBuffer();

async function newBatchWithCat(): Promise<{ batchId: number; batchCatId: number }> {
  const batchId = await createBatch(person, { colonyId: colony });
  batches.push(batchId);
  const added = await addCat(batchId, [await jpeg(200), await jpeg(30)]);
  if (!added.ok) throw new Error("addCat failed");
  return { batchId, batchCatId: added.batchCatId };
}

beforeAll(async () => {
  const p = await addPerson({ email, name: "Vt search", addedBy: "cli:vitest", roles: ["staff"] });
  person = { id: p.id, scopes: [{ role: "staff", colonyId: null }] };
  colony = await newColony("batch search");
  for (let i = 0; i < 3; i++) {
    const [ph] = await db
      .insert(photosTable)
      .values({ data: (await jpeg(10 + i * 40)).toString("base64"), mime: "image/jpeg" })
      .returning({ id: photosTable.id });
    const [c] = await db
      .insert(catsTable)
      .values({ name: `vt-bsearch-${RUN}-${i}`, primaryPhotoId: ph!.id, lat: 37.4447, lng: 24.9417, discovererDeviceId: `vt-bsearch-${RUN}` })
      .returning({ id: catsTable.id });
    await putInColony(c!.id, colony);
    catIds.push(c!.id);
  }
});

beforeEach(async () => {
  matchMock.mockReset();
  matchMock.mockImplementation(async (_p, candidates: CandidateInput[]) => ({
    isCatPhoto: true,
    matches: candidates.map((c, i) => ({ catId: c.catId, confidence: [0.9123456, 0.6, 0.2][i] ?? 0.1, reasoning: `same ear ${i}` })),
  }));
  await _resetBatchFindLimitsForTests();
  await _resetFindLimitsForTests();
});

afterAll(async () => {
  await _resetBatchFindLimitsForTests();
  await _resetFindLimitsForTests();
  await cleanUpVetPhotos();
  if (batches.length) await db.delete(vetBatchesTable).where(inArray(vetBatchesTable.id, batches));
  await db.delete(catsTable).where(inArray(catsTable.id, catIds));
  await removeTestPerson(email);
  await pool.end();
});

describe("searchBatchCat", () => {
  it("finds matches in the batch's colony and keeps them on the cat, with no photo bytes or position", async () => {
    const { batchId, batchCatId } = await newBatchWithCat();
    const out = await searchBatchCat(person, batchCatId, "batch");
    expect(out.kind).toBe("results");
    const cat = (await getBatch(batchId))!.cats[0]!;
    expect(cat.suggestions).toHaveLength(3);
    expect(new Set(cat.suggestions!.map((s) => s.catId))).toEqual(new Set(catIds));
    const json = JSON.stringify(cat.suggestions);
    expect(json).not.toMatch(/\d+\.\d{4,}/);
    expect(json).not.toMatch(/\/9j\/|"data"|"preview"|"lat"|"lng"|"position"/);
    expect(cat.photos).toHaveLength(2);
  });

  it("searches the colony or area it is told to, not only the batch's", async () => {
    const { batchCatId } = await newBatchWithCat();
    const other = await newColony("batch search empty");
    const out = await searchBatchCat(person, batchCatId, { colonyId: other });
    expect(out.kind).toBe("none_to_compare");
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("the 61st search by a person is refused, stores nothing, and keeps the cat's photos and fields", async () => {
    const { batchId, batchCatId } = await newBatchWithCat();
    await updateCat(batchCatId, { treatedNote: "kept note", did: ["sterilised"] });
    for (let i = 0; i < BATCH_FIND_PERSON_LIMIT; i++) await checkBatchFindLimits(person.id);
    const before = (await getBatch(batchId))!.cats[0]!;
    const out = await searchBatchCat(person, batchCatId, "batch");
    expect(out).toMatchObject({ kind: "refused", reason: "person" });
    expect(matchMock).not.toHaveBeenCalled();
    const after = (await getBatch(batchId))!.cats[0]!;
    expect(after.suggestions).toBeNull();
    expect(after.photos).toEqual(before.photos);
    expect(after).toMatchObject({ treatedNote: "kept note", did: ["sterilised"] });
  });

  it("a refused search keeps the suggestions an earlier search stored", async () => {
    const { batchId, batchCatId } = await newBatchWithCat();
    await searchBatchCat(person, batchCatId, "batch");
    for (let i = 0; i < BATCH_FIND_PERSON_LIMIT; i++) await checkBatchFindLimits(person.id);
    await searchBatchCat(person, batchCatId, "batch");
    expect((await getBatch(batchId))!.cats[0]!.suggestions).toHaveLength(3);
  });

  it("caps a stored reasoning at 300 characters", async () => {
    const { batchId, batchCatId } = await newBatchWithCat();
    matchMock.mockImplementation(async (_p, candidates: CandidateInput[]) => ({
      isCatPhoto: true,
      matches: candidates.map((c) => ({ catId: c.catId, confidence: 0.7, reasoning: "x".repeat(900) })),
    }));
    await searchBatchCat(person, batchCatId, "batch");
    expect((await getBatch(batchId))!.cats[0]!.suggestions!.every((s) => s.reasoning.length <= 300)).toBe(true);
  });

  it("a batch search doesn't touch the single-photo counters", async () => {
    const { batchCatId } = await newBatchWithCat();
    await searchBatchCat(person, batchCatId, "batch");
    expect(await findPersonHits(person.id)).toBe(0);
  });

  it("a saved batch's cat keeps no new suggestions", async () => {
    const { batchId, batchCatId } = await newBatchWithCat();
    await db.update(vetBatchesTable).set({ savedAt: new Date() }).where(eq(vetBatchesTable.id, batchId));
    await expect(searchBatchCat(person, batchCatId, "batch")).rejects.toThrow(/saved/);
    expect(matchMock).not.toHaveBeenCalled();
    expect(await batchFindPersonHits(person.id)).toBe(0);
    expect((await getBatch(batchId))!.cats[0]!.suggestions).toBeNull();
  });
});
