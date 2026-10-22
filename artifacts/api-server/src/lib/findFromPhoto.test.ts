import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { and, eq, gt, inArray, like, max, sql } from "drizzle-orm";
import {
  catsTable,
  db,
  observationsTable,
  photoFingerprintsTable,
  photosTable,
  photoVisibilityEventsTable,
  sightingsTable,
} from "@workspace/db";
import { deleteTestSightings } from "../test/sightings";
import { newColony, putInColony } from "../test/roleKit";

// SYC-396 PR 2.5, Task 2.5.1: the search itself. The matching service is
// mocked in every test (no real call is ever made), as the sighting tests do.
vi.mock("./matching", () => ({ matchCatPhoto: vi.fn() }));
// Spies on the two write helpers: a search must never call either.
vi.mock("./observations", async (orig) => {
  const real = (await orig()) as typeof import("./observations");
  return { ...real, writeObservation: vi.fn(real.writeObservation) };
});
vi.mock("./spotPhotos", async (orig) => {
  const real = (await orig()) as typeof import("./spotPhotos");
  return { ...real, saveSpotWithPhotos: vi.fn(real.saveSpotWithPhotos) };
});

// SYC-527 piece 3, Task 8: the model is mocked (fingerprints are made from a
// photo's colour, deterministically); the logger is captured to prove nothing
// private is logged.
const spies = vi.hoisted(() => ({ logLines: [] as string[] }));
vi.mock("./logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    { level: "trace", redact: actual.REDACT_PATHS, serializers: actual.LOG_SERIALIZERS },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});
vi.mock("./fingerprint/model", async (orig) => {
  const real = (await orig()) as typeof import("./fingerprint/model");
  return { ...real, fingerprintOf: vi.fn() };
});

// The island test seam (SYC-527 piece 1): with no area and no colony the real
// list would return every cat on the shared test database, so "the island" is
// narrowed to this run's own cats (names starting with PREFIX).
vi.mock("./teamCatList", async (orig) => {
  const real = (await orig()) as typeof import("./teamCatList");
  return {
    ...real,
    allTeamCats: vi.fn(async (f: Parameters<typeof real.allTeamCats>[0], now?: Date) => {
      const out = await real.allTeamCats(f, now);
      if (f.area !== undefined || f.colony !== undefined) return out;
      const cats = out.cats.filter((c) => c.name.startsWith(ISLE));
      return { ...out, cats, catCount: cats.length };
    }),
  };
});

import { matchCatPhoto, type CandidateInput, type MatchOutput, type NewPhotoInput } from "./matching";
import { writeObservation } from "./observations";
import { saveSpotWithPhotos } from "./spotPhotos";
import { allTeamCats } from "./teamCatList";
import { variantFor } from "./photoVariants";
import {
  bandOf,
  findFromPhoto,
  FIND_FILL_BUDGET_MS,
  FIND_MAX_CATS,
  FIND_SHORTLIST_K,
  POSSIBLE,
  VERY_LIKELY,
} from "./findFromPhoto";
import { DIMENSIONS, fingerprintOf } from "./fingerprint/model";
import { __fillClock } from "./fingerprint/index";
import { safeError } from "./logger";

const matchMock = vi.mocked(matchCatPhoto);
const fingerprintMock = vi.mocked(fingerprintOf);

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-find-${RUN}-`;
// The island's own scope: only cats named with ISLE are "the island" in the seam above.
const ISLE = `${PREFIX}isle-`;
const DEVICE = `${PREFIX}device`;
const NOW = new Date();

/** A small real JPEG of one colour, as base64 (variantFor must be able to decode it). */
async function jpeg(colour: string): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: colour } }).jpeg().toBuffer();
}

/** The red of a solid-colour photo, rounded: the stand-in "look" the mocked model reads. */
async function redOf(bytes: Buffer): Promise<number> {
  return Math.round((await sharp(bytes).stats()).channels[0]!.mean);
}
/** A length-1 fingerprint that is closer to another the nearer their reds are. */
function vecOf(red: number): Float32Array {
  const v = new Float32Array(DIMENSIONS);
  let sum = 0;
  for (let j = 0; j < DIMENSIONS; j++) {
    v[j] = Math.exp(-Math.abs(j - red) / 12);
    sum += v[j]! * v[j]!;
  }
  for (let j = 0; j < DIMENSIONS; j++) v[j] = v[j]! / Math.sqrt(sum);
  return v;
}
const redOfCat = (i: number) => 10 + 6 * i;
const solid = (red: number) =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: { r: red, g: 90, b: 60 } } }).jpeg().toBuffer();

let n = 0;
async function photo(colour: string): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}p${n++}`, data: (await jpeg(colour)).toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  return p!.id;
}

async function cat(key: string, primaryPhotoId: number, colony: number): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${PREFIX}${key}`, primaryPhotoId, lat: 37.4447, lng: 24.9417, discovererDeviceId: DEVICE })
    .returning({ id: catsTable.id });
  await putInColony(c!.id, colony);
  return c!.id;
}

/** `count` cats in a new colony, all sharing one photo. */
async function colonyOf(count: number, label: string): Promise<{ colony: number; ids: number[] }> {
  const colony = await newColony(`find ${label}`);
  const p = await photo("#336699");
  const ids: number[] = [];
  for (let i = 0; i < count; i++) ids.push(await cat(`${label}-${i}`, p, colony));
  return { colony, ids };
}

/** A JPEG carrying a GPS position in EXIF (as imageValidation.exif.test.ts's fixture). */
async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: "#048" } })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Copyright: "vitest fixture" },
        GPS: { GPSLatitudeRef: "N", GPSLatitude: "37/1 26/1 24/1", GPSLongitudeRef: "E", GPSLongitude: "24/1 56/1 0/1" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    .toBuffer();
}

/** The mock: a cat photo, every candidate scored by `score(catId)`. */
function answer(score: (catId: number) => number = () => 0.3): void {
  matchMock.mockImplementation(async (_p, candidates: CandidateInput[]): Promise<MatchOutput> => ({
    isCatPhoto: true,
    matches: candidates.map((c) => ({ catId: c.catId, confidence: score(c.catId), reasoning: `why ${c.catId}` })),
  }));
}

let upload: Buffer;
let small: { colony: number; ids: number[] };

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  // A photo with a visibility event stays: those events are add-only.
  await db
    .delete(photosTable)
    .where(
      and(
        like(photosTable.publicId, `${PREFIX}%`),
        sql`not exists (select 1 from photo_visibility_events e where e.photo_id = ${photosTable.id})`,
      ),
    );
}

beforeAll(async () => {
  await cleanup();
  upload = await jpeg("#aa5500");
  small = await colonyOf(4, "small");
});
afterAll(cleanup);
beforeEach(() => {
  matchMock.mockReset();
  answer();
  spies.logLines.length = 0;
  fingerprintMock.mockReset();
  fingerprintMock.mockImplementation(async (jpegBytes: Buffer) => vecOf(await redOf(jpegBytes)));
});

describe("findFromPhoto: narrowing (spec §5.2)", () => {
  it(`a colony of ${FIND_MAX_CATS + 1} is not refused: it uses the shortlist`, async () => {
    const big = await colonyOf(FIND_MAX_CATS + 1, "big");
    const out = await findFromPhoto(upload, { colony: big.colony }, NOW);
    expect(out.kind).toBe("results");
    expect(fingerprintMock).toHaveBeenCalled();
  });

  it("a colony with no active cats has none to compare", async () => {
    const empty = await newColony("find empty");
    expect(await findFromPhoto(upload, { colony: empty }, NOW)).toEqual({ kind: "none_to_compare" });
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("an upload that isn't a photo is refused before the gate and the service", async () => {
    const gate = vi.fn(async () => null);
    const out = await findFromPhoto(Buffer.from("not a picture at all"), { colony: small.colony }, NOW, { gate });
    expect(out).toEqual({ kind: "bad_photo", count: 4 });
    expect(gate).not.toHaveBeenCalled();
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("a gate that refuses stops the search before any call", async () => {
    const out = await findFromPhoto(upload, { colony: small.colony }, NOW, { gate: async () => "person" });
    expect(out).toEqual({ kind: "refused", count: 4, reason: "person" });
    expect(matchMock).not.toHaveBeenCalled();
  });
});

describe("findFromPhoto: groups of 10 and a final round", () => {
  it("25 cats make exactly 3 group calls plus 1 final call with the best 3 of each", async () => {
    const mid = await colonyOf(25, "mid");
    const score = (id: number) => (mid.ids.indexOf(id) % 10) / 10; // 0.0 … 0.9 within each group
    answer(score);
    const out = await findFromPhoto(upload, { colony: mid.colony }, NOW);
    expect(matchMock).toHaveBeenCalledTimes(4);
    const sizes = matchMock.mock.calls.map((c) => (c[1] as CandidateInput[]).length);
    expect(sizes).toEqual([10, 10, 5, 9]);
    // The final round holds each group's best 3.
    const finalIds = (matchMock.mock.calls[3]![1] as CandidateInput[]).map((c) => c.catId).sort((a, b) => a - b);
    const want = [mid.ids[7], mid.ids[8], mid.ids[9], mid.ids[17], mid.ids[18], mid.ids[19], mid.ids[22], mid.ids[23], mid.ids[24]];
    expect(finalIds).toEqual([...want].sort((a, b) => a! - b!));
    expect(out.kind).toBe("results");
    if (out.kind !== "results") return;
    expect(out.count).toBe(25);
    expect(out.compared).toBe(25);
    expect(out.results).toHaveLength(9);
    // Best first.
    const scores = out.results.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("the final round's scores are the ones shown", async () => {
    let call = 0;
    matchMock.mockImplementation(async (_p, candidates: CandidateInput[]) => {
      call++;
      return {
        isCatPhoto: true,
        matches: candidates.map((c) => ({ catId: c.catId, confidence: call === 4 ? 0.91 : 0.2, reasoning: `r${call}` })),
      };
    });
    const mid = await colonyOf(21, "final");
    const out = await findFromPhoto(upload, { colony: mid.colony }, NOW);
    expect(out.kind).toBe("results");
    if (out.kind !== "results") return;
    expect(out.results.every((r) => r.score === 0.91 && r.band === "very_likely" && r.reasoning === "r4")).toBe(true);
  });

  it("one group needs no final round", async () => {
    const out = await findFromPhoto(upload, { colony: small.colony }, NOW);
    expect(matchMock).toHaveBeenCalledTimes(1);
    expect(out.kind === "results" && out.results.length).toBe(3);
  });

  it("never more than 4 calls, even at 30 cats", async () => {
    const full = await colonyOf(FIND_MAX_CATS, "full");
    await findFromPhoto(upload, { colony: full.colony }, NOW);
    expect(matchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("a group that sees no cat gives not_a_cat", async () => {
    matchMock.mockResolvedValue({ isCatPhoto: false, matches: [] });
    expect(await findFromPhoto(upload, { colony: small.colony }, NOW)).toEqual({ kind: "not_a_cat", count: 4 });
  });

  it("only the first group decides not_a_cat: a later group's odd answer doesn't throw the photo away (review finding 5)", async () => {
    const mid = await colonyOf(15, "laternotcat");
    let call = 0;
    matchMock.mockImplementation(async (_p, candidates: CandidateInput[]) => ({
      isCatPhoto: ++call !== 2,
      matches: candidates.map((c) => ({ catId: c.catId, confidence: 0.6, reasoning: "" })),
    }));
    const out = await findFromPhoto(upload, { colony: mid.colony }, NOW);
    expect(out.kind).toBe("results");
  });

  it("the first group seeing no cat stops at once", async () => {
    const mid = await colonyOf(15, "firstnotcat");
    matchMock.mockResolvedValue({ isCatPhoto: false, matches: [] });
    expect(await findFromPhoto(upload, { colony: mid.colony }, NOW)).toEqual({ kind: "not_a_cat", count: 15 });
    expect(matchMock).toHaveBeenCalledTimes(1);
  });

  it("cats with no photo to compare give no_photos, before the gate (review finding 2)", async () => {
    const colony = await newColony("find nophotos");
    const [p] = await db
      .insert(photosTable)
      .values({ publicId: `${PREFIX}p${n++}`, data: Buffer.from("not an image").toString("base64"), mime: "image/jpeg" })
      .returning({ id: photosTable.id });
    await cat("unreadable", p!.id, colony);
    const gate = vi.fn(async () => null);
    expect(await findFromPhoto(upload, { colony }, NOW, { gate })).toEqual({ kind: "no_photos", count: 1 });
    expect(gate).not.toHaveBeenCalled();
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("a service that throws gives matching_down", async () => {
    matchMock.mockRejectedValue(new Error("AI matching returned unparseable output"));
    expect(await findFromPhoto(upload, { colony: small.colony }, NOW)).toEqual({ kind: "matching_down", count: 4 });
  });
});

describe("bands", () => {
  it("sit at 0.8 and 0.5 exactly", () => {
    expect(VERY_LIKELY).toBe(0.8);
    expect(POSSIBLE).toBe(0.5);
    expect(bandOf(0.8)).toBe("very_likely");
    expect(bandOf(0.7999)).toBe("possible");
    expect(bandOf(0.5)).toBe("possible");
    expect(bandOf(0.4999)).toBe("unlikely");
    expect(bandOf(1)).toBe("very_likely");
    expect(bandOf(0)).toBe("unlikely");
  });
});

describe("the photos sent", () => {
  it("a cat whose main photo is hidden is sent with its display photo, never the hidden bytes", async () => {
    const colony = await newColony("find hidden");
    const main = await photo("#ff0000");
    const shown = await photo("#00ff00");
    const id = await cat("hidden", main, colony);
    await db.insert(photoVisibilityEventsTable).values({ photoId: main, action: "hide", author: `report:${PREFIX}h` });
    // A resolved sighting whose photo is public: the stand-in the public sees.
    await db.insert(sightingsTable).values({
      catId: id,
      deviceId: DEVICE,
      photoId: shown,
      lat: 37.4447,
      lng: 24.9417,
      status: "resolved",
    });
    await findFromPhoto(upload, { colony }, NOW);
    const sent = (matchMock.mock.calls[0]![1] as CandidateInput[]).find((c) => c.catId === id)!;
    expect(sent.photoBase64).toBe((await variantFor(shown, "medium"))!.toString("base64"));
    expect(sent.photoBase64).not.toBe((await variantFor(main, "medium"))!.toString("base64"));
    // The result points at the photo compared, never the hidden one.
    const out = await findFromPhoto(upload, { colony }, NOW);
    const [shownRow] = await db.select({ publicId: photosTable.publicId }).from(photosTable).where(eq(photosTable.id, shown));
    expect(out.kind === "results" && out.results.find((r) => r.catId === id)?.photoPublicId).toBe(shownRow!.publicId);
  });

  it("the medium version is sent, not the full photo", async () => {
    await findFromPhoto(upload, { colony: small.colony }, NOW);
    const [p] = await db
      .select({ id: catsTable.primaryPhotoId })
      .from(catsTable)
      .where(eq(catsTable.id, small.ids[0]!));
    const sent = (matchMock.mock.calls[0]![1] as CandidateInput[])[0]!;
    expect(sent.photoBase64).toBe((await variantFor(p!.id, "medium"))!.toString("base64"));
  });

  it("the photo sent carries no EXIF (and so no GPS position)", async () => {
    const withGps = await jpegWithGps();
    expect((await sharp(withGps).metadata()).exif).toBeDefined(); // the fixture really has it
    await findFromPhoto(withGps, { colony: small.colony }, NOW);
    const sent = (matchMock.mock.calls[0]![0] as NewPhotoInput[])[0]!;
    expect(sent.role).toBe("first");
    expect((await sharp(Buffer.from(sent.photoBase64, "base64")).metadata()).exif).toBeUndefined();
    // The results page's copy of it (SYC-491) is made from the re-encoded photo too.
    const out = await findFromPhoto(withGps, { colony: small.colony }, NOW);
    expect(out.kind === "results" && out.preview).toBeTruthy();
    if (out.kind !== "results") return;
    const preview = await sharp(Buffer.from(out.preview!, "base64")).metadata();
    expect(preview.exif).toBeUndefined();
    expect(preview.width).toBeLessThanOrEqual(640);
  });
});

describe("nothing is stored", () => {
  it("no photos, sightings or observations row, and no write helper called", async () => {
    vi.mocked(writeObservation).mockClear();
    vi.mocked(saveSpotWithPhotos).mockClear();
    // The shared database: rows newer than the newest before the search,
    // and only those this search could have made, are checked.
    const newest = async (t: typeof photosTable | typeof sightingsTable | typeof observationsTable) =>
      Number((await db.select({ m: max(t.id) }).from(t))[0]?.m ?? 0);
    const before = { p: await newest(photosTable), s: await newest(sightingsTable), o: await newest(observationsTable) };
    const out = await findFromPhoto(upload, { colony: small.colony }, NOW);
    expect(out.kind).toBe("results");
    const sentB64 = (matchMock.mock.calls[0]![0] as NewPhotoInput[])[0]!.photoBase64;
    const photos = await db
      .select({ id: photosTable.id })
      .from(photosTable)
      .where(and(gt(photosTable.id, before.p), inArray(photosTable.data, [sentB64, upload.toString("base64")])));
    expect(photos).toEqual([]);
    const sightings = await db
      .select({ id: sightingsTable.id })
      .from(sightingsTable)
      .where(and(gt(sightingsTable.id, before.s), inArray(sightingsTable.catId, small.ids)));
    expect(sightings).toEqual([]);
    const observations = await db
      .select({ id: observationsTable.id })
      .from(observationsTable)
      .where(and(gt(observationsTable.id, before.o), inArray(observationsTable.catId, small.ids)));
    expect(observations).toEqual([]);
    expect(writeObservation).not.toHaveBeenCalled();
    expect(saveSpotWithPhotos).not.toHaveBeenCalled();
  });
});

describe("findFromPhoto: no place means the whole island (SYC-527 piece 1)", () => {
  // The island is its own scope (cats named with ISLE), cleared after each
  // test; it never touches other tests' fixtures, so file position is free.
  afterEach(async () => {
    await db.delete(catsTable).where(like(catsTable.name, `${ISLE}%`));
  });

  /** `count` island cats (a colony is only a way to make them), with a coat colour. */
  async function island(count: number, colour: string, label: string): Promise<number[]> {
    const { ids } = await colonyOf(count, label);
    for (const id of ids) {
      await db.insert(observationsTable).values({
        catId: id,
        kind: "coat",
        value: { colours: [colour] } as never,
        deviceId: DEVICE,
        roleAtTime: "staff",
        observedAt: new Date(Date.now() - 40 * 86400_000),
      });
    }
    return ids;
  }

  it("with no place, compares every active cat on the island", async () => {
    const ids = await island(12, "black", "isle-12");
    const out = await findFromPhoto(upload, {}, NOW);
    expect(out.kind).toBe("results");
    if (out.kind !== "results") return;
    expect(out.compared).toBe(12);
    expect(matchMock).toHaveBeenCalledTimes(3); // 2 groups plus the final round
    const groupCats = matchMock.mock.calls.slice(0, 2).flatMap((c) => (c[1] as CandidateInput[]).map((x) => x.catId));
    expect([...groupCats].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
  });

  it("with no place and colours, compares the island's cats of those colours", async () => {
    await island(5, "black", "isle-black");
    await island(4, "ginger", "isle-ginger");
    const out = await findFromPhoto(upload, { colours: ["black"] }, NOW);
    expect(out.kind === "results" && out.compared).toBe(5);
  });

  it("the island test seam is in use", async () => {
    await island(3, "black", "isle-seam");
    vi.mocked(allTeamCats).mockClear();
    await findFromPhoto(upload, {}, NOW);
    expect(allTeamCats).toHaveBeenCalledTimes(1);
    const [filters] = vi.mocked(allTeamCats).mock.calls[0]!;
    expect(filters.area).toBeUndefined();
    expect(filters.colony).toBeUndefined();
    const { cats } = await vi.mocked(allTeamCats).mock.results[0]!.value;
    expect(cats.length).toBeGreaterThan(0);
    expect(cats.every((c: { name: string }) => c.name.startsWith(ISLE))).toBe(true);
    // And it really is narrower than this run's cats: the file's other
    // fixtures (e.g. `small`) exist but are not on the island.
    const all = await db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${PREFIX}%`));
    expect(all.length).toBeGreaterThan(cats.length);
  });
});

describe("findFromPhoto: the shortlist over 30 cats (SYC-527 piece 3, spec §3)", () => {
  afterEach(async () => {
    __fillClock.now = () => Date.now();
    await db.delete(catsTable).where(like(catsTable.name, `${ISLE}%`));
  });

  /** `count` island cats, each with a photo of its own whose red is redOfCat(i). Returns ids in order. */
  async function spread(count: number, label: string): Promise<{ ids: number[]; photoIds: number[] }> {
    const ids: number[] = [];
    const photoIds: number[] = [];
    for (let i = 0; i < count; i++) {
      const [p] = await db
        .insert(photosTable)
        .values({ publicId: `${PREFIX}p${n++}`, data: (await solid(redOfCat(i))).toString("base64"), mime: "image/jpeg" })
        .returning({ id: photosTable.id });
      const [c] = await db
        .insert(catsTable)
        .values({
          name: `${ISLE}${label}-${i}`,
          primaryPhotoId: p!.id,
          lat: 37.4447,
          lng: 24.9417,
          discovererDeviceId: DEVICE,
        })
        .returning({ id: catsTable.id });
      ids.push(c!.id);
      photoIds.push(p!.id);
    }
    return { ids, photoIds };
  }

  /** An upload whose look is the cat at position `i` (or a little off it). */
  const uploadLike = (i: number, off = 0) => solid(redOfCat(i) + off);

  const candidateIds = () =>
    matchMock.mock.calls.slice(0, 2).flatMap((c) => (c[1] as CandidateInput[]).map((x) => x.catId));

  it("at 30 cats the index isn't touched and #252's calls are unchanged", async () => {
    await spread(FIND_MAX_CATS, "t30");
    const out = await findFromPhoto(upload, {}, NOW);
    expect(fingerprintMock).not.toHaveBeenCalled();
    expect(matchMock).toHaveBeenCalledTimes(4); // 3 groups plus the final round
    expect(out.kind === "results" && [out.compared, out.shortlist, out.leftOut]).toEqual([30, null, 0]);
  });

  it("at 31, the shortlist holds the cats that look closest, reads exactly K, and makes 3 AI calls", async () => {
    const { ids } = await spread(FIND_MAX_CATS + 1, "t31");
    const gate = vi.fn(async () => null);
    const out = await findFromPhoto(await uploadLike(25, 2), {}, NOW, { gate });
    expect(out.kind).toBe("results");
    if (out.kind !== "results") return;
    expect(out.count).toBe(31);
    expect(out.compared).toBe(FIND_SHORTLIST_K);
    expect(out.shortlist).toEqual({ of: 31 });
    expect(out.leftOut).toBe(0);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(matchMock).toHaveBeenCalledTimes(3); // 2 groups of 10, plus the final round
    const sent = candidateIds();
    expect(sent).toHaveLength(FIND_SHORTLIST_K);
    // The 20 whose red is nearest 25's: positions 15..30 are within 6 steps; the far low ones are out.
    expect(sent).toContain(ids[25]);
    expect(sent).toContain(ids[24]);
    for (const far of [0, 1, 2, 3, 4]) expect(sent).not.toContain(ids[far]);
    // Every cat shown is one of the sent.
    expect(out.results.every((r) => sent.includes(r.catId))).toBe(true);
  });

  it("fingerprints the re-encoded photo, never the raw upload", async () => {
    await spread(FIND_MAX_CATS + 1, "tenc");
    const raw = await jpegWithGps();
    await findFromPhoto(raw, {}, NOW);
    // The upload is the first call (the fill fingerprints the cats' photos after it).
    const first = fingerprintMock.mock.calls[0]![0] as Buffer;
    expect(first.equals(raw)).toBe(false);
    const meta = await sharp(first).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe("jpeg");
  });

  it("fingerprintOf throwing for the upload gives index_down: no gate, no AI", async () => {
    await spread(FIND_MAX_CATS + 1, "tdown");
    fingerprintMock.mockRejectedValue(new Error("the model is not available"));
    const gate = vi.fn(async () => null);
    expect(await findFromPhoto(upload, {}, NOW, { gate })).toEqual({ kind: "index_down", count: 31 });
    expect(gate).not.toHaveBeenCalled();
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("when no cat's photo can be fingerprinted the index is down too", async () => {
    await spread(FIND_MAX_CATS + 1, "tnone");
    let calls = 0;
    fingerprintMock.mockImplementation(async () => {
      if (calls++ === 0) return vecOf(50);
      throw new Error("bad image");
    });
    const gate = vi.fn(async () => null);
    expect(await findFromPhoto(upload, {}, NOW, { gate })).toEqual({ kind: "index_down", count: 31 });
    expect(gate).not.toHaveBeenCalled();
    expect(matchMock).not.toHaveBeenCalled();
  });

  it("cats past the fill budget are left out and counted", async () => {
    await spread(FIND_MAX_CATS + 1, "tbudget");
    // Each look at the clock is one second later: the budget runs out after 14 photos.
    let t = 0;
    __fillClock.now = () => (t += 1000);
    const out = await findFromPhoto(upload, {}, NOW);
    expect(FIND_FILL_BUDGET_MS).toBe(15_000);
    expect(out.kind).toBe("results");
    if (out.kind !== "results") return;
    expect(out.leftOut).toBe(31 - 14);
    expect(out.compared).toBe(14);
    expect(out.shortlist).toEqual({ of: 31 });
  });

  it("the upload is never stored: only this run's cats' display photos have fingerprints", async () => {
    const { photoIds } = await spread(FIND_MAX_CATS + 1, "tstore");
    const queryRed = redOfCat(25) + 3; // a look no cat has
    await findFromPhoto(await solid(queryRed), {}, NOW);
    const rows = await db
      .select({ photoId: photoFingerprintsTable.photoId, vector: photoFingerprintsTable.vector })
      .from(photoFingerprintsTable)
      .innerJoin(photosTable, eq(photosTable.id, photoFingerprintsTable.photoId))
      .where(like(photosTable.publicId, `${PREFIX}%`));
    expect(rows.length).toBeGreaterThanOrEqual(31);
    const shown = new Set(photoIds);
    // Other tests' photos of this run may have rows; ours must all be display photos of cats made here.
    const ours = rows.filter((r) => shown.has(r.photoId));
    expect(ours).toHaveLength(31);
    const query = Array.from(vecOf(queryRed));
    for (const r of rows) {
      const close = r.vector.every((x, j) => Math.abs(x - query[j]!) < 1e-6);
      expect(close, "a row holds the upload's fingerprint").toBe(false);
    }
  });

  it("logs counts only: no vector and no id, also when the model throws", async () => {
    const { photoIds } = await spread(FIND_MAX_CATS + 1, "tlog");
    await findFromPhoto(upload, {}, NOW);
    const bigArray = /\[(?:-?[\d.e+-]+,){383}-?[\d.e+-]+\]/;
    const text = () => spies.logLines.join("\n");
    expect(text()).toContain("shortlist");
    expect(text()).toMatch(/"path":"shortlist"/);
    expect(text()).not.toMatch(bigArray);
    expect(text()).not.toMatch(/photoId|publicId|catId/);
    expect(text()).not.toContain(PREFIX);
    for (const id of photoIds) expect(text()).not.toMatch(new RegExp(`"[a-zA-Z]*[iI]d":${id}[,}]`));

    spies.logLines.length = 0;
    const err = Object.assign(new Error("model failed"), { vector: Array.from(vecOf(40)), cause: { name: "Boom", vector: Array.from(vecOf(41)) } });
    fingerprintMock.mockRejectedValue(err);
    expect((await findFromPhoto(upload, {}, NOW)).kind).toBe("index_down");
    expect(text()).toContain("model failed");
    expect(text()).not.toMatch(bigArray);
    expect(text()).not.toContain(PREFIX);
  });

  it("safeError keeps a vector out of what it returns", () => {
    const v = Array.from(vecOf(40));
    const err = Object.assign(new Error("model failed"), { vector: v, data: v, cause: { name: "Boom", vector: v } });
    const out = JSON.stringify(safeError(err));
    expect(out).not.toMatch(/\[(?:-?[\d.e+-]+,){10}/);
    expect(out).toContain("model failed");
  });

  it("a colony over 30 is shortlisted inside the colony, and says so", async () => {
    const big = await colonyOf(FIND_MAX_CATS + 2, "colshort");
    const out = await findFromPhoto(upload, { colony: big.colony }, NOW);
    expect(out.kind === "results" && out.shortlist).toEqual({ of: FIND_MAX_CATS + 2 });
  });
});
