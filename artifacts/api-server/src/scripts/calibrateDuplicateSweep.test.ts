import { describe, expect, it } from "vitest";
import { CANDIDATE_THRESHOLDS, MIN_PAIRS_TO_TRUST, calibrationRows, formatCalibration, suggestThreshold } from "./calibrateDuplicateSweep";

// SYC-59 PR 5.3: the calibration's arithmetic against fixture pairs (the
// database side is in lib/db dbOps.calibrateDuplicateSweep.test.ts).

const pair = (same: boolean, score: number) => ({ same, score });

describe("calibrationRows", () => {
  const pairs = [
    ...[0.97, 0.95, 0.93, 0.91].map((s) => pair(true, s)),
    ...[0.96, 0.85, 0.82, 0.8].map((s) => pair(false, s)),
  ];
  const at = (t: number) => calibrationRows(pairs).find((r) => r.threshold === t)!;

  it("counts the pairs above each threshold, its top 10 and how many were the same cat", () => {
    expect(at(0.7)).toMatchObject({ above: 8, inTop: 8, same: 4, passes: false });
    expect(at(0.85)).toMatchObject({ above: 6, inTop: 6, same: 4, passes: false });
    expect(at(0.88)).toMatchObject({ above: 5, inTop: 5, same: 4, passes: true });
    expect(at(0.98)).toMatchObject({ above: 0, inTop: 0, same: 0, passes: false });
  });

  it("judges only the 10 closest look-alikes when more pass the threshold", () => {
    // Ten 'same' at .99, then ten 'different' at .90: the top 10 at 0.88 is all 'same'.
    const many = [...Array.from({ length: 10 }, () => pair(true, 0.99)), ...Array.from({ length: 10 }, () => pair(false, 0.9))];
    expect(calibrationRows(many, [0.88])[0]).toMatchObject({ above: 20, inTop: 10, same: 10, passes: true });
  });

  it("never passes a threshold with fewer pairs than it can be trusted on, even if all are right", () => {
    const few = [pair(true, 0.99), pair(true, 0.98), pair(true, 0.97)];
    expect(few.length).toBeLessThan(MIN_PAIRS_TO_TRUST);
    expect(calibrationRows(few).every((r) => !r.passes)).toBe(true);
  });

  it("exactly three in four passes; just under does not", () => {
    const four = [pair(true, 0.99), pair(true, 0.98), pair(true, 0.97), pair(false, 0.96)];
    expect(calibrationRows(four, [0.9])[0]!.passes).toBe(true);
    const five = [...four, pair(false, 0.95)];
    expect(calibrationRows(five, [0.9])[0]!.passes).toBe(false);
  });
});

describe("suggestThreshold and the report", () => {
  it("suggests the lowest passing threshold, or none", () => {
    const pairs = [...[0.97, 0.95, 0.93, 0.91].map((s) => pair(true, s)), pair(false, 0.8)];
    const rows = calibrationRows(pairs);
    expect(suggestThreshold(rows)).toBe(0.7);
    expect(suggestThreshold(calibrationRows([pair(false, 0.99), pair(false, 0.98), pair(true, 0.97), pair(false, 0.96)]))).toBeNull();
  });

  it("prints counts and scores only, and says to leave the switch off when nothing passes", () => {
    const lines = formatCalibration([pair(false, 0.99)], 2, calibrationRows([pair(false, 0.99)]));
    const text = lines.join("\n");
    expect(text).toContain("Decided pairs scored: 1 (0 merged, 1 different). Not scored, a cat has no fingerprint: 2.");
    expect(text).toContain("Suggested SWEEP_THRESHOLD: none yet");
    expect(text).toContain("Leave the switch off");
    expect(lines.filter((l) => /^\d\.\d\d/.test(l))).toHaveLength(CANDIDATE_THRESHOLDS.length);
  });
});
