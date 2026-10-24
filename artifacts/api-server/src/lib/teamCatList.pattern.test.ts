import { describe, expect, it } from "vitest";
import { patternPicked } from "./teamCatList";

// SYC-435: the grid's Pattern filter is forgiving about Solid and Patched
// (coat spec §5), as "Find the cat" is. Tabby is exact.
describe("patternPicked", () => {
  const cat = (coat: string[], pattern: string | null) => ({ coat, pattern }) as Parameters<typeof patternPicked>[0];
  it("matches the recorded pattern", () => {
    expect(patternPicked(cat(["black"], "plain"), ["plain"])).toBe(true);
    expect(patternPicked(cat(["black"], "plain"), ["patches"])).toBe(false);
    expect(patternPicked(cat(["ginger"], "stripes"), ["stripes", "plain"])).toBe(true);
  });
  it("shows a cat with white under both Solid and Patched, whichever was recorded", () => {
    expect(patternPicked(cat(["black", "white"], "plain"), ["patches"])).toBe(true);
    expect(patternPicked(cat(["black", "white"], "patches"), ["plain"])).toBe(true);
  });
  it("does not forgive without white, and never forgives Tabby", () => {
    expect(patternPicked(cat(["black", "ginger"], "patches"), ["plain"])).toBe(false);
    expect(patternPicked(cat(["black", "white"], "stripes"), ["plain"])).toBe(false);
    expect(patternPicked(cat(["black", "white"], "plain"), ["stripes"])).toBe(false);
  });
  it("never matches a cat with no pattern", () => {
    expect(patternPicked(cat(["white"], null), ["plain", "patches", "stripes"])).toBe(false);
  });
});
