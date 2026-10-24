import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { catsTable, db, observationsTable, photosTable, pool, vetBatchesTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

// SYC-677 Task 6: the batch pages. The matching service is mocked (no real
// call). Staff hold every capability today, so `can` is wrapped: `denied.cap`
// is refused to everyone.
const denied = vi.hoisted(() => ({ cap: null as string | null }));
vi.mock("../lib/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/capabilities")>();
  return {
    ...real,
    can: (...args: Parameters<typeof real.can>) => (args[1] === denied.cap ? false : real.can(...args)),
  };
});
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/matching", () => ({ matchCatPhoto: vi.fn() }));

import app from "../app";
import { matchCatPhoto, type CandidateInput } from "../lib/matching";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { guardianOn, newColony, putInColony, signedPerson, type Signed } from "../test/roleKit";
import { removeTestPerson } from "../test/removeTestPerson";
import { _resetBatchFindLimitsForTests, _resetFindLimitsForTests } from "../middlewares/rateLimit";
import { getBatch } from "../lib/vetBatches";
import { syrNumber } from "../lib/teamCatView";

let staff: Signed;
let guardian: Signed;
let colony: number;
const RUN = randomBytes(3).toString("hex");
const cats: { id: number; name: string }[] = [];
const KEY = "vitest-vetbatches-key-0123456789abcdef-0123456789";
const matchMock = vi.mocked(matchCatPhoto);

const jpeg = (r: number) =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g: 90, b: 60 } } }).jpeg().toBuffer();

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colony = await newColony("vetbatches");
  staff = await signedPerson("vb-staff", ["staff"]);
  guardian = await guardianOn("vb-guardian", [colony]);
  for (let i = 0; i < 3; i++) {
    const [ph] = await db
      .insert(photosTable)
      .values({ data: (await jpeg(10 + i * 50)).toString("base64"), mime: "image/jpeg" })
      .returning({ id: photosTable.id });
    const name = `vb-cat-${RUN}-${i}`;
    const [c] = await db
      .insert(catsTable)
      .values({ name, primaryPhotoId: ph!.id, lat: 37.4447, lng: 24.9417, discovererDeviceId: `vb-${RUN}` })
      .returning({ id: catsTable.id });
    await putInColony(c!.id, colony);
    cats.push({ id: c!.id, name });
  }
});
beforeEach(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
  matchMock.mockReset();
  // The first candidate is the best match.
  matchMock.mockImplementation(async (_p, candidates: CandidateInput[]) => ({
    isCatPhoto: true,
    matches: candidates.map((c, i) => ({ catId: c.catId, confidence: [0.9, 0.5, 0.2][i] ?? 0.1, reasoning: `same ear ${i}` })),
  }));
  await _resetBatchFindLimitsForTests();
  await _resetFindLimitsForTests();
});
afterAll(async () => {
  await _resetBatchFindLimitsForTests();
  await _resetFindLimitsForTests();
  await db.delete(vetBatchesTable).where(eq(vetBatchesTable.createdBy, staff.id));
  await removeTestPerson(staff.id);
  await removeTestPerson(guardian.id);
  await pool.end();
});

const get = (path: string, who: Signed = staff) =>
  request(app).get(path).set("Cookie", who.cookie).set("Accept", "text/html");
const post = (path: string, form: Record<string, string | string[]> = {}, who: Signed = staff) =>
  request(app).post(path).set("Cookie", who.cookie).set("Origin", TEAM_ORIGIN).type("form").send(form);
const upload = async (path: string, n = 1, who: Signed = staff) => {
  const t = request(app).post(path).set("Cookie", who.cookie).set("Origin", TEAM_ORIGIN);
  for (let i = 0; i < n; i++) t.attach("photos", await jpeg(40 + i * 30), { filename: `c${i}.jpg`, contentType: "image/jpeg" });
  return t;
};

/** A cat nobody has logged a visit for yet, in the colony. */
async function freshCat(): Promise<{ id: number; name: string }> {
  const [ph] = await db
    .insert(photosTable)
    .values({ data: (await jpeg(120)).toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const name = `vb-fresh-${RUN}-${cats.length}`;
  const [c] = await db
    .insert(catsTable)
    .values({ name, primaryPhotoId: ph!.id, lat: 37.4447, lng: 24.9417, discovererDeviceId: `vb-${RUN}` })
    .returning({ id: catsTable.id });
  await putInColony(c!.id, colony);
  const cat = { id: c!.id, name };
  cats.push(cat);
  return cat;
}

const NEW = (c: number) => `/api/team/vet-batches/new?colony=${c}`;

async function newBatch(): Promise<number> {
  const res = await get(NEW(colony));
  expect(res.status).toBe(303);
  return Number(/\/vet-batches\/(\d+)$/.exec(res.headers["location"]!)![1]);
}
async function addCatTo(batch: number, n = 1): Promise<number> {
  const res = await upload(`/api/team/vet-batches/${batch}/cats`, n);
  expect(res.status).toBe(303);
  return Number(/#bc-(\d+)$/.exec(res.headers["location"]!)![1]);
}
const SHARED = { date: new Date().toISOString().slice(0, 10), clinicId: "symviosis", price: "60", paidBy: "syros_cats" };
const sharedFor = (b: number) => post(`/api/team/vet-batches/${b}`, SHARED);
const cardOf = (html: string, row: number) => {
  const start = html.indexOf(`id="bc-${row}"`);
  expect(start, `card ${row} is on the page`).toBeGreaterThan(-1);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end === -1 ? undefined : end);
};

describe("the walk's rows exist for every batch route", () => {
  const ALL: [string, string][] = [
    ["get", "/api/team/vet-batches/new"],
    ["get", "/api/team/vet-batches/1"],
    ["post", "/api/team/vet-batches/1"],
    ["post", "/api/team/vet-batches/1/cats"],
    ["post", "/api/team/vet-batches/1/cats/1/search"],
    ["post", "/api/team/vet-batches/1/cats/1/lookup"],
    ["post", "/api/team/vet-batches/1/cats/1/confirm"],
    ["post", "/api/team/vet-batches/1/cats/1"],
    ["post", "/api/team/vet-batches/1/cats/1/remove"],
    ["post", "/api/team/vet-batches/1/save"],
    ["post", "/api/team/vet-batches/1/abandon"],
  ];
  it("a cat guardian gets 403 on every route", async () => {
    for (const [method, path] of ALL) {
      const r =
        method === "get"
          ? await get(path, guardian)
          : await post(path, {}, guardian);
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });
  it("a person without view_vet_costs or find_cat_from_photo is refused on every route", async () => {
    for (const cap of ["view_vet_costs", "find_cat_from_photo", "log_vet_visit"]) {
      denied.cap = cap;
      for (const [method, path] of ALL) {
        const r = method === "get" ? await get(path) : await post(path);
        expect(r.status, `${method} ${path} without ${cap}`).toBe(403);
      }
    }
  });
  it("a POST with no Origin is refused", async () => {
    const batch = await newBatch();
    const res = await request(app).post(`/api/team/vet-batches/${batch}`).set("Cookie", staff.cookie).type("form").send(SHARED);
    expect(res.status).toBe(401);
    const up = await request(app)
      .post(`/api/team/vet-batches/${batch}/cats`)
      .set("Cookie", staff.cookie)
      .attach("photos", await jpeg(10), { filename: "a.jpg", contentType: "image/jpeg" });
    expect(up.status).toBe(401);
    expect((await getBatch(batch))!.cats).toHaveLength(0);
  });
});

describe("the batch page", () => {
  it("starting from a colony makes a batch with that place, and an empty batch asks for a photo", async () => {
    const batch = await newBatch();
    const b = (await getBatch(batch))!;
    expect(b.shared.colonyId).toBe(colony);
    const page = await get(`/api/team/vet-batches/${batch}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain("For every cat in this batch");
    expect(page.text).toContain("Save these");
    expect(page.text).toContain('<input type="file" name="photos" accept="image/*" multiple>');
    expect(page.text).toContain('enctype="multipart/form-data"');
    expect(page.text).toContain("Vet settings");
    expect(page.text).toContain('value="60"');
  });
  it("starting from an area works, and a made-up area or colony is not found", async () => {
    const ok = await get("/api/team/vet-batches/new?area=ermoupoli");
    expect(ok.status).toBe(303);
    const made = (await getBatch(Number(/(\d+)$/.exec(ok.headers["location"]!)![1])))!;
    expect([made.shared.areaKey, made.shared.colonyId]).toEqual(["ermoupoli", null]);
    expect((await get("/api/team/vet-batches/new?area=nowhere-at-all")).status).toBe(404);
    expect((await get("/api/team/vet-batches/new?colony=999999999")).status).toBe(404);
    expect((await get("/api/team/vet-batches/new")).status).toBe(400);
  });
  it("a batch that does not exist is the not-found page, never a 500", async () => {
    for (const path of ["/api/team/vet-batches/999999999", "/api/team/vet-batches/abc"]) {
      expect((await get(path)).status).toBe(404);
    }
    expect((await post("/api/team/vet-batches/999999999")).status).toBe(404);
    expect((await upload("/api/team/vet-batches/999999999/cats")).status).toBe(404);
    expect((await post("/api/team/vet-batches/999999999/cats/1/search", { scope: "batch" })).status).toBe(404);
    expect((await post("/api/team/vet-batches/999999999/save")).status).toBe(404);
  });
  it("a cat row of another batch is not found", async () => {
    const a = await newBatch();
    const b = await newBatch();
    const row = await addCatTo(a);
    expect((await post(`/api/team/vet-batches/${b}/cats/${row}/remove`)).status).toBe(404);
    expect((await getBatch(a))!.cats).toHaveLength(1);
  });
  it("shared fields: a bad price is named at the price and nothing is saved", async () => {
    const batch = await newBatch();
    const res = await post(`/api/team/vet-batches/${batch}`, { ...SHARED, price: "9999" });
    expect(res.status).toBe(400);
    expect(res.text).toContain('id="vb-price-err"');
    expect(res.text).toContain('value="9999"');
    expect((await getBatch(batch))!.shared.priceEur).toBe("60.00");
    const good = await post(`/api/team/vet-batches/${batch}`, { ...SHARED, price: "55,50", note: "Calm day" });
    expect(good.status).toBe(303);
    const b = (await getBatch(batch))!;
    expect([b.shared.priceEur, b.shared.note, b.shared.clinicId]).toEqual(["55.50", "Calm day", "symviosis"]);
  });
  it("photos: none, too many and not-a-photo each come back with a plain sentence", async () => {
    const batch = await newBatch();
    const none = await post(`/api/team/vet-batches/${batch}/cats`);
    expect(none.status).toBe(303);
    expect(none.headers["location"]).toContain("said=no_photo");
    const many = await upload(`/api/team/vet-batches/${batch}/cats`, 7);
    expect(many.status).toBe(303);
    expect(many.headers["location"]).toContain("said=too_many_photos");
    const bad = await request(app)
      .post(`/api/team/vet-batches/${batch}/cats`)
      .set("Cookie", staff.cookie)
      .set("Origin", TEAM_ORIGIN)
      .attach("photos", Buffer.from("not a photo"), { filename: "x.jpg", contentType: "image/jpeg" });
    expect(bad.headers["location"]).toContain("said=bad_photo");
    expect((await getBatch(batch))!.cats).toHaveLength(0);
    const page = await get(`/api/team/vet-batches/${batch}?said=too_many_photos`);
    expect(page.text).toContain("Up to 6 photos for each cat.");
  });
});

describe("the full round trip", () => {
  it("create, add two cats, search one and confirm, look up the other by SYR number, set Sterilised, save", async () => {
    const batch = await newBatch();
    expect((await sharedFor(batch)).status).toBe(303);
    const rowA = await addCatTo(batch, 2);
    const rowB = await addCatTo(batch);
    const locations: string[] = [];

    // Search: the stored suggestions come back on the page.
    const search = await post(`/api/team/vet-batches/${batch}/cats/${rowA}/search`, { scope: "batch" });
    locations.push(search.headers["location"]!);
    expect(search.status).toBe(303);
    expect(search.headers["location"]).toBe(`/api/team/vet-batches/${batch}#bc-${rowA}`);
    const suggested = (await getBatch(batch))!.cats.find((c) => c.id === rowA)!.suggestions!;
    expect(suggested.length).toBeGreaterThan(0);
    const page = await get(`/api/team/vet-batches/${batch}`);
    expect(cardOf(page.text, rowA)).toContain("This is the cat");
    expect(cardOf(page.text, rowA)).toContain("Not matched yet");

    const chosen = suggested[0]!.catId;
    const confirmA = await post(`/api/team/vet-batches/${batch}/cats/${rowA}/confirm`, { catId: String(chosen) });
    locations.push(confirmA.headers["location"]!);
    expect(confirmA.status).toBe(303);

    // Lookup by SYR number: no search used, the cat comes back to choose.
    const other = cats.find((c) => c.id !== chosen)!;
    const lookup = await post(`/api/team/vet-batches/${batch}/cats/${rowB}/lookup`, { q: syrNumber(other.id) });
    expect(lookup.status).toBe(200);
    expect(lookup.text).toContain(other.name);
    expect(lookup.text).toContain("This is the cat");
    expect(matchMock).toHaveBeenCalledTimes(1);
    const confirmB = await post(`/api/team/vet-batches/${batch}/cats/${rowB}/confirm`, { catId: String(other.id) });
    locations.push(confirmB.headers["location"]!);
    expect(confirmB.status).toBe(303);

    for (const row of [rowA, rowB]) {
      const set = await post(`/api/team/vet-batches/${batch}/cats/${row}`, { did: "sterilised" });
      locations.push(set.headers["location"]!);
      expect(set.status).toBe(303);
    }
    const matched = await get(`/api/team/vet-batches/${batch}`);
    expect(matched.text).toContain(`Matched: ${cats.find((c) => c.id === chosen)!.name}`);
    expect(matched.text).toContain(syrNumber(chosen));

    const save = await post(`/api/team/vet-batches/${batch}/save`);
    locations.push(save.headers["location"]!);
    expect(save.status).toBe(303);
    expect(save.headers["location"]).toBe(`/api/team/colonies/${colony}?done=batch`);

    const visits = await db
      .select()
      .from(observationsTable)
      .where(and(inArray(observationsTable.catId, [chosen, other.id]), eq(observationsTable.kind, "vet_visit")));
    expect(visits).toHaveLength(2);
    expect((await getBatch(batch))!.savedAt).not.toBeNull();
    const colonyPage = await get(save.headers["location"]!);
    expect(colonyPage.text).toContain("The batch&#39;s vet visits are saved.");

    // Nothing typed or uploaded is in any address.
    for (const l of locations) {
      expect(l).toMatch(/^\/api\/team\/(vet-batches\/\d+(#bc-\d+)?|colonies\/\d+\?done=batch)$/);
      expect(l).not.toContain(syrNumber(other.id));
    }
  });

  it("a saved batch cannot be changed and says so; a second save is told it was already saved", async () => {
    const batch = await newBatch();
    await sharedFor(batch);
    const row = await addCatTo(batch);
    await post(`/api/team/vet-batches/${batch}/cats/${row}/confirm`, { catId: String((await freshCat()).id) });
    await post(`/api/team/vet-batches/${batch}/cats/${row}`, { did: "sterilised" });
    expect((await post(`/api/team/vet-batches/${batch}/save`)).status).toBe(303);
    const again = await post(`/api/team/vet-batches/${batch}/save`);
    expect(again.status).toBe(200);
    expect(again.text).toContain("This batch was already saved.");
    for (const r of [
      await post(`/api/team/vet-batches/${batch}`, SHARED),
      await upload(`/api/team/vet-batches/${batch}/cats`),
      await post(`/api/team/vet-batches/${batch}/cats/${row}/search`, { scope: "batch" }),
      await post(`/api/team/vet-batches/${batch}/cats/${row}/remove`),
      await post(`/api/team/vet-batches/${batch}/abandon`, { confirm: "1" }),
    ]) {
      expect(r.status).toBe(200);
      expect(r.text).toContain("This batch was already saved.");
    }
    expect((await getBatch(batch))!.cats).toHaveLength(1);
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("a failed save keeps everything and shows 'Confirm who this cat is.' at that card", async () => {
    const batch = await newBatch();
    await sharedFor(batch);
    const rowA = await addCatTo(batch);
    const rowB = await addCatTo(batch);
    const mine = await freshCat();
    await post(`/api/team/vet-batches/${batch}/cats/${rowA}/confirm`, { catId: String(mine.id) });
    await post(`/api/team/vet-batches/${batch}/cats/${rowA}`, { did: ["sterilised"], note: "keep me" });
    const res = await post(`/api/team/vet-batches/${batch}/save`);
    expect(res.status).toBe(422);
    expect(cardOf(res.text, rowB)).toContain("Confirm who this cat is.");
    expect(cardOf(res.text, rowA)).not.toContain("Confirm who this cat is.");
    expect(res.text).toContain("keep me");
    const b = (await getBatch(batch))!;
    expect(b.cats).toHaveLength(2);
    expect(b.savedAt).toBeNull();
    const visits = await db
      .select()
      .from(observationsTable)
      .where(and(eq(observationsTable.catId, mine.id), eq(observationsTable.kind, "vet_visit")));
    expect(visits).toHaveLength(0);
  });

  it("a batch with no clinic names it once, at the shared fields", async () => {
    const batch = await newBatch();
    const row = await addCatTo(batch);
    await post(`/api/team/vet-batches/${batch}/cats/${row}/confirm`, { catId: String(cats[1]!.id) });
    await post(`/api/team/vet-batches/${batch}/cats/${row}`, { did: ["sterilised"] });
    const res = await post(`/api/team/vet-batches/${batch}/save`);
    expect(res.status).toBe(422);
    expect(res.text.match(/Choose the clinic\./g)).toHaveLength(1);
    expect(cardOf(res.text, row)).not.toContain("Choose the clinic.");
  });
});

describe("the cat cards", () => {
  it("a crafted did=vaccinated without set_vaccination is refused and nothing is stored", async () => {
    const batch = await newBatch();
    const row = await addCatTo(batch);
    denied.cap = "set_vaccination";
    const res = await post(`/api/team/vet-batches/${batch}/cats/${row}`, { did: ["sterilised", "vaccinated"] });
    expect(res.status).toBe(403);
    expect((await getBatch(batch))!.cats[0]!.did).toEqual([]);
    // And the page does not offer the box.
    const page = await get(`/api/team/vet-batches/${batch}`);
    const matchedCard = cardOf(page.text, row);
    expect(matchedCard).not.toContain('value="vaccinated"');
  });
  it("Checked only, an odd box and a bad cost are named at the card", async () => {
    const batch = await newBatch();
    const row = await addCatTo(batch);
    await post(`/api/team/vet-batches/${batch}/cats/${row}/confirm`, { catId: String(cats[0]!.id) });
    const checked = await post(`/api/team/vet-batches/${batch}/cats/${row}`, { did: "checked" });
    expect(checked.status).toBe(400);
    expect(cardOf(checked.text, row)).toContain("Tick Sterilised, Vaccinated or Treated.");
    const cost = await post(`/api/team/vet-batches/${batch}/cats/${row}`, { did: "sterilised", cost: "lots" });
    expect(cost.status).toBe(400);
    expect(cardOf(cost.text, row)).toContain("The cost is in euros");
    expect(cardOf(cost.text, row)).toContain('value="lots"');
    const treated = await post(`/api/team/vet-batches/${batch}/cats/${row}`, { did: "treated" });
    expect(treated.status).toBe(400);
    expect(cardOf(treated.text, row)).toContain("Say what was treated");
  });
  it("confirming needs a real cat; 'Not this cat' undoes it; Remove takes the cat out", async () => {
    const batch = await newBatch();
    const row = await addCatTo(batch);
    const bad = await post(`/api/team/vet-batches/${batch}/cats/${row}/confirm`, { catId: "999999999" });
    expect(bad.status).toBe(303);
    expect(bad.headers["location"]).toContain("said=no_such_cat");
    expect((await getBatch(batch))!.cats[0]!.catId).toBeNull();
    await post(`/api/team/vet-batches/${batch}/cats/${row}/confirm`, { catId: String(cats[0]!.id) });
    expect((await getBatch(batch))!.cats[0]!.confirmed).toBe(true);
    await post(`/api/team/vet-batches/${batch}/cats/${row}/confirm`, { catId: "none" });
    const after = (await getBatch(batch))!.cats[0]!;
    expect([after.catId, after.confirmed]).toEqual([null, false]);
    const removed = await post(`/api/team/vet-batches/${batch}/cats/${row}/remove`);
    expect(removed.status).toBe(303);
    expect((await getBatch(batch))!.cats).toHaveLength(0);
  });
  it("a made-up place for the search is told so and no search is spent", async () => {
    const batch = await newBatch();
    const row = await addCatTo(batch);
    const res = await post(`/api/team/vet-batches/${batch}/cats/${row}/search`, { scope: "colony:999999999" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toContain("said=bad_place");
    expect(matchMock).not.toHaveBeenCalled();
  });
  it("search somewhere else: a colony, and the island", async () => {
    const batch = await newBatch();
    const row = await addCatTo(batch);
    for (const scope of [`colony:${colony}`, "island"]) {
      const res = await post(`/api/team/vet-batches/${batch}/cats/${row}/search`, { scope });
      expect(res.status).toBe(303);
      expect(res.headers["location"]).toBe(`/api/team/vet-batches/${batch}#bc-${row}`);
    }
    expect(matchMock).toHaveBeenCalledTimes(2);
  });
  it("with the daily limit reached the card says so and points to the lookup", async () => {
    const batch = await newBatch();
    const row = await addCatTo(batch);
    const { checkBatchFindLimits, BATCH_FIND_PERSON_LIMIT } = await import("../middlewares/rateLimit");
    const t = Date.now();
    for (let i = 0; i < BATCH_FIND_PERSON_LIMIT; i++) await checkBatchFindLimits(staff.id, t);
    const res = await post(`/api/team/vet-batches/${batch}/cats/${row}/search`, { scope: "batch" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toContain("said=capped_person");
    expect(matchMock).not.toHaveBeenCalled();
    const page = await get(`/api/team/vet-batches/${batch}`);
    expect(cardOf(page.text, row)).toContain("Look up by name or SYR number");
    expect(cardOf(page.text, row)).toContain("daily limit");
    expect(cardOf(page.text, row)).not.toContain("Find this cat</button>");
  });
  it("a lookup with a NUL or nothing typed finds nothing and does not fail", async () => {
    const batch = await newBatch();
    const row = await addCatTo(batch);
    for (const q of ["", "a\u0000b", "x".repeat(500)]) {
      const res = await post(`/api/team/vet-batches/${batch}/cats/${row}/lookup`, { q });
      expect(res.status).toBe(200);
    }
  });
});

describe("abandoning", () => {
  it("asks first, then removes the batch and its cats", async () => {
    const batch = await newBatch();
    await addCatTo(batch);
    const ask = await post(`/api/team/vet-batches/${batch}/abandon`);
    expect(ask.status).toBe(200);
    expect(ask.text).toContain("Yes, throw it away");
    expect((await getBatch(batch))).not.toBeNull();
    const done = await post(`/api/team/vet-batches/${batch}/abandon`, { confirm: "1" });
    expect(done.status).toBe(303);
    expect(done.headers["location"]).toBe(`/api/team/colonies/${colony}`);
    expect(await getBatch(batch)).toBeNull();
    expect((await get(`/api/team/vet-batches/${batch}`)).status).toBe(404);
  });
});
