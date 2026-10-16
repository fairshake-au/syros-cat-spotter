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
import { resolveCoat } from "../resolve";
import { catsDueForReading } from "./due";
import { _recordHooks, copyReadingForward, recordReading } from "./record";
import { MODEL_VERSION } from "./reader";
import { BUDGETS, spendReadBudget, sweepCoatReadings } from "./sweep";

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
  return { catCount: 1, photoClear: true, colours, confidence: 0.95, ...over };
}

beforeEach(() => {
  answers.clear();
  sentLabels = [];
  create.mockReset();
  create.mockImplementation(async (body: { messages: { content: { type: string; image_url?: { url: string } }[] }[] }) => {
    const image = body.messages[0]!.content.find((p) => p.type === "image_url")!;
    const label = labelOf(image.image_url!.url);
    sentLabels.push(label);
    const a = answers.get(label) ?? answer(["ginger", "tabby"]);
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

async function resolvedCoat(catId: number) {
  const records = await loadCatRecords([catId]);
  return resolveCoat(records.get(catId)!.observations);
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
  it("system:vision, system, machine, the photo read, dated now, colours and modelVersion only", async () => {
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
    expect(Object.keys(row.value as object).sort()).toEqual(["colours", "modelVersion"]);
    expect(row.value).toEqual({ colours: ["ginger", "tabby"], modelVersion: MODEL_VERSION });
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
    expect(row!.value).toEqual({ colours: ["not_sure"], modelVersion: MODEL_VERSION });
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
    expect((await resolvedCoat(c.id)).value).toEqual(["ginger", "tabby"]);
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

  it("a trial reports the copy and writes nothing", async () => {
    const c = await cat("copytrial");
    await sighting(c.id, "copytrial:s");
    await write([c.id]);
    await setHidden(c.main, true);
    await write([c.id]);
    await setHidden(c.main, false);
    const before = (await machineRows(c.id)).length;
    const r = await sweepCoatReadings({ mode: "trial", limit: 50, catIds: [c.id] });
    expect(r.items).toMatchObject([{ action: "copy", status: "copied", colours: ["ginger", "tabby"] }]);
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
    await write([c.id]); // ginger tabby, dated now: newer
    expect((await resolvedCoat(c.id)).value).toEqual(["grey"]);
  });

  it("one spotter doesn't overturn a machine reading", async () => {
    const c = await cat("prec-one");
    await write([c.id]);
    // A minute ago: newer than the machine reading (the test clock dates it
    // about an hour ago), and still in the past.
    await spotter(c.id, "dev-1", ["black"], ago(60_000));
    expect((await resolvedCoat(c.id)).value).toEqual(["ginger", "tabby"]);
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
      colours: ["black" as const],
      raw: { colours: ["black"], confidence: 0.9, catCount: 1, photoClear: true },
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
    expect((await resolvedCoat(c.id)).value).toEqual(["ginger", "tabby"]);
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
        colours: ["white"],
        raw: { colours: ["white"], confidence: 0.9, catCount: 1, photoClear: true },
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
