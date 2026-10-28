import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { appSettingsTable, db, pool } from "@workspace/db";
import app from "../app";
import { setDuplicateSweep } from "../lib/appSwitches";

// SYC-59 PR 5.3: the nightly look-alike sweep's one door. With the switch off
// (the default) it answers {ran:false} and does nothing; the token is the
// fingerprint job's, and no other token opens it. The sweep's own rules are
// in lib/duplicateSweep.test.ts.

const TOKEN = "vitest-fingerprint-job-token-for-sweep-0123456789";
const call = () => request(app).post("/api/internal/duplicates/sweep");

beforeEach(() => {
  process.env["FINGERPRINT_JOB_TOKEN"] = TOKEN;
});
afterEach(async () => {
  await db.delete(appSettingsTable).where(eq(appSettingsTable.key, "duplicate_sweep"));
});
afterAll(async () => {
  await pool.end();
});

describe("POST /api/internal/duplicates/sweep", () => {
  it("no token or a wrong token gets 401; no configured token gets 503", async () => {
    expect((await call()).status).toBe(401);
    expect((await call().set("Authorization", "Bearer nope")).status).toBe(401);
    process.env["NEWS_JOB_TOKEN"] = "vitest-news-token-other-sweep";
    expect((await call().set("Authorization", "Bearer vitest-news-token-other-sweep")).status).toBe(401);
    delete process.env["FINGERPRINT_JOB_TOKEN"];
    expect((await call().set("Authorization", `Bearer ${TOKEN}`)).status).toBe(503);
  });

  it("with the switch off it does nothing and says so, with counts only", async () => {
    const res = await call().set("Authorization", `Bearer ${TOKEN}`);
    expect([res.status, res.body]).toEqual([200, { ran: false, cats: 0, candidates: 0, written: 0 }]);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("with the switch on it runs and answers with counts only", async () => {
    await setDuplicateSweep(true);
    const res = await call().set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["candidates", "cats", "ran", "written"]);
    expect(res.body.ran).toBe(true);
    expect(res.body.written).toBeLessThanOrEqual(10);
  });

  it("the pre-launch gate lets only the fingerprint job's token through", async () => {
    const before = process.env["PRELAUNCH_GATE"];
    process.env["PRELAUNCH_GATE"] = "on";
    try {
      expect((await call()).status).toBe(401);
      expect((await call().set("Authorization", "Bearer wrong")).status).toBe(401);
      process.env["INTERNAL_PEOPLE_TOKEN"] = "vitest-people-token-other-sweep";
      expect((await call().set("Authorization", "Bearer vitest-people-token-other-sweep")).status).toBe(401);
      expect((await call().set("Authorization", `Bearer ${TOKEN}`)).status).toBe(200);
    } finally {
      delete process.env["INTERNAL_PEOPLE_TOKEN"];
      if (before === undefined) delete process.env["PRELAUNCH_GATE"];
      else process.env["PRELAUNCH_GATE"] = before;
    }
  });
});
