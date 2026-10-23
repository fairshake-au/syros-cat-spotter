import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { addPerson, catNewsChangesTable, catsTable, db, photosTable, pool } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { sessionCookieFor, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { guardianOn, newColony, type Signed } from "../test/roleKit";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-45 Slice 1: the nightly news check's review list (the team's:
// review_cat_news, SYC-619 §2.2). The
// route walk (team.walk.test.ts) checks who may call it; this checks what it
// says and that a review is recorded.

const RUN = randomBytes(3).toString("hex");
const KEY = "vitest-teamnews-key-0123456789abcdef-0123456";
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let staffCookie: string;
let guardian: Signed;
let catId: number;
const changeIds: number[] = [];

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  const staff = await addPerson({ email: `vitest-news-staff-${RUN}@example.com`, name: `Susan ${RUN}`, addedBy: "cli:vitest" });
  staffCookie = sessionCookieFor(staff.id);
  guardian = await guardianOn(`news-g-${RUN}`, [await newColony(`news-${RUN}`)]);
  const [p] = await db.insert(photosTable).values({ data: TINY_JPEG_B64, mime: "image/jpeg" }).returning();
  const [c] = await db
    .insert(catsTable)
    .values({ name: `VitestTeamNews-${RUN}`, description: "", primaryPhotoId: p!.id, lat: 37.44, lng: 24.94, discovererDeviceId: "vitest-teamnews" })
    .returning();
  catId = c!.id;
  const now = Date.now();
  const rows = await db
    .insert(catNewsChangesTable)
    .values([
      { catId, change: "sterilised", evidenceIds: [1], causedByDevices: ["vitest-secret-device"], foundAt: new Date(now - 60_000), state: "watched" },
      { catId, change: "seen_again", evidenceIds: [2], foundAt: new Date(now - 2 * 86_400_000), state: "silenced", silencedReason: "bulk" },
      { catId, change: "homed", evidenceIds: [3], foundAt: new Date(now - 31 * 86_400_000), state: "watched" },
    ])
    .returning({ id: catNewsChangesTable.id });
  changeIds.push(...rows.map((r) => r.id));
});

afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  await db.delete(catNewsChangesTable).where(inArray(catNewsChangesTable.id, changeIds));
  await db.delete(catsTable).where(eq(catsTable.id, catId));
  if (guardian) await removeTestPerson(guardian.email).catch(() => undefined);
  await pool.end();
});

describe("GET /api/team/news-changes", () => {
  it("the last 30 days, newest first, with the cat's name and code, and never the devices", async () => {
    const res = await request(app).get("/api/team/news-changes").set("Cookie", staffCookie).set("Accept", "application/json");
    expect(res.status).toBe(200);
    const mine = (res.body.changes as { id: number }[]).filter((c) => changeIds.includes(c.id));
    expect(mine.map((c) => c.id)).toEqual([changeIds[0], changeIds[1]]);
    expect(mine[0]).toMatchObject({
      catId,
      catName: `VitestTeamNews-${RUN}`,
      catCode: `SYR-${String(catId).padStart(4, "0")}`,
      change: "sterilised",
      state: "watched",
      reviewedAt: null,
    });
    expect(JSON.stringify(res.body)).not.toContain("vitest-secret-device");
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });

  it("a cat guardian gets the 403", async () => {
    const res = await request(app).get("/api/team/news-changes").set("Cookie", guardian.cookie).set("Accept", "application/json");
    expect(res.status).toBe(403);
  });
});

describe("POST /api/team/news-changes/:id/review", () => {
  const post = (id: string | number, body: object, cookie = staffCookie, origin = TEAM_ORIGIN) =>
    request(app)
      .post(`/api/team/news-changes/${id}/review`)
      .set("Origin", origin)
      .set("Cookie", cookie)
      .set("Accept", "application/json")
      .send(body);

  it("records the time and the note", async () => {
    const res = await post(changeIds[0]!, { note: "  Real: Agatha was done at the clinic on Tuesday.  " });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(catNewsChangesTable).where(eq(catNewsChangesTable.id, changeIds[0]!));
    expect(row!.reviewedNote).toBe("Real: Agatha was done at the clinic on Tuesday.");
    expect(row!.reviewedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("no note is fine; a missing change or a bad id is 404; a long note is 400", async () => {
    expect((await post(changeIds[1]!, {})).status).toBe(200);
    expect((await post(2_000_000_000, {})).status).toBe(404);
    expect((await post("abc", {})).status).toBe(404);
    expect((await post("99999999999", {})).status).toBe(404);
    expect((await post(changeIds[1]!, { note: "x".repeat(501) })).status).toBe(400);
  });

  it("refuses another Origin, and a cat guardian", async () => {
    // A bad Origin is the not-signed-in 401 (requireOrigin), like every dashboard form.
    expect((await post(changeIds[0]!, {}, staffCookie, "https://evil.example")).status).toBe(401);
    expect((await post(changeIds[0]!, {}, guardian.cookie)).status).toBe(403);
  });
});

describe("SYC-619 §2.2 (N1): the list has its own capability, review_cat_news", () => {
  // The workspace became management's. This list must not go with it: a
  // staff member with no management role still reads it and marks it.
  it("staff still reach news-changes; a guardian gets 403", async () => {
    const get = (cookie: string) =>
      request(app).get("/api/team/news-changes").set("Cookie", cookie).set("Accept", "application/json");
    const review = (cookie: string) =>
      request(app)
        .post(`/api/team/news-changes/${changeIds[1]}/review`)
        .set("Origin", TEAM_ORIGIN)
        .set("Cookie", cookie)
        .set("Accept", "application/json")
        .send({});
    expect((await get(staffCookie)).status).toBe(200);
    expect((await review(staffCookie)).status).toBe(200);
    expect((await get(guardian.cookie)).status).toBe(403);
    expect((await review(guardian.cookie)).status).toBe(403);
  });

  it("the routes ask for review_cat_news, not use_workspace", () => {
    const src = readFileSync(new URL("./teamNews.ts", import.meta.url), "utf8");
    expect(src).toContain('requireTeam("review_cat_news")');
    expect(src).toContain('formRoute("review_cat_news")');
    expect(src).not.toMatch(/(requireTeam|formRoute)\("use_workspace"\)/);
  });
});
