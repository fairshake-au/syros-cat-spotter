import { catsTable, db, duplicateDecisionsTable, duplicateReportsTable, photosTable } from "@workspace/db";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { duplicateSweepIsOn } from "./appSwitches";
import { haversineKm } from "./catHelpers";
import { canonicalCatOf, liveCats } from "./catIdentity";
import { fingerprintsFor } from "./fingerprint";
import { catDisplayPhotoIds } from "./photoVisibility";

// The nightly look-alike sweep (which-cat-is-which.md §3.1 item 3, §9.6, D11;
// SYC-59 PR 5.3). Each night, behind the app switch `duplicate_sweep` (off by
// default), it compares the main photos of live cats seen within 1.5 km of
// each other by their photo fingerprints, and writes `sweep` duplicate
// reports for the closest look-alikes. A report only puts a pair on the
// team's Possible duplicates list; nothing is ever merged by it.
//
// Reads fingerprints by each live cat's display photo (the same photo the
// public sees); it never writes to photo_fingerprints (the fingerprint job in
// lib/fingerprint is the only writer). Cats with no fingerprint are skipped.
// Counts only in logs: never a cat id, a photo id or a score.

/**
 * How alike two photos must look (dot product of length-1 fingerprints) for
 * the sweep to report them. PROVISIONAL: a high starting value so a first run
 * errs quiet. The spec (§9.6) has it set from pairs the team has already
 * decided, with `db-ops calibrate-duplicate-sweep`, before the switch is
 * turned on; change this number then.
 */
export const SWEEP_THRESHOLD = 0.9;

/** At most this many new pairs a night, closest look-alikes first. */
export const SWEEP_MAX_PER_NIGHT = 10;

/** Only cats seen this close are compared (the app's own "nearby"). */
export const SWEEP_NEARBY_KM = 1.5;

/** A pair the sweep reported is not reported again for this long. */
export const SWEEP_REPEAT_DAYS = 90;

export interface SweepPair {
  low: number;
  high: number;
  score: number;
}

const pairKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i]! * (b[i] ?? 0);
  return s;
}

/** The highest-scoring pairs first; ties go to the lower ids. At most `cap`. */
export function topPairs(pairs: readonly SweepPair[], cap: number): SweepPair[] {
  return [...pairs].sort((x, y) => y.score - x.score || x.low - y.low || x.high - y.high).slice(0, cap);
}

interface Cat {
  id: number;
  lat: number;
  lng: number;
  /** When the main photo was made (the reopen rule's "main photo changed"). */
  photoAt: Date | null;
  fingerprint: Float32Array;
}

/** Live cats that have a display photo with a current-model fingerprint. */
async function fingerprintedLiveCats(): Promise<Cat[]> {
  const rows = await liveCats({
    id: catsTable.id,
    lat: catsTable.lat,
    lng: catsTable.lng,
    primaryPhotoId: catsTable.primaryPhotoId,
    photoAt: photosTable.createdAt,
  }).leftJoin(photosTable, eq(photosTable.id, catsTable.primaryPhotoId));
  const display = await catDisplayPhotoIds(rows);
  const photoIds = [...display.values()].filter((p): p is number => p !== null);
  const prints = await fingerprintsFor(photoIds);
  const out: Cat[] = [];
  for (const r of rows) {
    const photo = display.get(r.id);
    const fingerprint = photo == null ? undefined : prints.get(photo);
    if (fingerprint) out.push({ id: r.id, lat: r.lat, lng: r.lng, photoAt: r.photoAt, fingerprint });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Every pair of these cats within the sweep's distance, scored, with the lower id first. */
export function scoreNearbyPairs(cats: readonly Pick<Cat, "id" | "lat" | "lng" | "fingerprint">[]): SweepPair[] {
  const out: SweepPair[] = [];
  for (let i = 0; i < cats.length; i += 1) {
    for (let j = i + 1; j < cats.length; j += 1) {
      const a = cats[i]!;
      const b = cats[j]!;
      if (haversineKm(a.lat, a.lng, b.lat, b.lng) > SWEEP_NEARBY_KM) continue;
      out.push({ low: Math.min(a.id, b.id), high: Math.max(a.id, b.id), score: dot(a.fingerprint, b.fingerprint) });
    }
  }
  return out;
}

/** What the pair already has on file, by canonical pair (a merged-away cat counts as the cat it is part of). */
async function pairHistory(now: Date) {
  const decisions = await db.select().from(duplicateDecisionsTable);
  const sweeps = await db
    .select({ catLow: duplicateReportsTable.catLow, catHigh: duplicateReportsTable.catHigh })
    .from(duplicateReportsTable)
    .where(
      and(
        eq(duplicateReportsTable.source, "sweep"),
        gt(duplicateReportsTable.createdAt, new Date(now.getTime() - SWEEP_REPEAT_DAYS * 86_400_000)),
      ),
    );
  const canon = await canonicalCatOf([...decisions, ...sweeps].flatMap((r) => [r.catLow, r.catHigh]));
  const canonical = (low: number, high: number): string | null => {
    const a = canon.get(low) ?? null;
    const b = canon.get(high) ?? null;
    return a === null || b === null || a === b ? null : pairKey(a, b);
  };
  const newest = new Map<string, { decision: string; at: Date; id: number }>();
  for (const d of decisions) {
    const key = canonical(d.catLow, d.catHigh);
    if (key === null) continue;
    const seen = newest.get(key);
    if (!seen || d.id > seen.id) newest.set(key, { decision: d.decision, at: d.createdAt, id: d.id });
  }
  const recentSweep = new Set<string>();
  for (const s of sweeps) {
    const key = canonical(s.catLow, s.catHigh);
    if (key !== null) recentSweep.add(key);
  }
  return { newest, recentSweep };
}

export interface SweepOutcome {
  /** False when the switch is off: nothing was read or written. */
  ran: boolean;
  /** Fingerprinted live cats compared. */
  cats: number;
  /** Pairs at or above the threshold with nothing standing in the way. */
  candidates: number;
  written: number;
}

/**
 * One night's sweep. With the switch off it does nothing at all. Otherwise it
 * writes `sweep` / `same` reports, with the likeness as the score, for the
 * {@link SWEEP_MAX_PER_NIGHT} closest look-alike pairs at or above
 * {@link SWEEP_THRESHOLD} that:
 *  - have no decision, or whose newest decision is "different" and one of
 *    the two cats' main photo is newer than that decision (§9.6 reopen rule);
 *  - have no sweep report in the last {@link SWEEP_REPEAT_DAYS} days.
 * Merged-away cats are never paired: only live cats are read.
 */
export async function runDuplicateSweep(now: Date = new Date()): Promise<SweepOutcome> {
  if (!(await duplicateSweepIsOn())) return { ran: false, cats: 0, candidates: 0, written: 0 };

  const cats = await fingerprintedLiveCats();
  const byId = new Map(cats.map((c) => [c.id, c]));
  const { newest, recentSweep } = await pairHistory(now);
  const open = scoreNearbyPairs(cats).filter((p) => {
    if (p.score < SWEEP_THRESHOLD) return false;
    const key = pairKey(p.low, p.high);
    if (recentSweep.has(key)) return false;
    const decided = newest.get(key);
    if (!decided) return true;
    if (decided.decision !== "different") return false;
    return [p.low, p.high].some((id) => (byId.get(id)?.photoAt?.getTime() ?? 0) > decided.at.getTime());
  });
  const chosen = topPairs(open, SWEEP_MAX_PER_NIGHT);
  if (chosen.length === 0) return { ran: true, cats: cats.length, candidates: open.length, written: 0 };

  // Two overlapping runs must not both report a pair: one at a time, and a
  // pair another run reported meanwhile is left out.
  const written = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('duplicate_sweep'))`);
    const since = new Date(now.getTime() - SWEEP_REPEAT_DAYS * 86_400_000);
    const lows = chosen.map((p) => p.low);
    const meanwhile = await tx
      .select({ catLow: duplicateReportsTable.catLow, catHigh: duplicateReportsTable.catHigh })
      .from(duplicateReportsTable)
      .where(
        and(
          eq(duplicateReportsTable.source, "sweep"),
          gt(duplicateReportsTable.createdAt, since),
          inArray(duplicateReportsTable.catLow, lows),
        ),
      );
    const taken = new Set(meanwhile.map((r) => pairKey(r.catLow, r.catHigh)));
    const rows = chosen
      .filter((p) => !taken.has(pairKey(p.low, p.high)))
      .map((p) => ({ catLow: p.low, catHigh: p.high, source: "sweep", says: "same", score: p.score, createdAt: now }));
    if (rows.length > 0) await tx.insert(duplicateReportsTable).values(rows);
    return rows.length;
  });
  return { ran: true, cats: cats.length, candidates: open.length, written };
}

/** A pair the team has decided, with how alike its two cats' main photos look. */
export interface DecidedPairScore {
  /** True for a merge ("same cat"), false for "different". */
  same: boolean;
  score: number;
}

/**
 * Decided pairs for calibration (§9.6): pairs whose newest decision is
 * "merged" or "different", scored by their two cats' display-photo
 * fingerprints. A merged-away cat is read as it was: its own photo. Pairs
 * where either cat has no fingerprint are counted in `unscored`, not scored.
 * Read-only.
 */
export async function decidedPairScores(): Promise<{ scored: DecidedPairScore[]; unscored: number }> {
  const decisions = await db.select().from(duplicateDecisionsTable);
  const newest = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions) {
    const key = pairKey(d.catLow, d.catHigh);
    const seen = newest.get(key);
    if (!seen || d.id > seen.id) newest.set(key, d);
  }
  const decided = [...newest.values()].filter((d) => d.decision === "merged" || d.decision === "different");
  if (decided.length === 0) return { scored: [], unscored: 0 };
  const ids = [...new Set(decided.flatMap((d) => [d.catLow, d.catHigh]))];
  // Not liveCats: a merged-away cat is exactly what a merged pair holds. Read by id, as the team's cat page does.
  const rows = await db.select({ id: catsTable.id, primaryPhotoId: catsTable.primaryPhotoId }).from(catsTable).where(inArray(catsTable.id, ids));
  const display = await catDisplayPhotoIds(rows);
  const prints = await fingerprintsFor([...display.values()].filter((p): p is number => p !== null));
  const printOf = (catId: number) => {
    const photo = display.get(catId);
    return photo == null ? undefined : prints.get(photo);
  };
  const scored: DecidedPairScore[] = [];
  let unscored = 0;
  for (const d of decided) {
    const a = printOf(d.catLow);
    const b = printOf(d.catHigh);
    if (!a || !b) {
      unscored += 1;
      continue;
    }
    scored.push({ same: d.decision === "merged", score: dot(a, b) });
  }
  return { scored, unscored };
}
