import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { catsTable, db, photosTable, pool, vetBatchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// SYC-677 PR B review finding 1: when the batch's daily count can't be read or
// written, a batch search fails CLOSED with the page and the counter-down
// words, never the app's generic JSON 500, and stores no suggestions.
// Modelled on team.findPhoto.counterDown.test.ts.

vi.mock("../middlewares/rateLimit", async (orig) => {
  const real = (await orig()) as typeof import("../middlewares/rateLimit");
  return {
    ...real,
    checkBatchFindLimits: vi.fn(async () => {
      throw new Error("the counter's database is down");
    }),
  };
});
vi.mock("../lib/matching", () => ({ matchCatPhoto: vi.fn() }));

import app from "../app";
import { matchCatPhoto } from "../lib/matching";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { getBatch } from "../lib/vetBatches";
import { SAID } from "../lib/teamPages/vetBatchPages";
import { newColony, putInColony, signedPerson, type Signed } from "../test/roleKit";
import { removeTestPerson } from "../test/removeTestPerson";

const KEY = "vitest-vbcounter-key-0123456789abcdef-0123456789";
const RUN = randomBytes(3).toString("hex");
let staff: Signed;
let colony: number;

const jpeg = (r: number) =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g: 90, b: 60 } } }).jpeg().toBuffer();

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colony = await newColony("vb counter down");
  staff = await signedPerson(`vb-counter-${RUN}`, ["staff"]);
  const [ph] = await db
    .insert(photosTable)
    .values({ data: (await jpeg(30)).toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [c] = await db
    .insert(catsTable)
    .values({ name: `vb-counter-${RUN}`, primaryPhotoId: ph!.id, lat: 37.4447, lng: 24.9417, discovererDeviceId: `vbc-${RUN}` })
    .returning({ id: catsTable.id });
  await putInColony(c!.id, colony);
});
afterAll(async () => {
  await db.delete(vetBatchesTable).where(eq(vetBatchesTable.createdBy, staff.id));
  await removeTestPerson(staff.id);
  await pool.end();
});

describe("the batch's daily count is down", () => {
  it("a search comes back to the card with the counter-down words, no 500, no suggestions stored", async () => {
    const made = await request(app).get(`/api/team/vet-batches/new?colony=${colony}`).set("Cookie", staff.cookie).set("Accept", "text/html");
    const batch = Number(/\/vet-batches\/(\d+)$/.exec(made.headers["location"]!)![1]);
    const add = request(app).post(`/api/team/vet-batches/${batch}/cats`).set("Cookie", staff.cookie).set("Origin", TEAM_ORIGIN);
    add.attach("photos", await jpeg(70), { filename: "c.jpg", contentType: "image/jpeg" });
    const row = Number(/#bc-(\d+)$/.exec((await add).headers["location"]!)![1]);

    const res = await request(app)
      .post(`/api/team/vet-batches/${batch}/cats/${row}/search`)
      .set("Cookie", staff.cookie)
      .set("Origin", TEAM_ORIGIN)
      .type("form")
      .send({ scope: "batch" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toContain("said=counter_down");

    const page = await request(app).get(res.headers["location"]!.split("#")[0]!).set("Cookie", staff.cookie).set("Accept", "text/html");
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(page.text).toContain(SAID["counter_down"]!.replace("isn't", "isn&#39;t"));
    expect(vi.mocked(matchCatPhoto)).not.toHaveBeenCalled();
    expect((await getBatch(batch))!.cats[0]!.suggestions).toBeNull();
  });
});
