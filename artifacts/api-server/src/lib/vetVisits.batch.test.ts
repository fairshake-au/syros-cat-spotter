import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { addPerson, catsTable, db, observationsTable, photosTable, pool, vetBatchesTable, vetVisitPhotosTable } from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import { getGuidance } from "@workspace/welfare-guidance";
import { commitStatement } from "./commitStatement";
import { loadCatRecords } from "./observations";
import { resolveSterilised } from "./resolve";
import { listGuardianChanges } from "./guardianChanges";
import { addCat, createBatch, getBatch, updateCat, updateShared } from "./vetBatches";
import { ALREADY_SAVED, logVetVisit, saveBatch } from "./vetVisits";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-677 Task 4: saving a batch, one visit per cat, in ONE transaction.
// observations is append-only and the test database is shared, so every
// assertion is on this run's own fresh cats, batches and photos.

// The rollback proof: the Nth `vet_visit` write of a save throws, mid-transaction.
const failOn = vi.hoisted(() => ({ visitN: 0, seen: 0 }));
vi.mock("./commitStatement", async (importOriginal) => {
  const real = await importOriginal<typeof import("./commitStatement")>();
  return {
    ...real,
    commitStatement: (...args: Parameters<typeof real.commitStatement>) => {
      if (args[1].kind === "vet_visit" && failOn.visitN > 0 && ++failOn.seen === failOn.visitN) {
        throw new Error("vitest: this write fails");
      }
      return real.commitStatement(...args);
    },
  };
});

const RUN = randomBytes(3).toString("hex");
const NAME_PREFIX = `VitestVetBatch${RUN}`;
const email = `vitest-vetbatchsave-${RUN}@example.com`;
const NOW = new Date("2026-10-24T10:00:00Z");
const CLINIC = getGuidance("en").vets[0]!.id;
// Who saves: an account id only, so the batch's author (a real person row,
// which vet_batches names) has no observations and can be removed afterwards.
const STAFF = { id: `vitest-vb-staff-${RUN}`, scopes: [{ role: "staff", colonyId: null }] };
let person: { id: string; scopes: { role: string; colonyId: number | null }[] };
let n = 0;
const batches: number[] = [];
const photos: number[] = [];
const cats: number[] = [];

async function jpeg(seed: number): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: { r: seed % 256, g: 90, b: 140 } } })
    .jpeg()
    .toBuffer();
}

async function insertCat(label = "cat") {
  n += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}-${label}-${n}`, description: "", primaryPhotoId: 0, lat: 37.44, lng: 24.9, discovererDeviceId: "vitest-vb" })
    .returning();
  cats.push(cat!.id);
  return { id: cat!.id, name: cat!.name };
}

type Entry = {
  catId: number | null;
  photos?: number;
  confirmed?: boolean;
  did?: string[];
  alsoSameDay?: boolean;
  newCat?: { name: string | null; description: string };
};

/** A batch dated 24 Oct 2026 at this run's clinic, with these entries; its id and entry ids. */
async function makeBatch(entries: Entry[]) {
  const id = await createBatch(person, {}, NOW);
  batches.push(id);
  const b = await getBatch(id);
  await updateShared(id, { ...b!.shared, clinicId: CLINIC });
  const rows: number[] = [];
  for (const [i, e] of entries.entries()) {
    const bufs = await Promise.all(Array.from({ length: e.photos ?? 1 }, (_, k) => jpeg(i * 10 + k)));
    const added = await addCat(id, bufs);
    if (!added.ok) throw new Error(`addCat: ${added.reason}`);
    rows.push(added.batchCatId);
    await updateCat(added.batchCatId, {
      catId: e.catId,
      ...(e.newCat ? { newCat: e.newCat } : {}),
      confirmed: e.confirmed ?? true,
      did: e.did ?? ["sterilised"],
      alsoSameDay: e.alsoSameDay ?? false,
    });
  }
  const read = await getBatch(id);
  for (const c of read!.cats) photos.push(...c.photos.map((p) => p.photoId));
  return { id, rows, batch: read! };
}

const visitRows = (catIds: number[]) =>
  db
    .select()
    .from(observationsTable)
    .where(inArray(observationsTable.catId, catIds))
    .then((r) => r.filter((o) => o.kind === "vet_visit"));

const keptFor = (photoIds: number[]) =>
  photoIds.length ? db.select().from(vetVisitPhotosTable).where(inArray(vetVisitPhotosTable.photoId, photoIds)) : Promise.resolve([]);

const savedAtOf = async (id: number) =>
  (await db.select({ savedAt: vetBatchesTable.savedAt }).from(vetBatchesTable).where(eq(vetBatchesTable.id, id)))[0]!.savedAt;

const allPhotos = (batch: { cats: { photos: { photoId: number }[] }[] }) => batch.cats.flatMap((c) => c.photos.map((p) => p.photoId));

beforeAll(async () => {
  const p = await addPerson({ email, name: "Vt batch save", addedBy: "cli:vitest", roles: ["staff"] });
  person = { id: p.id, scopes: [{ role: "staff", colonyId: null }] };
});
beforeEach(() => {
  failOn.visitN = 0;
  failOn.seen = 0;
});
afterAll(async () => {
  if (cats.length) await db.delete(vetVisitPhotosTable).where(inArray(vetVisitPhotosTable.catId, cats));
  if (batches.length) await db.delete(vetBatchesTable).where(inArray(vetBatchesTable.id, batches));
  if (photos.length) await db.delete(photosTable).where(inArray(photosTable.id, photos));
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  await removeTestPerson(email);
  await pool.end();
});

describe("saveBatch", () => {
  it("3 confirmed cats give 3 visits, 5 kept photos and saved_at set", async () => {
    const [a, b, c] = [await insertCat(), await insertCat(), await insertCat()];
    const { id, batch } = await makeBatch([
      { catId: a.id, photos: 2 },
      { catId: b.id, photos: 2 },
      { catId: c.id, photos: 1, did: ["treated"] },
    ]);
    await updateCat(batch.cats[2]!.id, { treatedNote: "ear mites", costEur: "15" });

    const result = await saveBatch(STAFF, id, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visits).toHaveLength(3);
    expect(await visitRows([a.id, b.id, c.id])).toHaveLength(3);
    expect(await keptFor(allPhotos(batch))).toHaveLength(5);
    expect(await savedAtOf(id)).toEqual(NOW);

    // The batch price for a sterilisation, the cat's own cost when typed, and the batch's payer.
    const byCat = new Map((await visitRows([a.id, c.id])).map((o) => [o.catId, o.value as Record<string, unknown>]));
    expect(byCat.get(a.id)).toMatchObject({ did: ["sterilised"], clinicId: CLINIC, costEur: Number(batch.shared.priceEur), paidBy: "syros_cats" });
    expect(byCat.get(c.id)).toMatchObject({ did: ["treated"], treatedNote: "ear mites", costEur: 15 });
  });

  it("R7: after a save, every photo of every batch cat is linked to its cat's visit", async () => {
    const [a, b] = [await insertCat(), await insertCat()];
    const { id, batch } = await makeBatch([
      { catId: a.id, photos: 3 },
      { catId: b.id, photos: 2 },
    ]);
    const result = await saveBatch(STAFF, id, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kept = new Map((await keptFor(allPhotos(batch))).map((k) => [k.photoId, k]));
    for (const [i, entry] of batch.cats.entries()) {
      for (const p of entry.photos) {
        expect(kept.get(p.photoId), `photo ${p.photoId} of entry ${i + 1}`).toMatchObject({
          catId: entry.catId,
          visitId: result.visits[i]!.visitId,
        });
      }
    }
  });

  it("R10: the batch note lands on every visit whose cat has no note; a cat's own note wins", async () => {
    const [a, b, c] = [await insertCat(), await insertCat(), await insertCat()];
    const { id, batch } = await makeBatch([{ catId: a.id }, { catId: b.id }, { catId: c.id }]);
    await updateShared(id, { ...batch.shared, clinicId: CLINIC, note: "Trapped at the harbour" });
    await updateCat(batch.cats[1]!.id, { note: "Bit the vet" });
    await updateCat(batch.cats[2]!.id, { note: "   " });
    expect((await saveBatch(STAFF, id, NOW)).ok).toBe(true);
    const noteOf = new Map((await visitRows([a.id, b.id, c.id])).map((o) => [o.catId, (o.value as { note?: string }).note]));
    expect(noteOf.get(a.id)).toBe("Trapped at the harbour");
    expect(noteOf.get(b.id)).toBe("Bit the vet");
    expect(noteOf.get(c.id)).toBe("Trapped at the harbour");
  });

  it("D8: a guardian's 'not sterilised' is overruled, with the reason 'vet visit on 24 Oct 2026'", async () => {
    const cat = await insertCat();
    const no = await db.transaction((tx) =>
      commitStatement(
        tx,
        {
          catId: cat.id,
          kind: "sterilised",
          value: { sterilised: false },
          accountId: `vitest-vb-guardian-${RUN}`,
          roleAtTime: "guardian",
          authorityScope: "colony:1",
          observedAt: new Date("2026-10-01T12:00:00Z"),
        },
        [],
        NOW,
      ),
    );
    const { id } = await makeBatch([{ catId: cat.id }]);
    const result = await saveBatch(STAFF, id, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visits[0]!.overruled).toEqual([no.id]);
    const record = (await loadCatRecords([cat.id])).get(cat.id);
    expect(resolveSterilised(record?.observations ?? [], []).value).toBe(true);
    const changes = await listGuardianChanges({ limit: 1000 });
    const entry = changes.find((ch) => ch.type === "overruled" && ch.overruledId === no.id);
    expect(entry).toMatchObject({ type: "overruled", reason: "vet visit on 24 Oct 2026" });
  });

  it("an unconfirmed cat saves nothing and is named", async () => {
    const [a, b] = [await insertCat(), await insertCat()];
    const { id, rows, batch } = await makeBatch([{ catId: a.id }, { catId: b.id, confirmed: false }]);
    const result = await saveBatch(STAFF, id, NOW);
    expect(result).toEqual({ ok: false, problems: [{ batchCatId: rows[1], field: "confirmed", words: "Confirm who this cat is." }] });
    expect(await visitRows([a.id, b.id])).toHaveLength(0);
    expect(await keptFor(allPhotos(batch))).toHaveLength(0);
    expect(await savedAtOf(id)).toBeNull();
  });

  it("the same cat twice saves nothing and names both entries", async () => {
    const a = await insertCat("Mimi");
    const other = await insertCat();
    const { id, rows } = await makeBatch([{ catId: a.id }, { catId: other.id }, { catId: a.id }]);
    const result = await saveBatch(STAFF, id, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const words = `${a.name} is in this batch twice: entries 1 and 3.`;
    expect(result.problems).toEqual([
      { batchCatId: rows[0], field: "catId", words },
      { batchCatId: rows[2], field: "catId", words },
    ]);
    expect(await visitRows([a.id, other.id])).toHaveLength(0);
    expect(await savedAtOf(id)).toBeNull();
  });

  it("a same-day visit without also_same_day saves nothing and names the cat; with it, it saves", async () => {
    const mimi = await insertCat("Mimi");
    const other = await insertCat();
    await logVetVisit(STAFF, { catId: mimi.id, date: "2026-10-24", value: { did: ["checked"], clinicId: CLINIC, costEur: null, paidBy: "syros_cats" } }, NOW);
    const { id, rows } = await makeBatch([{ catId: other.id }, { catId: mimi.id }]);

    const refused = await saveBatch(STAFF, id, NOW);
    expect(refused).toEqual({
      ok: false,
      problems: [{ batchCatId: rows[1], field: "alsoSameDay", words: `${mimi.name} already has a vet visit on 24 Oct.` }],
    });
    expect(await visitRows([other.id])).toHaveLength(0);
    expect(await visitRows([mimi.id])).toHaveLength(1);

    await updateCat(rows[1]!, { alsoSameDay: true });
    const saved = await saveBatch(STAFF, id, NOW);
    expect(saved.ok).toBe(true);
    expect(await visitRows([mimi.id])).toHaveLength(2);
    expect(await visitRows([other.id])).toHaveLength(1);
  });

  it("refuses 'Checked only' and a new cat, and saves nothing", async () => {
    const a = await insertCat();
    const b = await insertCat();
    const { id, rows } = await makeBatch([
      { catId: a.id, did: ["checked"] },
      { catId: b.id },
      { catId: null, newCat: { name: null, description: "" } },
    ]);
    const result = await saveBatch(STAFF, id, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toEqual([
      { batchCatId: rows[0], field: "did", words: "Tick Sterilised, Vaccinated or Treated." },
      { batchCatId: rows[2], field: "newCat", words: "New cats arrive in a later update" },
    ]);
    expect(await visitRows([a.id, b.id])).toHaveLength(0);
  });

  it("saving twice, one after the other, gives one set of visits", async () => {
    const [a, b] = [await insertCat(), await insertCat()];
    const { id, batch } = await makeBatch([{ catId: a.id }, { catId: b.id }]);
    expect((await saveBatch(STAFF, id, NOW)).ok).toBe(true);
    expect(await saveBatch(STAFF, id, NOW)).toEqual({
      ok: false,
      problems: [{ batchCatId: null, field: "batch", words: ALREADY_SAVED }],
    });
    expect(ALREADY_SAVED).toBe("This batch was already saved.");
    expect(await visitRows([a.id, b.id])).toHaveLength(2);
    expect(await keptFor(allPhotos(batch))).toHaveLength(2);
  });

  it("two saves started together (Promise.all) give one set of visits; the other is told it was already saved", async () => {
    const [a, b, c] = [await insertCat(), await insertCat(), await insertCat()];
    const { id } = await makeBatch([{ catId: a.id }, { catId: b.id }, { catId: c.id }]);
    const both = await Promise.all([saveBatch(STAFF, id, NOW), saveBatch(STAFF, id, NOW)]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    const loser = both.find((r) => !r.ok);
    expect(loser).toEqual({ ok: false, problems: [{ batchCatId: null, field: "batch", words: "This batch was already saved." }] });
    expect(await visitRows([a.id, b.id, c.id])).toHaveLength(3);
  });

  it("a failure while writing the third visit leaves no visits and no kept photos", async () => {
    const [a, b, c] = [await insertCat(), await insertCat(), await insertCat()];
    const { id, batch } = await makeBatch([
      { catId: a.id, photos: 2 },
      { catId: b.id, photos: 2 },
      { catId: c.id, photos: 1 },
    ]);
    failOn.visitN = 3;
    await expect(saveBatch(STAFF, id, NOW)).rejects.toThrow("vitest: this write fails");
    expect(failOn.seen).toBe(3);
    expect(await visitRows([a.id, b.id, c.id])).toHaveLength(0);
    expect(await keptFor(allPhotos(batch))).toHaveLength(0);
    expect(await savedAtOf(id)).toBeNull();
  });
});
