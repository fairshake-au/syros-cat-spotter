import { and, eq, inArray, sql } from "drizzle-orm";
import { db, photoFingerprintsTable } from "@workspace/db";
import { logger } from "../logger";
import { variantFor } from "../photoVariants";
import { hiddenPhotoIds } from "../photoVisibility";
import { DIMENSIONS, MODEL_ID, fingerprintOf } from "./model";

// SYC-527 piece 3: the looks-like index (spec
// docs/specs/find-from-a-photo-whole-island.md §3, §6.2, §7, §10). Saving,
// reading, ranking and filling fingerprints of photos.
//
// **This file is the only writer of photo_fingerprints**
// (fingerprint.source.test.ts enforces it). A hidden or removed photo must
// never have a row, so saveFingerprint locks the photo row FOR SHARE, then
// re-checks, then writes, all in one transaction. Every hide and removal
// path holds the same row FOR UPDATE when its trigger (migration 0039)
// deletes the row, so the two queue on the photo:
//   - hide first: the save waits, re-checks, sees the hide, writes nothing;
//   - save first: the hide waits, then its trigger deletes the new row.
//
// Privacy (§10): never log a photo id or a fingerprint here; counts only.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Tests only: a pause after the save's lock and re-check, right before its write. */
export const __fingerprintHooks: { beforeWrite?: (photoId: number, tx: Tx) => Promise<void> } = {};

/** Tests only: the clock fillMissing measures its budget with. */
export const __fillClock: { now: () => number } = { now: () => Date.now() };

/**
 * Stores a photo's fingerprint for the current model, unless the photo is
 * hidden, removed for good or gone ("hidden_or_removed", nothing written).
 * An existing fingerprint from the same model is left as it is; one from
 * another model is replaced.
 */
export async function saveFingerprint(photoId: number, v: Float32Array): Promise<"saved" | "hidden_or_removed"> {
  if (v.length !== DIMENSIONS) {
    throw new Error(`a fingerprint has ${DIMENSIONS} numbers, not ${v.length}`);
  }
  const vector = Array.from(v);
  return db.transaction(async (tx) => {
    // 1. Lock the photo row (a share lock; the source test looks for the
    //    clause itself, so it isn't spelled out in this comment). It
    //    conflicts with the hide paths' row lock for update, so a hide in
    //    progress finishes before this goes on, and a hide that starts now
    //    waits until this transaction ends.
    const locked = await tx.execute(sql`select id from photos where id = ${photoId} for share`);
    if (locked.rows.length === 0) return "hidden_or_removed" as const;
    // 2. Re-check, under the lock, through this transaction.
    if ((await hiddenPhotoIds([photoId], tx)).has(photoId)) return "hidden_or_removed" as const;
    await __fingerprintHooks.beforeWrite?.(photoId, tx);
    // 3. Only now write.
    await tx
      .insert(photoFingerprintsTable)
      .values({ photoId, model: MODEL_ID, vector })
      .onConflictDoUpdate({
        target: photoFingerprintsTable.photoId,
        set: { model: MODEL_ID, vector, madeAt: sql`now()` },
        setWhere: sql`${photoFingerprintsTable.model} <> excluded.model`,
      });
    return "saved" as const;
  });
}

/** The current model's fingerprints for these photos. A photo with none, or only an old model's, is absent. */
export async function fingerprintsFor(photoIds: number[]): Promise<Map<number, Float32Array>> {
  const out = new Map<number, Float32Array>();
  const unique = [...new Set(photoIds)];
  if (unique.length === 0) return out;
  const rows = await db
    .select({ photoId: photoFingerprintsTable.photoId, vector: photoFingerprintsTable.vector })
    .from(photoFingerprintsTable)
    .where(and(inArray(photoFingerprintsTable.photoId, unique), eq(photoFingerprintsTable.model, MODEL_ID)));
  for (const r of rows) out.set(r.photoId, Float32Array.from(r.vector));
  return out;
}

/**
 * Photo ids, closest first (largest dot product; the fingerprints are length
 * 1, so this is cosine similarity). Ties go to the lower id. At most `k`.
 */
export function rank(query: Float32Array, rows: Map<number, Float32Array>, k: number): number[] {
  if (k <= 0) return [];
  const scored: { id: number; score: number }[] = [];
  for (const [id, v] of rows) {
    let score = 0;
    for (let i = 0; i < query.length; i += 1) score += query[i]! * (v[i] ?? 0);
    scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  return scored.slice(0, k).map((s) => s.id);
}

export interface FillResult {
  made: number;
  failed: number;
  /** Photos still missing a fingerprint that weren't tried (the budget ran out), oldest first. */
  left: number[];
}

/** The fill running in this process, if any (spec §3, "Two searches at once"). */
let inFlight: Promise<FillResult> | undefined;

/**
 * Makes the missing fingerprints for these photos, oldest (lowest id) first,
 * starting no new photo once `budgetMs` has passed. A photo that can't be
 * fingerprinted (no picture, a bad image, the model unavailable, or hidden
 * meanwhile) counts as failed; nothing is stored about it, so the next fill
 * tries again.
 *
 * One fill at a time per process. A second caller waits for the running
 * fill, then re-reads what is still missing (usually nothing: the first fill
 * made it) and fills that. Its budget runs from its own call, so time spent
 * waiting counts: a search's whole wait stays within its limit. If the budget
 * runs out while it waits (the nightly batch is long), it fills nothing:
 * `made` is 0 and the photos still without a fingerprint come back in `left`,
 * so the caller ranks what exists and counts the rest as left out.
 */
export async function fillMissing(photoIds: number[], budgetMs: number): Promise<FillResult> {
  const startedAt = __fillClock.now();
  // A loop, not one await: with three callers, the second may start its fill
  // before the third wakes up.
  while (inFlight) {
    const remaining = budgetMs - (__fillClock.now() - startedAt);
    if (remaining <= 0) return skippedFill(photoIds);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slept = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, remaining);
    });
    try {
      await Promise.race([inFlight.catch(() => undefined), slept]);
    } finally {
      clearTimeout(timer);
    }
  }
  const run = fillNow(photoIds, budgetMs, startedAt);
  inFlight = run;
  try {
    return await run;
  } finally {
    if (inFlight === run) inFlight = undefined;
  }
}

/** The budget ran out waiting for another fill: what that fill has committed so far is read, and the rest is `left`. */
async function skippedFill(photoIds: number[]): Promise<FillResult> {
  const unique = [...new Set(photoIds)].sort((a, b) => a - b);
  const have = await fingerprintsFor(unique);
  return { made: 0, failed: 0, left: unique.filter((id) => !have.has(id)) };
}

async function fillNow(photoIds: number[], budgetMs: number, startedAt: number): Promise<FillResult> {
  const unique = [...new Set(photoIds)].sort((a, b) => a - b);
  const have = await fingerprintsFor(unique);
  const missing = unique.filter((id) => !have.has(id));
  let made = 0;
  let failed = 0;
  let i = 0;
  for (; i < missing.length; i += 1) {
    if (__fillClock.now() - startedAt >= budgetMs) break;
    const photoId = missing[i]!;
    try {
      const jpeg = await variantFor(photoId, "medium");
      if (!jpeg) {
        failed += 1;
        continue;
      }
      const v = await fingerprintOf(jpeg);
      if ((await saveFingerprint(photoId, v)) === "saved") made += 1;
      else failed += 1;
    } catch {
      // Deliberately not logged per photo: the id would say which photo
      // failed, and the error may carry it. The counts below are enough.
      failed += 1;
    }
  }
  const left = missing.slice(i);
  if (missing.length > 0) {
    logger.info({ made, failed, left: left.length }, "looks-like fingerprints filled");
  }
  return { made, failed, left };
}
