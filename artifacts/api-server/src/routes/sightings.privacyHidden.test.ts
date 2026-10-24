import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  catsTable,
  db,
  photosTable,
  photoVisibilityEventsTable,
  pool,
  sightingsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";

// SYC-303 (Samuel, 24 Oct 2026: option b): a nearby cat's main photo that is
// hidden for a PRIVACY reason is never sent to the matcher; the cat is
// compared by its newest visible photo instead, or not at all. A main photo
// hidden for any other reason is still sent, as before.

const { matchCatPhoto } = vi.hoisted(() => ({
  matchCatPhoto: vi.fn(async (_photos: unknown, candidates: { catId: number }[]) => ({
    isCatPhoto: true,
    matches: candidates.map((c) => ({ catId: c.catId, confidence: 0.9, reasoning: "test" })),
  })),
}));
vi.mock("../lib/matching", () => ({ matchCatPhoto }));
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";
import { _resetDeviceMatchLimitForTests } from "../middlewares/rateLimit";
import { signedPerson, type Signed } from "../test/roleKit";

// Out at sea, away from every other file's cats.
const ORIGIN = { lat: 35.8, lng: 21.3 };
const PREFIX = "vitest-privmatch-";
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let staff: Signed;
let n = 0;
const secretFor = (deviceId: string) => `vitest-secret-${deviceId}-0123456789`;

/** A photo whose bytes are a unique marker, so the test can see which one was sent. */
async function photo(marker: string): Promise<number> {
  const [p] = await db.insert(photosTable).values({ data: marker, mime: "image/jpeg" }).returning();
  return p!.id;
}

async function catWithMain(label: string, mainMarker: string) {
  n += 1;
  const photoId = await photo(mainMarker);
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `VitestPrivMatch-${label}-${Date.now()}-${n}`,
      description: "",
      primaryPhotoId: photoId,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng + 0.0001 * n,
      discovererDeviceId: `${PREFIX}seed`,
    })
    .returning();
  return { id: c!.id, photoId };
}

/** An older, resolved sighting of the cat: what the public page falls back to. */
async function olderVisiblePhoto(catId: number, marker: string): Promise<number> {
  const photoId = await photo(marker);
  await db.insert(sightingsTable).values({
    deviceId: `${PREFIX}seed`,
    photoId,
    catId,
    lat: ORIGIN.lat,
    lng: ORIGIN.lng,
    status: "resolved",
    createdAt: new Date(Date.now() - 86_400_000),
  });
  return photoId;
}

async function hide(photoId: number, reason: string | null) {
  await db.insert(photoVisibilityEventsTable).values({
    photoId,
    action: "hide",
    author: staff.id,
    personId: staff.id,
    reason,
  });
}
async function restore(photoId: number) {
  await db.insert(photoVisibilityEventsTable).values({
    photoId,
    action: "restore",
    author: staff.id,
    personId: staff.id,
  });
}

function submit(tag: string) {
  const deviceId = `${PREFIX}${tag}`;
  return request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", secretFor(deviceId))
    .send({
      deviceId,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      photoBase64: TINY_JPEG_B64,
      capturedAt: new Date(Date.now() - 60_000).toISOString(),
    });
}

type Sent = { catId: number; photoBase64: string };
const sent = () => matchCatPhoto.mock.calls.flatMap((call) => call[1] as Sent[]);
const sentFor = (catId: number) => sent().filter((s) => s.catId === catId).map((s) => s.photoBase64);

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = "vitest-privmatch-key-0123456789abcdef-0123456789";
  staff = await signedPerson("privmatch-staff", ["staff"]);
});
beforeEach(async () => {
  matchCatPhoto.mockClear();
  await _resetDeviceMatchLimitForTests();
});
afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

describe("SYC-303: a privacy-hidden main photo is not sent to the matcher", () => {
  it("sends the newest visible photo instead, never the hidden one", async () => {
    const cat = await catWithMain("fallback", "MAIN-PRIVATE-1");
    await olderVisiblePhoto(cat.id, "OLDER-VISIBLE-1");
    await hide(cat.photoId, "privacy");
    const r = await submit("fallback");
    expect(r.status).toBe(201);
    expect(sentFor(cat.id)).toEqual(["OLDER-VISIBLE-1"]);
    expect(sent().map((s) => s.photoBase64)).not.toContain("MAIN-PRIVATE-1");
  });

  it("leaves the cat out when it has no visible photo at all", async () => {
    const cat = await catWithMain("nofallback", "MAIN-PRIVATE-2");
    await hide(cat.photoId, "privacy");
    const other = await catWithMain("other", "MAIN-OTHER-2");
    const r = await submit("nofallback");
    expect(r.status).toBe(201);
    expect(sentFor(cat.id)).toEqual([]);
    expect(sentFor(other.id)).toEqual(["MAIN-OTHER-2"]);
  });

  it("also holds when a photo_private report (not a team hide) is why it is hidden", async () => {
    const cat = await catWithMain("report", "MAIN-PRIVATE-3");
    await olderVisiblePhoto(cat.id, "OLDER-VISIBLE-3");
    await hide(cat.photoId, "photo_private");
    await db.execute(sql`
      insert into welfare_reports (public_id, severity, client_ref, kind, reason, photo_id, photo_state)
      values (${`${PREFIX}report-${cat.photoId}`}, 'attention', ${`${PREFIX}report-${cat.photoId}`}, 'content', 'photo_private', ${cat.photoId}, 'none')`);
    await submit("report");
    expect(sentFor(cat.id)).toEqual(["OLDER-VISIBLE-3"]);
  });
});

describe("SYC-303: other hides and restores are unchanged", () => {
  it("a main photo hidden for another reason is still sent", async () => {
    const cat = await catWithMain("other-reason", "MAIN-BLURRY-4");
    await hide(cat.photoId, "blurry");
    await submit("other-reason");
    expect(sentFor(cat.id)).toEqual(["MAIN-BLURRY-4"]);
  });

  it("a main photo hidden with no reason is still sent", async () => {
    const cat = await catWithMain("no-reason", "MAIN-NOREASON-5");
    await hide(cat.photoId, null);
    await submit("no-reason");
    expect(sentFor(cat.id)).toEqual(["MAIN-NOREASON-5"]);
  });

  it("a privacy hide that was later restored is sent again", async () => {
    const cat = await catWithMain("restored", "MAIN-RESTORED-6");
    await hide(cat.photoId, "privacy");
    await restore(cat.photoId);
    await submit("restored");
    expect(sentFor(cat.id)).toEqual(["MAIN-RESTORED-6"]);
  });
});
