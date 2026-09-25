import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, profilesTable } from "@workspace/db";
import { inArray, like } from "drizzle-orm";
import app from "../app";

// All fixtures share this prefix so cleanup can never touch real data.
const PREFIX = "vitest-uname-";
const NAME_PREFIX = "VitestUname";

const device = (suffix: string) => `${PREFIX}${suffix}`;
const name = (suffix: string) => `${NAME_PREFIX}${suffix}`;

async function cleanup() {
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("POST /api/profiles/:deviceId/username", () => {
  it("claims a valid username on first authenticated use without constructing a full profile", async () => {
    const started = performance.now();
    const res = await request(app)
      .post(`/api/profiles/${device("a")}/username`)
      .set("X-Device-Secret", `secret-for-${"x".repeat(20)}`)
      .send({ username: name("Alpha") });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: name("Alpha") });
    const claimMs = Math.round(performance.now() - started);
    const fullStarted = performance.now();
    const full = await request(app).get(`/api/profiles/${device("a")}`)
      .set("X-Device-Secret", `secret-for-${"x".repeat(20)}`);
    expect(full.status).toBe(200);
    expect(full.body.username).toBe(name("Alpha"));
    expect(full.body.ownedCatIds).toEqual([]);
    console.info("Username local DB timing (ms)", {
      claim: claimMs, fullProfileAfterClaim: Math.round(performance.now() - fullStarted),
    });
    expect(claimMs).toBeLessThan(5000);
  });

  it("allows the same device to re-claim its own name", async () => {
    const res = await request(app)
      .post(`/api/profiles/${device("a")}/username`)
      .set("X-Device-Secret", `secret-for-${"x".repeat(20)}`)
      .send({ username: name("Alpha") });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(name("Alpha"));
  });

  it("still updates profile and leaderboard after an authenticated rename", async () => {
    const id = device("editor");
    const secret = "vitest-editor-secret-0123456789";
    const first = await request(app).post(`/api/profiles/${id}/username`)
      .set("X-Device-Secret", secret).send({ username: name("EditOld") });
    expect(first.body).toEqual({ username: name("EditOld") });
    const renamed = await request(app).post(`/api/profiles/${id}/username`)
      .set("X-Device-Secret", secret).send({ username: name("EditNew") });
    expect(renamed.body).toEqual({ username: name("EditNew") });
    const profile = await request(app).get(`/api/profiles/${id}`)
      .set("X-Device-Secret", secret);
    expect(profile.body.username).toBe(name("EditNew"));
    const leaderboard = await request(app).get("/api/leaderboard");
    expect(leaderboard.body.some((entry: { username: string }) => entry.username === name("EditNew"))).toBe(true);
  });

  it("reads the current name cheaply for reconciliation without creating a profile", async () => {
    const res = await request(app).get(`/api/profiles/${device("a")}/username`)
      .set("X-Device-Secret", `secret-for-${"x".repeat(20)}`);
    expect(res.body).toEqual({ username: name("Alpha") });
    const firstUse = await request(app).get(`/api/profiles/${device("unclaimed")}/username`)
      .set("X-Device-Secret", "vitest-unclaimed-secret-0123456789");
    expect(firstUse.body).toEqual({ username: null });
  });

  it("does not allow another credential to claim or reconcile the device's name", async () => {
    const wrongSecret = "vitest-wrong-secret-0123456789";
    expect((await request(app).get(`/api/profiles/${device("a")}/username`)
      .set("X-Device-Secret", wrongSecret)).status).toBe(403);
    expect((await request(app).post(`/api/profiles/${device("a")}/username`)
      .set("X-Device-Secret", wrongSecret)
      .send({ username: name("Hijack") })).status).toBe(403);
    expect((await request(app).post(`/api/profiles/${device("no-secret")}/username`)
      .send({ username: name("Hijack") })).status).toBe(401);
  });

  it("rejects an exact duplicate from another device with 409", async () => {
    const res = await request(app)
      .post(`/api/profiles/${device("b")}/username`)
      .set("X-Device-Secret", `secret-for-${"x".repeat(20)}`)
      .send({ username: name("Alpha") });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/taken/i);
  });

  it("rejects a different-casing duplicate with 409", async () => {
    const res = await request(app)
      .post(`/api/profiles/${device("b")}/username`)
      .set("X-Device-Secret", `secret-for-${"x".repeat(20)}`)
      .send({ username: name("Alpha").toUpperCase() });
    expect(res.status).toBe(409);
  });

  it.each([
    ["too short", "ab"],
    ["too long", "x".repeat(25)],
    ["invalid characters", "bad!name@"],
    ["only whitespace", "   "],
    ["missing", undefined],
    ["non-string", 42],
  ])("rejects invalid username (%s) with 400", async (_label, bad) => {
    const res = await request(app)
      .post(`/api/profiles/${device("c")}/username`)
      .set("X-Device-Secret", `secret-for-${"x".repeat(20)}`)
      .send({ username: bad });
    expect(res.status).toBe(400);
  });

  it("lets only one of two concurrent claims for the same name succeed", async () => {
    const contested = name("Race");
    const [r1, r2] = await Promise.all([
      request(app)
        .post(`/api/profiles/${device("race1")}/username`)
        .set("X-Device-Secret", "vitest-shared-device-secret-0123456789")
        .send({ username: contested }),
      request(app)
        .post(`/api/profiles/${device("race2")}/username`)
        .set("X-Device-Secret", "vitest-shared-device-secret-0123456789")
        .send({ username: contested }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Exactly one row in the DB holds the contested name.
    const rows = await db
      .select({ username: profilesTable.username })
      .from(profilesTable)
      .where(inArray(profilesTable.deviceId, [device("race1"), device("race2")]));
    expect(rows.filter((r) => r.username === contested)).toHaveLength(1);
  });
});

describe("GET /api/profiles/username-availability", () => {
  it("reports a taken name as unavailable, matching claim outcome", async () => {
    const res = await request(app)
      .get("/api/profiles/username-availability")
      .query({ name: name("Alpha") });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, reason: "taken" });
  });

  it("is case-insensitive about taken names", async () => {
    const res = await request(app)
      .get("/api/profiles/username-availability")
      .query({ name: name("Alpha").toLowerCase() });
    expect(res.body).toEqual({ available: false, reason: "taken" });
  });

  it("reports a free name as available", async () => {
    const res = await request(app)
      .get("/api/profiles/username-availability")
      .query({ name: name("FreeName") });
    expect(res.body).toEqual({ available: true });
  });

  it("reports invalid names as unavailable with reason=invalid", async () => {
    for (const bad of ["ab", "x".repeat(25), "bad!name@", ""]) {
      const res = await request(app)
        .get("/api/profiles/username-availability")
        .query({ name: bad });
      expect(res.body).toEqual({ available: false, reason: "invalid" });
    }
  });
});
