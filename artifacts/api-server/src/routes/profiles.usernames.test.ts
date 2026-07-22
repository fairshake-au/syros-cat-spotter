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
  it("claims a valid username and returns the profile", async () => {
    const res = await request(app)
      .post(`/api/profiles/${device("a")}/username`)
      .send({ username: name("Alpha") });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(name("Alpha"));
  });

  it("allows the same device to re-claim its own name", async () => {
    const res = await request(app)
      .post(`/api/profiles/${device("a")}/username`)
      .send({ username: name("Alpha") });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(name("Alpha"));
  });

  it("rejects an exact duplicate from another device with 409", async () => {
    const res = await request(app)
      .post(`/api/profiles/${device("b")}/username`)
      .send({ username: name("Alpha") });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/taken/i);
  });

  it("rejects a different-casing duplicate with 409", async () => {
    const res = await request(app)
      .post(`/api/profiles/${device("b")}/username`)
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
      .send({ username: bad });
    expect(res.status).toBe(400);
  });

  it("lets only one of two concurrent claims for the same name succeed", async () => {
    const contested = name("Race");
    const [r1, r2] = await Promise.all([
      request(app).post(`/api/profiles/${device("race1")}/username`).send({ username: contested }),
      request(app).post(`/api/profiles/${device("race2")}/username`).send({ username: contested }),
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
