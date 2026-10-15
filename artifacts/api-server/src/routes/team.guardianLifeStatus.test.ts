import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, observationsTable } from "@workspace/db";
import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { guardianOn, newColony, seedCat } from "../test/roleKit";

// SYC-362 D2 (adversarial review, 15 Oct 2026): the "cat guardian saves and
// keeps the owner" branch of POST /team/cats/:id/life-status is for when the
// team cat page opens to guardians. TODAY a real guardian is refused at the
// door, before any of it runs. When this test starts failing, the guardian
// path has opened: check the D2 note ("This cat still has an owner…") with a
// real guardian before changing this test.

const KEY = "vitest-g362-key-0123456789abcdef-0123456789abcd";
let guardianCookie: string;
let catId: number;
let previousKeys: string | undefined;

beforeAll(async () => {
  previousKeys = process.env["TEAM_SESSION_KEYS"];
  process.env["TEAM_SESSION_KEYS"] = KEY;
  const own = await newColony("g362");
  guardianCookie = (await guardianOn("g362", [own])).cookie;
  catId = (await seedCat(own)).id;
});

afterAll(() => {
  if (previousKeys === undefined) delete process.env["TEAM_SESSION_KEYS"];
  else process.env["TEAM_SESSION_KEYS"] = previousKeys;
});

describe("a real cat guardian and the team cat page, today", () => {
  it("can't open the team cat page of a cat in her own colony", async () => {
    const res = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", guardianCookie);
    expect(res.status).toBe(403);
  });

  it("is refused a life-status save, confirmed or not, and nothing is written", async () => {
    const rows = async () =>
      (await db.select().from(observationsTable).where(eq(observationsTable.catId, catId))).length;
    const before = await rows();
    for (const extra of [{}, { confirm: "1" }]) {
      const res = await request(app)
        .post(`/api/team/cats/${catId}/life-status`)
        .set("Origin", TEAM_ORIGIN)
        .set("Cookie", guardianCookie)
        .type("form")
        .send({ status: "street", reason: "Seen on the street", ...extra });
      expect(res.status).toBe(403);
    }
    expect(await rows()).toBe(before);
  });
});
