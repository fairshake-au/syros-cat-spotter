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

vi.mock("../lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notifications")>();
  return { ...actual, notifyCatSpotters: vi.fn() };
});

import app from "../app";
import { catNamed } from "../lib/catNames";

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

describe("POST /api/cats with a folded-name clash (SYC-101)", () => {
  it("answers NAME_TAKEN naming the cat, and registers nothing", async () => {
    const zoe = await insertCat(`${NAME_PREFIX} Zoë`);
    const res = await request(app)
      .post("/api/cats")
      .set("X-Device-Secret", SECRET)
      .send({
        deviceId: owner,
        name: `${NAME_PREFIX.toLowerCase()} zoe`,
        ownerName: "Maria",
        homeDescription: "Blue door",
        lat: 37.44,
        lng: 24.9,
      });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "NAME_TAKEN",
      cat: { id: zoe.id, name: `${NAME_PREFIX} Zoë` },
    });
    const rows = await db
      .select()
      .from(catsTable)
      .where(eq(catsTable.normalisedName, `${NAME_PREFIX.toLowerCase()} zoe`));
    expect(rows.map((r) => r.id)).toEqual([zoe.id]);
  });

  it("records the database's folded form on the name observation", async () => {
    const res = await request(app)
      .post("/api/cats")
      .set("X-Device-Secret", SECRET)
      .send({
        deviceId: owner,
        name: `${NAME_PREFIX} ΣΟΦΊΑΣ`,
        ownerName: "Maria",
        homeDescription: "Blue door",
        lat: 37.44,
        lng: 24.9,
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(`${NAME_PREFIX} ΣΟΦΊΑΣ`);
    const obs = await nameObservations(res.body.id);
    expect(obs.map((o) => o.value)).toEqual([
      { name: `${NAME_PREFIX} ΣΟΦΊΑΣ`, normalised: `${NAME_PREFIX.toLowerCase()} σοφιασ` },
    ]);
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
