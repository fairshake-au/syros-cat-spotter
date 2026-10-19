import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { and, eq, gt, inArray, like, max, sql } from "drizzle-orm";
import {
  catsTable,
  db,
  observationsTable,
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

import { matchCatPhoto, type CandidateInput, type MatchOutput, type NewPhotoInput } from "./matching";
import { writeObservation } from "./observations";
import { saveSpotWithPhotos } from "./spotPhotos";
import { variantFor } from "./photoVariants";
import { bandOf, findFromPhoto, FIND_MAX_CATS, POSSIBLE, VERY_LIKELY } from "./findFromPhoto";

const matchMock = vi.mocked(matchCatPhoto);

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-find-${RUN}-`;
const DEVICE = `${PREFIX}device`;
const NOW = new Date();

/** A small real JPEG of one colour, as base64 (variantFor must be able to decode it). */
async function jpeg(colour: string): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: colour } }).jpeg().toBuffer();
}

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
});

describe("findFromPhoto: narrowing (spec §5.2)", () => {
  it("refuses without an area or a colony, and never calls the service", async () => {
    expect(await findFromPhoto(upload, {}, NOW)).toEqual({ kind: "no_place" });
    expect(await findFromPhoto(upload, { colours: ["black"] }, NOW)).toEqual({ kind: "no_place" });
    expect(matchMock).not.toHaveBeenCalled();
  });

  it(`${FIND_MAX_CATS + 1} cats is too many, with no call to the service`, async () => {
    const big = await colonyOf(FIND_MAX_CATS + 1, "big");
    expect(await findFromPhoto(upload, { colony: big.colony }, NOW)).toEqual({
      kind: "too_many",
      count: FIND_MAX_CATS + 1,
    });
    expect(matchMock).not.toHaveBeenCalled();
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
