import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import request from "supertest";
import { catsTable, coloniesTable, db, observationsTable, photosTable, pool, vetVisitPhotosTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getGuidance } from "@workspace/welfare-guidance";

vi.mock("./push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./matching", () => ({ matchCatPhoto: vi.fn() }));

import app from "../app";
import { areaByKey } from "./areas/namedAreas";
import { currentColonyOf } from "./colonyMembership";
import { syrNumber } from "./teamCatView";
import { teamOnlyPhotoIds } from "./teamOnlyPhotos";
import { addCat, createBatch, getBatch, updateCat, updateShared } from "./vetBatches";
import { saveBatch, TEAM_DESK_DEVICE } from "./vetVisits";
import { TEAM_ORIGIN } from "./teamAuth/__fixtures__/queueKit";
import { newColony, signedPerson, type Signed } from "../test/roleKit";

// SYC-677 Task 9: a batch cat the team says is "None of these: a cat we
// haven't recorded" becomes a new cat in the save's own transaction. It is
// public at once: its first photo is its main photo (and so is never linked
// in vet_visit_photos); its other photos stay team-only. It sits at the
// batch's colony centre, else the area's centre, and is in the batch's
// colony. Named now, or left for spotters (stored as its SYR number, with
// name_pending set). The test database is thrown away after the run, so every
// assertion is on this run's own rows.

const RUN = randomBytes(3).toString("hex");
const PREFIX = `VtNewCat${RUN}`;
const NOW = new Date("2026-10-24T10:00:00Z");
const CLINIC = getGuidance("en").vets[0]!.id;
const STAFF = { id: `vitest-vb-newcat-${RUN}`, scopes: [{ role: "staff", colonyId: null }] };
// A colony centre with digits nothing else on a page would print.
const CENTRE = { lat: 37.451234, lng: 24.938765 };
const KEY = "vitest-vetbatches-newcat-key-0123456789abcdef-01234";

let author: Signed;
let colony: number;
let n = 0;

async function jpeg(seed: number): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: { r: seed % 256, g: 60, b: 200 } } })
    .jpeg()
    .toBuffer();
}

async function knownCat() {
  n += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({ name: `${PREFIX}-known-${n}`, description: "", primaryPhotoId: 0, lat: 37.44, lng: 24.9, discovererDeviceId: "vitest-nc" })
    .returning();
  return cat!;
}

type Entry = { catId?: number; newCat?: { name: string | null; description: string }; photos?: number; confirmed?: boolean };

async function makeBatch(entries: Entry[], place: { colonyId?: number; areaKey?: string } = {}) {
  const id = await createBatch(author, place, NOW);
  const b = await getBatch(id);
  await updateShared(id, { ...b!.shared, clinicId: CLINIC });
  const rows: number[] = [];
  for (const [i, e] of entries.entries()) {
    const added = await addCat(id, await Promise.all(Array.from({ length: e.photos ?? 1 }, (_, k) => jpeg(n * 7 + i * 10 + k))));
    if (!added.ok) throw new Error(`addCat: ${added.reason}`);
    rows.push(added.batchCatId);
    await updateCat(added.batchCatId, {
      ...(e.catId !== undefined ? { catId: e.catId } : {}),
      ...(e.newCat ? { newCat: e.newCat } : {}),
      confirmed: e.confirmed ?? true,
      did: ["sterilised"],
    });
  }
  return { id, rows, batch: (await getBatch(id))! };
}

const catById = async (id: number) => (await db.select().from(catsTable).where(eq(catsTable.id, id)))[0]!;
const kept = async (photoIds: number[]) =>
  (await db.select().from(vetVisitPhotosTable).where(inArray(vetVisitPhotosTable.photoId, photoIds))).map((r) => r.photoId);
const catsNamed = async (names: string[]) => db.select().from(catsTable).where(inArray(catsTable.name, names));
const visitsOf = async (catIds: number[]) =>
  (await db.select().from(observationsTable).where(inArray(observationsTable.catId, catIds))).filter((o) => o.kind === "vet_visit");

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  author = await signedPerson(`nc-${RUN}`, ["staff"]);
  colony = await newColony(`newcat-${RUN}`);
  await db.update(coloniesTable).set(CENTRE).where(eq(coloniesTable.id, colony));
});
afterAll(async () => {
  await pool.end();
});

describe("saveBatch: a new cat", () => {
  it("named now: created in the batch's colony, at its centre, its first photo public and its other photos team-only", async () => {
    const name = `${PREFIX} Mimi`;
    const { id, rows, batch } = await makeBatch([{ newCat: { name, description: "ginger, torn left ear" }, photos: 3 }], { colonyId: colony });
    const out = await saveBatch(STAFF, id, NOW);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.newCats).toHaveLength(1);
    expect(out.newCats[0]!.batchCatId).toBe(rows[0]);

    const cat = await catById(out.newCats[0]!.catId);
    const [first, ...others] = batch.cats[0]!.photos;
    expect(cat).toMatchObject({
      name,
      description: "ginger, torn left ear",
      primaryPhotoId: first!.photoId,
      lat: CENTRE.lat,
      lng: CENTRE.lng,
      discovererDeviceId: TEAM_DESK_DEVICE,
      namePending: false,
    });
    expect(TEAM_DESK_DEVICE).toBe("syros-cats-team");
    expect((await currentColonyOf([cat.id])).get(cat.id)).toBe(colony);

    // The first photo is the cat's public main photo, never a kept vet photo.
    expect(await kept([first!.photoId])).toEqual([]);
    expect([...(await kept(others.map((p) => p.photoId)))].sort()).toEqual(others.map((p) => p.photoId).sort());
    expect((await teamOnlyPhotoIds([first!.photoId])).size).toBe(0);
    expect([...(await teamOnlyPhotoIds(others.map((p) => p.photoId)))].sort()).toEqual(others.map((p) => p.photoId).sort());
    expect((await request(app).get(`/api/photos/${first!.publicId}`)).status).toBe(200);
    for (const p of others) expect((await request(app).get(`/api/photos/${p.publicId}`)).status).toBe(404);

    // A team `name` statement, then the visit, as for any cat.
    const rowsOfCat = await db.select().from(observationsTable).where(eq(observationsTable.catId, cat.id));
    const named = rowsOfCat.filter((o) => o.kind === "name");
    expect(named).toHaveLength(1);
    expect(named[0]).toMatchObject({ accountId: STAFF.id, value: expect.objectContaining({ name }) });
    expect(rowsOfCat.filter((o) => o.kind === "vet_visit")).toHaveLength(1);
    expect(rowsOfCat.filter((o) => o.kind === "colony")).toHaveLength(1);
  });

  it("left for spotters: stored as its SYR number with name_pending set, and no name statement", async () => {
    const { id } = await makeBatch([{ newCat: { name: null, description: "" } }], { colonyId: colony });
    const out = await saveBatch(STAFF, id, NOW);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const cat = await catById(out.newCats[0]!.catId);
    expect(cat.name).toBe(syrNumber(cat.id));
    expect(cat.namePending).toBe(true);
    const rowsOfCat = await db.select().from(observationsTable).where(eq(observationsTable.catId, cat.id));
    expect(rowsOfCat.filter((o) => o.kind === "name")).toHaveLength(0);
    expect(rowsOfCat.filter((o) => o.kind === "vet_visit")).toHaveLength(1);
  });

  it("in an area batch: at the area's centre, in no colony", async () => {
    const area = areaByKey("vaporia")!;
    const { id } = await makeBatch([{ newCat: { name: `${PREFIX} Area`, description: "" } }], { areaKey: area.key });
    const out = await saveBatch(STAFF, id, NOW);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const cat = await catById(out.newCats[0]!.catId);
    expect({ lat: cat.lat, lng: cat.lng }).toEqual({ lat: area.lat, lng: area.lng });
    expect((await currentColonyOf([cat.id])).has(cat.id)).toBe(false);
  });

  it.each([
    ["an offensive name", "fuck", "Cat name contains offensive language"],
    ["a blank name", "​​", "Cat name is empty"],
  ])("%s refuses the whole batch with the existing words, and saves nothing", async (_label, name, words) => {
    const known = await knownCat();
    const { id, rows } = await makeBatch([{ catId: known.id }, { newCat: { name, description: "" } }], { colonyId: colony });
    const out = await saveBatch(STAFF, id, NOW);
    expect(out).toEqual({ ok: false, problems: [{ batchCatId: rows[1], field: "newCat", words }] });
    expect(await visitsOf([known.id])).toHaveLength(0);
    expect(await catsNamed([name])).toHaveLength(0);
  });

  it("a name another cat has (once folded) refuses the whole batch", async () => {
    const known = await knownCat();
    const taken = known.name.toUpperCase();
    const { id, rows } = await makeBatch([{ catId: known.id }, { newCat: { name: taken, description: "" } }], { colonyId: colony });
    const out = await saveBatch(STAFF, id, NOW);
    expect(out).toEqual({ ok: false, problems: [{ batchCatId: rows[1], field: "newCat", words: "Cat name already taken" }] });
    expect(await visitsOf([known.id])).toHaveLength(0);
  });

  it("two new cats with the same name in one batch are refused, naming both entries", async () => {
    const name = `${PREFIX} Twin`;
    const { id, rows } = await makeBatch(
      [
        { newCat: { name, description: "" } },
        { newCat: { name: name.toLowerCase(), description: "" } },
      ],
      { colonyId: colony },
    );
    const out = await saveBatch(STAFF, id, NOW);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems).toEqual([
      { batchCatId: rows[1], field: "newCat", words: "Cat name already taken: entries 1 and 2 have the same name." },
    ]);
    expect(await catsNamed([name, name.toLowerCase()])).toHaveLength(0);
  });

  it("a batch with no colony and no area and a new cat is refused", async () => {
    const known = await knownCat();
    const name = `${PREFIX} Nowhere`;
    const { id } = await makeBatch([{ catId: known.id }, { newCat: { name, description: "" } }]);
    const out = await saveBatch(STAFF, id, NOW);
    expect(out).toEqual({ ok: false, problems: [{ batchCatId: null, field: "place", words: "Choose a colony or an area for this batch" }] });
    expect(await catsNamed([name])).toHaveLength(0);
    expect(await visitsOf([known.id])).toHaveLength(0);
  });

  it("an unconfirmed new cat is not saved", async () => {
    const { id, rows } = await makeBatch([{ newCat: { name: null, description: "" }, confirmed: false }], { colonyId: colony });
    const out = await saveBatch(STAFF, id, NOW);
    expect(out).toEqual({ ok: false, problems: [{ batchCatId: rows[0], field: "confirmed", words: "Confirm who this cat is." }] });
  });
});

describe("the batch page: a new cat", () => {
  const post = (path: string, form: Record<string, string>) =>
    request(app).post(path).set("Cookie", author.cookie).set("Origin", TEAM_ORIGIN).type("form").send(form);
  const get = (path: string) => request(app).get(path).set("Cookie", author.cookie).set("Accept", "text/html");
  const noPosition = (s: string) => {
    expect(s).not.toContain(String(CENTRE.lat));
    expect(s).not.toContain(String(CENTRE.lng));
    expect(s).not.toMatch(/37\.\d{3}|24\.\d{3}/);
  };

  it("an unmatched card offers 'None of these: a cat we haven't recorded', with both ways to name it", async () => {
    const { id, rows } = await makeBatch([{ confirmed: false }], { colonyId: colony });
    const page = await get(`/api/team/vet-batches/${id}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain("None of these: a cat we haven&#39;t recorded");
    expect(page.text).toContain("Name it now");
    expect(page.text).toContain("Leave it for spotters");
    expect(page.text).toContain(`action="/api/team/vet-batches/${id}/cats/${rows[0]}/confirm"`);
    noPosition(page.text);
  });

  it("Name it now: 303 to the card with nothing typed in the address, stored as a confirmed new cat", async () => {
    const { id, rows } = await makeBatch([{ confirmed: false }], { colonyId: colony });
    const name = `${PREFIX} Routed`;
    const res = await post(`/api/team/vet-batches/${id}/cats/${rows[0]}/confirm`, { catId: "new", naming: "now", name, description: "white socks" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/vet-batches/${id}#bc-${rows[0]}`);
    const cat = (await getBatch(id))!.cats[0]!;
    expect(cat).toMatchObject({ catId: null, newCat: { name, description: "white socks" }, confirmed: true });
    const page = await get(`/api/team/vet-batches/${id}`);
    expect(page.text).toContain("New cat:");
    expect(page.text).toContain(name);
    noPosition(page.text);
  });

  it("Leave it for spotters: stored with no name", async () => {
    const { id, rows } = await makeBatch([{ confirmed: false }], { colonyId: colony });
    const res = await post(`/api/team/vet-batches/${id}/cats/${rows[0]}/confirm`, { catId: "new", naming: "spotters", name: "ignored", description: "" });
    expect(res.status).toBe(303);
    expect((await getBatch(id))!.cats[0]).toMatchObject({ newCat: { name: null, description: "" }, confirmed: true });
    expect((await get(`/api/team/vet-batches/${id}`)).text).toContain("left for spotters to name");
  });

  it("a bad name comes back as a 400 with the words and what was typed, and changes nothing", async () => {
    const { id, rows } = await makeBatch([{ confirmed: false }], { colonyId: colony });
    const res = await post(`/api/team/vet-batches/${id}/cats/${rows[0]}/confirm`, { catId: "new", naming: "now", name: "fuck", description: "kept text" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("Cat name contains offensive language");
    expect(res.text).toContain("kept text");
    expect((await getBatch(id))!.cats[0]).toMatchObject({ newCat: null, confirmed: false });
    const blank = await post(`/api/team/vet-batches/${id}/cats/${rows[0]}/confirm`, { catId: "new", naming: "now", name: "  ", description: "" });
    expect(blank.status).toBe(400);
    expect(blank.text).toContain("Give the cat a name, or choose “Leave it for spotters”.");
  });

  it("saving the batch from the page makes the cat; no address or page on the way prints its position", async () => {
    const { id, rows } = await makeBatch([{ confirmed: false }], { colonyId: colony });
    const name = `${PREFIX} Saved`;
    await post(`/api/team/vet-batches/${id}/cats/${rows[0]}/confirm`, { catId: "new", naming: "now", name, description: "" });
    const answers = await post(`/api/team/vet-batches/${id}/cats/${rows[0]}`, { did: "sterilised", treatedNote: "", cost: "", paidBy: "", note: "" });
    expect(answers.status).toBe(303);
    noPosition(answers.headers["location"]!);
    const saved = await post(`/api/team/vet-batches/${id}/save`, {});
    expect(saved.status).toBe(303);
    noPosition(saved.headers["location"]!);
    expect(saved.headers["location"]).not.toContain(encodeURIComponent(name));
    const [cat] = await catsNamed([name]);
    expect(cat).toMatchObject({ lat: CENTRE.lat, lng: CENTRE.lng });
    const after = await get(saved.headers["location"]!);
    noPosition(after.text);
  });
});
