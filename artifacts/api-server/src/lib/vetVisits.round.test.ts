import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { db, catsTable, observationsTable } from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import { getGuidance } from "@workspace/welfare-guidance";
import { commitStatement } from "./commitStatement";
import { loadCatRecords, ObservationRefused, type VetVisitValue } from "./observations";
import { resolveSterilised } from "./resolve";
import { currentColonyOf } from "./colonyMembership";
import { logRound, ROUND_MAX } from "./vetVisits";

// SYC-396 PR 3.2, Task 3.2.1 (spec §8.5; SYC-621): a whole round's vet
// visits, one per ticked cat, saved together or not at all. observations is
// append-only, so every assertion is on this run's own fresh cats.

const RUN = randomBytes(3).toString("hex");
const NAME_PREFIX = `VitestVetRound${RUN}`;
let n = 0;

const STAFF = { id: `vitest-vr-staff-${RUN}`, scopes: [{ role: "staff", colonyId: null }] };
const GUARDIAN = { id: `vitest-vr-guardian-${RUN}`, scopes: [{ role: "guardian", colonyId: 1 }] };
const NOW = new Date("2026-10-21T10:00:00Z");
const CLINIC = getGuidance("en").vets[0]!.id;
const sterilise: VetVisitValue = { did: ["sterilised"], clinicId: CLINIC, costEur: 60, paidBy: "syros_cats" };

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}
beforeAll(cleanup);
afterAll(cleanup);

async function insertCat() {
  n += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}-${n}`, description: "", primaryPhotoId: 0, lat: 37.44, lng: 24.9, discovererDeviceId: "vitest-vr" })
    .returning();
  return cat!.id;
}

async function placeIn(catId: number, colonyId: number) {
  await db.transaction((tx) =>
    commitStatement(
      tx,
      { catId, kind: "colony", value: { colonyId }, accountId: STAFF.id, roleAtTime: "staff", observedAt: new Date("2026-10-01T12:00:00Z") },
      [],
      NOW,
    ),
  );
}

const visitRows = (catIds: number[]) =>
  db.select().from(observationsTable).where(inArray(observationsTable.catId, catIds)).then((r) => r.filter((o) => o.kind === "vet_visit"));

async function sterilisedOf(catId: number) {
  const record = (await loadCatRecords([catId])).get(catId);
  return resolveSterilised(record?.observations ?? [], []);
}

describe("logRound", () => {
  it("gives each ticked cat its own visit", async () => {
    const cats = [await insertCat(), await insertCat(), await insertCat()];
    const saved = await logRound(STAFF, { colonyId: 1, date: "2026-10-20", visits: cats.map((catId) => ({ catId, value: sterilise })) }, NOW);
    expect(saved).toHaveLength(3);
    expect(new Set(saved.map((s) => s.visitId)).size).toBe(3);
    expect(await visitRows(cats)).toHaveLength(3);
    for (const c of cats) expect((await sterilisedOf(c)).confidence).toBe("confirmed");
  });

  it("saves nothing when one visit is refused (all or nothing)", async () => {
    const cats = [await insertCat(), await insertCat(), await insertCat()];
    // The third names a cat that doesn't exist: refused while the cats are locked, before any write.
    const visits = [...cats.slice(0, 2), 2_000_000_000].map((catId) => ({ catId, value: sterilise }));
    await expect(logRound(STAFF, { colonyId: 1, date: "2026-10-20", visits }, NOW)).rejects.toBeInstanceOf(ObservationRefused);
    expect(await visitRows(cats)).toHaveLength(0);
    // A bad value on the third cat is refused inside the transaction, after two visits were written: nothing is left.
    const bad = [...cats.slice(0, 2).map((catId) => ({ catId, value: sterilise })), { catId: cats[2]!, value: { ...sterilise, clinicId: "" } }];
    await expect(logRound(STAFF, { colonyId: 1, date: "2026-10-20", visits: bad }, NOW)).rejects.toBeInstanceOf(ObservationRefused);
    expect(await visitRows(cats)).toHaveLength(0);
  });

  it("an added cat from another colony gets its visit and stays in its own colony", async () => {
    const mine = await insertCat();
    const theirs = await insertCat();
    await placeIn(mine, 1);
    await placeIn(theirs, 2);
    await logRound(STAFF, { colonyId: 1, date: "2026-10-20", visits: [mine, theirs].map((catId) => ({ catId, value: sterilise })) }, NOW);
    expect(await visitRows([theirs])).toHaveLength(1);
    expect((await currentColonyOf([theirs])).get(theirs)).toBe(2);
    expect((await db.select().from(observationsTable).where(eq(observationsTable.catId, theirs))).filter((o) => o.kind === "colony")).toHaveLength(1);
  });

  it(`refuses more than ${ROUND_MAX} cats, a future date, the same cat twice, and a cat guardian`, async () => {
    const one = await insertCat();
    const many = Array.from({ length: ROUND_MAX + 1 }, (_, i) => ({ catId: 1_900_000_000 + i, value: sterilise }));
    await expect(logRound(STAFF, { colonyId: 1, date: "2026-10-20", visits: many }, NOW)).rejects.toThrow(/Up to 40/);
    await expect(logRound(STAFF, { colonyId: 1, date: "2026-10-22", visits: [{ catId: one, value: sterilise }] }, NOW)).rejects.toThrow(/future/);
    await expect(
      logRound(STAFF, { colonyId: 1, date: "2026-10-20", visits: [{ catId: one, value: sterilise }, { catId: one, value: sterilise }] }, NOW),
    ).rejects.toThrow(/once/);
    await expect(logRound(GUARDIAN, { colonyId: 1, date: "2026-10-20", visits: [{ catId: one, value: sterilise }] }, NOW)).rejects.toThrow(/Not authorised/);
    expect(await visitRows([one])).toHaveLength(0);
  });
});
