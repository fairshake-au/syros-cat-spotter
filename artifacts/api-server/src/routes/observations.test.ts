import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { like, eq } from "drizzle-orm";
import {
  db,
  pool,
  addPerson,
  removePerson,
  catsTable,
  sightingsTable,
  observationsTable,
  catUpdatesTable,
  notificationsTable,
} from "@workspace/db";
import app from "../app";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";

// Data spine plan, PR 8 (spec §4.5, §3.5): the correction path's endpoints.
// No staff screen exists yet (SYC-43's later parts build it) — these are
// reachable only by tests and by anyone who can sign in through the
// hand-off until then.

const NAME_PREFIX = "VitestObsRoute";
const STAFF_EMAIL = "vitest-obs-staff@example.com";
const GUARDIAN_EMAIL = "vitest-obs-guardian@example.com";
const handoffKey = makeKey();

let staffId: string;
let guardianId: string;
let catIdCounter = 0;

async function cleanupCats() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}

beforeAll(async () => {
  await removePerson(STAFF_EMAIL);
  await removePerson(GUARDIAN_EMAIL);
  await cleanupCats();
  staffId = (
    await addPerson({
      email: STAFF_EMAIL,
      name: "Vitest Staff",
      addedBy: "cli:vitest",
      roles: ["staff"],
    })
  ).id;
  guardianId = (
    await addPerson({
      email: GUARDIAN_EMAIL,
      name: "Vitest Guardian",
      addedBy: "cli:vitest",
      roles: ["guardian"],
    })
  ).id;
});

afterAll(async () => {
  await cleanupCats();
  await removePerson(STAFF_EMAIL);
  await removePerson(GUARDIAN_EMAIL);
  await pool.end();
});

process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
process.env["TEAM_SESSION_KEYS"] =
  "vitest-obs-route-session-key-0123456789abcdef";

/** Signs in through the real hand-off; returns the cookie to send. */
async function signIn(personId: string): Promise<string> {
  const res = await request(app)
    .post("/api/team/handoff")
    .set("Origin", "https://admin.catspotters.com")
    .type("form")
    .send({ token: mint(handoffKey, claimsFor(personId, { sv: 1 })) });
  expect(res.status).toBe(303);
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
  return cookie.split(";")[0]!;
}

async function insertCat(overrides: Partial<typeof catsTable.$inferInsert> = {}) {
  catIdCounter += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${catIdCounter}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: "vitest-obs-route-discoverer",
      ...overrides,
    })
    .returning();
  return cat!;
}

async function observationsFor(catId: number) {
  return db
    .select()
    .from(observationsTable)
    .where(eq(observationsTable.catId, catId));
}

describe("POST /api/observations", () => {
  it("refuses with no session", async () => {
    const cat = await insertCat();
    const res = await request(app)
      .post("/api/observations")
      .send({
        catId: cat.id,
        kind: "life_status",
        value: { status: "deceased" },
        reason: "found on the road",
      });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "not_signed_in" });
    expect(await observationsFor(cat.id)).toHaveLength(0);
  });

  it("refuses a signed-in person without the capability, the same way", async () => {
    const cat = await insertCat();
    const cookie = await signIn(guardianId);
    const res = await request(app)
      .post("/api/observations")
      .set("Cookie", cookie)
      .send({
        catId: cat.id,
        kind: "life_status",
        value: { status: "deceased" },
        reason: "found on the road",
      });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "not_signed_in" });
    expect(await observationsFor(cat.id)).toHaveLength(0);
  });

  it("writes a life_status observation as staff, with the right role, author and reason", async () => {
    const cat = await insertCat();
    const cookie = await signIn(staffId);
    const res = await request(app)
      .post("/api/observations")
      .set("Cookie", cookie)
      .send({
        catId: cat.id,
        kind: "life_status",
        value: { status: "deceased" },
        reason: "found on the road",
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      catId: cat.id,
      kind: "life_status",
      accountId: staffId,
      deviceId: null,
      roleAtTime: "staff",
      value: { status: "deceased", reason: "found on the road" },
    });

    const rows = await observationsFor(cat.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId: staffId,
      deviceId: null,
      roleAtTime: "staff",
      kind: "life_status",
    });
  });

  it("writes a sterilised observation as staff", async () => {
    const cat = await insertCat();
    const cookie = await signIn(staffId);
    const res = await request(app)
      .post("/api/observations")
      .set("Cookie", cookie)
      .send({
        catId: cat.id,
        kind: "sterilised",
        value: { sterilised: true },
        reason: "done at the clinic, 2 Oct",
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      catId: cat.id,
      kind: "sterilised",
      accountId: staffId,
      roleAtTime: "staff",
      value: { sterilised: true, reason: "done at the clinic, 2 Oct" },
    });
  });

  it("refuses a malformed value", async () => {
    const cat = await insertCat();
    const cookie = await signIn(staffId);
    const res = await request(app)
      .post("/api/observations")
      .set("Cookie", cookie)
      .send({
        catId: cat.id,
        kind: "life_status",
        value: { status: "not_a_status" },
        reason: "oops",
      });
    expect(res.status).toBe(400);
    expect(await observationsFor(cat.id)).toHaveLength(0);
  });

  it("refuses a missing cat", async () => {
    const cookie = await signIn(staffId);
    const res = await request(app)
      .post("/api/observations")
      .set("Cookie", cookie)
      .send({
        catId: 999_999_999,
        kind: "life_status",
        value: { status: "homed" },
        reason: "no such cat",
      });
    expect(res.status).toBe(404);
  });

  it("sends no push: writing a death does not touch cat_updates or notifications", async () => {
    const cat = await insertCat();
    const cookie = await signIn(staffId);
    const before = await db
      .select()
      .from(catUpdatesTable)
      .where(eq(catUpdatesTable.catId, cat.id));
    const res = await request(app)
      .post("/api/observations")
      .set("Cookie", cookie)
      .send({
        catId: cat.id,
        kind: "life_status",
        value: { status: "deceased" },
        reason: "found on the road",
      });
    expect(res.status).toBe(201);
    const after = await db
      .select()
      .from(catUpdatesTable)
      .where(eq(catUpdatesTable.catId, cat.id));
    expect(after).toHaveLength(before.length);
    const notifs = await db.select().from(notificationsTable);
    expect(notifs.filter((n) => n.catUpdateId === cat.id)).toHaveLength(0);
  });

  it("end to end: a staff deceased statement reads 'deceased', and a later resolved sighting clears it", async () => {
    const { loadCatRecords } = await import("../lib/observations");
    const { resolveCat } = await import("../lib/resolve");

    const cat = await insertCat();
    const cookie = await signIn(staffId);
    const deathAt = new Date("2026-01-01T00:00:00Z");
    const deathRes = await request(app)
      .post("/api/observations")
      .set("Cookie", cookie)
      .send({
        catId: cat.id,
        kind: "life_status",
        value: { status: "deceased" },
        reason: "reported dead",
        observedAt: deathAt.toISOString(),
      });
    expect(deathRes.status).toBe(201);

    const records1 = await loadCatRecords([cat.id]);
    const snapshot1 = resolveCat(
      records1.get(cat.id)!.observations,
      records1.get(cat.id)!.evidenceOfLife,
      new Date(),
    );
    expect(snapshot1.lifeStatus).toBe("deceased");

    // A resolved sighting dated after the deceased statement clears it in
    // the same read (§3.2), with no job and no team action.
    await db.insert(sightingsTable).values({
      catId: cat.id,
      deviceId: "vitest-obs-route-spotter",
      photoId: 0,
      lat: 37.44,
      lng: 24.9,
      status: "resolved",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });

    const records2 = await loadCatRecords([cat.id]);
    const snapshot2 = resolveCat(
      records2.get(cat.id)!.observations,
      records2.get(cat.id)!.evidenceOfLife,
      new Date(),
    );
    expect(snapshot2.lifeStatus).toBe("street");
    expect(snapshot2.presumedDeceased).toBe(false);
  });
});

describe("POST /api/observations/:id/supersede", () => {
  async function writeEarTip(
    catId: number,
    clipped: boolean,
    photoId: number | null = 1,
  ) {
    const [row] = await db
      .insert(observationsTable)
      .values({
        catId,
        kind: "ear_tip",
        value: { clipped },
        deviceId: "vitest-obs-route-spotter",
        roleAtTime: "public",
        observedAt: new Date(),
        photoId,
      })
      .returning();
    return row!;
  }

  it("refuses with no session", async () => {
    const res = await request(app)
      .post("/api/observations/1/supersede")
      .send({ value: { clipped: false }, reason: "torn, not clipped" });
    expect(res.status).toBe(401);
  });

  it("refuses a missing observation", async () => {
    const cookie = await signIn(staffId);
    const res = await request(app)
      .post("/api/observations/999999999/supersede")
      .set("Cookie", cookie)
      .send({ value: { clipped: false }, reason: "torn, not clipped" });
    expect(res.status).toBe(404);
  });

  it("corrects a spotter's clipped-tip answer: sterilised returns to unknown, never to a negative", async () => {
    const cat = await insertCat();
    const spotted = await writeEarTip(cat.id, true);
    const cookie = await signIn(staffId);
    const res = await request(app)
      .post(`/api/observations/${spotted.id}/supersede`)
      .set("Cookie", cookie)
      .send({ value: { clipped: false }, reason: "that's a torn ear, not a clip" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      catId: cat.id,
      kind: "ear_tip",
      roleAtTime: "staff",
      accountId: staffId,
      supersedesId: spotted.id,
      supersedeReason: "that's a torn ear, not a clip",
      value: { clipped: false },
    });

    const { loadCatRecords } = await import("../lib/observations");
    const { resolveCat } = await import("../lib/resolve");
    const records = await loadCatRecords([cat.id]);
    const snapshot = resolveCat(
      records.get(cat.id)!.observations,
      records.get(cat.id)!.evidenceOfLife,
      new Date(),
    );
    expect(snapshot.sterilised.value).toBeNull();
    expect(snapshot.sterilised.confidence).toBe("unknown");
  });

  it("refuses superseding an observation that is already superseded", async () => {
    const cat = await insertCat();
    const spotted = await writeEarTip(cat.id, true);
    const cookie = await signIn(staffId);
    const first = await request(app)
      .post(`/api/observations/${spotted.id}/supersede`)
      .set("Cookie", cookie)
      .send({ value: { clipped: false }, reason: "first correction" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/observations/${spotted.id}/supersede`)
      .set("Cookie", cookie)
      .send({ value: { clipped: false }, reason: "second attempt" });
    expect(second.status).toBe(409);
  });

  it("refuses a signed-in person without the matching capability", async () => {
    const cat = await insertCat();
    const spotted = await writeEarTip(cat.id, true);
    const cookie = await signIn(guardianId);
    const res = await request(app)
      .post(`/api/observations/${spotted.id}/supersede`)
      .set("Cookie", cookie)
      .send({ value: { clipped: false }, reason: "nope" });
    expect(res.status).toBe(401);
  });

  it("lets staff supersede with an earlier observedAt than the entry it corrects (the J4 case)", async () => {
    // A wrong sterilised:true entry dated 2026-01-01 can't be beaten by a
    // newer-dated correction without naming which observation it replaces —
    // the resolver's newest-wins precedence (§4.6) would otherwise let the
    // wrong entry stand. Supersede names it explicitly.
    const cat = await insertCat();
    const cookie = await signIn(staffId);
    const wrong = await request(app)
      .post("/api/observations")
      .set("Cookie", cookie)
      .send({
        catId: cat.id,
        kind: "sterilised",
        value: { sterilised: true },
        reason: "data entry error",
        observedAt: "2026-01-01T00:00:00.000Z",
      });
    expect(wrong.status).toBe(201);

    const correction = await request(app)
      .post(`/api/observations/${wrong.body.id}/supersede`)
      .set("Cookie", cookie)
      .send({
        value: { sterilised: false },
        reason: "wrong cat's record was entered; the real date is earlier",
        observedAt: "2025-06-01T00:00:00.000Z",
      });
    expect(correction.status).toBe(201);

    const { loadCatRecords } = await import("../lib/observations");
    const { resolveCat } = await import("../lib/resolve");
    const records = await loadCatRecords([cat.id]);
    const snapshot = resolveCat(
      records.get(cat.id)!.observations,
      records.get(cat.id)!.evidenceOfLife,
      new Date(),
    );
    // Confirmed sterilised, from the row with no supersedesId pointing at
    // it — the correction supersedes the wrong row directly, so it is the
    // only active authoritative statement left, whatever its date.
    expect(snapshot.sterilised.value).toBe(false);
    expect(snapshot.sterilised.confidence).toBe("confirmed");
  });
});

describe("GET /api/observations/review/likely", () => {
  it("refuses with no session", async () => {
    const res = await request(app).get("/api/observations/review/likely");
    expect(res.status).toBe(401);
  });

  it("lists only cats currently at Likely, with their evidence photos, and drops a corrected one", async () => {
    const likelyCat = await insertCat();
    await db.insert(observationsTable).values({
      catId: likelyCat.id,
      kind: "ear_tip",
      value: { clipped: true, side: "left" },
      deviceId: "vitest-obs-route-spotter",
      roleAtTime: "public",
      observedAt: new Date(),
      photoId: 1,
    });

    const unrelatedCat = await insertCat();

    const cookie = await signIn(staffId);
    const res = await request(app)
      .get("/api/observations/review/likely")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const ids: number[] = res.body.cats.map((c: { catId: number }) => c.catId);
    expect(ids).toContain(likelyCat.id);
    expect(ids).not.toContain(unrelatedCat.id);
    const entry = res.body.cats.find(
      (c: { catId: number }) => c.catId === likelyCat.id,
    );
    expect(entry.evidence).toHaveLength(1);
    expect(entry.evidence[0]).toMatchObject({ side: "left" });

    // Correct it, then it drops off the list.
    const [earTip] = await db
      .select()
      .from(observationsTable)
      .where(eq(observationsTable.catId, likelyCat.id));
    await request(app)
      .post(`/api/observations/${earTip!.id}/supersede`)
      .set("Cookie", cookie)
      .send({ value: { clipped: false }, reason: "torn ear" });

    const res2 = await request(app)
      .get("/api/observations/review/likely")
      .set("Cookie", cookie);
    const ids2: number[] = res2.body.cats.map((c: { catId: number }) => c.catId);
    expect(ids2).not.toContain(likelyCat.id);
  });

  it("refuses a person without set_sterilisation", async () => {
    const cookie = await signIn(guardianId);
    const res = await request(app)
      .get("/api/observations/review/likely")
      .set("Cookie", cookie);
    expect(res.status).toBe(401);
  });
});
