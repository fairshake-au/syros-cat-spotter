import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  appSettingsTable,
  catsTable,
  db,
  duplicateDecisionsTable,
  duplicateReportsTable,
  photoFingerprintsTable,
  photosTable,
  pool,
} from "@workspace/db";
import { moveKit } from "../test/moveKit";
import { libMerge } from "../test/merges";
import { setDuplicateSweep } from "./appSwitches";
import { DIMENSIONS, MODEL_ID } from "./fingerprint/model";
import { SWEEP_MAX_PER_NIGHT, SWEEP_THRESHOLD, decidedPairScores, dot, runDuplicateSweep, scoreNearbyPairs, topPairs } from "./duplicateSweep";

// SYC-59 PR 5.3 (which-cat-is-which.md §3.1 item 3, §9.6, D11; spec test 26):
// the nightly look-alike sweep does nothing while its switch is off, writes at
// most 10 pairs, skips decided pairs and cats with no fingerprint, and never
// writes about a merged-away cat. Cat names are letters only (SYC-709).
//
// Fingerprints here are unit vectors along high dimensions that no other
// test uses, so only this file's cats look alike: a pair shares a dimension,
// the second cat leaning slightly off it so the pair scores `score`.

const kit = moveKit("VitestDupSweep");
const SWEEP_KEY = "duplicate_sweep";

beforeAll(kit.cleanup);
afterAll(async () => {
  await kit.cleanup();
  await pool.end();
});
afterEach(async () => {
  await db.delete(appSettingsTable).where(eq(appSettingsTable.key, SWEEP_KEY));
});

/** A fresh `now` each call, so the reports of one run are found by their time. */
let tick = 0;
const nextNow = () => new Date(Date.now() + 60_000 * ++tick);

let nextDim = 100;
/** A fingerprint along one dimension, leaning `lean` of the way onto another. */
function vector(dim: number, lean = 0): Float32Array {
  const v = new Float32Array(DIMENSIONS);
  v[dim] = Math.sqrt(1 - lean * lean);
  if (lean > 0) v[dim + 1] = lean;
  return v;
}

async function fingerprint(catId: number, v: Float32Array) {
  const [c] = await db.select({ photo: catsTable.primaryPhotoId }).from(catsTable).where(eq(catsTable.id, catId));
  await db.insert(photoFingerprintsTable).values({ photoId: c!.photo, model: MODEL_ID, vector: Array.from(v) });
}

/** Two cats that look alike by `score` (about), both fingerprinted. */
async function lookAlikes(score = 0.97) {
  const dim = (nextDim += 2);
  const a = await kit.cat();
  const b = await kit.cat();
  // dot = sqrt(1 - lean^2) for a = e_dim and b leaning onto e_dim+1.
  await fingerprint(a, vector(dim));
  await fingerprint(b, vector(dim, Math.sqrt(1 - score * score)));
  return { lo: Math.min(a, b), hi: Math.max(a, b), a, b };
}

const reportsAt = (at: Date) => db.select().from(duplicateReportsTable).where(and(eq(duplicateReportsTable.source, "sweep"), eq(duplicateReportsTable.createdAt, at)));
const reportsFor = (p: { lo: number; hi: number }) =>
  db.select().from(duplicateReportsTable).where(and(eq(duplicateReportsTable.catLow, p.lo), eq(duplicateReportsTable.catHigh, p.hi)));
const decide = (p: { lo: number; hi: number }, decision: string, createdAt = new Date()) =>
  db.insert(duplicateDecisionsTable).values({ catLow: p.lo, catHigh: p.hi, decision, createdAt, byAccountId: "vitest-sweeper", ...(decision === "merged" || decision === "merge_undone" ? { mergeId: 1 } : {}) });

describe("the pure parts", () => {
  it("scores nearby pairs by dot product and leaves out cats far apart", () => {
    const a = { id: 1, lat: 37.44, lng: 24.94, fingerprint: vector(10) };
    const b = { id: 2, lat: 37.4401, lng: 24.9401, fingerprint: vector(10) };
    const far = { id: 3, lat: 37.5, lng: 24.94, fingerprint: vector(10) }; // about 6.7 km
    expect(scoreNearbyPairs([a, b, far])).toEqual([{ low: 1, high: 2, score: 1 }]);
    expect(dot(vector(10), vector(11))).toBe(0);
  });

  it("keeps the closest look-alikes, ties to the lower ids, at most the cap", () => {
    const pairs = Array.from({ length: 15 }, (_, i) => ({ low: i + 1, high: i + 100, score: 0.9 + (i % 5) / 100 }));
    const top = topPairs(pairs, 10);
    expect(top).toHaveLength(10);
    expect(top[0]!.score).toBeCloseTo(0.94, 6);
    expect(top.map((p) => p.low).slice(0, 3)).toEqual([5, 10, 15]);
  });

  it("the provisional threshold is high and the cap is 10", () => {
    expect(SWEEP_THRESHOLD).toBeGreaterThanOrEqual(0.85);
    expect(SWEEP_MAX_PER_NIGHT).toBe(10);
  });
});

describe("the sweep (spec test 26)", () => {
  it("does nothing while its switch is off: no reports, and the answer says it did not run", async () => {
    const p = await lookAlikes();
    const at = nextNow();
    expect(await runDuplicateSweep(at)).toEqual({ ran: false, cats: 0, candidates: 0, written: 0 });
    expect(await reportsFor(p)).toEqual([]);
    expect(await reportsAt(at)).toEqual([]);
    // A row saying false, or a wrong shape, is off as well.
    await setDuplicateSweep(false);
    expect((await runDuplicateSweep(nextNow())).ran).toBe(false);
    expect(await reportsFor(p)).toEqual([]);
  });

  it("with the switch on, reports a look-alike pair as a 'same' sweep report with its score and no device", async () => {
    const p = await lookAlikes(0.97);
    await setDuplicateSweep(true);
    const at = nextNow();
    const out = await runDuplicateSweep(at);
    expect(out.ran).toBe(true);
    const mine = await reportsFor(p);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ source: "sweep", says: "same", deviceId: null, sightingId: null });
    expect(mine[0]!.score).toBeCloseTo(0.97, 3);
  });

  it("leaves out a pair below the threshold", async () => {
    const p = await lookAlikes(0.5);
    await setDuplicateSweep(true);
    await runDuplicateSweep(nextNow());
    expect(await reportsFor(p)).toEqual([]);
  });

  it("writes at most 10 pairs a night, the closest look-alikes", async () => {
    // Twelve pairs of this file's own, scoring 0.91 .. 0.9975; the two lowest must be left for another night.
    const made = [];
    for (let i = 0; i < 12; i++) made.push({ ...(await lookAlikes(0.91 + i * 0.0075)), rank: i });
    await setDuplicateSweep(true);
    const at = nextNow();
    const out = await runDuplicateSweep(at);
    expect(out.written).toBe(10);
    expect(await reportsAt(at)).toHaveLength(10);
    const wrote = new Set((await reportsAt(at)).map((r) => `${r.catLow}:${r.catHigh}`));
    // Whatever else was on file, none of this file's two weakest pairs beat the ten written.
    expect(wrote.has(`${made[0]!.lo}:${made[0]!.hi}`)).toBe(false);
    expect(wrote.has(`${made[11]!.lo}:${made[11]!.hi}`)).toBe(true);
  });

  it("does not report a pair again within 90 days, and does again after", async () => {
    const p = await lookAlikes();
    await setDuplicateSweep(true);
    await runDuplicateSweep(nextNow());
    await runDuplicateSweep(nextNow());
    expect(await reportsFor(p)).toHaveLength(1);
    await runDuplicateSweep(new Date(Date.now() + 91 * 86_400_000));
    expect(await reportsFor(p)).toHaveLength(2);
  });

  it("skips a pair the team has decided, whichever way", async () => {
    const decided = [];
    for (const decision of ["different", "merged", "not_sure", "merge_undone"]) {
      const p = await lookAlikes();
      await decide(p, decision);
      decided.push(p);
    }
    await setDuplicateSweep(true);
    await runDuplicateSweep(nextNow());
    for (const p of decided) expect(await reportsFor(p)).toEqual([]);
  });

  it("a 'different' pair comes back only after one cat's main photo is newer than the decision", async () => {
    const p = await lookAlikes();
    await decide(p, "different", new Date(Date.now() - 5 * 86_400_000));
    await setDuplicateSweep(true);
    await runDuplicateSweep(nextNow());
    expect(await reportsFor(p)).toEqual([]);
    // Cat a gets a new main photo (made now), with its own fingerprint.
    const dim = (nextDim += 2);
    const [photo] = await db
      .insert(photosTable)
      .values({ publicId: `VitestDupSweepNew${dim}`, data: "eA==", mime: "image/jpeg" })
      .returning({ id: photosTable.id });
    await db.update(catsTable).set({ primaryPhotoId: photo!.id }).where(eq(catsTable.id, p.a));
    await fingerprint(p.a, vector(dim));
    const [b] = await db.select({ photo: catsTable.primaryPhotoId }).from(catsTable).where(eq(catsTable.id, p.b));
    await db.update(photoFingerprintsTable).set({ vector: Array.from(vector(dim, Math.sqrt(1 - 0.97 * 0.97))) }).where(eq(photoFingerprintsTable.photoId, b!.photo));
    await runDuplicateSweep(nextNow());
    expect(await reportsFor(p)).toHaveLength(1);
  });

  it("skips cats with no fingerprint, and a fingerprint from another model", async () => {
    const a = await kit.cat();
    const b = await kit.cat();
    const c = await kit.cat();
    const dim = (nextDim += 2);
    await fingerprint(a, vector(dim));
    // b has none at all; c has one from another model.
    const [cc] = await db.select({ photo: catsTable.primaryPhotoId }).from(catsTable).where(eq(catsTable.id, c));
    await db.insert(photoFingerprintsTable).values({ photoId: cc!.photo, model: "some-old-model/v0", vector: Array.from(vector(dim)) });
    await setDuplicateSweep(true);
    await runDuplicateSweep(nextNow());
    for (const other of [b, c]) {
      expect(await reportsFor({ lo: Math.min(a, other), hi: Math.max(a, other) })).toEqual([]);
    }
  });

  it("never pairs a merged-away cat: the pair, and any pair with it, are not written about", async () => {
    const dim = (nextDim += 2);
    const survivor = await kit.cat();
    const away = await kit.cat();
    const third = await kit.cat();
    await fingerprint(survivor, vector(dim));
    await fingerprint(away, vector(dim));
    await fingerprint(third, vector(dim));
    await libMerge(away, survivor);
    await setDuplicateSweep(true);
    await runDuplicateSweep(nextNow());
    const touchingAway = await db
      .select()
      .from(duplicateReportsTable)
      .where(and(eq(duplicateReportsTable.source, "sweep"), inArray(duplicateReportsTable.catLow, [away]), eq(duplicateReportsTable.says, "same")));
    const touchingHigh = await db.select().from(duplicateReportsTable).where(and(eq(duplicateReportsTable.source, "sweep"), eq(duplicateReportsTable.catHigh, away)));
    expect([...touchingAway, ...touchingHigh]).toEqual([]);
    // The live cats still pair.
    const live = await reportsFor({ lo: Math.min(survivor, third), hi: Math.max(survivor, third) });
    expect(live).toHaveLength(1);
  });

  it("a pair decided before one cat was merged into another stays decided for the merged cat", async () => {
    const dim = (nextDim += 2);
    const x = await kit.cat();
    const y = await kit.cat();
    const z = await kit.cat();
    for (const c of [x, y, z]) await fingerprint(c, vector(dim));
    // x and y were decided 'different'; y is then merged into z. The live pair (x, z) is the same pair.
    await decide({ lo: Math.min(x, y), hi: Math.max(x, y) }, "different");
    await libMerge(y, z);
    await setDuplicateSweep(true);
    await runDuplicateSweep(nextNow());
    expect(await reportsFor({ lo: Math.min(x, z), hi: Math.max(x, z) })).toEqual([]);
  });
});

describe("the calibration reads (spec §9.6)", () => {
  it("scores decided pairs from their cats' fingerprints: merged is 'same', different is not, undecided and unfingerprinted are counted out", async () => {
    const same = await lookAlikes(0.96);
    const diff = await lookAlikes(0.8);
    const [n1, n2] = [await kit.cat(), await kit.cat()];
    const noPrint = { lo: Math.min(n1, n2), hi: Math.max(n1, n2) };
    const undecided = await lookAlikes(0.99);
    void undecided;
    await decide(same, "merged");
    await decide(diff, "different");
    await decide(noPrint, "different");
    const { scored, unscored } = await decidedPairScores();
    const near = (s: number) => scored.filter((x) => Math.abs(x.score - s) < 0.001);
    expect(near(0.96)).toEqual([{ same: true, score: expect.any(Number) }]);
    expect(near(0.8)).toEqual([{ same: false, score: expect.any(Number) }]);
    expect(unscored).toBeGreaterThanOrEqual(1);
    expect(near(0.99)).toEqual([]);
  });
});
