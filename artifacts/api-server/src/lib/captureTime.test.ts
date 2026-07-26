import { describe, it, expect } from "vitest";
import {
  clampCaptureTime,
  MAX_BACKDATE_MS,
  MAX_FUTURE_SKEW_MS,
} from "./captureTime";

const NOW = new Date("2026-07-26T12:00:00Z");

describe("clampCaptureTime", () => {
  it("falls back to now when the client sends nothing", () => {
    expect(clampCaptureTime(undefined, NOW)).toEqual(NOW);
    expect(clampCaptureTime(null, NOW)).toEqual(NOW);
    expect(clampCaptureTime("", NOW)).toEqual(NOW);
  });

  it("falls back to now on an unparseable value", () => {
    expect(clampCaptureTime("not a date", NOW)).toEqual(NOW);
    expect(clampCaptureTime("2026-13-45T99:99:99Z", NOW)).toEqual(NOW);
  });

  // The whole point: a sighting queued offline on Monday and synced Wednesday
  // must keep Monday, or the streak counts the sync instead of the spot.
  it("keeps a capture time from two days ago", () => {
    const monday = "2026-07-24T18:30:00Z";
    expect(clampCaptureTime(monday, NOW).toISOString()).toBe(
      new Date(monday).toISOString(),
    );
  });

  it("keeps a capture time from a few minutes ago", () => {
    const recent = "2026-07-26T11:45:00Z";
    expect(clampCaptureTime(recent, NOW).toISOString()).toBe(
      new Date(recent).toISOString(),
    );
  });

  it("clamps a future capture time to now", () => {
    expect(clampCaptureTime("2026-07-28T12:00:00Z", NOW)).toEqual(NOW);
  });

  it("tolerates a slightly fast clock inside the skew window", () => {
    const slightlyAhead = new Date(NOW.getTime() + MAX_FUTURE_SKEW_MS - 1000);
    expect(clampCaptureTime(slightlyAhead.toISOString(), NOW)).toEqual(
      slightlyAhead,
    );
  });

  it("clamps just beyond the skew window back to now", () => {
    const tooFarAhead = new Date(NOW.getTime() + MAX_FUTURE_SKEW_MS + 1000);
    expect(clampCaptureTime(tooFarAhead.toISOString(), NOW)).toEqual(NOW);
  });

  // Bounds how much streak anyone can manufacture by backdating.
  it("clamps an implausibly old capture time to the backdate floor", () => {
    const ancient = "2019-01-01T00:00:00Z";
    const floor = new Date(NOW.getTime() - MAX_BACKDATE_MS);
    expect(clampCaptureTime(ancient, NOW)).toEqual(floor);
  });

  it("keeps a capture time just inside the backdate window", () => {
    const justInside = new Date(NOW.getTime() - MAX_BACKDATE_MS + 60_000);
    expect(clampCaptureTime(justInside.toISOString(), NOW)).toEqual(justInside);
  });

  it("never returns a time in the future, whatever the input", () => {
    const inputs = [
      "2099-01-01T00:00:00Z",
      new Date(NOW.getTime() + 86_400_000).toISOString(),
      "not a date",
      undefined,
    ];
    for (const input of inputs) {
      const out = clampCaptureTime(input, NOW);
      expect(out.getTime()).toBeLessThanOrEqual(
        NOW.getTime() + MAX_FUTURE_SKEW_MS,
      );
    }
  });
});
