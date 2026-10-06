import { describe, expect, it } from "vitest";
import { foldName } from "./fold";

// §10.2 test 14, DECISIONS Part 2g. cats_name_lower_unique's gaps are pinned
// in lib/db/src/migrate/dataSpine.test.ts; this is the folding that closes
// them: NFC, case-folded, accents stripped, final sigma (ς) folded to sigma
// (σ), matching colonies.normalised_name and SYC-119's app-side fold in
// artifacts/cat-spotter/lib/catPicker.ts.
describe("foldName", () => {
  it("ΜΙΜΗ = Μιμή = NFD Μιμή", () => {
    const upper = foldName("ΜΙΜΗ");
    const accented = foldName("Μιμή".normalize("NFC"));
    const nfd = foldName("Μιμή".normalize("NFD"));
    expect(upper).toBe(accented);
    expect(accented).toBe(nfd);
  });

  it("ΣΟΦΊΑΣ = Σοφίας", () => {
    expect(foldName("ΣΟΦΊΑΣ")).toBe(foldName("Σοφίας"));
  });

  it("Zoë = Zoe", () => {
    expect(foldName("Zoë")).toBe(foldName("Zoe"));
  });

  it("is idempotent", () => {
    const once = foldName("Σοφίας");
    expect(foldName(once)).toBe(once);
  });

  it("folds colony names the same way (Vaporia — Eleni's)", () => {
    expect(foldName("VAPORIA — Eleni's")).toBe(foldName("Vaporia — Eleni's"));
  });

  it("trims surrounding whitespace", () => {
    expect(foldName("  Μιμή  ")).toBe(foldName("Μιμή"));
  });

  // PR #62 review: a stray zero-width space or an extra space from a paste
  // or a phone keyboard must not register "Mimi Cat" and "Mimi  Cat" (two
  // spaces) as different cats — Samuel's decision, 3 Oct 2026.
  it("strips invisible formatting characters (zero-width space)", () => {
    expect(foldName("Μιμή​")).toBe(foldName("Μιμή"));
  });

  it("collapses a run of whitespace, including a non-breaking space, to one space", () => {
    expect(foldName("Mimi  Cat")).toBe(foldName("Mimi Cat"));
    expect(foldName("Mimi Cat")).toBe(foldName("Mimi Cat"));
  });

  // Deliberately NOT folded (Samuel, 6 Oct 2026, DECISIONS.md Part 2m):
  // Greek/Latin look-alike letters. "ΑΓΑΘΗ" typed with a mixed keyboard as
  // "AΓAΘH" (Latin A, H) stays a different name; if it ever happens, the app
  // warns instead (SYC-227).
  it("does NOT fold Greek/Latin look-alike letters (Part 2m)", () => {
    expect(foldName("ΑΓΑΘΗ")).not.toBe(foldName("AΓAΘH"));
    expect(foldName("ΜΙΜΗ")).not.toBe(foldName("MIMH"));
  });

  it("Greek tonos/dialytika combinations fold with final sigma", () => {
    expect(foldName("ΪΑΣΩΝ")).toBe(foldName("Ιάσων"));
    expect(foldName("Ϊάσων")).toBe("ιασων");
    expect(foldName("ΟΔΟΣ")).toBe("οδοσ");
    expect(foldName("οδός")).toBe("οδοσ");
  });
});

describe("foldName vs the app's search fold (catPicker.ts)", () => {
  // Copied, not imported: catPicker.ts isn't exported for lib/db to import,
  // and keeping a literal copy here is what actually proves the two agree
  // rather than testing one function against itself.
  function appFold(text: string): string {
    return text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/\p{Cf}/gu, "")
      .toLowerCase()
      .replace(/ς/g, "σ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const cases: string[] = [
    "ΜΙΜΗ", "Μιμή", "Μιμή".normalize("NFD"), "ΣΟΦΊΑΣ", "Σοφίας", "Zoë", "Zoe",
    "ΐ", "Ϊ", "ΰ", "İpek", "Ipek", "ıpek", "Straße", "STRASSE", "ﬁfi", "fifi",
    "Ǆ", "ǅ", "Å", "Å", " Μιμή ", "Μιμή ", "Μιμή​", "Mimi  Cat", "Mimi Cat",
    "ΜΙΜΗ (Latin M I M H look-alike: MIMH)", "Ⅻ", "ﾐﾐ", "ﬀ",
  ];

  it("agrees on every case but Hangul (documented, harmless for search)", () => {
    const diffs = cases
      .filter((c) => foldName(c) !== appFold(c))
      .map((c) => ({ input: c, server: foldName(c), app: appFold(c) }));
    expect(diffs).toEqual([]);
  });

  it("Hangul is the one documented exception (NFC vs no NFC)", () => {
    const hangul = "한글";
    // The server folds to NFC; the app's search fold does not re-normalise.
    expect(foldName(hangul)).not.toBe(appFold(hangul));
  });
});
