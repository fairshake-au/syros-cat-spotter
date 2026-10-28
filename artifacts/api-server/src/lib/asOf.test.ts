import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, catsTable, catIdentityTable, observationsTable, sightingsTable, type Observation } from "@workspace/db";
import { like } from "drizzle-orm";
import { loadCatRecords, resolveAt } from "./observations";
import { mergeKeepingSightings } from "../test/merges";
import { resolveCat } from "./resolve";
import { currentColonyOf } from "./colonyMembership";
import { loadTeamCats } from "./teamCatList";
import { deleteTestSightings } from "../test/sightings";

// SYC-396 PR 3.0, Task 3.0.3 (plan Decision 10): records as they stood at a
// moment. "As of" means "entered by then": every observation, sighting, cat
// and merge with `createdAt > asOf` is left out BEFORE supersession is
// worked out. Rows here are inserted with chosen `createdAt`s, which only a
// test does (observations are append-only, so these stay; every assertion is
// on this file's own cats).

const NAME_PREFIX = "VitestAsOf";
const DEVICE = `vitest-asof-${Date.now()}`;
let counter = 0;

async function cleanup() {
  // cat_identity is append-only: this file's merge rows stay, naming only
  // its own (deleted) cats, and the database is thrown away after the run.
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  await deleteTestSightings(like(sightingsTable.deviceId, "vitest-asof-%"));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

const day = (d: number, h = 9) => new Date(Date.UTC(2026, 9, d, h));

async function catCreated(at: Date) {
  counter += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${counter}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: DEVICE,
      createdAt: at,
    })
    .returning();
  return cat!;
}

/** A team row entered at `entered` about `observed`. */
async function row(
  catId: number,
  kind: string,
  value: unknown,
  entered: Date,
  extra: Partial<typeof observationsTable.$inferInsert> = {},
): Promise<Observation> {
  const [o] = await db
    .insert(observationsTable)
    .values({
      catId,
      kind,
      value: value as object,
      accountId: "vitest-asof-staff",
      roleAtTime: "staff",
      observedAt: extra.observedAt ?? entered,
      createdAt: entered,
      ...extra,
    })
    .returning();
  return o!;
}

async function sighting(catId: number, entered: Date) {
  await db.insert(sightingsTable).values({
    catId,
    deviceId: DEVICE,
    photoId: 1,
    lat: 37.44,
    lng: 24.9,
    status: "resolved",
    createdAt: entered,
  });
}

async function sterilisedAsOf(catId: number, asOf: Date) {
  const r = (await loadCatRecords([catId], db, { asOf })).get(catId);
  return r ? resolveCat(r.observations, r.evidenceOfLife, asOf).sterilised.value : undefined;
}

describe("loadCatRecords as of a moment", () => {
  it("a cat sterilised on 10 Oct and corrected on 15 Oct reads sterilised as of 12 Oct, not as of 16 Oct", async () => {
    const cat = await catCreated(day(1));
    const yes = await row(cat.id, "sterilised", { sterilised: true }, day(10));
    await row(cat.id, "sterilised", { sterilised: false }, day(15), { supersedesId: yes.id });
    expect(await sterilisedAsOf(cat.id, day(12))).toBe(true);
    expect(await sterilisedAsOf(cat.id, day(16))).toBe(false);
  });

  it("a statement entered on 15 Oct with an operation date of 1 Oct is absent as of 12 Oct", async () => {
    const cat = await catCreated(day(1));
    await row(cat.id, "sterilised", { sterilised: true }, day(15), { observedAt: day(1) });
    expect(await sterilisedAsOf(cat.id, day(12))).toBeNull();
    expect(await sterilisedAsOf(cat.id, day(16))).toBe(true);
  });

  it("a cat created on 14 Oct is absent as of 12 Oct", async () => {
    const cat = await catCreated(day(14));
    expect((await loadCatRecords([cat.id], db, { asOf: day(12) })).has(cat.id)).toBe(false);
    expect((await loadCatRecords([cat.id], db, { asOf: day(15) })).has(cat.id)).toBe(true);
  });

  it("evidence of life as of 12 Oct ignores a sighting from 13 Oct", async () => {
    const cat = await catCreated(day(1));
    await sighting(cat.id, day(5));
    await sighting(cat.id, day(13));
    const asOf12 = (await loadCatRecords([cat.id], db, { asOf: day(12) })).get(cat.id)!;
    expect(asOf12.evidenceOfLife).toMatchObject({ source: "sighting", at: day(5), lastSightingAt: day(5) });
    const now = (await loadCatRecords([cat.id])).get(cat.id)!;
    expect(now.evidenceOfLife).toMatchObject({ at: day(13), lastSightingAt: day(13) });
  });

  it("a correction entered after the moment doesn't stand the earlier row down", async () => {
    const cat = await catCreated(day(1));
    const report = await row(cat.id, "welfare_report", { severity: "attention", isLitter: false, reportId: 1 }, day(8));
    const other = await catCreated(day(1));
    // Re-tied to another cat on 14 Oct: it no longer says this cat was alive, from then on.
    await row(other.id, "welfare_report", { severity: "attention", isLitter: false, reportId: 1 }, day(14), {
      supersedesId: report.id,
    });
    const asOf12 = (await loadCatRecords([cat.id], db, { asOf: day(12) })).get(cat.id)!;
    expect(asOf12.evidenceOfLife).toMatchObject({ source: "welfare_report", at: day(8) });
    const asOf15 = (await loadCatRecords([cat.id], db, { asOf: day(15) })).get(cat.id)!;
    expect(asOf15.evidenceOfLife).toMatchObject({ source: "created" });
  });

  it("with no asOf, the output is what it was: the same as asOf far in the future, with or without history", async () => {
    const cat = await catCreated(day(1));
    const yes = await row(cat.id, "sterilised", { sterilised: true }, day(10));
    await row(cat.id, "sterilised", { sterilised: false }, day(15), { supersedesId: yes.id });
    await sighting(cat.id, day(13));
    const plain = await loadCatRecords([cat.id]);
    const far = await loadCatRecords([cat.id], db, { asOf: new Date("2999-01-01") });
    const hist = await loadCatRecords([cat.id], db, { withHistory: true });
    expect(far).toEqual(plain);
    const { history, ...rest } = hist.get(cat.id)!;
    expect(rest).toEqual(plain.get(cat.id));
    expect(history).toBeDefined();
  });
});

describe("currentColonyOf as of a moment", () => {
  it("a cat moved from colony A to B on 15 Oct is in A as of 12 Oct", async () => {
    const cat = await catCreated(day(1));
    await row(cat.id, "colony", { colonyId: 910_001 }, day(10));
    await row(cat.id, "colony", { colonyId: 910_002 }, day(15));
    expect((await currentColonyOf([cat.id], db, { asOf: day(12) })).get(cat.id)).toBe(910_001);
    expect((await currentColonyOf([cat.id], db, { asOf: day(16) })).get(cat.id)).toBe(910_002);
    expect((await currentColonyOf([cat.id])).get(cat.id)).toBe(910_002);
    // Before anything put it anywhere: in no colony.
    expect((await currentColonyOf([cat.id], db, { asOf: day(9) })).has(cat.id)).toBe(false);
  });

  it("a Mark wrong entered after the moment doesn't count yet", async () => {
    const cat = await catCreated(day(1));
    const putIn = await row(cat.id, "colony", { colonyId: 910_003 }, day(10));
    await row(cat.id, "colony", { colonyId: null }, day(15), { supersedesId: putIn.id });
    expect((await currentColonyOf([cat.id], db, { asOf: day(12) })).get(cat.id)).toBe(910_003);
    expect((await currentColonyOf([cat.id], db, { asOf: day(16) })).has(cat.id)).toBe(false);
  });
});

describe("loadTeamCats as of a moment", () => {
  it("leaves out a cat created later, and reads sightings, records and colonies as they stood", async () => {
    const early = await catCreated(day(1));
    const late = await catCreated(day(14));
    const yes = await row(early.id, "sterilised", { sterilised: true }, day(10));
    await row(early.id, "sterilised", { sterilised: false }, day(15), { supersedesId: yes.id });
    await row(early.id, "colony", { colonyId: 910_011 }, day(10));
    await row(early.id, "colony", { colonyId: 910_012 }, day(15));
    await sighting(early.id, day(5));
    await sighting(early.id, day(13));

    const asOf12 = await loadTeamCats(undefined, { asOf: day(12) });
    expect(asOf12.some((c) => c.id === late.id)).toBe(false);
    const then = asOf12.find((c) => c.id === early.id)!;
    expect(then).toMatchObject({ colonyId: 910_011, lastSeenAt: day(5) });
    expect(then.snapshot.sterilised.value).toBe(true);

    const today = await loadTeamCats();
    expect(today.some((c) => c.id === late.id)).toBe(true);
    const nowRow = today.find((c) => c.id === early.id)!;
    expect(nowRow).toMatchObject({ colonyId: 910_012, lastSeenAt: day(13) });
    expect(nowRow.snapshot.sterilised.value).toBe(false);
  });

  it("with asOf and no now, resolves as of the moment (a cat last seen long before is presumed deceased only later)", async () => {
    const cat = await catCreated(day(1));
    await sighting(cat.id, day(2));
    const then = (await loadTeamCats(undefined, { asOf: day(12) })).find((c) => c.id === cat.id)!;
    expect(then.snapshot.presumedDeceased).toBe(false);
    const later = (await loadTeamCats(new Date("2030-01-01"), { asOf: day(12) })).find((c) => c.id === cat.id)!;
    expect(later.snapshot.presumedDeceased).toBe(true);
  });
});

describe("resolveAt", () => {
  it("equals loadCatRecords as of T then resolveCat, for 50 random T", async () => {
    // A small history with every ingredient: a correction, a late entry
    // with an early date, sightings, a re-tied welfare report, a new cat.
    const a = await catCreated(day(1));
    const yes = await row(a.id, "sterilised", { sterilised: true }, day(4));
    await row(a.id, "sterilised", { sterilised: false }, day(9), { supersedesId: yes.id });
    await row(a.id, "life_status", { status: "deceased" }, day(11));
    await sighting(a.id, day(6));
    await sighting(a.id, day(13));
    const b = await catCreated(day(7));
    await row(b.id, "sterilised", { sterilised: true }, day(14), { observedAt: day(2) });
    const report = await row(b.id, "welfare_report", { severity: "urgent", isLitter: true, reportId: 2 }, day(8));
    await row(a.id, "welfare_report", { severity: "urgent", isLitter: true, reportId: 2 }, day(12), {
      supersedesId: report.id,
    });
    const ids = [a.id, b.id];
    const loaded = await loadCatRecords(ids, db, { withHistory: true });

    let seed = 3;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const from = day(1, 0).getTime();
    const to = day(16, 0).getTime();
    for (let i = 0; i < 50; i++) {
      const T = new Date(from + Math.floor(rand() * (to - from)));
      const now = new Date(T.getTime() + Math.floor(rand() * 40 * 30 * 86_400_000));
      const asOf = await loadCatRecords(ids, db, { asOf: T });
      for (const id of ids) {
        const r = asOf.get(id);
        const expected = r ? resolveCat(r.observations, r.evidenceOfLife, now) : null;
        expect(resolveAt(loaded.get(id)!, T, now)).toEqual(expected);
      }
    }
  });

  it("agrees with loadCatRecords(asOf) across a merge, and a merge undone (review F4)", async () => {
    // A ← B merged on 5 Oct. C merged into D on 5 Oct, undone on 8 Oct: the
    // undo row is C → C. Nothing in the app writes cat_identity yet (SYC-59).
    const a = await catCreated(day(1));
    const b = await catCreated(day(1));
    const c = await catCreated(day(1));
    const d = await catCreated(day(1));
    await row(b.id, "sterilised", { sterilised: true }, day(2));
    await row(c.id, "sterilised", { sterilised: true }, day(2));
    await sighting(b.id, day(3));
    await mergeKeepingSightings({ catId: b.id, canonicalCatId: a.id, createdBy: "vitest-asof", createdAt: day(5) });
    const [merge] = await db
      .insert(catIdentityTable)
      .values({ catId: c.id, canonicalCatId: d.id, createdBy: "vitest-asof", createdAt: day(5) })
      .returning();
    await db.insert(catIdentityTable).values({
      catId: c.id,
      canonicalCatId: c.id,
      createdBy: "vitest-asof",
      supersedesId: merge!.id,
      createdAt: day(8),
    });
    const ids = [a.id, c.id];
    const loaded = await loadCatRecords(ids, db, { withHistory: true });
    for (const T of [day(4), day(6), day(9), day(12)]) {
      const asOf = await loadCatRecords(ids, db, { asOf: T });
      for (const id of ids) {
        const r = asOf.get(id)!;
        expect(resolveAt(loaded.get(id)!, T, day(20))).toEqual(resolveCat(r.observations, r.evidenceOfLife, day(20)));
      }
    }
    // A takes in B's sterilisation from the merge on.
    expect((await sterilisedAsOf(a.id, day(4)))).toBeNull();
    expect((await sterilisedAsOf(a.id, day(6)))).toBe(true);
    // C's own rows count once, before and after its undone merge.
    expect((await loadCatRecords([c.id])).get(c.id)!.observations).toHaveLength(1);
    expect(await sterilisedAsOf(c.id, day(6))).toBe(true);
  });

  it("refuses records loaded without history", async () => {
    const cat = await catCreated(day(1));
    const r = (await loadCatRecords([cat.id])).get(cat.id)!;
    expect(() => resolveAt(r, day(5), day(5))).toThrow(/withHistory/);
  });
});
