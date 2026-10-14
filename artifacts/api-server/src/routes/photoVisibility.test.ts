import { deleteTestSightings } from "../test/sightings";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import {
  addPerson,
  catsTable,
  catUpdatesTable,
  db,
  deviceCredentialsTable,
  markLeft,
  notificationsTable,
  photosTable,
  photoVisibilityEventsTable,
  pool,
  pushTokensTable,
  catSubscriptionsTable,
  sightingsTable,
  type Cat,
} from "@workspace/db";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  sessionCookieFor,
  signInThroughHandoff,
  TEAM_ORIGIN,
} from "../lib/teamAuth/__fixtures__/queueKit";

// SYC-43 part 2 plan, PR 6: hiding and restoring a photo. Tests P6-1 to P6-9
// (P6-0, the source test, is lib/photoVisibility.source.test.ts). One test
// per public reader (the plan's items 1–7, plus items 9 and 10 that Samuel
// decided on 11 Oct 2026): hide → gone, restore → back. Each has a mutation
// probe recorded in the PR.

// The capability checks run in two layers: requireTeam on the route, and
// can() again inside setPhotoVisibility. Today staff hold every capability,
// so `can` is wrapped (as in team.corrections.test.ts): `denied.cap`, when
// set, is refused to everyone.
const denied = vi.hoisted(() => ({ cap: null as string | null }));
vi.mock("../lib/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/capabilities")>();
  return {
    ...real,
    can: (...args: Parameters<typeof real.can>) =>
      args[1] === denied.cap ? false : real.can(...args),
  };
});

// setPhotoVisibility is wrapped only to count calls, so the route's own
// refusal can be told apart from the one inside the function.
const visibilityCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("../lib/photoVisibility", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/photoVisibility")>();
  return {
    ...real,
    setPhotoVisibility: (...args: Parameters<typeof real.setPhotoVisibility>) => {
      visibilityCalls.n += 1;
      return real.setPhotoVisibility(...args);
    },
  };
});

// The matcher says every nearby cat it is sent is a 0.9 match.
vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async (_photo: string, candidates: { catId: number }[]) => ({
    isCatPhoto: true,
    matches: candidates.map((c) => ({ catId: c.catId, confidence: 0.9, reasoning: "test" })),
  })),
}));
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Every push is recorded instead of sent (P6-7).
const pushes = vi.hoisted(() => [] as unknown[][]);
vi.mock("../lib/push", () => ({
  sendPushNotification: vi.fn(async (...args: unknown[]) => {
    pushes.push(args);
  }),
}));

import app from "../app";
import { setPhotoVisibility } from "../lib/photoVisibility";
import { fanOutNotifications, insertCatUpdate } from "../lib/notificationFanout";
import { _resetDeviceMatchLimitForTests } from "../middlewares/rateLimit";

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-p6-${RUN}-`;
const SUSAN = `vitest-p6-susan-${RUN}@example.com`;
const MARIA = `vitest-p6-maria-${RUN}@example.com`;
const VERA = `vitest-p6-vera-${RUN}@example.com`;
const KEY = "vitest-p6-key-0123456789abcdef-0123456789abcd";
const DEVICE = `${PREFIX}device`;
const SECRET = `vitest-p6-secret-${RUN}-0123456789`;
const handoffKey = makeKey();

// Far out at sea, so no other file's cats are near enough to be matched or
// listed first.
const ORIGIN = { lat: 34.3127, lng: 21.4419 };

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let cookie: string;
let mariaCookie: string;
let volunteerCookie: string;
let susanId: string;
let n = 0;

async function cleanup() {
  const cats = await db
    .select({ id: catsTable.id })
    .from(catsTable)
    .where(like(catsTable.name, `${PREFIX}%`));
  const catIds = cats.map((c) => c.id);
  if (catIds.length > 0) {
    const updates = await db
      .select({ id: catUpdatesTable.id })
      .from(catUpdatesTable)
      .where(inArray(catUpdatesTable.catId, catIds));
    if (updates.length > 0) {
      await db
        .delete(notificationsTable)
        .where(inArray(notificationsTable.catUpdateId, updates.map((u) => u.id)));
    }
    await db.delete(catUpdatesTable).where(inArray(catUpdatesTable.catId, catIds));
    await db.delete(catSubscriptionsTable).where(inArray(catSubscriptionsTable.catId, catIds));
  }
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(pushTokensTable).where(like(pushTokensTable.deviceId, `${PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
  // Photos with hide/restore events stay: the log is append-only, and the
  // throwaway test database goes at the end of the run.
}

interface SeededPhoto {
  id: number;
  publicId: string;
}

async function photo(): Promise<SeededPhoto> {
  n += 1;
  const publicId = `${PREFIX}photo-${n}`;
  const [p] = await db
    .insert(photosTable)
    .values({ publicId, data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  return { id: p!.id, publicId };
}

interface SeededCat {
  id: number;
  name: string;
  main: SeededPhoto;
  /** Its resolved sightings' photos, oldest first. */
  sightings: SeededPhoto[];
}

/** A cat at ORIGIN with a main photo and `count` resolved sightings, a day apart. */
async function seedCat(count = 2, device = `${PREFIX}spotter`): Promise<SeededCat> {
  n += 1;
  const name = `${PREFIX}Μιμή-${n}`;
  const main = await photo();
  const [c] = await db
    .insert(catsTable)
    .values({
      name,
      description: "",
      primaryPhotoId: main.id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      discovererDeviceId: device,
    })
    .returning({ id: catsTable.id });
  const sightings: SeededPhoto[] = [];
  for (let i = 0; i < count; i++) {
    const p = await photo();
    await db.insert(sightingsTable).values({
      catId: c!.id,
      deviceId: device,
      photoId: p.id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      status: "resolved",
      createdAt: new Date(Date.now() - (count - i) * 86_400_000),
    });
    sightings.push(p);
  }
  return { id: c!.id, name, main, sightings };
}

const form = (path: string, c = cookie) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", c).type("form");

const hide = (p: SeededPhoto, catId?: number, c = cookie) =>
  form(`/api/team/photos/${p.publicId}/hide`, c).send(catId ? { cat: String(catId) } : {});
const restore = (p: SeededPhoto, catId?: number, c = cookie) =>
  form(`/api/team/photos/${p.publicId}/restore`, c).send(catId ? { cat: String(catId) } : {});

const url = (p: SeededPhoto) => `/api/photos/${p.publicId}`;

const eventsFor = (p: SeededPhoto) =>
  db
    .select()
    .from(photoVisibilityEventsTable)
    .where(eq(photoVisibilityEventsTable.photoId, p.id))
    .orderBy(photoVisibilityEventsTable.id);

/** The cat as the public catalogue lists it, nearest first from ORIGIN. */
async function listed(catId: number) {
  const res = await request(app).get(`/api/cats?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&pageSize=200`);
  expect(res.status).toBe(200);
  const cat = (res.body.cats as { id: number; photoUrl: string | null }[]).find((c) => c.id === catId);
  expect(cat, "the seeded cat is on the first page").toBeDefined();
  return cat!;
}

async function detail(catId: number) {
  const res = await request(app).get(`/api/cats/${catId}`);
  expect(res.status).toBe(200);
  return res.body as {
    cat: { photoUrl: string | null };
    sightings: { photoUrl: string | null; createdAt: string }[];
  };
}

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await cleanup();
  susanId = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest", roles: ["staff"] })).id;
  cookie = await signInThroughHandoff(app, handoffKey, susanId);
  const maria = await addPerson({ email: MARIA, name: "Maria", addedBy: "cli:vitest", roles: ["staff"] });
  mariaCookie = await signInThroughHandoff(app, handoffKey, maria.id);
  const vera = await addPerson({ email: VERA, name: "Vera", addedBy: "cli:vitest", roles: ["volunteer"] });
  // A session held anyway: the hand-off gives a volunteer none (SYC-188).
  volunteerCookie = sessionCookieFor(vera.id);
});

beforeEach(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
  visibilityCalls.n = 0;
  pushes.length = 0;
  await _resetDeviceMatchLimitForTests();
});

afterAll(async () => {
  await cleanup();
  await markLeft(SUSAN, "cli:vitest");
  await markLeft(MARIA, "cli:vitest").catch(() => {});
  await markLeft(VERA, "cli:vitest");
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

// ── P6-1: the photo route ──────────────────────────────────────────────────

describe("P6-1: GET /api/photos/:publicId", () => {
  it("a hidden photo answers exactly as an unknown id does; restored, it serves again", async () => {
    const cat = await seedCat(0);
    const before = await request(app).get(url(cat.main));
    expect(before.status).toBe(200);

    expect((await hide(cat.main, cat.id)).status).toBe(303);
    const gone = await request(app).get(url(cat.main));
    const unknown = await request(app).get(`/api/photos/${PREFIX}no-such-photo`);
    expect([gone.status, gone.text, gone.headers["content-type"]]).toEqual([
      unknown.status,
      unknown.text,
      unknown.headers["content-type"],
    ]);
    expect(gone.status).toBe(404);
    expect(gone.headers["cache-control"]).toBeUndefined();

    expect((await restore(cat.main, cat.id)).status).toBe(303);
    const back = await request(app).get(url(cat.main));
    expect(back.status).toBe(200);
    expect(back.body).toEqual(before.body);
  });
});

// ── P6-2 and P6-7b: the catalogue ──────────────────────────────────────────

describe("P6-2: GET /api/cats (the catalogue list)", () => {
  it("a hidden main photo is replaced; restoring brings the original back", async () => {
    const cat = await seedCat(2);
    expect((await listed(cat.id)).photoUrl).toBe(url(cat.main));
    await hide(cat.main, cat.id);
    expect((await listed(cat.id)).photoUrl).toBe(url(cat.sightings[1]!));
    await restore(cat.main, cat.id);
    expect((await listed(cat.id)).photoUrl).toBe(url(cat.main));
  });
});

describe("P6-7b: what stands in for a hidden main photo (Decision 4)", () => {
  it("the newest visible photo, then the next, then none; cats.primary_photo_id never changes", async () => {
    const cat = await seedCat(2);
    const [older, newer] = cat.sightings as [SeededPhoto, SeededPhoto];
    await hide(cat.main, cat.id);
    expect((await detail(cat.id)).cat.photoUrl).toBe(url(newer));
    await hide(newer, cat.id);
    expect((await detail(cat.id)).cat.photoUrl).toBe(url(older));
    expect((await listed(cat.id)).photoUrl).toBe(url(older));
    await hide(older, cat.id);
    expect((await detail(cat.id)).cat.photoUrl).toBeNull();
    expect((await listed(cat.id)).photoUrl).toBeNull();

    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, cat.id));
    expect(row!.primaryPhotoId).toBe(cat.main.id);

    await restore(cat.main, cat.id);
    expect((await detail(cat.id)).cat.photoUrl).toBe(url(cat.main));
    expect((await listed(cat.id)).photoUrl).toBe(url(cat.main));
  });

  it("only a confirmed sighting's photo can stand in: never a pending or awaiting-team one (review, finding 1)", async () => {
    const cat = await seedCat(1);
    // Newer than the confirmed sighting, but not on the cat's public page.
    for (const status of ["pending", "awaiting_team"] as const) {
      const p = await photo();
      await db.insert(sightingsTable).values({
        catId: cat.id,
        deviceId: `${PREFIX}spotter`,
        photoId: p.id,
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        status,
        createdAt: new Date(),
      });
    }
    await hide(cat.main, cat.id);
    expect((await detail(cat.id)).cat.photoUrl).toBe(url(cat.sightings[0]!));
    expect((await listed(cat.id)).photoUrl).toBe(url(cat.sightings[0]!));
  });

  it("a hidden sighting photo that isn't the main one never changes the cat's photo", async () => {
    const cat = await seedCat(2);
    await hide(cat.sightings[1]!, cat.id);
    expect((await detail(cat.id)).cat.photoUrl).toBe(url(cat.main));
    expect((await listed(cat.id)).photoUrl).toBe(url(cat.main));
  });
});

// ── P6-3: a cat's public page ──────────────────────────────────────────────

describe("P6-3: GET /api/cats/:id", () => {
  it("a sighting whose photo is hidden stays, with no photo; restored, the photo is back", async () => {
    const cat = await seedCat(2);
    const before = await detail(cat.id);
    expect(before.sightings.map((s) => s.photoUrl)).toEqual([url(cat.sightings[1]!), url(cat.sightings[0]!)]);

    await hide(cat.sightings[1]!, cat.id);
    const after = await detail(cat.id);
    expect(after.sightings).toHaveLength(2);
    expect(after.sightings.map((s) => s.photoUrl)).toEqual([null, url(cat.sightings[0]!)]);
    expect(after.sightings[0]!.createdAt).toBe(before.sightings[0]!.createdAt);

    await restore(cat.sightings[1]!, cat.id);
    expect(await detail(cat.id)).toEqual(before);
  });

  it("the main photo is replaced on the cat's page too", async () => {
    const cat = await seedCat(1);
    await hide(cat.main, cat.id);
    expect((await detail(cat.id)).cat.photoUrl).toBe(url(cat.sightings[0]!));
  });

  it("nothing on the page carries a hidden photo's id, anywhere", async () => {
    const cat = await seedCat(2);
    await hide(cat.main, cat.id);
    await hide(cat.sightings[0]!, cat.id);
    const res = await request(app).get(`/api/cats/${cat.id}`);
    expect(res.text).not.toContain(cat.main.publicId);
    expect(res.text).not.toContain(cat.sightings[0]!.publicId);
  });
});

// ── P6-4: matching a sighting ──────────────────────────────────────────────

let captureOffsetMs = 0;
function submitSighting() {
  captureOffsetMs += 1000;
  return request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", SECRET)
    .send({
      deviceId: DEVICE,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      photoBase64: TINY_JPEG_B64,
      capturedAt: new Date(Date.now() - 3_600_000 - captureOffsetMs).toISOString(),
    });
}

describe("P6-4: POST /api/sightings candidates, and the cat in the resolve reply", () => {
  it("a candidate's hidden main photo is replaced, and so is the resolved cat's; restored, both are back", async () => {
    // Clear the area of this file's other cats, so this one is a candidate.
    await cleanup();
    const cat = await seedCat(1);

    const first = await submitSighting();
    expect(first.status).toBe(201);
    const candidate = () =>
      (first.body.candidates as { catId: number; photoUrl: string | null }[]).find((c) => c.catId === cat.id);
    expect(candidate()?.photoUrl).toBe(url(cat.main));

    await hide(cat.main, cat.id);
    const hidden = await submitSighting();
    const hiddenCandidate = (hidden.body.candidates as { catId: number; photoUrl: string | null }[]).find(
      (c) => c.catId === cat.id,
    );
    expect(hiddenCandidate?.photoUrl).toBe(url(cat.sightings[0]!));
    expect(hidden.text).not.toContain(cat.main.publicId);

    const resolved = await request(app)
      .post(`/api/sightings/${hidden.body.sightingId}/resolve`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, catId: cat.id });
    expect(resolved.status).toBe(200);
    // The sighting just confirmed is now the cat's newest visible photo, so
    // it stands in for the hidden main photo (Decision 4).
    const [mine] = await db
      .select({ publicId: photosTable.publicId })
      .from(sightingsTable)
      .innerJoin(photosTable, eq(photosTable.id, sightingsTable.photoId))
      .where(eq(sightingsTable.id, hidden.body.sightingId));
    expect(resolved.body.cat.photoUrl).toBe(`/api/photos/${mine!.publicId}`);
    expect(resolved.text).not.toContain(cat.main.publicId);

    await restore(cat.main, cat.id);
    const again = await submitSighting();
    const restored = (again.body.candidates as { catId: number; photoUrl: string | null }[]).find(
      (c) => c.catId === cat.id,
    );
    expect(restored?.photoUrl).toBe(url(cat.main));
  });
});

// ── P6-5: the in-app notifications list ────────────────────────────────────

describe("P6-5: GET /api/notifications/:deviceId", () => {
  it("a notification's cat photo is replaced while hidden, and back after restore", async () => {
    const cat = await seedCat(1);
    const [update] = await db
      .insert(catUpdatesTable)
      .values({ catId: cat.id, updateType: "general", message: "Fed today" })
      .returning();
    await db.insert(notificationsTable).values({ deviceId: DEVICE, catUpdateId: update!.id });
    const read = async () => {
      const res = await request(app).get(`/api/notifications/${DEVICE}`).set("X-Device-Secret", SECRET);
      expect(res.status).toBe(200);
      return res;
    };
    const mine = (res: request.Response) =>
      (res.body as { catId: number; catPhotoUrl: string | null }[]).find((r) => r.catId === cat.id)!;

    expect(mine(await read()).catPhotoUrl).toBe(url(cat.main));
    await hide(cat.main, cat.id);
    const hidden = await read();
    expect(mine(hidden).catPhotoUrl).toBe(url(cat.sightings[0]!));
    expect(hidden.text).not.toContain(cat.main.publicId);
    await hide(cat.sightings[0]!, cat.id);
    expect(mine(await read()).catPhotoUrl).toBeNull();
    await restore(cat.main, cat.id);
    expect(mine(await read()).catPhotoUrl).toBe(url(cat.main));
  });
});

// ── P6-6: "cats known around here" ─────────────────────────────────────────

describe("P6-6: the hand-pick list (SYC-119) reads the catalogue", () => {
  it("the nearby-first catalogue the picker reads replaces a hidden main photo", async () => {
    // The phone builds "cats known around here" from GET /api/cats sorted
    // from where the spotter stands; there is no separate server list.
    const cat = await seedCat(1);
    await hide(cat.main, cat.id);
    const res = await request(app).get(`/api/cats?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&pageSize=200`);
    expect(res.text).not.toContain(cat.main.publicId);
    expect((await listed(cat.id)).photoUrl).toBe(url(cat.sightings[0]!));
  });
});

// ── P6-7: push notifications ───────────────────────────────────────────────

describe("P6-7: push notifications carry no photo address", () => {
  it("a care update's push names the cat and the message only, hidden photo or not", async () => {
    const cat = await seedCat(1);
    await db.insert(catSubscriptionsTable).values({ catId: cat.id, deviceId: DEVICE });
    await db.insert(pushTokensTable).values({ deviceId: DEVICE, token: `ExponentPushToken[${PREFIX}]` });
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, cat.id));
    for (const hidden of [false, true]) {
      if (hidden) await hide(cat.main, cat.id);
      pushes.length = 0;
      const update = await insertCatUpdate(db, {
        cat: row as Cat,
        updateType: "general",
        message: "Fed today",
      });
      await fanOutNotifications({ cat: row as Cat, update });
      await vi.waitFor(() => expect(pushes.length).toBe(1));
      const sent = JSON.stringify(pushes);
      expect(sent).not.toContain("/api/photos/");
      expect(sent).not.toContain(cat.main.publicId);
      expect(sent).not.toMatch(/photo/i);
    }
  });
});

// ── Items 9 and 10 (Samuel, 11 Oct 2026) ───────────────────────────────────

describe("P6-9n: the NAME_TAKEN reply (item 9: as the catalogue)", () => {
  it("names the cat with the photo the catalogue shows, and the original after restore", async () => {
    const cat = await seedCat(1);
    // SYC-130 removed POST /cats (D7): an owner renaming their own cat to the
    // taken name gets the same NAME_TAKEN reply (nameTakenBody).
    const [own] = await db
      .insert(catsTable)
      .values({
        name: `${PREFIX}renamer-${n}`,
        description: "",
        primaryPhotoId: cat.main.id,
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        discovererDeviceId: DEVICE,
        ownerDeviceId: DEVICE,
      })
      .returning({ id: catsTable.id });
    const register = () =>
      request(app)
        .patch(`/api/cats/${own!.id}`)
        .set("X-Device-Secret", SECRET)
        .send({ deviceId: DEVICE, name: cat.name });
    const first = await register();
    expect(first.status).toBe(409);
    expect(first.body.cat.photoUrl).toBe(url(cat.main));
    await hide(cat.main, cat.id);
    const taken = await register();
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: "NAME_TAKEN", cat: { id: cat.id, photoUrl: url(cat.sightings[0]!) } });
    expect(taken.text).not.toContain(cat.main.publicId);
    await restore(cat.main, cat.id);
    expect((await register()).body.cat.photoUrl).toBe(url(cat.main));
  });
});

describe("P6-10: the 'Anything to add?' card (item 10: no photo, even for its spotter)", () => {
  it("the spotter's own sighting stays on the card without its hidden photo", async () => {
    const cat = await seedCat(0);
    const own = await photo();
    await db.insert(sightingsTable).values({
      catId: cat.id,
      deviceId: DEVICE,
      photoId: own.id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      status: "resolved",
      createdAt: new Date(Date.now() - 3_600_000),
    });
    const card = async () => {
      const res = await request(app)
        .get(`/api/profiles/${DEVICE}/cats/${cat.id}/open-sightings`)
        .set("X-Device-Secret", SECRET);
      expect(res.status).toBe(200);
      return res;
    };
    const photos = (res: request.Response) =>
      (res.body.sightings as { photoUrl: string | null }[]).map((s) => s.photoUrl);
    expect(photos(await card())).toEqual([url(own)]);
    await hide(own, cat.id);
    const hidden = await card();
    expect(photos(hidden)).toEqual([null]);
    expect(hidden.text).not.toContain(own.publicId);
    await restore(own, cat.id);
    expect(photos(await card())).toEqual([url(own)]);
  });
});

// ── P6-8: staff still see it ───────────────────────────────────────────────

describe("P6-8: staff still see a hidden photo, labelled with who hid it and when", () => {
  it("the team page shows it, with Restore, and the team photo route still serves it", async () => {
    const cat = await seedCat(1);
    const res = await hide(cat.main, cat.id);
    expect(res.headers["location"]).toBe(
      `/api/team/cats/${cat.id}?done=hidden&p=${cat.main.publicId}#p-${cat.main.publicId}`,
    );
    const page = await request(app).get(res.headers["location"]!).set("Cookie", cookie);
    expect(page.status).toBe(200);
    const figure = page.text.slice(page.text.indexOf(`id="p-${cat.main.publicId}"`));
    const tile = figure.slice(0, figure.indexOf("</figure>"));
    expect(tile).toContain(`src="/api/team/photos/${cat.main.publicId}"`);
    expect(tile).toMatch(/Hidden from the public by Susan, <time datetime="[^"]+">\d{1,2} [A-Z][a-z]{2} \d{4}<\/time>/);
    expect(tile).toContain(`action="/api/team/photos/${cat.main.publicId}/restore"`);
    // The message lands beside the photo, once.
    expect(tile).toContain("Hidden. The public no longer sees this photo.");
    expect(page.text.split("Hidden. The public no longer sees this photo.")).toHaveLength(2);
    // The overview says the public sees another photo instead.
    expect(page.text).toContain("The main photo is hidden from the public.");

    const bytes = await request(app).get(`/api/team/photos/${cat.main.publicId}`).set("Cookie", cookie);
    expect(bytes.status).toBe(200);

    const json = await request(app).get(`/api/team/cats/${cat.id}`).set("Cookie", cookie).set("Accept", "application/json");
    const main = (json.body.photos as { publicId: string; hidden: { by: string } | null }[]).find(
      (p) => p.publicId === cat.main.publicId,
    );
    expect(main?.hidden?.by).toBe("Susan");
    const other = (json.body.photos as { publicId: string; hidden: unknown }[]).find(
      (p) => p.publicId === cat.sightings[0]!.publicId,
    );
    expect(other?.hidden).toBeNull();
  });

  it("a team member who has since left is named with (left)", async () => {
    const cat = await seedCat(0);
    expect((await hide(cat.main, cat.id, mariaCookie)).status).toBe(303);
    await markLeft(MARIA, "cli:vitest");
    const page = await request(app).get(`/api/team/cats/${cat.id}`).set("Cookie", cookie);
    expect(page.text).toContain("Hidden from the public by Maria (left),");
  });

  it("a photo that isn't hidden has Hide, and no label", async () => {
    const cat = await seedCat(0);
    const page = await request(app).get(`/api/team/cats/${cat.id}`).set("Cookie", cookie);
    expect(page.text).toContain(`action="/api/team/photos/${cat.main.publicId}/hide"`);
    expect(page.text).not.toContain("Hidden from the public by");
  });

  it("?done= and ?p= never reach Object.prototype or echo", async () => {
    const cat = await seedCat(0);
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const page = await request(app)
        .get(`/api/team/cats/${cat.id}?done=${key}&p=${key}`)
        .set("Cookie", cookie);
      expect(page.status, key).toBe(200);
      expect(page.text).not.toContain('class="notice"');
    }
    const odd = await request(app).get(`/api/team/cats/${cat.id}?done=hidden&p=%3Cscript%3E`).set("Cookie", cookie);
    expect(odd.text).not.toContain("<script>");
  });
});

// ── P6-9: add-only ─────────────────────────────────────────────────────────

describe("P6-9: events are only ever inserted", () => {
  it("hide → restore → hide gives three rows, signed by the person, oldest first", async () => {
    const cat = await seedCat(0);
    await hide(cat.main, cat.id);
    await restore(cat.main, cat.id);
    await hide(cat.main, cat.id);
    const rows = await eventsFor(cat.main);
    expect(rows.map((r) => r.action)).toEqual(["hide", "restore", "hide"]);
    expect(rows.every((r) => r.author === susanId && r.personId === susanId)).toBe(true);
    expect(rows.every((r, i) => i === 0 || r.at.getTime() >= rows[i - 1]!.at.getTime())).toBe(true);
  });

  it("hiding a hidden photo, or restoring a public one, writes nothing and says so", async () => {
    const cat = await seedCat(0);
    const restoreFirst = await restore(cat.main, cat.id);
    expect(restoreFirst.headers["location"]).toContain("done=already_public");
    await hide(cat.main, cat.id);
    const again = await hide(cat.main, cat.id);
    expect(again.headers["location"]).toContain("done=already_hidden");
    expect(await eventsFor(cat.main)).toHaveLength(1);
    const json = await request(app)
      .post(`/api/team/photos/${cat.main.publicId}/hide`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({});
    expect([json.status, json.body.code]).toEqual([409, "ALREADY_HIDDEN"]);
  });

  it("the database refuses an update or a delete (the trigger stays the backstop)", async () => {
    const cat = await seedCat(0);
    await hide(cat.main, cat.id);
    await expect(
      db.update(photoVisibilityEventsTable).set({ action: "restore" }).where(eq(photoVisibilityEventsTable.photoId, cat.main.id)),
    ).rejects.toThrow();
    await expect(
      db.delete(photoVisibilityEventsTable).where(eq(photoVisibilityEventsTable.photoId, cat.main.id)),
    ).rejects.toThrow();
    expect(await eventsFor(cat.main)).toHaveLength(1);
  });

  it("an unknown photo is a 404, and nothing is written", async () => {
    const res = await form(`/api/team/photos/${PREFIX}nothing/hide`).send({});
    expect(res.status).toBe(404);
    const json = await request(app)
      .post(`/api/team/photos/${PREFIX}nothing/hide`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({});
    expect(json.status).toBe(404);
  });
});

// ── Who may ────────────────────────────────────────────────────────────────

describe("each route is refused without its capability, in both layers", () => {
  it("a person whose scopes grant nothing gets the identical 401, and nothing is written", async () => {
    const cat = await seedCat(0);
    for (const res of [await hide(cat.main, cat.id, volunteerCookie), await restore(cat.main, cat.id, volunteerCookie)]) {
      expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    }
    expect(await eventsFor(cat.main)).toHaveLength(0);
  });

  it("the route refuses staff lacking that capability before the write is even tried", async () => {
    const cat = await seedCat(0);
    denied.cap = "hide_photo";
    const res = await hide(cat.main, cat.id);
    expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect(visibilityCalls.n).toBe(0);
    denied.cap = null;
    await hide(cat.main, cat.id);
    denied.cap = "restore_photo";
    const back = await restore(cat.main, cat.id);
    expect([back.status, back.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect(visibilityCalls.n).toBe(1);
    expect((await eventsFor(cat.main)).map((r) => r.action)).toEqual(["hide"]);
  });

  it("setPhotoVisibility refuses on its own, whatever route calls it", async () => {
    const cat = await seedCat(0);
    const volunteer = { id: susanId, scopes: [{ role: "volunteer", colonyId: null }] };
    expect(await setPhotoVisibility(volunteer, { publicId: cat.main.publicId, action: "hide" })).toEqual({
      kind: "not_authorised",
    });
    const staff = { id: susanId, scopes: [{ role: "staff", colonyId: null }] };
    denied.cap = "hide_photo";
    expect(await setPhotoVisibility(staff, { publicId: cat.main.publicId, action: "hide" })).toEqual({
      kind: "not_authorised",
    });
    denied.cap = "restore_photo";
    expect((await setPhotoVisibility(staff, { publicId: cat.main.publicId, action: "hide" })).kind).toBe("changed");
    expect(await setPhotoVisibility(staff, { publicId: cat.main.publicId, action: "restore" })).toEqual({
      kind: "not_authorised",
    });
    expect((await eventsFor(cat.main)).map((r) => r.action)).toEqual(["hide"]);
  });

  it("the team page shows Hide or Restore only to someone who may", async () => {
    const cat = await seedCat(1);
    await hide(cat.main, cat.id);
    denied.cap = "hide_photo";
    const page = await request(app).get(`/api/team/cats/${cat.id}`).set("Cookie", cookie);
    expect(page.text).not.toContain(`/api/team/photos/${cat.sightings[0]!.publicId}/hide"`);
    expect(page.text).toContain(`/api/team/photos/${cat.main.publicId}/restore"`);
    denied.cap = "restore_photo";
    const page2 = await request(app).get(`/api/team/cats/${cat.id}`).set("Cookie", cookie);
    expect(page2.text).not.toContain(`/api/team/photos/${cat.main.publicId}/restore"`);
    expect(page2.text).toContain(`/api/team/photos/${cat.sightings[0]!.publicId}/hide"`);
  });

  it("every POST is refused from another Origin or none, before anything is read", async () => {
    const cat = await seedCat(0);
    for (const action of ["hide", "restore"]) {
      const path = `/api/team/photos/${cat.main.publicId}/${action}`;
      const evil = await request(app).post(path).set("Origin", "https://evil.catspotters.com").set("Cookie", cookie).type("form").send({});
      expect([evil.status, evil.text]).toEqual([401, '{"error":"not_signed_in"}']);
      const none = await request(app).post(path).set("Cookie", cookie).type("form").send({});
      expect(none.status).toBe(401);
    }
    expect(visibilityCalls.n).toBe(0);
    expect(await eventsFor(cat.main)).toHaveLength(0);
  });
});

// ── Two tabs, and a burst ──────────────────────────────────────────────────

describe("at the same moment", () => {
  it("six tabs hiding the same photo write one event; the rest are told someone already did", async () => {
    const cat = await seedCat(0);
    // Widen the race: each insert waits 150 ms before it lands, so without
    // the photo row lock every tab would read "not hidden" and write a hide.
    await db.execute(sql`create or replace function vt_p6_slow_insert() returns trigger language plpgsql as $$
      begin perform pg_sleep(0.15); return new; end $$`);
    await db.execute(sql`create trigger vt_p6_slow_insert before insert on photo_visibility_events
      for each row execute function vt_p6_slow_insert()`);
    let results: request.Response[];
    try {
      results = await Promise.all(Array.from({ length: 6 }, () => hide(cat.main, cat.id)));
    } finally {
      await db.execute(sql`drop trigger if exists vt_p6_slow_insert on photo_visibility_events`);
      await db.execute(sql`drop function if exists vt_p6_slow_insert()`);
    }
    expect(results.every((r) => r.status === 303)).toBe(true);
    const already = results.filter((r) => String(r.headers["location"]).includes("done=already_hidden"));
    expect(already).toHaveLength(5);
    expect(await eventsFor(cat.main)).toHaveLength(1);
  });

  it("hide and restore racing on one photo leave the log and the public answer in agreement", async () => {
    const cat = await seedCat(0);
    await Promise.all([hide(cat.main, cat.id), restore(cat.main, cat.id), hide(cat.main, cat.id), restore(cat.main, cat.id)]);
    const rows = await eventsFor(cat.main);
    // The log alternates: no two hides or restores in a row.
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.action).not.toBe(rows[i - 1]!.action);
    const hiddenNow = rows.at(-1)?.action === "hide";
    expect((await request(app).get(url(cat.main))).status).toBe(hiddenNow ? 404 : 200);
  });

  it("a burst of taps across many photos doesn't exhaust the connection pool", async () => {
    const photos: SeededPhoto[] = [];
    for (let i = 0; i < 14; i++) photos.push(await photo());
    const results = await Promise.all(photos.flatMap((p) => [hide(p), hide(p)]));
    expect(results.every((r) => r.status === 303)).toBe(true);
    const rows = await db
      .select()
      .from(photoVisibilityEventsTable)
      .where(and(inArray(photoVisibilityEventsTable.photoId, photos.map((p) => p.id))));
    expect(rows).toHaveLength(14);
  }, 20_000);
});
