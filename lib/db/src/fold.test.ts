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
});
