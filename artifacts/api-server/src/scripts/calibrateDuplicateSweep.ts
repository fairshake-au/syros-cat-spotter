import { pathToFileURL } from "node:url";
import { safeError } from "../lib/logger";
import { SWEEP_MAX_PER_NIGHT, SWEEP_THRESHOLD, decidedPairScores, topPairs, type DecidedPairScore } from "../lib/duplicateSweep";

// SYC-59 PR 5.3 (which-cat-is-which.md §9.6): the calibration the nightly
// look-alike sweep needs before its switch is turned on. READ-ONLY (db-ops
// `calibrate-duplicate-sweep` starts it over a read-only session) and prints
// counts and likeness scores only: no cat id, name, photo or position.
//
// It takes the pairs the team has already decided (merged = the same cat,
// "different" = two cats), scores each pair by its two cats' main-photo
// fingerprints, and shows, for each candidate threshold, how the sweep's top
// 10 above it would have done. The acceptance test (§9.6) is that at least 3
// in 4 of the top 10 would have been "same cat".
//
//   pnpm --filter @workspace/db exec tsx ../../artifacts/api-server/src/scripts/calibrateDuplicateSweep.ts

/** Candidate thresholds, lowest first. */
export const CANDIDATE_THRESHOLDS: readonly number[] = [0.7, 0.75, 0.8, 0.85, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98];

/** The acceptance test: this share of the top 10 must have been the same cat. */
export const PASS_SHARE = 0.75;

/**
 * Fewer decided pairs than this above a threshold prove nothing (a top 10 of
 * two pairs can be 2 of 2 by luck), so such a threshold is never suggested.
 */
export const MIN_PAIRS_TO_TRUST = 4;

export interface ThresholdRow {
  threshold: number;
  /** Decided pairs scoring at or above the threshold. */
  above: number;
  /** The top 10 of those (fewer if fewer). */
  inTop: number;
  /** How many of the top were merged ("same cat"). */
  same: number;
  passes: boolean;
}

export function calibrationRows(pairs: readonly DecidedPairScore[], thresholds: readonly number[] = CANDIDATE_THRESHOLDS): ThresholdRow[] {
  return thresholds.map((threshold) => {
    const above = pairs.filter((p) => p.score >= threshold);
    // The same ordering the sweep uses: closest look-alikes first.
    const top = topPairs(
      above.map((p, i) => ({ low: i, high: i, score: p.score })),
      SWEEP_MAX_PER_NIGHT,
    ).map((t) => above[t.low]!);
    const same = top.filter((p) => p.same).length;
    return {
      threshold,
      above: above.length,
      inTop: top.length,
      same,
      passes: top.length >= MIN_PAIRS_TO_TRUST && same / top.length >= PASS_SHARE,
    };
  });
}

/** The lowest threshold that passes (the one that finds the most), or null. */
export function suggestThreshold(rows: readonly ThresholdRow[]): number | null {
  return rows.find((r) => r.passes)?.threshold ?? null;
}

export function formatCalibration(pairs: readonly DecidedPairScore[], unscored: number, rows: readonly ThresholdRow[]): string[] {
  const same = pairs.filter((p) => p.same).length;
  const suggested = suggestThreshold(rows);
  const lines = [
    `Decided pairs scored: ${pairs.length} (${same} merged, ${pairs.length - same} different). Not scored, a cat has no fingerprint: ${unscored}.`,
    `For each threshold, the sweep's top ${SWEEP_MAX_PER_NIGHT} among these pairs, and how many of them were the same cat:`,
    "threshold  pairs above  in top 10  same cat  share  passes",
    ...rows.map(
      (r) =>
        `${r.threshold.toFixed(2).padEnd(9)}  ${String(r.above).padEnd(11)}  ${String(r.inTop).padEnd(9)}  ${String(r.same).padEnd(8)}  ${(r.inTop ? `${Math.round((100 * r.same) / r.inTop)}%` : "-").padEnd(5)}  ${r.passes ? "yes" : "no"}`,
    ),
    `A threshold passes when at least ${PASS_SHARE * 100}% of its top ${SWEEP_MAX_PER_NIGHT} were the same cat and it has at least ${MIN_PAIRS_TO_TRUST} pairs to judge by.`,
    "Caution: the team decides pairs that already looked alike, so this is a fair test of telling look-alikes apart, not of every pair on the island.",
  ];
  if (suggested === null) {
    lines.push(
      pairs.length < MIN_PAIRS_TO_TRUST
        ? `Suggested SWEEP_THRESHOLD: none yet. Too few decided pairs (${pairs.length}); decide more on Possible duplicates and run this again. Leave the switch off.`
        : "Suggested SWEEP_THRESHOLD: none. No threshold passes; leave the switch off.",
    );
  } else {
    lines.push(`Suggested SWEEP_THRESHOLD: ${suggested.toFixed(2)} (lib/duplicateSweep.ts has ${SWEEP_THRESHOLD.toFixed(2)} now). Change it there, then turn the switch on.`);
  }
  return lines;
}

export async function main(say: (l: string) => void): Promise<number> {
  const { pool } = await import("@workspace/db");
  try {
    const { makeReadOnly } = await import("./smokeCheck");
    await makeReadOnly();
    const { scored, unscored } = await decidedPairScores();
    formatCalibration(scored, unscored, calibrationRows(scored)).forEach(say);
  } finally {
    // The pool keeps the process alive; end it so the script exits.
    await pool.end();
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main((l) => console.log(l)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      // safeError: a database error's own message can carry a query and its values.
      console.error(`calibrate-duplicate-sweep failed: ${JSON.stringify(safeError(err))}`);
      process.exitCode = 1;
    },
  );
}
