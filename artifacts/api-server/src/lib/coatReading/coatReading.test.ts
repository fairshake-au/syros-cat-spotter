import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  catsTable,
  db,
  observationsTable,
  photosTable,
  photoVisibilityEventsTable,
  pool,
  sightingsTable,
  type Observation,
} from "@workspace/db";

// SYC-161 plan, PR 1: the reader's rules through the real database. The model
// is mocked in every test (no real call is ever made): it answers per photo,
// from `answers`, keyed by the label each fixture photo's bytes spell.
const create = vi.hoisted(() => vi.fn());
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create } } },
}));

import { deleteTestSightings } from "../../test/sightings";
import { consume } from "../limits";
import { loadCatRecords, writeObservation } from "../observations";
import { catDisplayPhotoIds, catDisplayPhotos } from "../photoVisibility";
import { resolveCoatParts } from "../resolve";
import { catsDueForReading } from "./due";
import { _recordHooks, copyReadingForward, recordReading } from "./record";
import { MODEL_VERSION } from "./reader";
import { BUDGETS, losesWhatIsKnown, spendReadBudget, sweepCoatReadings } from "./sweep";
import { VISION_MODEL } from "../visionModel";

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-coat-${RUN}-`;
// Far out at sea, away from every other file's cats.
const AT = { lat: 33.9127, lng: 20.8419 };

let n = 0;
const answers = new Map<string, Record<string, unknown>>();
/** Every image the mocked model was sent, decoded back to its label. */
let sentLabels: string[] = [];

function bytesFor(label: string): string {
  return Buffer.from(`photo:${label}`).toString("base64");
}

function labelOf(dataUrl: string): string {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Buffer.from(b64, "base64").toString("utf8").replace(/^photo:/, "");
}

function answer(colours: string[], over: Record<string, unknown> = {}) {
  // coat-v2 (SYC-398 §7): colours plus a pattern; "plain" unless a test says.
  return { catCount: 1, photoClear: true, colours, pattern: "plain", confidence: 0.95, ...over };
}

beforeEach(() => {
  answers.clear();
  sentLabels = [];
  create.mockReset();
  create.mockImplementation(async (body: { messages: { content: { type: string; image_url?: { url: string } }[] }[] }) => {
    const image = body.messages[0]!.content.find((p) => p.type === "image_url")!;
    const label = labelOf(image.image_url!.url);
    sentLabels.push(label);
    const a = answers.get(label) ?? answer(["ginger"], { pattern: "stripes" });
    return { choices: [{ message: { content: JSON.stringify(a) } }] };
  });
});

afterEach(() => {
  _recordHooks.afterRecheck = null;
});

async function photo(label: string, createdAt: Date): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}${label}-${n++}`, data: bytesFor(label), mime: "image/jpeg", createdAt })
    .returning({ id: photosTable.id });
  return p!.id;
}

/**
 * A cat with a main photo labelled `${label}:main`, taken two days ago:
 * older than any sighting's photo, as in life, so a reading dated by its
 * photo (mutation probe 1) would lose to the stand-in's every time, not only
 * when two inserts happen to land in different milliseconds.
 */
async function cat(label: string, opts: { noPhoto?: boolean } = {}): Promise<{ id: number; main: number }> {
  const main = opts.noPhoto ? 0 : await photo(`${label}:main`, new Date(Date.now() - 2 * 86_400_000));
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}${label}-${n++}`,
      primaryPhotoId: main,
      lat: AT.lat,
      lng: AT.lng,
      discovererDeviceId: `${PREFIX}discoverer`,
    })
    .returning({ id: catsTable.id });
  return { id: c!.id, main };
}

/** A resolved sighting of the cat, with a new photo. Newer each call. */
async function sighting(catId: number, label: string, minutesAgo = 0): Promise<number> {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  const photoId = await photo(label, at);
  await db.insert(sightingsTable).values({
    catId,
    photoId,
    deviceId: `${PREFIX}spotter`,
    lat: AT.lat,
    lng: AT.lng,
    status: "resolved",
    createdAt: at,
  });
  return photoId;
}

async function setHidden(photoId: number, hidden: boolean) {
  await db
    .insert(photoVisibilityEventsTable)
    // A report-author event (SYC-44's form), so no person row is needed.
    .values({ photoId, action: hidden ? "hide" : "restore", author: `report:${PREFIX}${n++}` });
}

async function machineRows(catId: number): Promise<Observation[]> {
  return db
    .select()
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, catId), eq(observationsTable.provenance, "machine")))
    .orderBy(observationsTable.id);
}

/** The team marks a row wrong ("Mark wrong", seeded directly). */
async function markWrong(catId: number, rowId: number) {
  await writeObservation(db, {
    catId,
    kind: "coat",
    value: { retracted: true },
    accountId: "person:vitest-coat-staff",
    roleAtTime: "staff",
    supersedesId: rowId,
    observedAt: new Date(),
  });
}

/** A clock that ticks a minute per reading, starting an hour ago. */
function clock() {
  let t = Date.now() - 60 * 60_000;
  return () => new Date((t += 60_000));
}

async function write(catIds: number[], tick = clock()) {
  return sweepCoatReadings({ mode: "write", limit: 50, catIds, now: tick });
}

/** The cat's resolved coat colours (SYC-398: the colours part). */
async function resolvedCoat(catId: number) {
  const records = await loadCatRecords([catId]);
  return resolveCoatParts(records.get(catId)!.observations).colours;
}

async function resolvedPattern(catId: number) {
  const records = await loadCatRecords([catId]);
  return resolveCoatParts(records.get(catId)!.observations).pattern;
}

afterAll(async () => {
  const cats = await db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  const ids = cats.map((c) => c.id);
  if (ids.length) {
    await deleteTestSightings(inArray(sightingsTable.catId, ids));
    await db.delete(catsTable).where(inArray(catsTable.id, ids));
  }
  await pool.end();
});

describe("T-row: one reading is one new row", () => {
  it("system:vision, system, machine, the photo read, dated now, the coat in the new shape and modelVersion only", async () => {
    const c = await cat("row");
    const at = new Date(Date.now() - 5 * 60_000);
    const r = await sweepCoatReadings({ mode: "write", limit: 50, catIds: [c.id], now: () => at });
    expect(r.written).toBe(1);
    const rows = await machineRows(c.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.accountId).toBe("system:vision");
    expect(row.roleAtTime).toBe("system");
    expect(row.provenance).toBe("machine");
    expect(row.photoId).toBe(c.main);
    expect(row.observedAt.toISOString()).toBe(at.toISOString());
    // SYC-398 §7: the coat-v2 answer Ginger · Stripes, in the new shape.
    expect(Object.keys(row.value as object).sort()).toEqual(["colours", "modelVersion", "pattern"]);
    expect(row.value).toEqual({ colours: ["ginger"], pattern: "stripes", modelVersion: MODEL_VERSION });
    expect(row.supersedesId).toBeNull();
    expect(row.suggestionSource).toBe("coat-reader");
    expect(row.suggestionSource).not.toMatch(/^backfill:/);
    expect(row.suggestedValue).toMatchObject({ confidence: 0.95, catCount: 1, photoClear: true });
  });

  it("a Not sure reading is a row too", async () => {
    const c = await cat("row-notsure");
    answers.set("row-notsure:main", answer(["ginger"], { catCount: 2 }));
    await write([c.id]);
    const [row] = await machineRows(c.id);
    expect(row!.value).toEqual({ notSure: true, modelVersion: MODEL_VERSION });
    expect(row!.suggestedValue).toMatchObject({ notSureBecause: "cat_count" });
  });
});

describe("T-photo: only the photo the public sees is ever read", () => {
  it("a hidden main photo: read from the newest public sighting photo, never the main", async () => {
    const c = await cat("hm");
    await sighting(c.id, "hm:older", 30);
    const newer = await sighting(c.id, "hm:newer", 10);
    await setHidden(c.main, true);
    await write([c.id]);
    const [row] = await machineRows(c.id);
    expect(row!.photoId).toBe(newer);
    expect(sentLabels).toEqual(["hm:newer"]);
  });

  it("every photo hidden: not read", async () => {
    const c = await cat("allhid");
    const s = await sighting(c.id, "allhid:s");
    await setHidden(c.main, true);
    await setHidden(s, true);
    const r = await write([c.id]);
    expect(r.due).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(await machineRows(c.id)).toHaveLength(0);
  });

  it("no hidden photo's bytes ever reach the model, across a mixed run", async () => {
    const a = await cat("mix-a");
    const b = await cat("mix-b");
    const bs = await sighting(b.id, "mix-b:standin");
    const bHiddenSighting = await sighting(b.id, "mix-b:hidden-newest");
    await setHidden(b.main, true);
    await setHidden(bHiddenSighting, true);
    const d = await cat("mix-d");
    await setHidden(d.main, true);
    await write([a.id, b.id, d.id]);
    expect(sentLabels.sort()).toEqual(["mix-a:main", "mix-b:standin"]);
    for (const hidden of ["mix-b:main", "mix-b:hidden-newest", "mix-d:main"]) {
      expect(sentLabels).not.toContain(hidden);
    }
    expect((await machineRows(b.id))[0]!.photoId).toBe(bs);
  });

  it("a cat with no photo (primaryPhotoId 0) is not read", async () => {
    const c = await cat("nophoto", { noPhoto: true });
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    await write([c.id]);
    expect(create).not.toHaveBeenCalled();
  });

  it("a cat whose photo row has been deleted is not read", async () => {
    const c = await cat("deleted");
    await db.delete(photosTable).where(eq(photosTable.id, c.main));
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    await write([c.id]);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("T-due: when a cat is due (R2) and when a photo is never read again (R4)", () => {
  it("rule 1: no machine row and a public photo → due; read once, then not due", async () => {
    const c = await cat("r1");
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toMatchObject([
      { catId: c.id, photoId: c.main, action: "read", because: "unread" },
    ]);
    await write([c.id]);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    await write([c.id]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rule 2: main public and the newest reading is of the main → not due", async () => {
    const c = await cat("r2no");
    await sighting(c.id, "r2no:s");
    await write([c.id]);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
  });

  it("rule 2: main restored after a stand-in reading, main never read → due, read the main", async () => {
    const c = await cat("r2yes");
    await sighting(c.id, "r2yes:s");
    await setHidden(c.main, true);
    await write([c.id]); // reads the stand-in
    await setHidden(c.main, false);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toMatchObject([
      { photoId: c.main, action: "read", because: "main_restored" },
    ]);
    await write([c.id]);
    expect(sentLabels).toEqual(["r2yes:s", "r2yes:main"]);
  });

  it("rule 3: main hidden and the newest reading was of the main → due, read the stand-in", async () => {
    const c = await cat("r3");
    const s = await sighting(c.id, "r3:s");
    await write([c.id]);
    await setHidden(c.main, true);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toMatchObject([
      { photoId: s, action: "read", because: "reading_photo_hidden" },
    ]);
  });

  it("rule 3: the stand-in that was read is hidden too → due, read the next public photo", async () => {
    const c = await cat("r3b");
    const s1 = await sighting(c.id, "r3b:s1", 30);
    await setHidden(c.main, true);
    await write([c.id]); // reads s1
    const s2 = await sighting(c.id, "r3b:s2", 20);
    await setHidden(s1, true);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toMatchObject([
      { photoId: s2, action: "read", because: "reading_photo_hidden" },
    ]);
  });

  it("a new sighting on a cat whose main is hidden does NOT make it due", async () => {
    const c = await cat("newsight");
    await sighting(c.id, "newsight:s1", 30);
    await setHidden(c.main, true);
    await write([c.id]); // reads s1
    await sighting(c.id, "newsight:s2", 0); // now the stand-in the public sees
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    await write([c.id]);
    expect(sentLabels).toEqual(["newsight:s1"]);
  });

  it("a photo whose reading was marked wrong is never read again, and the cat is not 'unread'", async () => {
    const c = await cat("wrong");
    await write([c.id]);
    const [row] = await machineRows(c.id);
    await markWrong(c.id, row!.id);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    await write([c.id]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a photo whose reading was Not sure is never read again", async () => {
    const c = await cat("ns");
    answers.set("ns:main", answer(["grey"], { confidence: 0.4 }));
    await write([c.id]);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    await write([c.id]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("when every photo is hidden, the last reading stays and nothing is due", async () => {
    const c = await cat("last");
    await write([c.id]);
    await setHidden(c.main, true);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    expect((await resolvedCoat(c.id)).value).toEqual(["ginger"]);
    expect((await resolvedPattern(c.id)).value).toBe("stripes");
  });

  it("a failed call writes nothing; the cat stays due (R6)", async () => {
    const c = await cat("fail");
    create.mockRejectedValueOnce(new Error("upstream down"));
    const r = await write([c.id]);
    expect(r.items[0]).toMatchObject({ status: "failed", reason: "error" });
    expect(await machineRows(c.id)).toHaveLength(0);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toHaveLength(1);
  });

  it("unparseable output writes nothing too", async () => {
    const c = await cat("garbled");
    create.mockResolvedValueOnce({ choices: [{ message: { content: "a ginger cat, I think" } }] });
    await write([c.id]);
    expect(await machineRows(c.id)).toHaveLength(0);
  });
});

describe("T-copy: a restored main photo that was read before is copied, with no call", () => {
  it("copies the earlier reading forward: same colours, version and photo, dated now", async () => {
    const c = await cat("copy");
    const s = await sighting(c.id, "copy:s");
    answers.set("copy:main", answer(["ginger"]));
    answers.set("copy:s", answer(["black"]));
    const tick = clock();
    await write([c.id], tick); // main → ginger
    await setHidden(c.main, true);
    await write([c.id], tick); // stand-in → black
    await setHidden(c.main, false);
    const due = await catsDueForReading(Infinity, db, { catIds: [c.id] });
    const [first] = await machineRows(c.id);
    expect(due).toMatchObject([{ photoId: c.main, action: "copy", copyOf: first!.id }]);
    const at = tick();
    await sweepCoatReadings({ mode: "write", limit: 50, catIds: [c.id], now: () => at });
    expect(create).toHaveBeenCalledTimes(2); // no third call
    const rows = await machineRows(c.id);
    expect(rows.map((r) => r.photoId)).toEqual([c.main, s, c.main]);
    const copy = rows[2]!;
    expect(copy.value).toEqual(first!.value);
    expect(copy.suggestionSource).toBe("coat-reader:copy");
    expect(copy.suggestedValue).toEqual({ copiedFrom: first!.id });
    expect(copy.observedAt.toISOString()).toBe(at.toISOString());
    expect(copy.supersedesId).toBeNull();
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
  });

  it("SYC-398: a reading stored in the old v1 shape is copied in the new shape, keeping its own version", async () => {
    const c = await cat("copyold");
    await sighting(c.id, "copyold:s");
    const tick = clock();
    // A reading written before SYC-398, straight to the table (the write
    // check now refuses the old shape), of the main photo.
    const [old] = await db
      .insert(observationsTable)
      .values({
        catId: c.id,
        kind: "coat",
        value: { colours: ["tabby", "white"], modelVersion: "vision-old/coat-v1" },
        accountId: "system:vision",
        roleAtTime: "system",
        authorityScope: "none",
        provenance: "machine",
        photoId: c.main,
        observedAt: tick(),
        suggestionSource: "coat-reader",
      })
      .returning();
    await setHidden(c.main, true);
    await write([c.id], tick); // stand-in → ginger · stripes
    await setHidden(c.main, false);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toMatchObject([
      { photoId: c.main, action: "copy", copyOf: old!.id },
    ]);
    await write([c.id], tick);
    const rows = await machineRows(c.id);
    const copy = rows.at(-1)!;
    expect(copy.suggestedValue).toEqual({ copiedFrom: old!.id });
    // An old Tabby · White says only Stripes (§6); the version is the source's.
    expect(copy.value).toEqual({ pattern: "stripes", modelVersion: "vision-old/coat-v1" });
  });

  it("a trial reports the copy and writes nothing", async () => {
    const c = await cat("copytrial");
    await sighting(c.id, "copytrial:s");
    await write([c.id]);
    await setHidden(c.main, true);
    await write([c.id]);
    await setHidden(c.main, false);
    const before = (await machineRows(c.id)).length;
    const r = await sweepCoatReadings({ mode: "trial", limit: 50, catIds: [c.id] });
    expect(r.items).toMatchObject([
      { action: "copy", status: "copied", parts: { colours: ["ginger"], pattern: "stripes", notSure: false } },
    ]);
    expect(await machineRows(c.id)).toHaveLength(before);
  });

  it("if the team marked the earlier reading wrong, nothing is written and the stand-in's reading stays the newest", async () => {
    const c = await cat("copywrong");
    await sighting(c.id, "copywrong:s");
    answers.set("copywrong:main", answer(["ginger"]));
    answers.set("copywrong:s", answer(["black"]));
    const tick = clock();
    await write([c.id], tick);
    const [first] = await machineRows(c.id);
    await markWrong(c.id, first!.id);
    await setHidden(c.main, true);
    await write([c.id], tick); // stand-in → black
    await setHidden(c.main, false);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    const r = await write([c.id], tick);
    expect(r.written).toBe(0);
    expect(await machineRows(c.id)).toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect((await resolvedCoat(c.id)).value).toEqual(["black"]);
  });
});

describe("T-ids: catDisplayPhotoIds and catDisplayPhotos always agree", () => {
  it("main public, main hidden with a stand-in, everything hidden, main deleted, no photo", async () => {
    const pub = await cat("ids-pub");
    const standIn = await cat("ids-standin");
    await sighting(standIn.id, "ids-standin:old", 30);
    const newest = await sighting(standIn.id, "ids-standin:new", 5);
    await setHidden(standIn.main, true);
    const allHidden = await cat("ids-allhidden");
    const ah = await sighting(allHidden.id, "ids-allhidden:s");
    await setHidden(allHidden.main, true);
    await setHidden(ah, true);
    const deleted = await cat("ids-deleted");
    await sighting(deleted.id, "ids-deleted:s");
    await db.delete(photosTable).where(eq(photosTable.id, deleted.main));
    const none = await cat("ids-none", { noPhoto: true });

    const cats = await db
      .select({ id: catsTable.id, primaryPhotoId: catsTable.primaryPhotoId })
      .from(catsTable)
      .where(inArray(catsTable.id, [pub.id, standIn.id, allHidden.id, deleted.id, none.id]));
    const ids = await catDisplayPhotoIds(cats);
    const urls = await catDisplayPhotos(cats);
    const publicIds = new Map(
      (await db.select({ id: photosTable.id, publicId: photosTable.publicId }).from(photosTable)).map((p) => [
        p.id,
        p.publicId,
      ]),
    );
    for (const c of cats) {
      const id = ids.get(c.id) ?? null;
      const url = urls.get(c.id) ?? null;
      expect(id === null, `cat ${c.id}`).toBe(url === null);
      if (id !== null) expect(url).toBe(`/api/photos/${publicIds.get(id)}`);
    }
    expect(ids.get(pub.id)).toBe(pub.main);
    expect(ids.get(standIn.id)).toBe(newest);
    expect(ids.get(allHidden.id)).toBeNull();
    // Today a deleted main photo gets no stand-in (a photo-display gap, noted on SYC-44).
    expect(ids.get(deleted.id)).toBeNull();
    expect(ids.get(none.id)).toBeNull();
  });
});

describe("T-newest: through the real resolver", () => {
  it("after a hide the stand-in's reading wins; after a restore the copied main reading wins", async () => {
    const c = await cat("newest");
    await sighting(c.id, "newest:s");
    answers.set("newest:main", answer(["ginger"]));
    answers.set("newest:s", answer(["black"]));
    const tick = clock();
    await write([c.id], tick);
    expect((await resolvedCoat(c.id)).value).toEqual(["ginger"]);
    await setHidden(c.main, true);
    await write([c.id], tick);
    expect((await resolvedCoat(c.id)).value).toEqual(["black"]);
    await setHidden(c.main, false);
    await write([c.id], tick);
    expect((await resolvedCoat(c.id)).value).toEqual(["ginger"]);
  });
});

describe("T-exclude: write leaves out the cats Samuel rejected", () => {
  it("writes every due cat but the excluded one, which stays due", async () => {
    const a = await cat("ex-a");
    const b = await cat("ex-b");
    const r = await sweepCoatReadings({ mode: "write", limit: 50, exclude: [a.id], catIds: [a.id, b.id] });
    expect(r.written).toBe(1);
    expect(r.items.find((i) => i.catId === a.id)).toMatchObject({ status: "excluded" });
    expect(await machineRows(a.id)).toHaveLength(0);
    expect(await machineRows(b.id)).toHaveLength(1);
    expect(sentLabels).toEqual(["ex-b:main"]);
    const dry = await sweepCoatReadings({ mode: "dry_run", limit: 50, exclude: [a.id], catIds: [a.id, b.id] });
    expect(dry.due).toBe(1);
    expect(dry.items).toMatchObject([{ catId: a.id, status: "excluded" }]);
  });
});

describe("T-precedence: SYC-2's rules decide, through the real resolver (spec test 16, SYC2-D10)", () => {
  const spotter = (catId: number, device: string, colours: string[], observedAt: Date) =>
    writeObservation(db, {
      catId,
      kind: "coat",
      value: { colours },
      deviceId: `${PREFIX}${device}`,
      roleAtTime: "public",
      observedAt,
    });
  // Exact moments in the past, whatever the time of day. (A fixed 10:00 UTC
  // "today" was still in the future before 10:00 UTC, so writeObservation
  // refused it and the test failed every morning: SYC-413.) Whole days apart
  // always fall on different Athens days, which independence needs.
  const ago = (ms: number) => new Date(Date.now() - ms);
  const DAY = 86_400_000;

  it("a team colour beats a newer machine reading", async () => {
    const c = await cat("prec-team");
    await writeObservation(db, {
      catId: c.id,
      kind: "coat",
      value: { colours: ["grey"] },
      accountId: "person:vitest-coat-staff",
      roleAtTime: "staff",
      observedAt: new Date(Date.now() - 3 * 86_400_000),
    });
    await write([c.id]); // ginger · stripes, dated now: newer
    expect((await resolvedCoat(c.id)).value).toEqual(["grey"]);
  });

  it("one spotter doesn't overturn a machine reading", async () => {
    const c = await cat("prec-one");
    await write([c.id]);
    // A minute ago: newer than the machine reading (the test clock dates it
    // about an hour ago), and still in the past.
    await spotter(c.id, "dev-1", ["black"], ago(60_000));
    expect((await resolvedCoat(c.id)).value).toEqual(["ginger"]);
  });

  it("two independent spotters do", async () => {
    const c = await cat("prec-two");
    await write([c.id]);
    await spotter(c.id, "dev-1", ["black"], ago(2 * DAY));
    await spotter(c.id, "dev-2", ["black"], ago(DAY));
    expect((await resolvedCoat(c.id)).value).toEqual(["black"]);
  });

  it("a machine Not sure after a real reading leaves no machine reading", async () => {
    const c = await cat("prec-ns");
    await sighting(c.id, "prec-ns:s");
    answers.set("prec-ns:s", answer(["grey"], { photoClear: false }));
    const tick = clock();
    await write([c.id], tick); // main → ginger tabby
    await setHidden(c.main, true);
    await write([c.id], tick); // stand-in → Not sure
    const coat = await resolvedCoat(c.id);
    expect(coat.value).toBeNull();
    expect(coat.confidence).toBe("unknown");
  });
});

describe("T-budget: the limits hold, through the database", () => {
  // Two minutes into an hour, so the previous window (empty) barely counts.
  const hourStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const at = hourStart + 2 * 60_000;

  it("the 61st call in an hour isn't made, across two simulated servers", async () => {
    const server = (offset: number) =>
      Promise.all(
        Array.from({ length: 31 }, (_, i) => spendReadBudget({ catId: 900_000 + offset + i, photoId: 1 }, at)),
      );
    const [a, b] = await Promise.all([server(0), server(100)]);
    const verdicts = [...a, ...b];
    expect(verdicts.filter((v) => v === "ok")).toHaveLength(60);
    expect(verdicts.filter((v) => v === "hour_limit")).toHaveLength(2);
  });

  it("the 21st new-cat reading in an hour isn't made", async () => {
    const verdicts = [];
    for (let i = 0; i < 21; i++) {
      verdicts.push(await spendReadBudget({ catId: 910_000 + i, photoId: 1, newCat: true }, at));
    }
    expect(verdicts.slice(0, 20).every((v) => v === "ok")).toBe(true);
    expect(verdicts[20]).toBe("new_cat_limit");
  });

  it("a 4th attempt on one photo within a day isn't made, across two simulated servers", async () => {
    const verdicts = await Promise.all(
      Array.from({ length: 4 }, () => spendReadBudget({ catId: 920_000, photoId: 7 }, at)),
    );
    expect(verdicts.filter((v) => v === "ok")).toHaveLength(3);
    expect(verdicts.filter((v) => v === "photo_attempts_used")).toHaveLength(1);
  });

  it("a run that hits the hourly limit stops at once and says how many are still due", async () => {
    const cats = [await cat("bud-a"), await cat("bud-b"), await cat("bud-c")];
    for (let i = 0; i < BUDGETS.hour.limit - 1; i++) {
      await consume(BUDGETS.hour.bucket, "all", BUDGETS.hour.limit, BUDGETS.hour.windowMs, undefined, at, {
        sliding: true,
      });
    }
    const r = await sweepCoatReadings({
      mode: "write",
      limit: 50,
      catIds: cats.map((c) => c.id),
      now: () => new Date(at),
    });
    expect(r.calls).toBe(1);
    expect(r.written).toBe(1);
    expect(r.stopped).toBe("hour_limit");
    expect(r.stillDue).toBe(2);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a photo that has used its attempts is skipped, and the run goes on", async () => {
    const a = await cat("att-a");
    const b = await cat("att-b");
    create.mockRejectedValue(new Error("always fails"));
    for (let i = 0; i < 3; i++) await sweepCoatReadings({ mode: "write", limit: 50, catIds: [a.id] });
    expect(create).toHaveBeenCalledTimes(3);
    create.mockReset();
    create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(answer(["white"])) } }] });
    const r = await sweepCoatReadings({ mode: "write", limit: 50, catIds: [a.id, b.id] });
    expect(r.items.find((i) => i.catId === a.id)).toMatchObject({ status: "photo_attempts_used" });
    expect(r.written).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("T-race: two servers recording one cat at once write one row (R8)", () => {
  it("the second waits on the lock, re-checks, and writes nothing", async () => {
    const c = await cat("race");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reached = 0;
    _recordHooks.afterRecheck = async () => {
      reached += 1;
      if (reached === 1) await gate;
    };
    const input = {
      catId: c.id,
      photoId: c.main,
      parts: { colours: ["black" as const], pattern: null, notSure: false },
      raw: { colours: ["black"], pattern: "plain", confidence: 0.9, catCount: 1, photoClear: true },
    };
    const first = recordReading(input);
    while (reached === 0) await new Promise((r) => setTimeout(r, 10));
    // The first is now between its re-check and its insert. Start the second.
    const second = recordReading(input);
    await new Promise((r) => setTimeout(r, 300));
    release();
    const outcomes = await Promise.all([first, second]);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(["not_due", "written"]);
    expect(await machineRows(c.id)).toHaveLength(1);
  });
});

// Added from the Opus spot review of due.ts, record.ts and catDisplayPhotoIds.
describe("spot review: the gaps it found, closed", () => {
  it("finding 1: a photo the team hides during a run is never sent", async () => {
    const a = await cat("mid-a");
    const b = await cat("mid-b");
    // While the model looks at a's photo, the team hides b's.
    create.mockImplementationOnce(async () => {
      sentLabels.push("mid-a:main");
      await setHidden(b.main, true);
      return { choices: [{ message: { content: JSON.stringify(answer(["grey"])) } }] };
    });
    const r = await write([a.id, b.id]);
    expect(sentLabels).toEqual(["mid-a:main"]);
    expect(r.items.find((i) => i.catId === b.id)).toMatchObject({ status: "not_due_any_more" });
    expect(await machineRows(b.id)).toHaveLength(0);
  });

  it("finding 2: a retraction without standing doesn't stop a copy (the resolver ignores it too)", async () => {
    const c = await cat("nostanding");
    await sighting(c.id, "nostanding:s");
    const tick = clock();
    await write([c.id], tick);
    const [first] = await machineRows(c.id);
    // A "mark wrong" from someone with no standing on appearance, written
    // straight to the table (writeObservation would refuse it).
    await db.insert(observationsTable).values({
      catId: c.id,
      kind: "coat",
      value: { retracted: true },
      deviceId: `${PREFIX}no-standing`,
      roleAtTime: "public",
      authorityScope: "none",
      provenance: "volunteered",
      observedAt: new Date(),
      supersedesId: first!.id,
    });
    expect((await resolvedCoat(c.id)).value).toEqual(["ginger"]);
    await setHidden(c.main, true);
    await write([c.id], tick);
    await setHidden(c.main, false);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toMatchObject([
      { action: "copy", copyOf: first!.id },
    ]);
  });

  it("finding 3: a copy whose source was marked wrong after the list was made writes nothing", async () => {
    const c = await cat("late-wrong");
    await sighting(c.id, "late-wrong:s");
    const tick = clock();
    await write([c.id], tick);
    await setHidden(c.main, true);
    await write([c.id], tick);
    await setHidden(c.main, false);
    const [due] = await catsDueForReading(Infinity, db, { catIds: [c.id] });
    expect(due).toMatchObject({ action: "copy" });
    await markWrong(c.id, due!.copyOf!);
    const before = (await machineRows(c.id)).length;
    expect(await copyReadingForward({ catId: c.id, photoId: due!.photoId, copyOf: due!.copyOf!, now: tick() })).toEqual({
      kind: "not_due",
    });
    expect(await machineRows(c.id)).toHaveLength(before);
  });

  it("finding 3: the re-check refuses a copy of a different row, and a read where a copy is due", async () => {
    const c = await cat("wrong-source");
    await sighting(c.id, "wrong-source:s");
    const tick = clock();
    await write([c.id], tick);
    await setHidden(c.main, true);
    await write([c.id], tick);
    await setHidden(c.main, false);
    const [due] = await catsDueForReading(Infinity, db, { catIds: [c.id] });
    const rows = await machineRows(c.id);
    const standIn = rows.find((r) => r.photoId !== c.main)!;
    expect(await copyReadingForward({ catId: c.id, photoId: c.main, copyOf: standIn.id, now: tick() })).toEqual({
      kind: "not_due",
    });
    expect(
      await recordReading({
        catId: c.id,
        photoId: due!.photoId,
        parts: { colours: ["white"], pattern: null, notSure: false },
        raw: { colours: ["white"], pattern: "plain", confidence: 0.9, catCount: 1, photoClear: true },
        now: tick(),
      }),
    ).toEqual({ kind: "not_due" });
    expect(await machineRows(c.id)).toHaveLength(rows.length);
  });

  it("finding 3: the re-check refuses a stale source, an older reading of the same photo", async () => {
    const c = await cat("stale-source");
    await sighting(c.id, "stale-source:s");
    const tick = clock();
    await write([c.id], tick); // r1: main
    await setHidden(c.main, true);
    await write([c.id], tick); // r2: stand-in
    await setHidden(c.main, false);
    await write([c.id], tick); // r3: a copy of r1
    await setHidden(c.main, true);
    await write([c.id], tick); // r4: a copy of r2
    await setHidden(c.main, false);
    const [r1] = await machineRows(c.id);
    const [due] = await catsDueForReading(Infinity, db, { catIds: [c.id] });
    expect(due).toMatchObject({ action: "copy", photoId: c.main });
    expect(due!.copyOf).not.toBe(r1!.id); // the newest reading of the main photo, r3
    const before = (await machineRows(c.id)).length;
    expect(await copyReadingForward({ catId: c.id, photoId: c.main, copyOf: r1!.id, now: tick() })).toEqual({
      kind: "not_due",
    });
    expect(await machineRows(c.id)).toHaveLength(before);
  });

  it("finding 4: ANY rejected reading of a photo stops the copy, not only the newest", async () => {
    const c = await cat("anywrong");
    await sighting(c.id, "anywrong:s");
    answers.set("anywrong:main", answer(["ginger"]));
    answers.set("anywrong:s", answer(["black"]));
    const tick = clock();
    await write([c.id], tick); // r1: main, ginger
    await setHidden(c.main, true);
    await write([c.id], tick); // r2: stand-in, black
    await setHidden(c.main, false);
    await write([c.id], tick); // r3: a copy of r1
    const [r1] = await machineRows(c.id);
    await markWrong(c.id, r1!.id); // the team rejects the ORIGINAL, not the copy
    await setHidden(c.main, true);
    await write([c.id], tick); // r4: a copy of r2 (the stand-in)
    await setHidden(c.main, false);
    // The main photo's readings are r1 (rejected) and r3 (its copy): neither comes back.
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    expect((await resolvedCoat(c.id)).value).toEqual(["black"]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("finding 5 (R2 rule 3, as written): every photo hidden, then a new public sighting → one reading of it", async () => {
    const c = await cat("reappear");
    await write([c.id]);
    await setHidden(c.main, true);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    const s = await sighting(c.id, "reappear:s");
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toMatchObject([
      { photoId: s, action: "read", because: "reading_photo_hidden" },
    ]);
    await write([c.id]);
    await write([c.id]);
    expect(sentLabels).toEqual(["reappear:main", "reappear:s"]);
  });
});

// ── SYC-398 PR C: the one checked re-read (§7) ──────────────────────────────
describe("T-reread: a manual re-read of photos read by an older reader version", () => {
  const V1 = `${VISION_MODEL}/coat-v1`;

  /**
   * A reading by the coat-v1 reader, straight to the table (as the 15 Oct
   * fill-in wrote them, before coat-v2). `value` is the stored coat.
   */
  async function v1Reading(catId: number, photoId: number, value: Record<string, unknown>, at: Date) {
    const [row] = await db
      .insert(observationsTable)
      .values({
        catId,
        kind: "coat",
        value: { ...value, modelVersion: V1 },
        accountId: "system:vision",
        roleAtTime: "system",
        authorityScope: "none",
        provenance: "machine",
        photoId,
        observedAt: at,
        suggestionSource: "coat-reader",
      })
      .returning();
    return row!;
  }

  async function team(catId: number, value: Record<string, unknown>) {
    await writeObservation(db, {
      catId,
      kind: "coat",
      value,
      accountId: "person:vitest-coat-staff",
      roleAtTime: "staff",
      observedAt: new Date(Date.now() - 60_000),
    });
  }

  const reread = (catIds: number[], mode: "dry_run" | "trial" | "write" = "write", tick = clock()) =>
    sweepCoatReadings({ mode, limit: 50, catIds, reread: true, now: tick });

  it("an automatic run never lists or reads a cat for an older version", async () => {
    const c = await cat("rr-auto");
    const tick = clock();
    await v1Reading(c.id, c.main, { colours: ["tabby"] }, tick());
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: false })).toEqual([]);
    const r = await write([c.id], tick);
    expect(r.due).toBe(0);
    expect(r.reread).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("a cat whose shown photo already has a v1 reading is listed with action read under reread, then written once", async () => {
    const c = await cat("rr-read");
    const tick = clock();
    await v1Reading(c.id, c.main, { colours: ["tabby"] }, tick());
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toEqual([
      { catId: c.id, photoId: c.main, action: "read", because: "older_version" },
    ]);
    answers.set("rr-read:main", answer(["brown", "ginger"], { pattern: "stripes" }));
    const r = await reread([c.id], "write", tick);
    expect(r.reread).toBe(true);
    expect(r.items).toMatchObject([{ catId: c.id, because: "older_version", status: "written" }]);
    expect(r.written).toBe(1);
    const rows = await machineRows(c.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.value).toEqual({ colours: ["brown", "ginger"], pattern: "stripes", modelVersion: MODEL_VERSION });
    expect(rows[1]!.photoId).toBe(c.main);
    expect((await resolvedCoat(c.id)).value).toEqual(["brown", "ginger"]);
  });

  it("after the v2 write it isn't listed again: at most one written reading per photo per version", async () => {
    const c = await cat("rr-once");
    const tick = clock();
    await v1Reading(c.id, c.main, { colours: ["ginger", "white"] }, tick());
    await reread([c.id], "write", tick);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toEqual([]);
    const again = await reread([c.id], "write", tick);
    expect(again.due).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("after the v2 write, a restored photo copies its v2 reading, never a newer v1 one, and isn't listed again", async () => {
    const c = await cat("rr-v2copy");
    await sighting(c.id, "rr-v2copy:s");
    const tick = clock();
    await v1Reading(c.id, c.main, { colours: ["tabby"] }, tick());
    await reread([c.id], "write", tick); // the v2 write of the main photo
    const v2 = (await machineRows(c.id)).at(-1)!;
    // A later v1 row of the same photo (as an old copy forward would leave).
    await v1Reading(c.id, c.main, { colours: ["tabby"] }, tick());
    await setHidden(c.main, true);
    await write([c.id], tick); // the stand-in, coat-v2
    await setHidden(c.main, false);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toMatchObject([
      { photoId: c.main, action: "copy", copyOf: v2.id, because: "main_restored" },
    ]);
    await reread([c.id], "write", tick);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toEqual([]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("a v1 copy-forward under an automatic run isn't due again", async () => {
    const c = await cat("rr-copy");
    await sighting(c.id, "rr-copy:s");
    const tick = clock();
    const main = await v1Reading(c.id, c.main, { colours: ["ginger"], pattern: "stripes" }, tick());
    await setHidden(c.main, true);
    await write([c.id], tick); // the stand-in, read by coat-v2
    await setHidden(c.main, false);
    // Automatic: the main photo was read before (by v1), so it is copied as before.
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toMatchObject([
      { photoId: c.main, action: "copy", copyOf: main.id, because: "main_restored" },
    ]);
    await write([c.id], tick);
    const copy = (await machineRows(c.id)).at(-1)!;
    expect(copy.value).toEqual({ colours: ["ginger"], pattern: "stripes", modelVersion: V1 });
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    await write([c.id], tick);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("under reread, a restored photo read only by v1 is read rather than copied, and then isn't due again (no copy loop)", async () => {
    const c = await cat("rr-loop");
    await sighting(c.id, "rr-loop:s");
    const tick = clock();
    await v1Reading(c.id, c.main, { colours: ["black", "white"] }, tick());
    await setHidden(c.main, true);
    await write([c.id], tick); // the stand-in, read by coat-v2
    await setHidden(c.main, false);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toEqual([
      { catId: c.id, photoId: c.main, action: "read", because: "main_restored" },
    ]);
    answers.set("rr-loop:main", answer(["black", "white"], { pattern: "patches" }));
    const r = await reread([c.id], "write", tick);
    expect(r.items).toMatchObject([{ status: "written" }]);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toEqual([]);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("under reread, a restored photo with a reading by this version is copied, not read", async () => {
    const c = await cat("rr-copy2");
    await sighting(c.id, "rr-copy2:s");
    const tick = clock();
    await write([c.id], tick); // main, coat-v2
    const [mainRow] = await machineRows(c.id);
    await setHidden(c.main, true);
    await write([c.id], tick); // stand-in, coat-v2
    await setHidden(c.main, false);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toMatchObject([
      { photoId: c.main, action: "copy", copyOf: mainRow!.id, because: "main_restored" },
    ]);
  });

  it("a photo with a reading the team marked wrong is skipped", async () => {
    const c = await cat("rr-wrong");
    const tick = clock();
    const old = await v1Reading(c.id, c.main, { colours: ["tabby"] }, tick());
    await markWrong(c.id, old.id);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toEqual([]);
    const r = await reread([c.id], "write", tick);
    expect(r.due).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("an older rejected reading of the shown photo is enough to skip it", async () => {
    const c = await cat("rr-wrong-old");
    const tick = clock();
    const first = await v1Reading(c.id, c.main, { colours: ["grey"] }, tick());
    await markWrong(c.id, first.id);
    await v1Reading(c.id, c.main, { colours: ["tabby"] }, tick());
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toEqual([]);
  });

  it("a cat whose both parts the team decided is skipped; one part decided is not enough", async () => {
    const both = await cat("rr-team-both");
    const one = await cat("rr-team-one");
    const tick = clock();
    await v1Reading(both.id, both.main, { colours: ["tabby"] }, tick());
    await v1Reading(one.id, one.main, { colours: ["tabby"] }, tick());
    await team(both.id, { colours: ["brown", "ginger"], pattern: "stripes" });
    await team(one.id, { colours: ["brown", "ginger"] });
    expect(resolveCoatParts((await loadCatRecords([both.id])).get(both.id)!.observations).pattern.rule).toBe(1);
    const due = await catsDueForReading(Infinity, db, { catIds: [both.id, one.id], reread: true });
    expect(due).toEqual([{ catId: one.id, photoId: one.main, action: "read", because: "older_version" }]);
    await reread([both.id, one.id], "write", tick);
    expect(sentLabels).toEqual(["rr-team-one:main"]);
  });

  it("a reading that loses a known pattern is held back: nothing written, in a trial and a write", async () => {
    const c = await cat("rr-pattern");
    const tick = clock();
    await v1Reading(c.id, c.main, { colours: ["ginger"], pattern: "stripes" }, tick());
    answers.set("rr-pattern:main", answer(["ginger", "white"], { pattern: "cant_tell" }));
    const trial = await reread([c.id], "trial", tick);
    expect(trial.items).toMatchObject([
      {
        status: "held_back",
        current: { colours: ["ginger"], pattern: "stripes", notSure: false },
        parts: { colours: ["ginger", "white"], pattern: null, notSure: false },
      },
    ]);
    const r = await reread([c.id], "write", tick);
    expect(r.items).toMatchObject([{ status: "held_back" }]);
    expect(r.written).toBe(0);
    expect(await machineRows(c.id)).toHaveLength(1);
    // Held back, so still due: it stays on the list by design.
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toHaveLength(1);
  });

  it("losing known colours is held back too (the pure rule)", () => {
    const known = { colours: ["black" as const, "white" as const], pattern: null, notSure: false };
    expect(losesWhatIsKnown(known, { colours: null, pattern: "patches", notSure: false })).toBe(true);
    expect(losesWhatIsKnown(known, { colours: ["black"], pattern: null, notSure: false })).toBe(false);
    expect(losesWhatIsKnown(null, { colours: ["black"], pattern: null, notSure: false })).toBe(false);
    expect(losesWhatIsKnown({ colours: null, pattern: null, notSure: true }, { colours: null, pattern: "plain", notSure: false })).toBe(false);
    expect(losesWhatIsKnown(null, { colours: null, pattern: null, notSure: true })).toBe(true);
  });

  it("a whole Not sure is held back, even over a v1 Not sure", async () => {
    const known = await cat("rr-ns-known");
    const unknown = await cat("rr-ns-unknown");
    const tick = clock();
    await v1Reading(known.id, known.main, { colours: ["tabby"] }, tick());
    await v1Reading(unknown.id, unknown.main, { colours: ["not_sure"] }, tick());
    answers.set("rr-ns-known:main", answer(["ginger"], { catCount: 2 }));
    answers.set("rr-ns-unknown:main", answer(["ginger"], { photoClear: false }));
    const r = await reread([known.id, unknown.id], "write", tick);
    expect(r.items.map((i) => i.status)).toEqual(["held_back", "held_back"]);
    expect(r.written).toBe(0);
    expect(await machineRows(known.id)).toHaveLength(1);
    expect(await machineRows(unknown.id)).toHaveLength(1);
  });

  it("a reading that keeps every known part, and adds to them, is written", async () => {
    const c = await cat("rr-keeps");
    const tick = clock();
    await v1Reading(c.id, c.main, { colours: ["tabby", "white"] }, tick()); // Stripes, colours not known
    answers.set("rr-keeps:main", answer(["brown", "white"], { pattern: "stripes" }));
    const r = await reread([c.id], "write", tick);
    expect(r.items).toMatchObject([
      { status: "written", current: { colours: null, pattern: "stripes", notSure: false } },
    ]);
    expect((await resolvedCoat(c.id)).value).toEqual(["brown", "white"]);
  });

  it("current is the newest machine reading the team hasn't marked wrong", async () => {
    const c = await cat("rr-current");
    await sighting(c.id, "rr-current:s");
    const tick = clock();
    await v1Reading(c.id, c.main, { colours: ["ginger"], pattern: "stripes" }, tick());
    await setHidden(c.main, true);
    answers.set("rr-current:s", answer(["black"], { pattern: "cant_tell" }));
    await write([c.id], tick); // the stand-in: Black, pattern not known
    const standIn = (await machineRows(c.id)).at(-1)!;
    await markWrong(c.id, standIn.id);
    await setHidden(c.main, false);
    // The main photo was read only by v1: under reread it is read again.
    answers.set("rr-current:main", answer(["ginger"], { pattern: "cant_tell" }));
    const r = await reread([c.id], "trial", tick);
    expect(r.items).toMatchObject([
      { because: "main_restored", status: "held_back", current: { colours: ["ginger"], pattern: "stripes" } },
    ]);
  });

  it("exclude holds under reread", async () => {
    const a = await cat("rr-ex-a");
    const b = await cat("rr-ex-b");
    const tick = clock();
    await v1Reading(a.id, a.main, { colours: ["tabby"] }, tick());
    await v1Reading(b.id, b.main, { colours: ["tabby"] }, tick());
    const r = await sweepCoatReadings({
      mode: "write",
      limit: 50,
      exclude: [a.id],
      catIds: [a.id, b.id],
      reread: true,
      now: tick,
    });
    expect(r.items.find((i) => i.catId === a.id)).toMatchObject({ status: "excluded" });
    expect(r.items.find((i) => i.catId === b.id)).toMatchObject({ status: "written" });
    expect(await machineRows(a.id)).toHaveLength(1);
    expect(sentLabels).toEqual(["rr-ex-b:main"]);
  });

  it("the re-check inside the lock honours reread (forced interleave, as in T-race): one row", async () => {
    const c = await cat("rr-race");
    const tick = clock();
    await v1Reading(c.id, c.main, { colours: ["tabby"] }, tick());
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reached = 0;
    _recordHooks.afterRecheck = async () => {
      reached += 1;
      if (reached === 1) await gate;
    };
    const input = {
      catId: c.id,
      photoId: c.main,
      parts: { colours: ["brown" as const], pattern: "stripes" as const, notSure: false },
      raw: { colours: ["brown"], pattern: "stripes", confidence: 0.9, catCount: 1, photoClear: true },
      reread: true,
    };
    const first = recordReading(input);
    // Fail fast, not by timeout, if the first never passes its re-check.
    let settled = false;
    void first.then(() => (settled = true));
    while (reached === 0 && !settled) await new Promise((r) => setTimeout(r, 10));
    expect(reached, "the first reading passed its re-check").toBe(1);
    // The first is now between its re-check and its insert. Start the second.
    const second = recordReading(input);
    await new Promise((r) => setTimeout(r, 300));
    release();
    const outcomes = await Promise.all([first, second]);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(["not_due", "written"]);
    expect(await machineRows(c.id)).toHaveLength(2);
    _recordHooks.afterRecheck = null;
    // Without reread, the same reading is refused inside the lock.
    const other = await cat("rr-race-auto");
    await v1Reading(other.id, other.main, { colours: ["tabby"] }, tick());
    expect(await recordReading({ ...input, catId: other.id, photoId: other.main, reread: false })).toEqual({
      kind: "not_due",
    });
  });

  it("a cat the team decides while its photo is being read is refused by the re-check, and nothing is written", async () => {
    const c = await cat("rr-mid");
    const tick = clock();
    await v1Reading(c.id, c.main, { colours: ["tabby"] }, tick());
    create.mockImplementationOnce(async () => {
      sentLabels.push("rr-mid:main");
      await team(c.id, { colours: ["grey"], pattern: "stripes" });
      return { choices: [{ message: { content: JSON.stringify(answer(["grey"], { pattern: "stripes" })) } }] };
    });
    const r = await reread([c.id], "write", tick);
    expect(r.items).toMatchObject([{ status: "not_due_any_more" }]);
    expect(await machineRows(c.id)).toHaveLength(1);
  });

  it("a photo the team rejects between the list and the send is never sent", async () => {
    const a = await cat("rr-send-a");
    const b = await cat("rr-send-b");
    const tick = clock();
    await v1Reading(a.id, a.main, { colours: ["tabby"] }, tick());
    const bOld = await v1Reading(b.id, b.main, { colours: ["tabby"] }, tick());
    create.mockImplementationOnce(async () => {
      sentLabels.push("rr-send-a:main");
      await markWrong(b.id, bOld.id);
      return { choices: [{ message: { content: JSON.stringify(answer(["grey"], { pattern: "stripes" })) } }] };
    });
    const r = await reread([a.id, b.id], "write", tick);
    expect(sentLabels).toEqual(["rr-send-a:main"]);
    expect(r.items.find((i) => i.catId === b.id)).toMatchObject({ status: "not_due_any_more" });
  });
});

// Added from the Opus spot review of PR C (due.ts and sweep.ts).
describe("T-reread spot review: the gaps it found, closed", () => {
  const V1 = `${VISION_MODEL}/coat-v1`;

  async function machine(catId: number, photoId: number, value: Record<string, unknown>, at: Date) {
    const [row] = await db
      .insert(observationsTable)
      .values({
        catId,
        kind: "coat",
        value,
        accountId: "system:vision",
        roleAtTime: "system",
        authorityScope: "none",
        provenance: "machine",
        photoId,
        observedAt: at,
        suggestionSource: "coat-reader",
      })
      .returning();
    return row!;
  }

  it("finding 3: under reread, a never-read cat's Not sure is written, as in any run", async () => {
    const c = await cat("rv-unread-ns");
    answers.set("rv-unread-ns:main", answer(["ginger"], { catCount: 2 }));
    const r = await sweepCoatReadings({ mode: "write", limit: 50, catIds: [c.id], reread: true, now: clock() });
    expect(r.items).toMatchObject([{ because: "unread", status: "written", current: null }]);
    const [row] = await machineRows(c.id);
    expect(row!.value).toEqual({ notSure: true, modelVersion: MODEL_VERSION });
    expect(r.stillDue).toBe(0);
  });

  it("a cat whose both parts a cat guardian decided is skipped", async () => {
    const c = await cat("rv-guardian");
    const tick = clock();
    await machine(c.id, c.main, { colours: ["tabby"], modelVersion: V1 }, tick());
    // A guardian's statement, straight to the table (level 2: rule 1).
    await db.insert(observationsTable).values({
      catId: c.id,
      kind: "coat",
      value: { colours: ["grey"], pattern: "plain" },
      accountId: "person:vitest-coat-guardian",
      roleAtTime: "guardian",
      authorityScope: "colony:1",
      provenance: "volunteered",
      observedAt: new Date(Date.now() - 60_000),
    });
    const parts = resolveCoatParts((await loadCatRecords([c.id])).get(c.id)!.observations);
    expect([parts.colours.rule, parts.pattern.rule]).toEqual([1, 1]);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toEqual([]);
  });

  it("a retraction without standing doesn't make a photo 'rejected' for the re-read", async () => {
    const c = await cat("rv-nostanding");
    const tick = clock();
    const old = await machine(c.id, c.main, { colours: ["tabby"], modelVersion: V1 }, tick());
    await db.insert(observationsTable).values({
      catId: c.id,
      kind: "coat",
      value: { retracted: true },
      deviceId: `${PREFIX}rv-no-standing`,
      roleAtTime: "public",
      authorityScope: "none",
      provenance: "volunteered",
      observedAt: new Date(),
      supersedesId: old.id,
    });
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toMatchObject([
      { action: "read", because: "older_version" },
    ]);
  });

  it("under reread, a restored photo whose only (v1) reading was marked wrong is skipped, not read", async () => {
    const c = await cat("rv-r2wrong");
    await sighting(c.id, "rv-r2wrong:s");
    const tick = clock();
    const old = await machine(c.id, c.main, { colours: ["grey"], modelVersion: V1 }, tick());
    await markWrong(c.id, old.id);
    await setHidden(c.main, true);
    await write([c.id], tick); // the stand-in, coat-v2
    await setHidden(c.main, false);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toEqual([]);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
  });

  it("a machine row with no modelVersion counts as an older version", async () => {
    const c = await cat("rv-noversion");
    await machine(c.id, c.main, { colours: ["ginger"] }, clock()());
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id], reread: true })).toMatchObject([
      { action: "read", because: "older_version" },
    ]);
    expect(await catsDueForReading(Infinity, db, { catIds: [c.id] })).toEqual([]);
  });

  it("stillDue counts a held-back cat", async () => {
    const c = await cat("rv-stilldue");
    const tick = clock();
    await machine(c.id, c.main, { colours: ["ginger"], pattern: "stripes", modelVersion: V1 }, tick());
    answers.set("rv-stilldue:main", answer(["ginger"], { pattern: "cant_tell" }));
    const r = await sweepCoatReadings({ mode: "write", limit: 50, catIds: [c.id], reread: true, now: tick });
    expect(r).toMatchObject({ due: 1, written: 0, stillDue: 1 });
    expect(r.items).toMatchObject([{ status: "held_back" }]);
  });

  it("a copy under reread is written through the lock's re-check", async () => {
    const c = await cat("rv-copywrite");
    await sighting(c.id, "rv-copywrite:s");
    const tick = clock();
    await write([c.id], tick); // main, coat-v2
    await setHidden(c.main, true);
    await write([c.id], tick); // stand-in, coat-v2
    await setHidden(c.main, false);
    const r = await sweepCoatReadings({ mode: "write", limit: 50, catIds: [c.id], reread: true, now: tick });
    expect(r.items).toMatchObject([{ action: "copy", status: "written" }]);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

// Samuel, 17 Oct 2026 (SYC-448 decision 1, "Keep the new colours"): the
// hold-back ignores a part the team or a cat guardian decides.
describe("T-reread SYC-448: a part the team decided is never 'lost' by a re-read", () => {
  it("Toula's case: team Stripes, old AI Stripes, new reading Brown · White with the pattern not told → written", async () => {
    const c = await cat("d1-toula");
    const tick = clock();
    // The 15 Oct fill-in's "Tabby · White": Stripes, colours not known.
    await db.insert(observationsTable).values({
      catId: c.id,
      kind: "coat",
      value: { colours: ["tabby", "white"], modelVersion: `${VISION_MODEL}/coat-v1` },
      accountId: "system:vision",
      roleAtTime: "system",
      authorityScope: "none",
      provenance: "machine",
      photoId: c.main,
      observedAt: tick(),
      suggestionSource: "coat-reader",
    });
    // Samuel's verdict, as the team: Stripes, colours not stated (spec §8).
    await writeObservation(db, {
      catId: c.id,
      kind: "coat",
      value: { pattern: "stripes" },
      accountId: "person:vitest-coat-staff",
      roleAtTime: "staff",
      observedAt: new Date(Date.now() - 60_000),
    });
    answers.set("d1-toula:main", answer(["brown", "white"], { pattern: "cant_tell" }));
    const r = await sweepCoatReadings({ mode: "write", limit: 50, catIds: [c.id], reread: true, now: tick });
    expect(r.items).toMatchObject([
      { because: "older_version", status: "written", current: { colours: null, pattern: "stripes" } },
    ]);
    expect((await resolvedCoat(c.id)).value).toEqual(["brown", "white"]);
    expect((await resolvedPattern(c.id)).value).toBe("stripes");
  });

  it("the pure rule: a decided part is ignored, an AI-only part still counts, a whole Not sure is still held back", () => {
    const current = { colours: ["ginger" as const], pattern: "stripes" as const, notSure: false };
    const noPattern = { colours: ["ginger" as const], pattern: null, notSure: false };
    expect(losesWhatIsKnown(current, noPattern)).toBe(true);
    expect(losesWhatIsKnown(current, noPattern, { colours: false, pattern: true })).toBe(false);
    expect(losesWhatIsKnown(current, noPattern, { colours: true, pattern: false })).toBe(true);
    expect(
      losesWhatIsKnown(current, { colours: null, pattern: null, notSure: true }, { colours: true, pattern: true }),
    ).toBe(true);
  });
});
