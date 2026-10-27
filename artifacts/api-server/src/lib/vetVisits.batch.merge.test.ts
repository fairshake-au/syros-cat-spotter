import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { addPerson, catIdentityTable, catsTable, db, photosTable, pool, vetBatchesTable, vetVisitPhotosTable } from "@workspace/db";
import { inArray, like } from "drizzle-orm";
import { getGuidance } from "@workspace/welfare-guidance";
import { addCat, createBatch, getBatch, updateCat, updateShared } from "./vetBatches";
import { logVetVisit, saveBatch } from "./vetVisits";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-410 PR 1.2, spec test 15 for the batch's same-day check: a visit on a cat
// merged into this one that day is a visit to the same animal. Each phase uses
// a fresh pair (a save writes visits, so it can't be repeated on one pair):
// before the merge the batch saves; with the merge standing it is refused and
// names Agatha; after a merge and its undo it saves again.

const RUN = randomBytes(3).toString("hex");
const NAME_PREFIX = "VitestBatchMerge";
const email = `vitest-batchmerge-${RUN}@example.com`;
const NOW = new Date("2026-10-24T10:00:00Z");
const CLINIC = getGuidance("en").vets[0]!.id;
const LETTERS = "bcdfghjkmpqrvwxz";
let counter = 0;
const tag = () => {
  counter += 1;
  let n = counter;
  let out = "";
  do {
    out = LETTERS[n % 16] + out;
    n = Math.floor(n / 16);
  } while (n > 0);
  return out;
};
let person: { id: string; scopes: { role: string; colonyId: number | null }[] };
const STAFF = { id: `vitest-bm-staff-${RUN}`, scopes: [{ role: "staff", colonyId: null }] };
const batches: number[] = [];
const photos: number[] = [];
const cats: number[] = [];

const jpeg = (seed: number) =>
  sharp({ create: { width: 40, height: 30, channels: 3, background: { r: seed % 256, g: 90, b: 140 } } })
    .jpeg()
    .toBuffer();

async function insertCat(label: string) {
  const [cat] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}${label}${tag()}`, description: "", primaryPhotoId: 0, lat: 37.44, lng: 24.9, discovererDeviceId: "vitest-vb-merge" })
    .returning();
  cats.push(cat!.id);
  return { id: cat!.id, name: cat!.name };
}

beforeAll(async () => {
  const p = await addPerson({ email, name: "Vt batch merge", addedBy: "cli:vitest", roles: ["staff"] });
  person = { id: p.id, scopes: [{ role: "staff", colonyId: null }] };
});
afterAll(async () => {
  if (cats.length) await db.delete(vetVisitPhotosTable).where(inArray(vetVisitPhotosTable.catId, cats));
  if (batches.length) await db.delete(vetBatchesTable).where(inArray(vetBatchesTable.id, batches));
  if (photos.length) await db.delete(photosTable).where(inArray(photosTable.id, photos));
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  await removeTestPerson(email);
  await pool.end();
});

/** A pair where Mimi already has a visit that day, a batch for Agatha, and the save's answer. */
async function saveFor(how: "alone" | "merged" | "merged then undone") {
  const mimi = await insertCat("Mimi");
  const agatha = await insertCat("Agatha");
  await logVetVisit(STAFF, { catId: mimi.id, date: "2026-10-24", value: { did: ["checked"], clinicId: CLINIC, costEur: null, paidBy: "syros_cats" } }, NOW);
  if (how !== "alone") {
    const [m] = await db
      .insert(catIdentityTable)
      .values({ catId: mimi.id, canonicalCatId: agatha.id, reason: "vitest batch merge" })
      .returning({ id: catIdentityTable.id });
    if (how === "merged then undone") {
      await db.insert(catIdentityTable).values({ catId: mimi.id, canonicalCatId: mimi.id, supersedesId: m!.id, reason: "vitest batch merge undo" });
    }
  }
  const id = await createBatch(person, {}, NOW);
  batches.push(id);
  const b = await getBatch(id);
  await updateShared(id, { ...b!.shared, clinicId: CLINIC });
  const added = await addCat(id, [await jpeg(1)]);
  if (!added.ok) throw new Error(`addCat: ${added.reason}`);
  await updateCat(added.batchCatId, { catId: agatha.id, confirmed: true, did: ["sterilised"], alsoSameDay: false });
  for (const c of (await getBatch(id))!.cats) photos.push(...c.photos.map((p) => p.photoId));
  const result = await saveBatch(STAFF, id, NOW);
  return { result, agatha, row: added.batchCatId };
}

describe("saveBatch's same-day check, with a merge", () => {
  it("saves when the other record has no visit that day (the pair isn't merged)", async () => {
    const { result } = await saveFor("alone");
    expect(result.ok).toBe(true);
  });

  it("refuses, naming Agatha, when a cat merged into her already had a visit that day", async () => {
    const { result, agatha, row } = await saveFor("merged");
    expect(result).toEqual({
      ok: false,
      problems: [{ batchCatId: row, field: "alsoSameDay", words: `${agatha.name} already has a vet visit on 24 Oct.` }],
    });
  });

  it("after the merge is undone, the batch saves again", async () => {
    const { result } = await saveFor("merged then undone");
    expect(result.ok).toBe(true);
  });
});
