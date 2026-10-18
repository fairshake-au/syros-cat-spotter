import { describe, expect, it } from "vitest";
import { COAT_COLOURS, COAT_PATTERNS } from "../appearance";
import { TEAM_COAT_GOLDEN } from "./__fixtures__/teamCoatGolden";
import { coatIsUnknown, coatWordsFor, teamCoatPhrase, teamPatternWord, TEAM_PATTERN_LABELS } from "./teamCoatWords";

// SYC-443 PR 1, Task 1.1 (coat-colours-and-pattern.md §15.2, §15.5, §15.6).
// The words are checked against the spec's table, typed by hand into the
// fixture, never against the code's own rules.

const ALL = ["en", "el", "fr"] as const;

describe("the golden table (§15.6): every coat in the team's words", () => {
  it("the fixture is complete: 128 distinct rows, every one of the 32 colour sets × 4 pattern states", () => {
    expect(TEAM_COAT_GOLDEN).toHaveLength(128);
    expect(TEAM_COAT_GOLDEN.map((r) => r[0])).toEqual(Array.from({ length: 128 }, (_, i) => i + 1));
    const keys = new Set(TEAM_COAT_GOLDEN.map(([, colours, pattern]) => `${(colours ?? []).join("+")}|${pattern ?? "?"}`));
    expect(keys.size).toBe(128);
    // Every subset of the five colours (the empty one is "not known"), with each pattern state.
    for (let mask = 0; mask < 32; mask++) {
      const set = COAT_COLOURS.filter((_, i) => mask & (1 << i)).join("+");
      for (const p of [...COAT_PATTERNS, "?"]) expect(keys.has(`${set}|${p}`), `${set}|${p}`).toBe(true);
    }
  });

  it.each(TEAM_COAT_GOLDEN.map((r) => [r[0], r] as const))("row %i", (_, [, colours, pattern, words]) => {
    expect(teamCoatPhrase({ colours, pattern })).toBe(words);
  });

  it("[] colours count as not known, the same as null, in every row where colours are unknown", () => {
    const unknown = TEAM_COAT_GOLDEN.filter(([, colours]) => colours === null);
    expect(unknown).toHaveLength(4);
    for (const [row, , pattern, words] of unknown) {
      expect(teamCoatPhrase({ colours: [], pattern }), `row ${row}`).toBe(words);
    }
  });

  it("the order the colours come in doesn't matter (row 87, reversed)", () => {
    expect(teamCoatPhrase({ colours: ["white", "ginger", "black"], pattern: "patches" })).toBe("Calico");
    expect(teamCoatPhrase({ colours: ["white", "ginger", "brown"], pattern: "stripes" })).toBe("Brown and ginger tabby with white");
  });

  it("codes outside the vocabulary are dropped, never written", () => {
    expect(teamCoatPhrase({ colours: ["ginger", "tabby", "<b>"], pattern: "stripes" })).toBe("Ginger tabby");
    expect(teamCoatPhrase({ colours: ["ginger"], pattern: "tabby" })).toBe("Ginger, pattern not known");
  });
});

describe("one statement says 'not stated' (§15.2)", () => {
  it.each([
    [{ colours: null, pattern: "stripes" }, "Tabby, colours not stated"],
    [{ colours: null, pattern: "plain" }, "Solid, colours not stated"],
    [{ colours: null, pattern: "patches" }, "Patched, colours not stated"],
    [{ colours: [], pattern: "stripes" }, "Tabby, colours not stated"],
    [{ colours: ["ginger", "white"], pattern: null }, "Ginger and white, pattern not stated"],
    [{ colours: ["black"], pattern: null }, "Black, pattern not stated"],
    [{ colours: ["ginger"], pattern: "stripes" }, "Ginger tabby"],
  ] as const)("%j gives %s", (coat, words) => {
    expect(teamCoatPhrase(coat, "stated")).toBe(words);
  });
});

describe("the pattern words (§15.2, T3A)", () => {
  it("Solid, Tabby, Patched, Not known", () => {
    expect(["plain", "stripes", "patches", null, "tabby"].map(teamPatternWord)).toEqual(["Solid", "Tabby", "Patched", "Not known", "Not known"]);
  });

  it("the Correct buttons carry their hints, keyed by the codes they post", () => {
    expect(TEAM_PATTERN_LABELS).toEqual({
      plain: "Solid (one colour all over, maybe a little white)",
      stripes: "Tabby (stripes, swirls or spots)",
      patches: "Patched (tortoiseshell, calico, black and white…)",
      none: "Not stated",
    });
  });
});

describe("coatIsUnknown", () => {
  it("is true only when neither part is known", () => {
    expect(coatIsUnknown({ colours: null, pattern: null })).toBe(true);
    expect(coatIsUnknown({ colours: [], pattern: null })).toBe(true);
    expect(coatIsUnknown({ colours: ["black"], pattern: null })).toBe(false);
    expect(coatIsUnknown({ colours: null, pattern: "stripes" })).toBe(false);
    expect(coatIsUnknown({ colours: [], pattern: "plain" })).toBe(false);
  });
});

describe("coatWordsFor: English only (T4A)", () => {
  const coat = { colours: ["ginger"], pattern: "stripes" };

  it("English gives the team phrase", () => {
    expect(coatWordsFor("en", coat, { live: ALL })).toBe("Ginger tabby");
    expect(coatWordsFor(undefined, coat)).toBe("Ginger tabby");
    expect(coatWordsFor("en", { colours: ["black", "white"], pattern: null }, { gap: "stated", live: ALL })).toBe(
      "Black and white, pattern not stated",
    );
  });

  it("with Greek and French switched on, §2's words in each, never an English team word", () => {
    expect(coatWordsFor("el", coat, { live: ALL })).toBe("Πορτοκαλί · Ρίγες");
    expect(coatWordsFor("fr", coat, { live: ALL })).toBe("Roux · Rayures");
    expect(coatWordsFor("el", { colours: ["black", "ginger", "white"], pattern: "patches" }, { live: ALL })).toBe(
      "Μαύρο · Πορτοκαλί · Λευκό · Μπαλώματα",
    );
    for (const lang of ["el", "fr"]) {
      for (const [, colours, pattern] of TEAM_COAT_GOLDEN) {
        expect(coatWordsFor(lang, { colours, pattern }, { live: ALL })).not.toMatch(
          /tabby|tortoiseshell|calico|solid|patched|not known|not stated/i,
        );
      }
    }
  });

  it("with only English live (today), Greek falls back to English and its team phrase", () => {
    expect(coatWordsFor("el", coat)).toBe("Ginger tabby");
    expect(coatWordsFor("fr", coat, { live: ["en"] })).toBe("Ginger tabby");
  });
});
