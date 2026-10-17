import { describe, expect, it } from "vitest";
import { COAT_COLOURS, COAT_PATTERNS, legacyCoatCodes, partsToValue, readCoatValue } from "./appearance";

describe("readCoatValue: the one translation (spec §6)", () => {
  const cases: [string, unknown, ReturnType<typeof readCoatValue>][] = [
    ["new, both parts", { colours: ["brown", "ginger"], pattern: "stripes" }, { colours: ["brown", "ginger"], pattern: "stripes", notSure: false }],
    ["new, colours only", { colours: ["ginger"] }, { colours: ["ginger"], pattern: null, notSure: false }],
    ["new, pattern only", { pattern: "stripes" }, { colours: null, pattern: "stripes", notSure: false }],
    ["new, with the team's reason and agreesWith", { colours: ["grey"], reason: "x", agreesWith: 4 }, { colours: ["grey"], pattern: null, notSure: false }],
    ["notSure", { notSure: true }, { colours: null, pattern: null, notSure: true }],
    ["old ginger · tabby", { colours: ["ginger", "tabby"] }, { colours: ["ginger"], pattern: "stripes", notSure: false }],
    ["old tabby", { colours: ["tabby"] }, { colours: null, pattern: "stripes", notSure: false }],
    ["old tabby · white: a bare white never becomes known", { colours: ["tabby", "white"] }, { colours: null, pattern: "stripes", notSure: false }],
    ["old black_and_white · tabby keeps black and white", { colours: ["black_and_white", "tabby"] }, { colours: ["black", "white"], pattern: "stripes", notSure: false }],
    ["old black_and_white", { colours: ["black_and_white"] }, { colours: ["black", "white"], pattern: null, notSure: false }],
    ["old tortoiseshell_or_calico", { colours: ["tortoiseshell_or_calico"] }, { colours: ["black", "ginger"], pattern: "patches", notSure: false }],
    ["old not_sure", { colours: ["not_sure"] }, { colours: null, pattern: null, notSure: true }],
    ["machine v1 row", { colours: ["ginger", "tabby"], modelVersion: "gpt-5.6-terra/coat-v1" }, { colours: ["ginger"], pattern: "stripes", notSure: false }],
    ["retraction", { retracted: true }, null],
    ["unknown code", { colours: ["purple"] }, null],
    ["nothing stated", {}, null],
  ];
  for (const [label, value, expected] of cases) it(label, () => expect(readCoatValue(value)).toEqual(expected));

  it("orders colours black, grey, brown, ginger, white", () => {
    expect(readCoatValue({ colours: ["white", "brown", "black"] })?.colours).toEqual(["black", "brown", "white"]);
  });
});

describe("partsToValue: never writes nulls", () => {
  it.each([
    [{ colours: ["ginger"], pattern: null, notSure: false }, { colours: ["ginger"] }],
    [{ colours: null, pattern: "stripes", notSure: false }, { pattern: "stripes" }],
    [{ colours: ["brown"], pattern: "plain", notSure: false }, { colours: ["brown"], pattern: "plain" }],
    [{ colours: null, pattern: null, notSure: true }, { notSure: true }],
  ] as const)("%j → %j", (parts, value) => expect(partsToValue(parts as never)).toEqual(value));
});

/** The spec §6 truth table, written independently of the implementation. */
function oracle(colours: readonly string[], pattern: string | null): string[] {
  const s = new Set(colours);
  const nonBW = colours.filter((c) => c !== "black" && c !== "white");
  if (s.has("black") && s.has("white") && nonBW.length === 0 && pattern !== "stripes") return ["black_and_white"];
  if (pattern === "patches" && s.has("black") && s.has("ginger")) return ["tortoiseshell_or_calico"];
  if (pattern === "stripes") {
    for (const c of ["ginger", "grey", "black", "white"]) if (s.has(c)) return c === "white" ? ["tabby", "white"] : [c, "tabby"];
    return ["tabby"];
  }
  return ["black", "white", "ginger", "grey"].filter((c) => s.has(c)).slice(0, 2);
}

describe("legacyCoatCodes: the old field for older phones", () => {
  it("matches the spec table for all 32 colour sets × 4 pattern states", () => {
    for (let mask = 0; mask < 32; mask++) {
      const colours = COAT_COLOURS.filter((_, i) => mask & (1 << i));
      for (const pattern of [...COAT_PATTERNS, null]) {
        expect(legacyCoatCodes(colours, pattern), `${colours}+${pattern}`).toEqual(oracle(colours, pattern));
      }
    }
  });

  it("spec §6 examples: Brown alone gives [], Brown · White · Stripes gives tabby · white", () => {
    expect(legacyCoatCodes(["brown"], null)).toEqual([]);
    expect(legacyCoatCodes(["brown", "white"], "stripes")).toEqual(["tabby", "white"]);
  });
});
