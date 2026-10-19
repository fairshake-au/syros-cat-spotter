import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { and, like, sql } from "drizzle-orm";
import { catsTable, db, photosTable, pool } from "@workspace/db";

// SYC-396 PR 2.5, adversarial review finding 1: when the daily count can't be
// read or written, Find from a photo fails CLOSED with its own page and
// words, never the app's generic JSON 500, and the form still opens.

vi.mock("../middlewares/rateLimit", async (orig) => {
  const real = (await orig()) as typeof import("../middlewares/rateLimit");
  return {
    ...real,
    checkFindLimits: vi.fn(async () => {
      throw new Error("the counter's database is down");
    }),
    findLimitReached: vi.fn(async () => {
      throw new Error("the counter's database is down");
    }),
  };
});
vi.mock("../lib/matching", () => ({ matchCatPhoto: vi.fn() }));

import app from "../app";
import { matchCatPhoto } from "../lib/matching";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { MATCHING_DOWN_WORDS } from "../lib/teamPages/findPhotoPage";
import { newColony, putInColony, RUN, signedPerson, type Signed } from "../test/roleKit";
import { STRICT_CSP } from "../test/wideCsp";

const KEY = "vitest-finddown-key-0123456789abcdef-0123456789";
const PREFIX = `vt-finddown-${RUN}-`;
let team: Signed;
let colony: number;
let upload: Buffer;

const jpeg = (colour: string) =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: colour } }).jpeg().toBuffer();

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}p`, data: (await jpeg("#336699")).toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  colony = await newColony("find down");
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${PREFIX}cat`, primaryPhotoId: p!.id, lat: 37.4447, lng: 24.9417, discovererDeviceId: `${PREFIX}d` })
    .returning({ id: catsTable.id });
  await putInColony(c!.id, colony);
  team = await signedPerson(`finddown-${RUN}`, ["staff"]);
  upload = await jpeg("#aa5500");
});
beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
});
afterAll(async () => {
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(
    and(
      like(photosTable.publicId, `${PREFIX}%`),
      sql`not exists (select 1 from photo_visibility_events e where e.photo_id = ${photosTable.id})`,
    ),
  );
  await pool.end();
});

describe("the daily count is down", () => {
  it("a search answers 503 with the page and words, and never calls the service", async () => {
    const res = await request(app)
      .post("/api/team/cats/find")
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", team.cookie)
      .set("Accept", "text/html")
      .field("colony", String(colony))
      .attach("photo", upload, "cat.jpg");
    expect(res.status).toBe(503);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["content-security-policy"]).toBe(STRICT_CSP);
    expect(res.text).toContain(MATCHING_DOWN_WORDS.replace("isn't", "isn&#39;t").replace("area's", "area&#39;s"));
    expect(vi.mocked(matchCatPhoto)).not.toHaveBeenCalled();
  });

  it("the form still opens, with no cap notice", async () => {
    const res = await request(app)
      .get(`/api/team/cats/find?colony=${colony}`)
      .set("Cookie", team.cookie)
      .set("Accept", "text/html");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("1 cat to compare");
    expect(res.text).toContain('type="file"');
  });
});
