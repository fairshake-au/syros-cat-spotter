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
  missingLabels,
  parseArgs,
  keptPhoto,
  normaliseExtra,
  promptHash,
  candidatesFor,
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
  it("puts photo 62 always in held, and spreads non-cats and night cats over both halves", () => {
    for (const seed of [EVAL_SEED, "aaa", "bbb", "ccc", "ddd"]) {
      const picked = pickTestSet(manyRows(), seed);
      const half = (id: number) => picked.find((p) => p.photoId === id)!.half;
      expect(half(62)).toBe("held");
      expect([half(500), half(501)]).toContain("held");
      expect([300, 301, 302, 303, 304, 305].filter((i) => half(i) === "held").length).toBe(3);
    }
    expect(pickTestSet([row(62), row(500, { noCat: true })], EVAL_SEED).map((p) => p.half)).toEqual(["held", "held"]);
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
  it("treats a failed call as the worst, for either truth", () => {
    expect(worstOf(["cat", "failed", "cat"], "cat")).toBe("failed");
    expect(worstOf(["not_cat", "failed", "unsure"], "not_cat")).toBe("failed");
  });
});

describe("scoreHeld", () => {
  const cats = (n: number, unsure: number, night = true) =>
    Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      truth: "cat" as const,
      night,
      worst: i < unsure ? ("unsure" as const) : ("cat" as const),
    }));
  const sock = (worst: "cat" | "unsure" | "not_cat" | "failed" = "not_cat") => ({ id: 62, truth: "not_cat" as const, night: false, worst });
  it("passes a complete run that meets the bar", () => {
    const r = scoreHeld([...cats(5, 1), sock()]);
    expect(r.status).toBe("PASS");
    expect(r.passed).toBe(true);
  });
  it("fails when one non-cat reads cat", () => {
    expect(scoreHeld([...cats(5, 0), sock("cat")]).status).toBe("FAIL");
  });
  it("fails when a cat reads not_cat", () => {
    expect(scoreHeld([...cats(5, 0), sock(), { id: 70, truth: "cat", night: false, worst: "not_cat" }]).status).toBe("FAIL");
  });
  it("fails at 2 of 9 night cats unsure and passes at 1 of 5", () => {
    expect(scoreHeld([...cats(9, 2), sock()]).status).toBe("FAIL");
    expect(scoreHeld([...cats(5, 1), sock()]).status).toBe("PASS");
  });
  it("passes a non-cat that reads unsure", () => {
    expect(scoreHeld([...cats(5, 0), sock("unsure")]).status).toBe("PASS");
  });
  it("is INCOMPLETE when photo 62 is not scored", () => {
    const r = scoreHeld([...cats(5, 0), { id: 500, truth: "not_cat", night: false, worst: "not_cat" }]);
    expect(r.status).toBe("INCOMPLETE");
    expect(r.passed).toBe(false);
  });
  it("is INCOMPLETE with no non-cats at all", () => {
    expect(scoreHeld(cats(6, 0)).status).toBe("INCOMPLETE");
  });
  it("is INCOMPLETE with fewer than 5 night cats, and 0 night cats is never PASS", () => {
    expect(scoreHeld([...cats(4, 0), sock()]).status).toBe("INCOMPLETE");
    expect(scoreHeld([...cats(8, 0, false), sock()]).status).not.toBe("PASS");
  });
  it("fails when any call failed, and says how many", () => {
    const r = scoreHeld([...cats(5, 0), { ...sock(), worst: "failed", failedCalls: 2 }]);
    expect(r.status).toBe("FAIL");
    expect(r.lines.join("\n")).toContain("2 calls failed");
  });
  it("prints n on each bar line", () => {
    const r = scoreHeld([...cats(5, 1), sock()]);
    expect(r.lines.filter((l) => l.includes("n=")).length).toBe(3);
  });
});

describe("missingLabels", () => {
  it("lists unlabelled photo numbers; skip counts as labelled; extra files are not asked about", () => {
    const truthOf = new Map<number, "cat" | "not_cat" | "skip">([[1, "cat"], [2, "skip"]]);
    expect(missingLabels([{ photoId: 1 }, { photoId: 2 }, { photoId: 3 }, { photoId: null }, { photoId: 4 }], truthOf)).toEqual([3, 4]);
  });
});

describe("what is printed", () => {
  it("holds a photo number, the old answer, the answers and worst, and nothing else", () => {
    const fixture = { photoId: 62, name: "Whiskerbeard", lat: 37.44, photoSeen: "a black sock on a floor" };
    const line = formatPhotoLine({ label: String(fixture.photoId), old: "cat", answers: ["cat", "unsure", "cat"], worst: "cat" });
    expect(line).toContain("62");
    expect(line).toContain("cat, unsure, cat");
    expect(formatPhotoLine({ label: "mysock.jpg", old: "none", answers: ["unsure", "failed", "cat"], worst: "failed" })).toContain("mysock.jpg");
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

describe("parseArgs", () => {
  it("needs --half tune|held", () => {
    expect(parseArgs([]).ok).toBe(false);
    expect(parseArgs(["--half", "other"]).ok).toBe(false);
    expect(parseArgs(["--half", "tune"])).toEqual({ ok: true, half: "tune", promptModule: null });
  });
  it("takes --prompt-module for tune", () => {
    expect(parseArgs(["--half", "tune", "--prompt-module", "./p.ts"])).toEqual({ ok: true, half: "tune", promptModule: "./p.ts" });
  });
  it("refuses --prompt-module with --half held", () => {
    const r = parseArgs(["--half", "held", "--prompt-module", "./p.ts"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("held");
  });
  it("no longer knows --prompt-file", () => {
    expect(parseArgs(["--half", "tune", "--prompt-file", "x"]).ok).toBe(false);
  });
});

describe("promptHash", () => {
  it("is 8 characters and tells two prompts apart", () => {
    expect(promptHash("one")).toMatch(/^[0-9a-f]{8}$/);
    expect(promptHash("one")).toBe(promptHash("one"));
    expect(promptHash("one")).not.toBe(promptHash("two"));
  });
});

describe("candidatesFor", () => {
  const c = (catId: number, lum: number) => ({ catId, name: "Whiskerbeard", photoBase64: "", mime: "image/jpeg", lum });
  it("uses the nearby cats when there are any, and never works out the island", async () => {
    let asked = false;
    const island = async () => {
      asked = true;
      return [c(9, 1)];
    };
    expect((await candidatesFor([c(1, 80), c(2, 70)], island, 3)).map((x) => x.catId)).toEqual([2, 1]);
    expect(asked).toBe(false);
  });
  it("falls back to the darkest 3 live cats island-wide when none are nearby", async () => {
    const island = async () => [c(5, 90), c(6, 10), c(7, 30), c(8, 20)];
    expect((await candidatesFor([], island, 3)).map((x) => x.catId)).toEqual([6, 8, 7]);
  });
});

describe("keptPhoto", () => {
  it("keeps a photo that is there", () => {
    expect(keptPhoto({ data: "abc", mime: "image/png", removedAt: null })).toEqual({ photoBase64: "abc", mime: "image/png" });
  });
  it("leaves out a photo removed for good (no data, or removed_at set) and a missing row", () => {
    expect(keptPhoto({ data: null, mime: "image/png", removedAt: new Date("2026-01-01T00:00:00Z") })).toBeNull();
    expect(keptPhoto({ data: "abc", mime: "image/png", removedAt: new Date("2026-01-01T00:00:00Z") })).toBeNull();
    expect(keptPhoto({ data: null, mime: "image/png", removedAt: null })).toBeNull();
    expect(keptPhoto(undefined)).toBeNull();
  });
  it("a spot whose only photo was removed leaves photo 62 unscored, so the run is INCOMPLETE", () => {
    const nightCats = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, truth: "cat" as const, night: true, worst: "cat" as const }));
    expect(scoreHeld([...nightCats, { id: 500, truth: "not_cat", night: false, worst: "not_cat" }]).status).toBe("INCOMPLETE");
  });
});

describe("normaliseExtra", () => {
  it("sends an extra file the way production sends an upload: upright JPEG, longest edge at most 2048", async () => {
    const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: { r: 20, g: 20, b: 20 } } }).png().toBuffer();
    const out = await normaliseExtra(big);
    expect(out!.mime).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(out!.photoBase64, "base64")).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(2048);
  });
  it("refuses a file that is not a picture", async () => {
    await expect(normaliseExtra(Buffer.from("not a picture"))).rejects.toThrow();
  });
});
