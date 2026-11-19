import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  EVAL_SEED,
  darkestCandidates,
  formatPhotoLine,
  isAthensNight,
  meanLuminance,
  oldAnswerOf,
  pickTestSet,
  scoreHeld,
  worstOf,
  type SpotRow,
} from "./photoCheckEval";

// SYC-866: the test script's arithmetic. The database and the model are not
// touched here; the script itself runs only in Replit.

// Fixed instants (UTC). Syros is UTC+3 in summer, UTC+2 in winter.
const SUMMER_NIGHT = new Date("2026-06-21T20:30:00Z"); // 23:30 local, after sunset (about 20:50)
const SUMMER_DAY = new Date("2026-06-21T09:00:00Z"); // noon local
const WINTER_EVENING = new Date("2026-12-21T16:30:00Z"); // 18:30 local, after sunset (about 17:20)
const WINTER_AFTERNOON = new Date("2026-12-21T13:30:00Z"); // 15:30 local, before sunset

const row = (photoId: number, over: Partial<SpotRow> = {}): SpotRow => ({
  photoId,
  takenAt: SUMMER_DAY,
  noCat: false,
  photoCount: 1,
  ...over,
});

const manyRows = (): SpotRow[] => [
  ...Array.from({ length: 80 }, (_, i) => row(100 + i)),
  ...Array.from({ length: 6 }, (_, i) => row(300 + i, { takenAt: SUMMER_NIGHT })),
  ...Array.from({ length: 4 }, (_, i) => row(400 + i, { photoCount: 3 })),
  row(62),
  row(500, { noCat: true }),
  row(501, { noCat: true }),
];

describe("isAthensNight", () => {
  it("is night after a summer sunset and day at noon", () => {
    expect(isAthensNight(SUMMER_NIGHT)).toBe(true);
    expect(isAthensNight(SUMMER_DAY)).toBe(false);
  });
  it("is night in a winter evening and day in the afternoon", () => {
    expect(isAthensNight(WINTER_EVENING)).toBe(true);
    expect(isAthensNight(WINTER_AFTERNOON)).toBe(false);
  });
  it("is night just before sunrise in summer", () => {
    expect(isAthensNight(new Date("2026-06-21T01:00:00Z"))).toBe(true); // 04:00 local
  });
});

describe("pickTestSet", () => {
  it("is stable for one seed and differs for another", () => {
    const a = pickTestSet(manyRows(), EVAL_SEED);
    expect(pickTestSet(manyRows(), EVAL_SEED)).toEqual(a);
    expect(pickTestSet(manyRows(), "otherseed")).not.toEqual(a);
  });
  it("always includes photo 62 and every not-a-cat photo, and every night spot", () => {
    const ids = pickTestSet(manyRows(), EVAL_SEED).map((p) => p.photoId);
    for (const id of [62, 500, 501, 300, 301, 302, 303, 304, 305]) expect(ids).toContain(id);
  });
  it("samples cats to about 40, with a few multi-photo spots, no repeats", () => {
    const picked = pickTestSet(manyRows(), EVAL_SEED);
    const ids = picked.map((p) => p.photoId);
    expect(new Set(ids).size).toBe(ids.length);
    const cats = ids.filter((i) => i !== 500 && i !== 501);
    expect(cats.length).toBeGreaterThanOrEqual(38);
    expect(cats.length).toBeLessThanOrEqual(46);
    expect(ids.filter((i) => i >= 400 && i < 410).length).toBeGreaterThanOrEqual(3);
  });
  it("splits into both halves, every photo in exactly one", () => {
    const picked = pickTestSet(manyRows(), EVAL_SEED);
    expect(picked.some((p) => p.half === "tune")).toBe(true);
    expect(picked.some((p) => p.half === "held")).toBe(true);
  });
});

describe("worstOf", () => {
  it("is cat for a non-cat when any run said cat", () => {
    expect(worstOf(["cat", "unsure", "cat"], "not_cat")).toBe("cat");
    expect(worstOf(["unsure", "not_cat", "not_cat"], "not_cat")).toBe("unsure");
    expect(worstOf(["not_cat", "not_cat", "not_cat"], "not_cat")).toBe("not_cat");
  });
  it("is not_cat for a cat when any run said so, else unsure", () => {
    expect(worstOf(["cat", "unsure", "cat"], "cat")).toBe("unsure");
    expect(worstOf(["cat", "not_cat", "unsure"], "cat")).toBe("not_cat");
    expect(worstOf(["cat", "cat", "cat"], "cat")).toBe("cat");
  });
});

describe("scoreHeld", () => {
  const cats = (n: number, unsure: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      truth: "cat" as const,
      night: true,
      worst: i < unsure ? ("unsure" as const) : ("cat" as const),
    }));
  it("fails when one non-cat reads cat", () => {
    const r = scoreHeld([...cats(5, 0), { id: 62, truth: "not_cat", night: false, worst: "cat" }]);
    expect(r.passed).toBe(false);
  });
  it("fails when a cat reads not_cat", () => {
    const r = scoreHeld([...cats(5, 0), { id: 70, truth: "cat", night: false, worst: "not_cat" }]);
    expect(r.passed).toBe(false);
  });
  it("fails at 2 of 9 night cats unsure and passes at 1 of 5", () => {
    expect(scoreHeld(cats(9, 2)).passed).toBe(false);
    expect(scoreHeld(cats(5, 1)).passed).toBe(true);
  });
  it("passes a non-cat that reads unsure or not_cat", () => {
    const r = scoreHeld([...cats(5, 0), { id: 62, truth: "not_cat", night: false, worst: "unsure" }]);
    expect(r.passed).toBe(true);
  });
});

describe("what is printed", () => {
  it("holds a photo number, the old answer, the answers and worst, and nothing else", () => {
    const fixture = { photoId: 62, name: "Whiskerbeard", lat: 37.44, photoSeen: "a black sock on a floor" };
    const line = formatPhotoLine({ label: String(fixture.photoId), old: "cat", answers: ["cat", "unsure", "cat"], worst: "cat" });
    expect(line).toContain("62");
    expect(line).toContain("cat, unsure, cat");
    for (const secret of [fixture.name, String(fixture.lat), fixture.photoSeen, "sock"]) expect(line).not.toContain(secret);
    const scored = scoreHeld([{ id: 62, truth: "not_cat", night: false, worst: "cat" }]);
    for (const l of scored.lines) {
      expect(l).not.toContain(fixture.name);
      expect(l).not.toContain("37.44");
    }
  });
});

describe("oldAnswerOf", () => {
  it("reads the stored record", () => {
    expect(oldAnswerOf({ noCatInAnyPhoto: true, matcherFailed: false })).toBe("not_cat");
    expect(oldAnswerOf({ noCatInAnyPhoto: false, matcherFailed: true })).toBe("failed");
    expect(oldAnswerOf({ noCatInAnyPhoto: null, matcherFailed: false })).toBe("cat");
    expect(oldAnswerOf(null)).toBe("none");
  });
});

describe("darkest known cats", () => {
  it("meanLuminance is lower for a black picture than a white one", async () => {
    const png = (v: number) => sharp({ create: { width: 8, height: 8, channels: 3, background: { r: v, g: v, b: v } } }).png().toBuffer();
    const dark = await meanLuminance((await png(10)).toString("base64"));
    const light = await meanLuminance((await png(240)).toString("base64"));
    expect(dark).toBeLessThan(light);
  });
  it("takes the 3 darkest, or what there is", () => {
    const c = (catId: number, lum: number) => ({ catId, name: "Whiskerbeard", photoBase64: "", mime: "image/jpeg", lum });
    expect(darkestCandidates([c(1, 90), c(2, 10), c(3, 50), c(4, 20)], 3).map((x) => x.catId)).toEqual([2, 4, 3]);
    expect(darkestCandidates([c(1, 90)], 3).map((x) => x.catId)).toEqual([1]);
    expect(darkestCandidates([], 3)).toEqual([]);
  });
});
