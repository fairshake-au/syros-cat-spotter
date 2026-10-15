import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { cleanUpPeople, emailFor, joined } from "../test/inviteKit";

// SYC-53 PR 1.2, Decision D: with no colonies in existence the cat guardian
// option says so and cannot be sent, on the screen AND on the server
// (production holds no colonies today). The colony list is faked empty here,
// because the shared test database holds other tests' colonies.

vi.mock("../lib/teamColonies", async (orig) => ({
  ...(await orig<typeof import("../lib/teamColonies")>()),
  listColonies: async () => [],
}));

let susan: Awaited<ReturnType<typeof joined>>;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = "vitest-people-nocol-key-0123456789abcdef-0123";
  susan = await joined("nc-susan", ["staff", "management"]);
});
afterAll(async () => {
  await cleanUpPeople();
  delete process.env["TEAM_SESSION_KEYS"];
});

describe("no colonies exist yet", () => {
  it("the form says so and the cat guardian option is disabled", async () => {
    const res = await request(app).get("/api/team/people").set("Cookie", susan.cookie).set("Sec-Fetch-Mode", "navigate");
    expect(res.status).toBe(200);
    expect(res.text).toContain("No colonies exist yet");
    expect(res.text).toMatch(/<input type="checkbox" name="roles" value="guardian" disabled>/);
  });

  it("the server refuses a cat guardian invitation anyway, and creates nobody", async () => {
    const email = emailFor("nc-guardian");
    for (const body of [{ roles: "guardian" }, { roles: "guardian", colony: "1" }]) {
      const res = await request(app)
        .post("/api/team/people/invite")
        .set("Cookie", susan.cookie)
        .set("Origin", TEAM_ORIGIN)
        .set("X-Forwarded-For", "10.99.1.1")
        .type("form")
        .send({ email, name: "Vt nc", language: "en", ...body });
      expect(res.status).toBe(400);
      expect(res.text).toContain("No colonies exist yet");
    }
    expect((await pool.query(`select count(*)::int as n from people where email = $1`, [email])).rows[0].n).toBe(0);
  });
});
