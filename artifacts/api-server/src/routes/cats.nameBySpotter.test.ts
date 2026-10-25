import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import {
  db,
  pool,
  catsTable,
  deviceCredentialsTable,
  observationsTable,
  sightingMatchesTable,
  sightingsTable,
} from "@workspace/db";
import app from "../app";
import { syrNumber } from "../lib/teamCatView";
import { TEAM_DESK_DEVICE } from "../lib/teamDesk";
import { peek } from "../lib/limits";
import { _resetNameCatLimitForTests, NAME_CAT_WINDOW_MS } from "../middlewares/rateLimit";
import { deleteTestSightings } from "../test/sightings";

// SYC-677 D: a cat Syros Cats left for spotters to name ("Spotters naming a
// cat", vet-visit-batches design). Its stored name is its SYR number until a
// spotter names it through POST /cats/:id/name; the first good name wins.

// Letters only: a cat name can't hold 5 digits in a row (SYC-709), and a
// hex tag sometimes does, which made this file fail at random.
const RUN = [...randomBytes(4)].map((b) => "bcdfghjkmpqrvwxz"[b % 16]).join("");
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

/**
 * SYC-709: a phone may only name a cat it has met (the claim's rule): a
 * resolved sighting of the cat, matched by confirming the suggestion. With
 * `movedTo`, the match record says the spotter chose another cat and the
 * team later moved the sighting here, which doesn't count.
 */
async function met(catId: number, deviceId: string, opts: { movedTo?: number; status?: "resolved" | "pending" } = {}) {
  const [s] = await db
    .insert(sightingsTable)
    .values({ catId, deviceId, photoId: 0, lat: 37.445, lng: 24.942, status: opts.status ?? "resolved" })
    .returning({ id: sightingsTable.id });
  await db.insert(sightingMatchesTable).values({
    sightingId: s!.id,
    choice: "suggested",
    chosenCatId: opts.movedTo ?? catId,
    chosenAt: new Date(),
    suggestedRank: 1,
  });
}

/** A pending cat that phones a and b (and any others named) have met. */
async function metPendingCat(devices: string[] = ["a", "b"]): Promise<number> {
  const catId = await pendingCat();
  for (const d of devices) await met(catId, device(d));
  return catId;
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
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
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
// Phone a names a cat in most tests; the 3-a-day count gets its own tests.
beforeEach(async () => {
  await _resetNameCatLimitForTests();
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
    const catId = await metPendingCat();
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
    const catId = await metPendingCat();
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
    const catId = await metPendingCat();
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
    const catId = await metPendingCat();
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

  it("an older app's home-note save sends the stored SYR name back: it goes through and the cat stays pending", async () => {
    const catId = await pendingCat();
    await db.update(catsTable).set({ ownerDeviceId: device("owner") }).where(eq(catsTable.id, catId));
    const [before] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    for (const sent of [before!.name, before!.name.toLowerCase(), ` ${before!.name} `]) {
      const res = await request(app)
        .patch(`/api/cats/${catId}`)
        .set("X-Device-Secret", SECRET)
        .send({ deviceId: device("owner"), name: sent, homeDescription: "Green door" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.namePending).toBe(true);
      expect(res.body.name).toBe(before!.name);
    }
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    expect(row!.namePending).toBe(true);
    expect(row!.name).toBe(before!.name);
    expect(row!.homeDescription).toBe("Green door");
    expect(await nameStatements(catId)).toHaveLength(0);
  });
});

// SYC-709 (docs/specs/syc-709-naming-limits.md): a phone names only a cat it
// has met, at most 3 a day, and never with a web link or phone number.
describe("SYC-709: naming limits", () => {
  const detail = (catId: number, d: string) =>
    request(app).get(`/api/cats/${catId}`).set("X-Device-Id", device(d)).set("X-Device-Secret", SECRET);

  it("a phone that hasn't met the cat is 403 NEEDS_SIGHTING, and nothing is written", async () => {
    const catId = await pendingCat();
    const res = await nameIt(catId, device("c"), `${NAME}Stranger`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NEEDS_SIGHTING");
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    expect(row!.namePending).toBe(true);
    expect(await nameStatements(catId)).toHaveLength(0);
  });

  it("a sighting still being matched, or one the team moved here from another cat, doesn't count as met", async () => {
    const other = await namedCat(`${NAME}Elsewhere`);
    const catId = await pendingCat();
    await met(catId, device("c"), { status: "pending" });
    await met(catId, device("c"), { movedTo: other });
    const res = await nameIt(catId, device("c"), `${NAME}NotMet`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NEEDS_SIGHTING");
  });

  it("a sighting of a cat merged into this one counts as met", async () => {
    const catId = await pendingCat();
    const merged = await namedCat(`${NAME}MergedIn`);
    await met(merged, device("c"));
    await db.execute(sql`insert into cat_identity (cat_id, canonical_cat_id) values (${merged}, ${catId})`);
    const res = await nameIt(catId, device("c"), `${NAME}ViaMerge`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("a phone that hasn't met the cat can't learn which names are taken: 403 comes before NAME_TAKEN", async () => {
    await namedCat(`${NAME}Probe`);
    const catId = await pendingCat();
    const res = await nameIt(catId, device("c"), `${NAME}Probe`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NEEDS_SIGHTING");
    expect(res.body.cat).toBeUndefined();
  });

  it("3 saved names a day per phone: the 4th is 429 NAME_DAILY_LIMIT with Retry-After, and rolls back", async () => {
    const cats = [await metPendingCat(), await metPendingCat(), await metPendingCat(), await metPendingCat()];
    for (const [i, catId] of cats.slice(0, 3).entries()) {
      const ok = await nameIt(catId, device("a"), `${NAME}Day${i}`);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    }
    const fourth = await nameIt(cats[3]!, device("a"), `${NAME}Day3`);
    expect(fourth.status).toBe(429);
    expect(fourth.body).toEqual({
      error: "You've named 3 cats today. You can name another tomorrow.",
      code: "NAME_DAILY_LIMIT",
    });
    expect(Number(fourth.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(fourth.headers["retry-after"])).toBeLessThanOrEqual(24 * 60 * 60);
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, cats[3]!));
    expect(row!.namePending).toBe(true);
    expect(await nameStatements(cats[3]!)).toHaveLength(0);
    // The refused 4th rolled its own count back: the phone's day still reads 3.
    expect((await peek("name_cat", device("a"), NAME_CAT_WINDOW_MS)).hits).toBe(3);
    // Another phone still has its own 3.
    expect((await nameIt(cats[3]!, device("b"), `${NAME}Day3b`)).status).toBe(200);
  });

  it("refused names don't use up the day's 3", async () => {
    const holder = `${NAME}Held`;
    await namedCat(holder);
    const cats = [await metPendingCat(), await metPendingCat(), await metPendingCat()];
    // Taken, offensive, a link, a phone that hasn't met the cat: none counts.
    expect((await nameIt(cats[0]!, device("a"), holder)).status).toBe(409);
    expect((await nameIt(cats[0]!, device("a"), "putain cat")).status).toBe(400);
    expect((await nameIt(cats[0]!, device("a"), "buy-stuff.com")).status).toBe(400);
    const stranger = await pendingCat();
    expect((await nameIt(stranger, device("a"), `${NAME}Nope`)).status).toBe(403);
    for (const [i, catId] of cats.entries()) {
      expect((await nameIt(catId, device("a"), `${NAME}Kept${i}`)).status).toBe(200);
    }
  });

  it("two names at once from one phone with one left today: exactly one saves", async () => {
    const cats = [await metPendingCat(), await metPendingCat(), await metPendingCat(), await metPendingCat()];
    for (const [i, catId] of cats.slice(0, 2).entries()) {
      expect((await nameIt(catId, device("a"), `${NAME}Par${i}`)).status).toBe(200);
    }
    const [r1, r2] = await Promise.all([
      nameIt(cats[2]!, device("a"), `${NAME}ParX`),
      nameIt(cats[3]!, device("a"), `${NAME}ParY`),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 429]);
    const rows = await db.select().from(catsTable).where(inArray(catsTable.id, [cats[2]!, cats[3]!]));
    expect(rows.filter((r) => !r.namePending)).toHaveLength(1);
  });

  it.each([
    ["buy-stuff.com"],
    ["BUY.COM"],
    ["www.example"],
    ["http://x"],
    ["t.me/kitty"],
    ["Call 6912345678"],
    ["691 234 5678"],
    ["+30 691-234-5678"],
    ["buy-stuff．com"],
  ])("refuses %j with NAME_HAS_LINK when naming a pending cat and on an owner's rename", async (bad) => {
    const catId = await metPendingCat();
    const res = await nameIt(catId, device("a"), bad);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Names can't include web links or phone numbers.", code: "NAME_HAS_LINK" });
    expect(await nameStatements(catId)).toHaveLength(0);

    const owned = await namedCat(`${NAME}Own${[...randomBytes(2)].map((x) => "bcdfghjkmpqrvwxz"[x % 16]).join("")}`);
    await db.update(catsTable).set({ ownerDeviceId: device("owner") }).where(eq(catsTable.id, owned));
    const renamed = await request(app)
      .patch(`/api/cats/${owned}`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: device("owner"), name: bad });
    expect(renamed.status).toBe(400);
    expect(renamed.body.code).toBe("NAME_HAS_LINK");
  });

  it.each([["Mr.Whiskers"], ["Dr. Who"], ["Agent 007"], ["Kitty 2026"], ["No. 5"], ["Μαύρη"], ["Minou"]])(
    "accepts %j",
    async (good) => {
      const catId = await metPendingCat();
      const res = await nameIt(catId, device("a"), `${good} ${randomBytes(2).toString("hex").replace(/\d/g, "x")}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    },
  );

  it("canName: true for a proven phone that met the pending cat; false otherwise; absent unproven", async () => {
    const catId = await metPendingCat(["a"]);
    expect((await detail(catId, "a")).body.canName).toBe(true);
    expect((await detail(catId, "c")).body.canName).toBe(false);
    expect((await request(app).get(`/api/cats/${catId}`)).body.canName).toBeUndefined();
    const named = await namedCat(`${NAME}CanNameNamed`);
    await met(named, device("a"));
    expect((await detail(named, "a")).body.canName).toBe(false);
  });
});
