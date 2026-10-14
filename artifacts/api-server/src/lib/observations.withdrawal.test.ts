import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, catsTable, observationsTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { writeObservation, WITHDRAWN } from "./observations";
import { resolveLifeStatus } from "./resolve";

// A life_status withdrawal (claiming-a-cat.md §6; data spine §3.2, §10.1):
// it supersedes an owner's `homed` and asserts nothing of its own.
//
// observations is append-only — nothing here deletes an observation. Cleanup
// removes only this file's cats (observations.catId has no FK, and the
// whole database is thrown away at the end of the run).
const NAME_PREFIX = "VitestWithdrawal";
let counter = 0;

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function cat() {
  counter += 1;
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${counter}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.94,
      discovererDeviceId: "dev-w",
    })
    .returning();
  return c!;
}

// Relative dates, so the public 30-day clamp never moves them whatever day
// the suite runs.
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function teamStatus(catId: number, status: string, at: Date) {
  return writeObservation(db, {
    catId,
    kind: "life_status",
    value: { status },
    accountId: "system:legacy-backfill",
    roleAtTime: "staff",
    observedAt: at,
  });
}

async function ownerHomed(catId: number, at: Date) {
  return writeObservation(db, {
    catId,
    kind: "life_status",
    value: { status: "homed" },
    deviceId: "dev-w",
    roleAtTime: "public",
    authorityScope: "owner_of_this_cat",
    observedAt: at,
  });
}

function withdraw(catId: number, supersedesId: number | null | undefined, at = daysAgo(1)) {
  return writeObservation(db, {
    catId,
    kind: "life_status",
    value: WITHDRAWN,
    deviceId: "dev-w",
    roleAtTime: "public",
    authorityScope: "owner_of_this_cat",
    observedAt: at,
    supersedesId,
    supersedeReason: "owner let go",
  });
}

async function rowsFor(catId: number) {
  return db.select().from(observationsTable).where(eq(observationsTable.catId, catId));
}

describe("life_status withdrawal", () => {
  it("withdraws an owner's homed, so the status falls back to what stood before", async () => {
    const c = await cat();
    await teamStatus(c.id, "in_care", daysAgo(5));
    const homed = await ownerHomed(c.id, daysAgo(4));
    const w = await withdraw(c.id, homed.id, daysAgo(3));
    expect(w.value).toEqual({ withdrawn: true });
    expect(w.supersedesId).toBe(homed.id);
    expect(resolveLifeStatus(await rowsFor(c.id), null, new Date()).value).toBe("in_care");
  });

  it("asserts nothing: with no earlier statement the cat is back to the untouched default", async () => {
    const c = await cat();
    const homed = await ownerHomed(c.id, daysAgo(4));
    await withdraw(c.id, homed.id, daysAgo(3));
    const resolved = resolveLifeStatus(await rowsFor(c.id), null, new Date());
    expect(resolved.value).toBe("street");
    expect(resolved.confidence).toBe("unknown");
    expect(resolved.supportingObservationIds).toEqual([]);
  });

  it("refuses a withdrawal with nothing to supersede", async () => {
    const c = await cat();
    await expect(withdraw(c.id, undefined)).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
    await expect(withdraw(c.id, null)).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
  });

  it("refuses a withdrawal pointing at a row that does not exist", async () => {
    const c = await cat();
    await expect(withdraw(c.id, 2_000_000_000)).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
  });

  it("refuses withdrawing anything but a homed statement", async () => {
    const c = await cat();
    const street = await teamStatus(c.id, "street", daysAgo(5));
    await expect(withdraw(c.id, street.id)).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
  });

  it("refuses withdrawing a row of another kind", async () => {
    const c = await cat();
    const ster = await writeObservation(db, {
      catId: c.id,
      kind: "sterilised",
      value: { sterilised: true },
      accountId: "system:legacy-backfill",
      roleAtTime: "staff",
      observedAt: daysAgo(5),
    });
    await expect(withdraw(c.id, ster.id)).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
    // A row of another kind whose value happens to carry status "homed" is
    // still not a homed statement — the kind is what counts.
    const lookalike = await writeObservation(db, {
      catId: c.id,
      kind: "note",
      value: { text: "lives with us", status: "homed" },
      accountId: "system:legacy-backfill",
      roleAtTime: "staff",
      observedAt: daysAgo(5),
    });
    await expect(withdraw(c.id, lookalike.id)).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
  });

  it("refuses withdrawing another cat's homed", async () => {
    const mine = await cat();
    const theirs = await cat();
    const theirHomed = await ownerHomed(theirs.id, daysAgo(4));
    await expect(withdraw(mine.id, theirHomed.id)).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
    expect(await rowsFor(mine.id)).toHaveLength(0);
  });

  it("refuses withdrawing a homed that is already withdrawn", async () => {
    const c = await cat();
    const homed = await ownerHomed(c.id, daysAgo(4));
    await withdraw(c.id, homed.id, daysAgo(3));
    await expect(withdraw(c.id, homed.id, daysAgo(2))).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
    expect((await rowsFor(c.id)).filter((o) => o.supersedesId === homed.id)).toHaveLength(1);
  });

  it("refuses withdrawing a homed the team has already superseded", async () => {
    const c = await cat();
    const homed = await ownerHomed(c.id, daysAgo(4));
    await writeObservation(db, {
      catId: c.id,
      kind: "life_status",
      value: { status: "street" },
      accountId: "system:legacy-backfill",
      roleAtTime: "staff",
      observedAt: daysAgo(3),
      supersedesId: homed.id,
      supersedeReason: "team correction",
    });
    await expect(withdraw(c.id, homed.id, daysAgo(2))).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
  });

  it("does not accept { withdrawn: true } on any other kind", async () => {
    const c = await cat();
    const homed = await ownerHomed(c.id, daysAgo(4));
    await expect(
      writeObservation(db, {
        catId: c.id,
        kind: "coat",
        value: WITHDRAWN,
        deviceId: "dev-w",
        roleAtTime: "public",
        observedAt: daysAgo(1),
        supersedesId: homed.id,
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
  });

  it("does not treat a withdrawal with extra fields, or a non-true flag, as a withdrawal", async () => {
    const c = await cat();
    const homed = await ownerHomed(c.id, daysAgo(4));
    for (const value of [{ withdrawn: true, note: "x" }, { withdrawn: "true" }, { withdrawn: false }]) {
      await expect(
        writeObservation(db, {
          catId: c.id,
          kind: "life_status",
          value,
          deviceId: "dev-w",
          roleAtTime: "public",
          observedAt: daysAgo(1),
          supersedesId: homed.id,
        }),
      ).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
    }
  });

  it("leaves ordinary life_status writes, superseding or not, unaffected", async () => {
    const c = await cat();
    const street = await teamStatus(c.id, "street", daysAgo(5));
    const homed = await ownerHomed(c.id, daysAgo(4));
    const inCare = await writeObservation(db, {
      catId: c.id,
      kind: "life_status",
      value: { status: "in_care" },
      accountId: "system:legacy-backfill",
      roleAtTime: "staff",
      observedAt: daysAgo(3),
      supersedesId: street.id,
    });
    expect(homed.value).toEqual({ status: "homed" });
    expect(inCare.supersedesId).toBe(street.id);
    expect(resolveLifeStatus(await rowsFor(c.id), null, new Date()).value).toBe("in_care");
  });
});
