import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pool, catsTable, deviceCredentialsTable, observationsTable } from "@workspace/db";
import app from "../app";
import { syrNumber } from "../lib/teamCatView";
import { TEAM_DESK_DEVICE } from "../lib/teamDesk";

// SYC-677 D: a cat Syros Cats left for spotters to name ("Spotters naming a
// cat", vet-visit-batches design). Its stored name is its SYR number until a
// spotter names it through POST /cats/:id/name; the first good name wins.

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vitest-nameby-${RUN}-`;
const NAME = `VtNameBy${RUN}`;
const SECRET = "vitest-nameby-device-secret-aaaa";
const device = (s: string) => `${PREFIX}${s}`;

const madeCats: number[] = [];

// Each request comes from its own address, so this file never shares the
// name-suggestions limiter's bucket with another file (or itself).
let ipN = 0;
const freshIp = () => `2001:db8:6770:${(++ipN).toString(16)}::1`;

async function pendingCat(): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME}tmp${madeCats.length}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: TEAM_DESK_DEVICE,
    })
    .returning({ id: catsTable.id });
  await db.update(catsTable).set({ name: syrNumber(c!.id), namePending: true }).where(eq(catsTable.id, c!.id));
  madeCats.push(c!.id);
  return c!.id;
}

async function namedCat(name: string): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({ name, description: "", primaryPhotoId: 0, lat: 37.445, lng: 24.942, discovererDeviceId: device("finder") })
    .returning({ id: catsTable.id });
  madeCats.push(c!.id);
  return c!.id;
}

function nameIt(catId: number, deviceId: string, name: string, secret = SECRET) {
  return request(app)
    .post(`/api/cats/${catId}/name`)
    .set("X-Device-Secret", secret)
    .set("X-Forwarded-For", freshIp())
    .send({ deviceId, name });
}

async function nameStatements(catId: number) {
  return db
    .select()
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, catId), eq(observationsTable.kind, "name")));
}

async function cleanup() {
  if (madeCats.length) {
    // Observations are append-only; deleting the cat takes its own with it.
    await db.delete(catsTable).where(inArray(catsTable.id, madeCats));
  }
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

beforeAll(async () => {
  // Bind each device's secret, as the app does on its first request.
  for (const d of ["a", "b", "c", "owner"]) {
    await request(app).get(`/api/profiles/${device(d)}`).set("X-Device-Secret", SECRET);
  }
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("POST /cats/:catId/name", () => {
  it("shows a pending cat publicly as its SYR number with namePending true", async () => {
    const catId = await pendingCat();
    const res = await request(app).get(`/api/cats/${catId}`);
    expect(res.status).toBe(200);
    expect(res.body.cat.namePending).toBe(true);
    expect(res.body.cat.name).toBe(syrNumber(catId));
  });

  it("shows namePending false for a named cat, in the list too", async () => {
    const catId = await namedCat(`${NAME}Listed`);
    const res = await request(app).get(`/api/cats/${catId}`);
    expect(res.body.cat.namePending).toBe(false);
    // The list is capped, so this cat may not be on its first page: assert
    // the field on every cat the page does carry, and that it carries some.
    const list = await request(app).get(`/api/cats?pageSize=50`);
    const cats = list.body.cats as Array<{ namePending: unknown }>;
    expect(cats.length).toBeGreaterThan(0);
    for (const c of cats) expect(typeof c.namePending).toBe("boolean");
  });

  it("names a pending cat once, with a name statement by this device; a second naming is 409 ALREADY_NAMED", async () => {
    const catId = await pendingCat();
    const first = await nameIt(catId, device("a"), `${NAME}Mimi`);
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect(first.body.name).toBe(`${NAME}Mimi`);
    expect(first.body.namePending).toBe(false);
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    expect(row!.name).toBe(`${NAME}Mimi`);
    expect(row!.namePending).toBe(false);
    const statements = await nameStatements(catId);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.deviceId).toBe(device("a"));
    expect(statements[0]!.value).toMatchObject({ name: `${NAME}Mimi`, normalised: row!.normalisedName });

    const second = await nameIt(catId, device("b"), `${NAME}Other`);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("ALREADY_NAMED");
    const [after] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    expect(after!.name).toBe(`${NAME}Mimi`);
    expect(await nameStatements(catId)).toHaveLength(1);
  });

  it("two namings at once: exactly one 200 and one 409 ALREADY_NAMED", async () => {
    const catId = await pendingCat();
    const [r1, r2] = await Promise.all([
      nameIt(catId, device("a"), `${NAME}RaceA`),
      nameIt(catId, device("b"), `${NAME}RaceB`),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    const winner = r1.status === 200 ? r1 : r2;
    expect(loser.body.code).toBe("ALREADY_NAMED");
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    expect(row!.name).toBe(winner.body.name);
    expect(await nameStatements(catId)).toHaveLength(1);
  });

  it("refuses an offensive name with OFFENSIVE_NAME, and writes nothing", async () => {
    const catId = await pendingCat();
    const res = await nameIt(catId, device("a"), "putain cat");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OFFENSIVE_NAME");
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    expect(row!.namePending).toBe(true);
    expect(await nameStatements(catId)).toHaveLength(0);
  });

  it("refuses a blank name with EMPTY_NAME", async () => {
    const catId = await pendingCat();
    const res = await nameIt(catId, device("a"), "​​");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("EMPTY_NAME");
  });

  it("refuses a SYR-shaped name", async () => {
    const catId = await pendingCat();
    const res = await nameIt(catId, device("a"), "SYR-9999");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "That looks like a cat's SYR number. Choose a name.", code: "SYR_SHAPED_NAME" });
  });

  it("refuses a name another cat has with NAME_TAKEN, naming that cat", async () => {
    const holder = await namedCat(`${NAME}Taken`);
    const catId = await pendingCat();
    const res = await nameIt(catId, device("a"), `${NAME.toLowerCase()}taken`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NAME_TAKEN");
    expect(res.body.cat.id).toBe(holder);
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    expect(row!.namePending).toBe(true);
  });

  it("a cat that isn't pending gets 409 ALREADY_NAMED", async () => {
    const catId = await namedCat(`${NAME}Already`);
    const res = await nameIt(catId, device("a"), `${NAME}New`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_NAMED");
    expect(await nameStatements(catId)).toHaveLength(0);
  });

  it("an unknown or redacted cat is 404", async () => {
    expect((await nameIt(2_000_000_000, device("a"), `${NAME}Ghost`)).status).toBe(404);
    const catId = await pendingCat();
    await db.update(catsTable).set({ redactedAt: new Date() }).where(eq(catsTable.id, catId));
    expect((await nameIt(catId, device("a"), `${NAME}Ghost`)).status).toBe(404);
  });

  it("a wrong device secret gets the same answer as on claim, and writes nothing", async () => {
    const catId = await pendingCat();
    const wrong = "wrong-secret-but-16-chars-long!";
    const named = await nameIt(catId, device("a"), `${NAME}Sneaky`, wrong);
    const claimed = await request(app)
      .post(`/api/cats/${catId}/claim`)
      .set("X-Device-Secret", wrong)
      .send({ deviceId: device("a"), livesOnSyros: true, livesInMyHome: true, homePin: { lat: 37.445, lng: 24.942 } });
    expect(named.status).toBe(claimed.status);
    expect(named.body).toEqual(claimed.body);
    expect([401, 403]).toContain(named.status);
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    expect(row!.namePending).toBe(true);
    expect(await nameStatements(catId)).toHaveLength(0);
  });

  it("the team desk's id can never name a cat", async () => {
    const catId = await pendingCat();
    const res = await nameIt(catId, TEAM_DESK_DEVICE, `${NAME}Desk`);
    expect(res.status).toBe(403);
  });

  it("an owner's rename refuses a SYR-shaped name with the same code and words, and writes nothing", async () => {
    const catId = await namedCat(`${NAME}OwnerSyr`);
    await db.update(catsTable).set({ ownerDeviceId: device("owner") }).where(eq(catsTable.id, catId));
    const res = await request(app)
      .patch(`/api/cats/${catId}`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: device("owner"), name: "syr42" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "That looks like a cat's SYR number. Choose a name.", code: "SYR_SHAPED_NAME" });
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    expect(row!.name).toBe(`${NAME}OwnerSyr`);
    expect(await nameStatements(catId)).toHaveLength(0);
  });

  it("an owner renaming a pending cat clears namePending, so no spotter can overwrite it", async () => {
    const catId = await pendingCat();
    await db.update(catsTable).set({ ownerDeviceId: device("owner") }).where(eq(catsTable.id, catId));
    const renamed = await request(app)
      .patch(`/api/cats/${catId}`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: device("owner"), name: `${NAME}Owned` });
    expect(renamed.status).toBe(200);
    expect(renamed.body.namePending).toBe(false);
    const res = await nameIt(catId, device("a"), `${NAME}Overwrite`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_NAMED");
  });
});
