import { describe, expect, it } from "vitest";
import type { TeamAppearance, TeamAppearanceStatement, TeamCatView, TeamStatement } from "../teamCatView";
import { catFacts } from "./catFacts";
import { renderCatPage } from "./catPages";

// The facts row at the top of the team cat page (SYC-396 spec §7.1, plan Task
// 1.4.1). Each value says its own uncertainty in words; there is no
// confidence tag beside it.

const NOW = new Date("2026-10-17T09:00:00Z");

const statement = (id: number, over: Partial<TeamStatement> = {}): TeamStatement => ({
  id,
  kind: "note",
  said: `Said ${id}`,
  reason: null,
  author: { kind: "team", label: "Maria" },
  observedAt: "2026-03-01T10:00:00Z",
  createdAt: "2026-03-01T10:00:00Z",
  asGuardian: false,
  replaces: null,
  replacedBy: [],
  movedTo: null,
  ownerClaim: false,
  movedFrom: null,
  photoUrl: null,
  sightingId: null,
  correction: null,
  ...over,
});

const appearanceNone: TeamAppearance = {
  value: null,
  confidence: "unknown",
  checkReasons: [],
  statements: [],
  guardianDecides: false,
  aboveTeamIds: [],
  guardianDisagrees: false,
};

const coatStatement = (over: Partial<TeamAppearanceStatement>): TeamAppearanceStatement => ({
  id: 50,
  codes: ["grey", "stripes"],
  author: { kind: "system", label: "read automatically from the photo" },
  source: "machine",
  prompted: false,
  agreesWith: null,
  createdAt: "2026-09-01T10:00:00Z",
  photoUrl: null,
  modelVersion: null,
  counts: true,
  markable: true,
  ...over,
});

const greyStripes = (statements: TeamAppearanceStatement[]): TeamAppearance => ({
  ...appearanceNone,
  value: ["grey", "stripes"],
  confidence: "likely",
  parts: {
    colours: { value: ["grey"], confidence: "likely" },
    pattern: { value: "stripes", confidence: "likely" },
  },
  statements,
});

interface Over {
  sterilised?: Partial<TeamCatView["records"]["sterilised"]>;
  life?: Partial<TeamCatView["records"]["lifeStatus"]>;
  coat?: TeamAppearance;
  colony?: TeamCatView["colony"];
  sightings?: TeamCatView["sightings"];
  history?: TeamStatement[];
  vaccinations?: TeamCatView["records"]["vaccinations"];
}

function factsView(o: Over = {}): TeamCatView {
  const base = {
    value: null,
    confidence: "unknown" as const,
    asOf: "2026-03-01T10:00:00Z",
    supportingStatementIds: [],
    conflictingStatementIds: [],
  };
  return {
    cat: {
      id: 7,
      syr: "SYR-0007",
      name: "Tiger",
      description: "",
      // Ermoupoli's harbour.
      lat: 37.4447,
      lng: 24.9418,
      createdAt: "2026-01-01T10:00:00Z",
      mainPhotoUrl: null,
    },
    owner: { has: false, orphanedHome: false, homeDescription: null, homePin: null },
    colony: o.colony ?? null,
    publicStatus: {
      hasHome: false,
      lifeStatus: "street",
      notSeenSince: null,
      sterilised: { value: null, confidence: "unknown", clippedTipSightings: 0 },
      coat: [],
      coatColours: [],
      coatPattern: null,
      markings: [],
    },
    records: {
      lifeStatus: { ...base, value: "street", presumedDeceased: false, notSeenSince: null, ...o.life },
      sterilised: { ...base, clippedTipSightings: 0, ...o.sterilised },
      vaccinations: o.vaccinations ?? [],
    },
    appearance: { coat: o.coat ?? appearanceNone, markings: appearanceNone, handPick: false },
    sightings: o.sightings ?? [],
    photos: [],
    history: o.history ?? [],
    recentGuardianMark: null,
  };
}
const view = factsView;

/** The facts as plain text, tags stripped, by label. */
function facts(v: TeamCatView): Record<string, string> {
  return Object.fromEntries(
    catFacts(v, NOW).map((f) => [
      f.label,
      f.html
        .replace(/<br>/g, " | ")
        .replace(/<[^>]*>/g, "")
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim(),
    ]),
  );
}

describe("the facts row: sterilised (spec §7.1)", () => {
  it("confirmed by the team: Yes, confirmed by Syros Cats, with the date", () => {
    const v = view({
      sterilised: { value: true, confidence: "confirmed", asOf: "2026-08-13T09:00:00Z", supportingStatementIds: [3] },
      history: [statement(3, { kind: "sterilised" })],
    });
    expect(facts(v)["Sterilised"]).toBe("Yes, confirmed by Syros Cats, 13 Aug 2026");
  });

  it("confirmed by a cat guardian says whose word it is", () => {
    const v = view({
      sterilised: { value: true, confidence: "confirmed", asOf: "2026-10-14T09:00:00Z", supportingStatementIds: [3] },
      history: [statement(3, { kind: "sterilised", asGuardian: true, author: { kind: "team", label: "Eleni" } })],
    });
    expect(facts(v)["Sterilised"]).toBe("Yes, confirmed by Eleni, cat guardian, 14 Oct 2026");
  });

  it("likely, with a clipped ear in 3 photos: Probably: clipped ear seen in 3 photos", () => {
    const v = view({ sterilised: { value: true, confidence: "likely", clippedTipSightings: 3 } });
    expect(facts(v)["Sterilised"]).toBe("Probably: clipped ear seen in 3 photos");
  });

  it("one photo is singular", () => {
    const v = view({ sterilised: { value: true, confidence: "likely", clippedTipSightings: 1 } });
    expect(facts(v)["Sterilised"]).toBe("Probably: clipped ear seen in 1 photo");
  });

  it("confirmed not sterilised: No, Syros Cats' records", () => {
    const v = view({
      sterilised: { value: false, confidence: "confirmed", supportingStatementIds: [3] },
      history: [statement(3)],
    });
    expect(facts(v)["Sterilised"]).toBe("No, Syros Cats' records");
  });

  it("unknown, and a bare report, are both Not known (the same as the Cats grid's badge)", () => {
    expect(facts(view())["Sterilised"]).toBe("Not known");
    expect(facts(view({ sterilised: { value: true, confidence: "reported" } }))["Sterilised"]).toBe("Not known");
  });

  it("carries the sterilisation mark's shape, never colour alone (§12.2)", () => {
    const html = catFacts(view({ sterilised: { value: true, confidence: "likely", clippedTipSightings: 2 } }), NOW)[0]!
      .html;
    expect(html).toContain('class="mark mark-probably"');
    expect(html).toContain("<svg");
  });
});

describe("the facts row: lives", () => {
  it("in the Cats grid's words", () => {
    expect(facts(view())["Lives"]).toBe("On the street");
    expect(facts(view({ life: { value: "homed" } }))["Lives"]).toBe("Has a home");
    expect(facts(view({ life: { value: "in_care" } }))["Lives"]).toBe("In care");
    expect(facts(view({ life: { value: null } }))["Lives"]).toBe("Not known");
  });

  it("presumed deceased: Probably no longer with us, and Not seen since with month and year", () => {
    const v = view({ life: { value: "street", presumedDeceased: true, notSeenSince: "2026-06-12T08:00:00Z" } });
    expect(facts(v)["Lives"]).toBe("Probably no longer with us | Not seen since Jun 2026");
  });

  it("recorded as no longer with us says so plainly", () => {
    expect(facts(view({ life: { value: "deceased" } }))["Lives"]).toBe("No longer with us");
  });
});

describe("the facts row: colour", () => {
  it("from the machine: the colours plus the pattern, read from the photo, linking to Appearance", () => {
    const v = view({ coat: greyStripes([coatStatement({})]) });
    expect(facts(v)["Colour"]).toBe("Grey Stripes read from the photo");
    const html = catFacts(v, NOW).find((f) => f.label === "Colour")!.html;
    expect(html).toContain('href="#appearance"');
    expect(html).toContain('<span class="colourchip">Grey</span>');
  });

  it("from a team member: set by their name, ahead of the machine", () => {
    const v = view({
      coat: greyStripes([
        coatStatement({ id: 51, source: "team", author: { kind: "team", label: "Maria" } }),
        coatStatement({}),
      ]),
    });
    expect(facts(v)["Colour"]).toBe("Grey Stripes set by Maria");
  });

  it("names whoever decided the colours, not whoever added the pattern (review finding 5)", () => {
    const coat = greyStripes([
      coatStatement({ id: 61, source: "team", author: { kind: "team", label: "Maria" } }),
      coatStatement({ id: 60 }),
    ]);
    coat.parts!.colours.supportingStatementIds = [60];
    coat.parts!.pattern.supportingStatementIds = [61];
    expect(facts(view({ coat }))["Colour"]).toBe("Grey Stripes read from the photo");
  });

  it("a cat guardian who has since deleted their details is never named by that phrase", () => {
    const v = view({
      sterilised: { value: true, confidence: "confirmed", asOf: "2026-10-14T09:00:00Z", supportingStatementIds: [3] },
      history: [
        statement(3, {
          kind: "sterilised",
          asGuardian: true,
          author: { kind: "deleted", label: "someone who has since deleted their details" },
        }),
      ],
    });
    expect(facts(v)["Sterilised"]).toBe("Yes, confirmed by a cat guardian, 14 Oct 2026");
  });

  it("a statement that no longer counts names nobody", () => {
    const v = view({
      coat: greyStripes([coatStatement({ source: "team", author: { kind: "team", label: "Maria" }, counts: false })]),
    });
    expect(facts(v)["Colour"]).toBe("Grey Stripes");
  });

  it("Plain is not a chip; nothing known is Not known", () => {
    const plain: TeamAppearance = {
      ...greyStripes([coatStatement({})]),
      parts: { colours: { value: ["black"], confidence: "likely" }, pattern: { value: "plain", confidence: "likely" } },
    };
    expect(facts(view({ coat: plain }))["Colour"]).toBe("Black read from the photo");
    expect(facts(view())["Colour"]).toBe("Not known");
  });
});

describe("the facts row: colony and last seen", () => {
  it("the colony by name, with a link; or No colony", () => {
    const v = view({ colony: { id: 4, name: "Vaporia steps", wasName: null } });
    expect(catFacts(v, NOW).find((f) => f.label === "Colony")!.html).toBe(
      '<a href="/api/team/colonies/4">Vaporia steps</a>',
    );
    expect(facts(view())["Colony"]).toBe("No colony");
  });

  it("last seen: 3 days ago · the named area, never a position", () => {
    const v = view({
      sightings: [
        { id: 9, lat: 37.4447, lng: 24.9418, at: "2026-10-14T08:00:00Z", photoUrl: null, extraPhotos: [], mixedCats: false },
      ],
    });
    const seen = facts(v)["Last seen"]!;
    expect(seen).toMatch(/^3 days ago · [A-Z][a-z]+/);
    expect(seen).not.toMatch(/\d+\.\d{3}/);
  });

  it("never seen: says so, with where it was first recorded", () => {
    expect(facts(view())["Last seen"]).toMatch(/^Never seen since first recorded · [A-Z]/);
  });
});

describe("the facts row: vaccinated", () => {
  it("only where recorded", () => {
    expect(facts(view())["Vaccinated"]).toBeUndefined();
    const v = view({
      vaccinations: [
        { observationId: 1, date: "2026-05-02T00:00:00Z", vaccines: ["rabies", { other: "FeLV" }], clinic: null },
      ],
    });
    expect(facts(v)["Vaccinated"]).toBe("Rabies, FeLV, 2 May 2026");
  });
});

describe("the facts row on the page", () => {
  const v = view({
    sterilised: { value: true, confidence: "likely", clippedTipSightings: 3 },
    coat: greyStripes([coatStatement({})]),
  });
  const html = renderCatPage(v, "Sam", { may: () => true, now: NOW });

  it("sits above the evidence", () => {
    expect(html.indexOf('class="catfacts"')).toBeGreaterThan(-1);
    expect(html.indexOf('class="catfacts"')).toBeLessThan(html.indexOf("What we know about this cat"));
  });

  it("no confidence pill sits beside a sterilised or life value anywhere on the page", () => {
    const row = /<dl class="catfacts">[\s\S]*?<\/dl>/.exec(html)![0];
    expect(row).not.toContain('class="tag"');
    // The evidence's Life and Sterilised Status rows say it in words, with no
    // tag. (The Appearance section, SYC-398's, keeps its own levels.)
    const known = /<details class="evidence"[\s\S]*?<\/details>/.exec(html)![0];
    const statuses = [...known.matchAll(/<dt>Status<\/dt><dd>([\s\S]*?)<\/dd>/g)];
    expect(statuses).toHaveLength(2);
    for (const m of statuses) expect(m[1]).not.toContain('class="tag"');
  });

  it("keeps #192's words", () => {
    expect(html).toContain("What we know about this cat");
    expect(html).toContain(">Update this cat</h2>");
  });

  it("What the public sees is one line under the facts", () => {
    expect(html.indexOf('class="publicline"')).toBeGreaterThan(html.indexOf('class="catfacts"'));
    expect(html).not.toContain("<h2>What the public sees</h2>");
  });
});
