/**
 * Data spine PR 6 (SYC-41): turning on blurring.
 *
 * cat-record-data-spine.md §10.8.8: every public payload, asserted against
 * all four emitters in §10.6 by name, contains no exact coordinate, no
 * sighting coordinate, no note, no private feeding site and no raw device id.
 *
 * §10.8.9: the same public request repeated a hundred times with varied
 * viewer positions returns byte-identical geography.
 *
 * Plus the pieces around them: the owner's exact view on the detail page
 * only (§10.6 Option B), coarse distances and stable ordering (§6.4.2–3),
 * dates not times (§6.4.4), and the paged catalogue (§2.3).
 *
 * Mutation probe (plan, PR 6 "Assurance"): route any one emitter around
 * serialiseCat — e.g. put `lat: cat.lat, lng: cat.lng` back into the resolve
 * response — and the matching "emitter N" test below goes red.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool, catsTable, photosTable, sightingsTable, feedingSitesTable } from "@workspace/db";
import { writeObservation } from "../lib/observations";
import { blurPosition } from "../lib/blur";
import { BLUR_CELL_METRES } from "../lib/blur";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const RUN = randomBytes(4).toString("hex");
const CAT_PREFIX = `VitestBlur-${RUN}`;
const SECRET = `vitest-blur-secret-${RUN}-0123456789`;
/** Raw device ids: none of these may ever appear in a public payload. */
const DISCOVERER = `vitest-blur-discoverer-${RUN}`;
const OWNER = `vitest-blur-owner-${RUN}`;
const SPOTTER = `vitest-blur-spotter-${RUN}`;
const STRANGER = `vitest-blur-stranger-${RUN}`;
const DEVICE_IDS = [DISCOVERER, OWNER, SPOTTER, STRANGER];

/** Exact positions, with digits no cell centre will share. */
const CAT_EXACT = { lat: 37.4431234567, lng: 24.9445678912 };
const OWNED_EXACT = { lat: 37.4467891234, lng: 24.9401234598 };
const SIGHTING_EXACT = { lat: 37.4433456789, lng: 24.9447891234 };
const FEEDING_EXACT = { lat: 37.4429876543, lng: 24.9443210987 };
const NOTE_TEXT = `private note ${RUN}: the feeder comes at 7am by the blue door`;
const FEEDING_NAME = `Secret bowl ${RUN}`;

const EXACT_NUMBERS = [CAT_EXACT, OWNED_EXACT, SIGHTING_EXACT, FEEDING_EXACT].flatMap((p) => [
  p.lat,
  p.lng,
]);

let catId = 0;
let ownedCatId = 0;
let resolveBody: Record<string, unknown> = {};

async function insertPhoto(): Promise<number> {
  const [p] = await db.insert(photosTable).values({ data: TINY_JPEG_B64, mime: "image/jpeg" }).returning();
  return p!.id;
}

/** Every number anywhere in a JSON value. */
function numbersIn(v: unknown, out: number[] = []): number[] {
  if (typeof v === "number") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => numbersIn(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => numbersIn(x, out));
  return out;
}

/** Every key anywhere in a JSON value. */
function keysIn(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysIn(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysIn(x, out);
    }
  }
  return out;
}

/** Every string anywhere in a JSON value. */
function stringsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsIn(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => stringsIn(x, out));
  return out;
}

/** Syros sits inside these: a coordinate-shaped number falls in one of them. */
const isLatLike = (n: number) => n > 36 && n < 39;
const isLngLike = (n: number) => n > 24 && n < 26;

/**
 * Review of #95, finding 5: "not within 1 cm of the truth" let a coordinate
 * rounded to 1 m, or one sent as text, through. So instead: any non-integer
 * number shaped like a Syros latitude or longitude, in a number or inside a
 * string, must be a published cell centre, or the payload fails.
 */
function expectOnlyCellCentres(payload: unknown) {
  const candidates = [
    ...numbersIn(payload),
    ...stringsIn(payload).flatMap((t) => (t.match(/-?\d+\.\d+/g) ?? []).map(Number)),
  ].filter((n) => !Number.isInteger(n));
  for (const n of candidates) {
    if (isLatLike(n)) {
      expect(blurPosition(n, 24.94).lat, `latitude-shaped ${n} is not a cell centre`).toBe(n);
    }
    if (isLngLike(n)) {
      expect(blurPosition(37.44, n).lng, `longitude-shaped ${n} is not a cell centre`).toBe(n);
    }
  }
}

/** §10.8.8, the whole list, for one payload. */
function expectNothingPrivate(payload: unknown) {
  const json = JSON.stringify(payload);
  expectOnlyCellCentres(payload);
  for (const n of numbersIn(payload)) {
    for (const exact of EXACT_NUMBERS) {
      // Within ~1 cm of an exact coordinate counts as the exact coordinate.
      expect(Math.abs(n - exact), `exact coordinate ${exact} leaked as ${n}`).toBeGreaterThan(1e-7);
    }
  }
  // The seeded positions' distinctive sub-metre digits, in any text form.
  // (Published centres keep 6 decimals, so they never carry these.)
  for (const exact of EXACT_NUMBERS) {
    const digits = String(exact).split(".")[1]!.slice(3, 9);
    expect(json, `exact coordinate ${exact} leaked as text`).not.toContain(digits);
  }
  expect(json).not.toContain(NOTE_TEXT);
  expect(json).not.toContain(FEEDING_NAME);
  for (const id of DEVICE_IDS) expect(json).not.toContain(id);
  const keys = keysIn(payload);
  for (const banned of ["deviceId", "ownerDeviceId", "discovererDeviceId", "note", "feedingSites"]) {
    expect(keys).not.toContain(banned);
  }
}

/** The cat-shaped object every emitter sends must be the public cell. */
function expectPublicCat(cat: Record<string, unknown>, exact: { lat: number; lng: number }) {
  const cell = blurPosition(exact.lat, exact.lng);
  expect(cat["lat"]).toBe(cell.lat);
  expect(cat["lng"]).toBe(cell.lng);
  expect(cat["locationPrecision"]).toBe("approximate");
  expect(cat["locationCellM"]).toBe(BLUR_CELL_METRES);
  expect(cat["lastSeenAt"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
}

async function listAll(query: Record<string, string | number> = {}) {
  const cats: Record<string, unknown>[] = [];
  const pages: unknown[] = [];
  for (let page: number | null = 1; page !== null; ) {
    const res = await request(app).get("/api/cats").query({ ...query, page, pageSize: 200 });
    expect(res.status).toBe(200);
    pages.push(res.body);
    cats.push(...res.body.cats);
    page = res.body.nextPage;
  }
  return { cats, pages };
}

beforeAll(async () => {
  const photoId = await insertPhoto();
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${CAT_PREFIX}-street`,
      description: "",
      primaryPhotoId: photoId,
      ...CAT_EXACT,
      discovererDeviceId: DISCOVERER,
    })
    .returning();
  catId = cat!.id;

  // A resolved public sighting at its own exact position, carrying a note.
  const [s] = await db
    .insert(sightingsTable)
    .values({
      deviceId: SPOTTER,
      photoId: await insertPhoto(),
      ...SIGHTING_EXACT,
      status: "resolved",
      catId,
    })
    .returning();
  await writeObservation(db, {
    catId,
    kind: "note",
    value: { text: NOTE_TEXT },
    deviceId: SPOTTER,
    roleAtTime: "public",
    sightingId: s!.id,
    observedAt: new Date(),
  });

  // A private feeding site right next to the cat (§6.7: absent, not blurred).
  await db.insert(feedingSitesTable).values({ name: FEEDING_NAME, ...FEEDING_EXACT, isPublic: false });

  // An owned cat, registered through the route so the owner is bound to its secret.
  const reg = await request(app)
    .post("/api/cats")
    .set("X-Device-Secret", SECRET)
    .send({
      deviceId: OWNER,
      name: `${CAT_PREFIX}-owned`,
      ownerName: "Eleni",
      homeDescription: "Blue door",
      ...OWNED_EXACT,
    });
  expect(reg.status).toBe(201);
  ownedCatId = reg.body.id;

  // Emitter 3: a spotter resolves a new sighting to the street cat.
  const [pending] = await db
    .insert(sightingsTable)
    .values({ deviceId: SPOTTER, photoId: await insertPhoto(), ...SIGHTING_EXACT, status: "pending" })
    .returning();
  const res = await request(app)
    .post(`/api/sightings/${pending!.id}/resolve`)
    .set("X-Device-Secret", SECRET)
    .send({ deviceId: SPOTTER, catId });
  expect(res.status).toBe(200);
  resolveBody = res.body;
});

afterAll(async () => {
  await pool.end();
});

describe("§10.8.8: no public payload carries anything private, by emitter", () => {
  it("emitter 1, listCatsWithStats (GET /cats)", async () => {
    const { cats, pages } = await listAll({ lat: 37.45, lng: 24.93 });
    for (const page of pages) expectNothingPrivate(page);
    const mine = cats.find((c) => c["id"] === catId)!;
    const owned = cats.find((c) => c["id"] === ownedCatId)!;
    expectPublicCat(mine, CAT_EXACT);
    // The list is always public, even for a cat that has an owner (Option B).
    expectPublicCat(owned, OWNED_EXACT);
  });

  it("emitter 2, catPayload (GET /cats/:id, public)", async () => {
    const res = await request(app).get(`/api/cats/${catId}`);
    expect(res.status).toBe(200);
    expectNothingPrivate(res.body);
    expectPublicCat(res.body.cat, CAT_EXACT);
  });

  it("emitter 3, the inline cat in the resolve response (POST /sightings/:id/resolve)", () => {
    // The response's own `profile` is the spotter's private payload and
    // carries their device id by design; the cat in it must be public.
    const cat = resolveBody["cat"] as Record<string, unknown>;
    expectNothingPrivate(cat);
    expectPublicCat(cat, CAT_EXACT);
  });

  it("emitter 4, the sightings array (GET /cats/:id)", async () => {
    const res = await request(app).get(`/api/cats/${catId}`);
    const sightings = res.body.sightings as Record<string, unknown>[];
    expect(sightings.length).toBeGreaterThanOrEqual(2);
    expectNothingPrivate(sightings);
    for (const s of sightings) {
      // No id either: ids are handed out in upload order, a clock (review of #95).
      expect(Object.keys(s)).not.toContain("id");
      expect(Object.keys(s)).not.toContain("lat");
      expect(Object.keys(s)).not.toContain("lng");
      expect(s["createdAt"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("the care timeline carries dates, not times", async () => {
    const res = await request(app).get(`/api/cats/${catId}`);
    for (const e of res.body.careTimeline as { at: string }[]) {
      expect(e.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("§10.6 Option B: an owner sees their own cat exactly, on its page only", () => {
  it("a proven owner gets the exact position on the detail page", async () => {
    const res = await request(app)
      .get(`/api/cats/${ownedCatId}`)
      .set("X-Device-Id", OWNER)
      .set("X-Device-Secret", SECRET);
    expect(res.body.cat.lat).toBe(OWNED_EXACT.lat);
    expect(res.body.cat.lng).toBe(OWNED_EXACT.lng);
    expect(res.body.cat.locationPrecision).toBe("exact");
    expect(res.body.cat.locationCellM).toBeNull();
    // Still no sighting positions, even for the owner (§6.4.1).
    for (const s of res.body.sightings) expect(Object.keys(s)).not.toContain("lat");
  });

  it("the owner's id with the wrong secret gets the public view, with no error", async () => {
    const res = await request(app)
      .get(`/api/cats/${ownedCatId}`)
      .set("X-Device-Id", OWNER)
      .set("X-Device-Secret", "the-wrong-secret-0123456789");
    expect(res.status).toBe(200);
    expectPublicCat(res.body.cat, OWNED_EXACT);
  });

  it("another proven device gets the public view of someone else's cat", async () => {
    await request(app).get(`/api/profiles/${STRANGER}`).set("X-Device-Secret", SECRET);
    const res = await request(app)
      .get(`/api/cats/${ownedCatId}`)
      .set("X-Device-Id", STRANGER)
      .set("X-Device-Secret", SECRET);
    expectPublicCat(res.body.cat, OWNED_EXACT);
  });

  it("the owner's id alone (no secret) gets the public view", async () => {
    const res = await request(app).get(`/api/cats/${ownedCatId}`).set("X-Device-Id", OWNER);
    expectPublicCat(res.body.cat, OWNED_EXACT);
  });
});

describe("§10.8.9: geography is the same for every viewer, every time", () => {
  it("a hundred requests from varied viewer positions return byte-identical geography", async () => {
    const geography = (cats: Record<string, unknown>[]) =>
      JSON.stringify(
        cats
          .map((c) => [c["id"], c["lat"], c["lng"], c["locationPrecision"], c["locationCellM"]])
          .sort((a, b) => (a[0] as number) - (b[0] as number)),
      );
    const first = geography((await listAll()).cats);
    for (let i = 0; i < 100; i++) {
      const viewer = { lat: 37.40 + (i % 10) * 0.01, lng: 24.89 + Math.floor(i / 10) * 0.01 };
      const res = await request(app).get("/api/cats").query({ ...viewer, pageSize: 200 });
      const all = [...res.body.cats];
      for (let p = res.body.nextPage; p !== null; ) {
        const next = await request(app).get("/api/cats").query({ ...viewer, page: p, pageSize: 200 });
        all.push(...next.body.cats);
        p = next.body.nextPage;
      }
      expect(geography(all)).toBe(first);
    }
  });
});

describe("§6.4.2–3: coarse distance, stable order", () => {
  it("distance is to the cell centre, rounded to 100 m", async () => {
    const { cats } = await listAll({ lat: 37.45, lng: 24.93 });
    for (const c of cats) {
      const km = c["distanceKm"] as number;
      expect(Math.round(km * 10) / 10).toBe(km);
    }
  });

  it("sorted by that distance, ties broken by id, never by anything exact", async () => {
    const { cats } = await listAll({ lat: 37.45, lng: 24.93 });
    for (let i = 1; i < cats.length; i++) {
      const a = cats[i - 1]!;
      const b = cats[i]!;
      const da = a["distanceKm"] as number;
      const db_ = b["distanceKm"] as number;
      expect(da < db_ || (da === db_ && (a["id"] as number) < (b["id"] as number))).toBe(true);
    }
  });

  it("without a viewer position: newest last-seen date first, ties by id", async () => {
    const { cats } = await listAll();
    for (let i = 1; i < cats.length; i++) {
      const a = cats[i - 1]!;
      const b = cats[i]!;
      const cmp = (b["lastSeenAt"] as string).localeCompare(a["lastSeenAt"] as string);
      expect(cmp < 0 || (cmp === 0 && (a["id"] as number) < (b["id"] as number))).toBe(true);
    }
  });
});

describe("§2.3: the catalogue is paged", () => {
  it("walking every page returns every cat exactly once", async () => {
    const whole = (await listAll()).cats.map((c) => c["id"]);
    const paged: unknown[] = [];
    let total = 0;
    for (let page: number | null = 1; page !== null; ) {
      const res = await request(app).get("/api/cats").query({ page, pageSize: 1 });
      expect(res.body.cats.length).toBeLessThanOrEqual(1);
      total = res.body.total;
      paged.push(...res.body.cats.map((c: { id: number }) => c.id));
      page = res.body.nextPage;
    }
    expect(paged).toEqual(whole);
    expect(paged.length).toBe(total);
    expect(new Set(paged).size).toBe(paged.length);
  });

  it("caps the page size at 200 and defaults to 100", async () => {
    const big = await request(app).get("/api/cats").query({ pageSize: 5000 });
    expect(big.body.pageSize).toBe(200);
    const plain = await request(app).get("/api/cats");
    expect(plain.body.pageSize).toBe(100);
    expect(plain.body.page).toBe(1);
  });

  it("a page past the end is empty, with no next page", async () => {
    const res = await request(app).get("/api/cats").query({ page: 10_000 });
    expect(res.body.cats).toEqual([]);
    expect(res.body.nextPage).toBeNull();
  });
});
