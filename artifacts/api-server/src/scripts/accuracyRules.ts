// SYC-527 piece 3, Task 4: the pure part of the accuracy check. No database,
// no model: ranking, hit rates, and the two rules that choose the model and
// the shortlist length (K) from spec section 8.

export type ModelName = "dinov2-small-q8" | "clip-b32-q8";

/** Percent of searches (0 to 100) that put the right cat in the top 10 and top 20. */
export interface HitRates {
  top10: number;
  top20: number;
}

export interface Check2Rates {
  dino: HitRates;
  clip: HitRates;
}

/** Spec section 8: within this many points, DINOv2 small wins on size. */
export const MODEL_TIE_POINTS = 5;
/** Spec section 8: top 10 within this many points of top 20 lets K drop to 10. */
export const K_TIE_POINTS = 2;

// Rates come from whole counts, so a tolerance only guards float noise at an
// exact boundary (for example 85 - 80 computed as 5.000000000000001).
const EPS = 1e-9;

/**
 * Apply the rules (brief Step 3, spec section 8). Pure.
 *
 * Model: the better top-20 rate wins; within 5 points (5 exactly counts as
 * within), DINOv2 small. With no check 2 there is nothing to prefer CLIP on,
 * so DINOv2 small.
 *
 * K: 10 if the chosen model's top 10 is within 2 points of its top 20 (2
 * exactly counts as within) AND the smoke test passes at 10; otherwise 20.
 * Always 20 if check 2 was skipped.
 *
 * `smokePassesAt10` is the smoke result for the model this returns; use
 * {@link chooseWithSmoke} when the two models' smoke results differ.
 */
export function chooseModelAndK(
  check2: Check2Rates | null,
  smokePassesAt10: boolean,
): { model: ModelName; k: 10 | 20 } {
  if (check2 === null) return { model: "dinov2-small-q8", k: 20 };
  const clipWins = check2.clip.top20 - check2.dino.top20 > MODEL_TIE_POINTS + EPS;
  const model: ModelName = clipWins ? "clip-b32-q8" : "dinov2-small-q8";
  const rates = clipWins ? check2.clip : check2.dino;
  const withinTwo = rates.top20 - rates.top10 <= K_TIE_POINTS + EPS;
  return { model, k: withinTwo && smokePassesAt10 ? 10 : 20 };
}

/** {@link chooseModelAndK}, using the smoke result of whichever model wins. */
export function chooseWithSmoke(
  check2: Check2Rates | null,
  smoke: { dino: boolean; clip: boolean },
): { model: ModelName; k: 10 | 20 } {
  const model = chooseModelAndK(check2, true).model;
  return chooseModelAndK(check2, model === "clip-b32-q8" ? smoke.clip : smoke.dino);
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/**
 * Cats ordered by closeness to the query (cosine, vectors are unit length),
 * best first. Ties break by index so the order is the same every run.
 */
export function rankGallery(query: Float32Array, gallery: readonly Float32Array[]): number[] {
  return gallery
    .map((v, i) => ({ i, s: dot(query, v) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.i);
}

/**
 * The right cat's rank (1 is best). Ties count against the right cat: a
 * gallery cat that scores the same is ranked above it, so a tie can never
 * flatter the result.
 */
export function rankOf(query: Float32Array, gallery: readonly Float32Array[], right: number): number {
  const own = dot(query, gallery[right]!);
  let ahead = 0;
  for (let i = 0; i < gallery.length; i++) if (i !== right && dot(query, gallery[i]!) >= own) ahead++;
  return ahead + 1;
}

/** Percent (0 to 100) of ranks at or inside `k`. Null for no ranks. */
export function hitRate(ranks: readonly number[], k: number): number | null {
  if (ranks.length === 0) return null;
  return (ranks.filter((r) => r <= k).length / ranks.length) * 100;
}

/** Is more than half of this list one value? (For "the top 20 are mostly one area".) */
export function mostlyOne(values: readonly string[]): boolean {
  if (values.length === 0) return false;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Math.max(...counts.values()) * 2 > values.length;
}

export const pct = (n: number | null): string => (n === null ? "n/a" : `${n.toFixed(1)}%`);
