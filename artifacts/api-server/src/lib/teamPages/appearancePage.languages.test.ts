import { describe, expect, it, vi } from "vitest";
import type { TeamAppearance, TeamAppearanceStatement, TeamCatView } from "../teamCatView";
import type { ColourCheckCat } from "../colourCheck";
import { renderAppearanceSection, renderColourCheckPage } from "./appearancePage";
import { drawnCaption } from "./coatDrawing";

// SYC-443 PR 1 (coat-colours-and-pattern.md §15.5, Decision T4A): the team's
// words are English only. A team page in Greek or French says the coat in
// §2's words, the Correct buttons included, and never an English team word.
// Team routes take no language, so this renders the Appearance section
// directly, with every language switched on as SYC-291's one-line change
// will (the pattern of routes/team.guardianLanguage.test.ts).

vi.mock("./strings", async (importOriginal) => {
  const real = await importOriginal<typeof import("./strings")>();
  const ALL = ["en", "el", "fr"] as const;
  return {
    ...real,
    LIVE_LANGUAGES: ALL,
    pageLanguage: (r: string | null | undefined, live: readonly string[] = ALL) => real.pageLanguage(r, live as never),
    tr: (r: string | null | undefined, k: never, v?: Record<string, string>, live: readonly string[] = ALL) =>
      real.tr(r, k, v, live as never),
  };
});

const statement = (over: Partial<TeamAppearanceStatement>): TeamAppearanceStatement => ({
  id: 50,
  codes: ["brown", "ginger", "stripes"],
  author: { kind: "team", label: "Maria" },
  source: "team",
  prompted: false,
  agreesWith: null,
  createdAt: "2026-09-01T10:00:00Z",
  photoUrl: null,
  modelVersion: null,
  counts: true,
  markable: true,
  ...over,
});

const none: TeamAppearance = {
  value: null,
  confidence: "unknown",
  checkReasons: [],
  statements: [],
  guardianDecides: false,
  aboveTeamIds: [],
  guardianDisagrees: false,
};

const coat: TeamAppearance = {
  ...none,
  value: ["brown", "ginger", "stripes"],
  confidence: "confirmed",
  parts: {
    colours: { value: ["brown", "ginger"], confidence: "confirmed" },
    pattern: { value: "stripes", confidence: "confirmed" },
  },
  statements: [statement({}), statement({ id: 51, codes: ["stripes"] })],
};

function view(): TeamCatView {
  return {
    cat: {
      id: 7,
      syr: "SYR-0007",
      name: "Tiger",
      description: "",
      lat: 37.4447,
      lng: 24.9418,
      createdAt: "2026-01-01T10:00:00Z",
      mainPhotoUrl: null,
    },
    owner: { has: false, orphanedHome: false, homeDescription: null, homePin: null },
    colony: null,
    publicStatus: {
      hasHome: false,
      lifeStatus: "street",
      notSeenSince: null,
      sterilised: { value: null, confidence: "unknown", clippedTipSightings: 0 },
      coat: ["ginger", "tabby"],
      coatColours: ["brown", "ginger"],
      coatPattern: "stripes",
      markings: [],
    },
    records: {
      lifeStatus: {
        value: "street",
        confidence: "unknown",
        asOf: "2026-03-01T10:00:00Z",
        supportingStatementIds: [],
        conflictingStatementIds: [],
        presumedDeceased: false,
        notSeenSince: null,
      },
      sterilised: {
        value: null,
        confidence: "unknown",
        asOf: "2026-03-01T10:00:00Z",
        supportingStatementIds: [],
        conflictingStatementIds: [],
        clippedTipSightings: 0,
      },
      vaccinations: [],
    },
    appearance: { coat, markings: none, handPick: false },
    sightings: [],
    photos: [],
    history: [],
    recentGuardianMark: null,
  } as TeamCatView;
}

const ENGLISH_TEAM_WORDS = /tabby|tortoiseshell|calico|solid|patched|not stated|not known|\bCoat\b/gi;
/** Each English team word in the page, with a little context, so a failure names it. */
const englishIn = (html: string) => {
  // The words a person reads: tags (CSS, form codes like value="coat") removed; the drawn caption is in its <title>.
  const text = html.replace(/<[^>]*>/g, " ");
  return [...text.matchAll(ENGLISH_TEAM_WORDS)].map((m) => text.slice(Math.max(0, m.index - 30), m.index + 20));
};

const render = (lang: string) => renderAppearanceSection(view(), () => true, "a_coat_corrected", lang);

describe("T4A: the Appearance section in Greek and French says §2's words", () => {
  it("English, for comparison: the team's words", () => {
    const html = render("en");
    expect(html).toContain("<h3>Coat</h3>");
    expect(html).toContain("Pattern</dt><dd>Tabby");
    expect(html).toContain("Tabby (stripes, swirls or spots)");
    expect(html).toContain("<strong>Brown and ginger tabby</strong>");
    expect(html).toContain("Tabby, colours not stated");
    expect(html).toContain('<p class="public">Brown · Ginger · Stripes</p>');
    // The check the Greek and French pages must pass does find the English words.
    expect(englishIn(html).length).toBeGreaterThan(5);
  });

  it("Greek: Χρώμα, Ρίγες, the drawn cat and statements in §2's words, the buttons without hints", () => {
    const html = render("el");
    expect(html).toContain("<h3>Χρώμα</h3>");
    expect(html).toContain("<dd>Ρίγες");
    expect(html).toContain("<strong>Καφέ · Πορτοκαλί · Ρίγες</strong>");
    expect(html).toContain('aria-label="Καφέ · Πορτοκαλί · Ρίγες"');
    // A statement says only the parts it states, as before SYC-443 (review finding 2).
    expect(html).toContain('<span class="sid">#51</span> Ρίγες <');
    expect(html).not.toContain("Χρώματα άγνωστα · Ρίγες");
    for (const [code, word] of [["plain", "Ενιαίο"], ["stripes", "Ρίγες"], ["patches", "Μπαλώματα"], ["none", "Δεν δηλώθηκε"]]) {
      expect(html).toContain(`name="pattern" value="${code}"${code === "none" ? " checked" : ""}> ${word}</label>`);
    }
    expect(englishIn(html)).toEqual([]);
  });

  it("French: Couleur, Rayures, the drawn cat and statements in §2's words, the buttons without hints", () => {
    const html = render("fr");
    expect(html).toContain("<h3>Couleur</h3>");
    expect(html).toContain("<dd>Rayures");
    expect(html).toContain("<strong>Brun · Roux · Rayures</strong>");
    for (const word of ["Uni", "Rayures", "Plaques"]) expect(html).toContain(`> ${word}</label>`);
    expect(englishIn(html)).toEqual([]);
  });

  it("the drawn caption and the Colour check line follow the page's language", () => {
    expect(drawnCaption("el", { colours: ["black", "ginger", "white"], pattern: "patches" })).toBe("Μαύρο · Πορτοκαλί · Λευκό · Μπαλώματα");
    expect(drawnCaption("en", { colours: ["black", "ginger", "white"], pattern: "patches" })).toBe("Calico");
    // The drawn caption keeps its own wording for an unknown part, as before SYC-443.
    expect(drawnCaption("el", { colours: null, pattern: "stripes" })).toBe("Χρώματα άγνωστα · Ρίγες");
    expect(drawnCaption("fr", { colours: ["grey"], pattern: null })).toBe("Gris · Motif inconnu");
    const cat = {
      catId: 7,
      name: "Tiger",
      syr: "SYR-0007",
      photoUrl: null,
      coatColours: ["ginger"],
      coatPattern: "stripes",
      markings: [],
      reasons: ["spotters_disagree"],
      group: "check",
      above: { coat: [], markings: [] },
    } as unknown as ColourCheckCat;
    const el = renderColourCheckPage([cat], "Susan", undefined, "el");
    expect(el).toContain("Χρώμα: Πορτοκαλί · Ρίγες");
    expect(el).not.toMatch(/tabby/i);
    expect(renderColourCheckPage([cat], "Susan", undefined, "en")).toContain("Coat: Ginger tabby");
  });
});
