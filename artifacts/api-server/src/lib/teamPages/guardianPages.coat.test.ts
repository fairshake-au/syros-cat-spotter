import { describe, expect, it } from "vitest";
import type { GuardianCat } from "../guardianCatView";
import { renderGuardianCatPage } from "./guardianPages";
import type { Language } from "./strings";

// SYC-443 PR 2 (folds in SYC-436): a cat guardian's cat page says the coat in
// the team's words (spec coat-colours-and-pattern.md §15, T1A), then the marks
// as the public line words them. English only (T4A): with Greek switched on,
// a Greek page says §2's words for the parts that are known. Drawn directly,
// with `live` passed, as the guardian language tests do.

const GREEK_LIVE: readonly Language[] = ["en", "el"];

function cat(over: Partial<GuardianCat> = {}): GuardianCat {
  return {
    id: 7,
    syr: "SYR-0007",
    name: "Pipitsa",
    description: "",
    lat: 37.445,
    lng: 24.942,
    colony: { id: 3, name: "Vaporia" },
    mainPhotoUrl: null,
    photoUrls: [],
    sterilised: { value: null, confidence: "unknown" },
    lifeStatus: null,
    lastSeen: null,
    coat: [],
    coatColours: ["ginger"],
    coatPattern: "stripes",
    markings: ["white_paws", "missing_eye"],
    ...over,
  };
}

const page = (c: GuardianCat, language = "en", live?: readonly Language[]) =>
  renderGuardianCatPage({ name: "Eleni", language }, c, [], live);

/** The facts block, where the coat line sits. */
const facts = (html: string) => html.slice(html.indexOf('<div class="gfacts">'), html.indexOf("</div>", html.indexOf('<div class="gfacts">')));

/** The coat line: the plain line straight after the position line, or null for none. */
function coatLine(html: string): string | null {
  const m = facts(html).match(/<p>[^<]*37\.44500, 24\.94200[^<]*<\/p>(?:<p>([^<]*)<\/p>)?/);
  if (!m) throw new Error("no position line");
  return m[1] ?? null;
}

/** Every old public coat word, in all three languages (SYC-436). */
const OLD_WORDS = [
  "Tortoiseshell or calico",
  "Χελωνόχρωμο ή τρίχρωμο",
  "Écaille de tortue ou calico",
  "Τιγρέ",
  "Tigré",
  "Ασπρόμαυρο",
  "tortoiseshell_or_calico",
  "black_and_white",
];

describe("a guardian's cat page says the coat in the team's words (SYC-443 PR 2)", () => {
  it("English: Ginger tabby, then the marks", () => {
    expect(coatLine(page(cat()))).toBe("Ginger tabby · White paws · One eye");
  });

  it("Greek live: §2's words for the known parts, and the marks in Greek", () => {
    const html = page(cat(), "el", GREEK_LIVE);
    expect(coatLine(html)).toBe("Πορτοκαλί · Ρίγες · Λευκά πόδια · Ένα μάτι");
    expect(html).not.toContain("tabby");
  });

  it("Greek asked for but not live: English, in the team's words", () => {
    expect(coatLine(page(cat(), "el"))).toBe("Ginger tabby · White paws · One eye");
  });

  it("a calico says Calico, never Tortoiseshell or calico, in any language", () => {
    const calico = cat({ coatColours: ["black", "ginger", "white"], coatPattern: "patches", markings: [] });
    expect(coatLine(page(calico))).toBe("Calico");
    for (const [lang, live] of [["en", undefined], ["el", GREEK_LIVE], ["fr", ["en", "fr"] as const]] as const) {
      const html = page(calico, lang, live);
      for (const old of OLD_WORDS) expect(html, `${lang}: ${old}`).not.toContain(old);
    }
  });

  it("reads the colours and pattern, never the old coat codes", () => {
    const html = page(cat({ coat: ["tortoiseshell_or_calico"], markings: [] }));
    expect(coatLine(html)).toBe("Ginger tabby");
    for (const old of OLD_WORDS) expect(html).not.toContain(old);
  });

  it("a part nobody has said is said out loud", () => {
    expect(coatLine(page(cat({ coatColours: ["black", "white"], coatPattern: null, markings: [] })))).toBe(
      "Black and white, pattern not known",
    );
  });

  it("an unknown coat shows only the marks", () => {
    for (const coatColours of [[], ["not_sure" as never]]) {
      const html = page(cat({ coatColours, coatPattern: null, markings: ["white_paws"] }));
      expect(coatLine(html)).toBe("White paws");
      expect(html).not.toMatch(/pattern not known|colours not known|>Not known</);
    }
    const greek = page(cat({ coatColours: [], coatPattern: null, markings: ["white_paws"] }), "el", GREEK_LIVE);
    expect(coatLine(greek)).toBe("Λευκά πόδια");
    expect(greek).not.toContain("Άγνωστο");
  });

  it("nothing known at all: no coat line", () => {
    const html = page(cat({ coatColours: [], coatPattern: null, markings: [] }));
    expect(coatLine(html)).toBeNull();
    expect(html).not.toContain("<p></p>");
  });
});
