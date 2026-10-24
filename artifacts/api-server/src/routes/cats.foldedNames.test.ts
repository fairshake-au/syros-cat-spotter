import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  deviceCredentialsTable,
  observationsTable,
} from "@workspace/db";
import { and, eq, ilike, like } from "drizzle-orm";

// SYC-101 (DECISIONS.md Part 2g): a cat's name is taken if another cat has
// the same name once accents, case and final sigma are folded. Registering
// or renaming to such a name answers NAME_TAKEN, naming the cat that has it,
// and writes nothing.

// Lets a test skip the pre-write name check once, so the unique index has to
// decide, as when two people take the same name at the same moment.
const race = vi.hoisted(() => ({ skipPrechecks: 0 }));
vi.mock("../lib/catNames", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/catNames")>();
  return {
    ...actual,
    catNamed: vi.fn(async (name: string) => {
      if (race.skipPrechecks > 0) {
        race.skipPrechecks--;
        return undefined;
      }
      return actual.catNamed(name);
    }),
  };
});

vi.mock("../lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notifications")>();
  return { ...actual, notifyCatFollowers: vi.fn() };
});

import app from "../app";
import { catNamed, isUniqueViolation } from "../lib/catNames";

const PREFIX = "vitest-folded-names-";
const NAME_PREFIX = "VitestFold";
const SECRET = "vitest-folded-names-secret-aaaa";
const owner = `${PREFIX}owner`;

async function cleanup() {
  await db.delete(catsTable).where(ilike(catsTable.name, `${NAME_PREFIX}%`));
  await db
    .delete(deviceCredentialsTable)
    .where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

beforeAll(async () => {
  await cleanup();
  const res = await request(app)
    .get(`/api/profiles/${owner}/username`)
    .set("X-Device-Secret", SECRET);
  expect(res.status).toBe(200);
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function insertCat(name: string, ownerDeviceId: string | null = null) {
  const [cat] = await db
    .insert(catsTable)
    .values({
      name,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: `${PREFIX}discoverer`,
      ownerDeviceId,
    })
    .returning();
  return cat!;
}

async function nameObservations(catId: number) {
  return db
    .select({ value: observationsTable.value })
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, catId), eq(observationsTable.kind, "name")));
}

describe("catNamed (SYC-101)", () => {
  it("finds a cat by its folded name", async () => {
    const mimi = await insertCat(`${NAME_PREFIX} Μιμή`);
    expect((await catNamed(`${NAME_PREFIX.toUpperCase()} ΜΙΜΗ`))?.id).toBe(mimi.id);
    expect((await catNamed(`${NAME_PREFIX} Μιμή`.normalize("NFD")))?.id).toBe(mimi.id);
    expect(await catNamed(`${NAME_PREFIX} Μιμα`)).toBeUndefined();
  });
});

describe("PATCH /api/cats/:id rename with a folded-name clash (SYC-101)", () => {
  it("answers NAME_TAKEN naming the other cat, and changes nothing", async () => {
    const other = await insertCat(`${NAME_PREFIX} Αγάπη`);
    const mine = await insertCat(`${NAME_PREFIX} Ρούλα`, owner);
    const res = await request(app)
      .patch(`/api/cats/${mine.id}`)
      .set("X-Device-Secret", SECRET)
      .send({
        deviceId: owner,
        name: `${NAME_PREFIX.toUpperCase()} ΑΓΑΠΗ`,
        homeDescription: "New home",
      });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "NAME_TAKEN", cat: { id: other.id } });
    const [after] = await db.select().from(catsTable).where(eq(catsTable.id, mine.id));
    expect(after!.name).toBe(`${NAME_PREFIX} Ρούλα`);
    expect(after!.homeDescription).toBeNull();
    expect(await nameObservations(mine.id)).toEqual([]);
  });

  it("lets an owner re-spell their own cat's name", async () => {
    const mine = await insertCat(`${NAME_PREFIX} Λίλη`, owner);
    const res = await request(app)
      .patch(`/api/cats/${mine.id}`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: owner, name: `${NAME_PREFIX.toUpperCase()} ΛΙΛΗ` });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(`${NAME_PREFIX.toUpperCase()} ΛΙΛΗ`);
    const obs = await nameObservations(mine.id);
    expect(obs.map((o) => o.value)).toEqual([
      {
        name: `${NAME_PREFIX.toUpperCase()} ΛΙΛΗ`,
        normalised: `${NAME_PREFIX.toLowerCase()} λιλη`,
      },
    ]);
  });
});

describe("losing a race for a name (SYC-101, review of #92)", () => {
  // The pre-check found nothing, then another cat took the name before this
  // write: the unique index refuses it, and the answer is still NAME_TAKEN.
  it("renaming answers NAME_TAKEN and changes nothing", async () => {
    const winner = await insertCat(`${NAME_PREFIX} Μαρίνα`);
    const mine = await insertCat(`${NAME_PREFIX} Τούλα`, owner);
    race.skipPrechecks = 1;
    const res = await request(app)
      .patch(`/api/cats/${mine.id}`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: owner, name: `${NAME_PREFIX} μαρινα` });
    expect(race.skipPrechecks).toBe(0);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "NAME_TAKEN", cat: { id: winner.id } });
    const [after] = await db.select().from(catsTable).where(eq(catsTable.id, mine.id));
    expect(after!.name).toBe(`${NAME_PREFIX} Τούλα`);
    expect(await nameObservations(mine.id)).toEqual([]);
  });

  it("only the folded-name index counts as name taken", () => {
    const nameClash = { code: "23505", constraint: "cats_normalised_name_unique" };
    expect(isUniqueViolation(nameClash)).toBe(true);
    expect(isUniqueViolation(new Error("wrapped", { cause: nameClash }))).toBe(true);
    expect(isUniqueViolation({ code: "23505", constraint: "cats_pkey" })).toBe(false);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
  });
});

describe("a name that is empty once folded (SYC-101, review of #92)", () => {
  it("is refused on rename and writes nothing", async () => {
    const invisible = "​⁠​";
    const mine = await insertCat(`${NAME_PREFIX} Κίκα`, owner);
    const ren = await request(app)
      .patch(`/api/cats/${mine.id}`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: owner, name: invisible });
    expect(ren.status).toBe(400);
    expect(ren.body.code).toBe("EMPTY_NAME");
    const [after] = await db.select().from(catsTable).where(eq(catsTable.id, mine.id));
    expect(after!.name).toBe(`${NAME_PREFIX} Κίκα`);
  });
});
