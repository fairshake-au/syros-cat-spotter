import { describe, expect, it } from "vitest";
import type { TeamAppearance, TeamAppearanceStatement, TeamCatView, TeamStatement } from "../teamCatView";
import { catFacts, healthNoteOf, renderCatFacts, type Shown } from "./catFacts";
import { catView, richCatView, statement } from "./__fixtures__/catView";
import { renderCatPage } from "./catPages";

// The facts row at the top of the team cat page (SYC-396 spec §7.1, plan Task
// 1.4.1). Each value says its own uncertainty in words; there is no
// confidence tag beside it.

const NOW = new Date("2026-10-17T09:00:00Z");

/** What renderCatPage hands the facts: the history by id, and every statement shown. */
const optsFor = (v: TeamCatView): { byId: Map<number, import("../teamCatView").TeamStatement>; shown: Shown } => ({
  byId: new Map(v.history.map((h) => [h.id, h])),
  shown: null,
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
    catFacts(v, NOW, optsFor(v)).map((f) => [
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
    const v2 = view({ sterilised: { value: true, confidence: "likely", clippedTipSightings: 2 } });
    const html = catFacts(v2, NOW, optsFor(v2))[0]!.html;
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

describe("the facts row: coat (SYC-443: the team's words, one chip)", () => {
  it("from the machine: the colours plus the pattern, read from the photo, linking to Appearance", () => {
    const v = view({ coat: greyStripes([coatStatement({})]) });
    expect(facts(v)["Coat"]).toBe("Grey tabby read from the photo");
    const html = catFacts(v, NOW, optsFor(v)).find((f) => f.label === "Coat")!.html;
    expect(html).toContain('href="#appearance"');
    expect(html).toContain('<a href="#appearance"><span class="colourchip">Grey tabby</span></a>');
    expect(html.match(/class="colourchip"/g)).toHaveLength(1);
    expect(catFacts(v, NOW, optsFor(v)).some((f) => f.label === "Colour")).toBe(false);
  });

  it("from a team member: set by their name, ahead of the machine", () => {
    const v = view({
      coat: greyStripes([
        coatStatement({ id: 51, source: "team", author: { kind: "team", label: "Maria" } }),
        coatStatement({}),
      ]),
    });
    expect(facts(v)["Coat"]).toBe("Grey tabby set by Maria");
  });

  it("names whoever decided the colours, not whoever added the pattern (review finding 5)", () => {
    const coat = greyStripes([
      coatStatement({ id: 61, source: "team", author: { kind: "team", label: "Maria" } }),
      coatStatement({ id: 60 }),
    ]);
    coat.parts!.colours.supportingStatementIds = [60];
    coat.parts!.pattern.supportingStatementIds = [61];
    expect(facts(view({ coat }))["Coat"]).toBe("Grey tabby read from the photo");
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
    expect(facts(v)["Coat"]).toBe("Grey tabby");
  });

  it("a Solid one-colour cat is just its colour; nothing known is Not known", () => {
    const plain: TeamAppearance = {
      ...greyStripes([coatStatement({})]),
      parts: { colours: { value: ["black"], confidence: "likely" }, pattern: { value: "plain", confidence: "likely" } },
    };
    expect(facts(view({ coat: plain }))["Coat"]).toBe("Black read from the photo");
    expect(facts(view())["Coat"]).toBe("Not known");
  });

  it("an unknown part is said out loud, never hidden", () => {
    const noPattern: TeamAppearance = {
      ...greyStripes([coatStatement({})]),
      parts: { colours: { value: ["black", "white"], confidence: "likely" }, pattern: { value: null, confidence: "unknown" } },
    };
    expect(facts(view({ coat: noPattern }))["Coat"]).toBe("Black and white, pattern not known read from the photo");
  });
});

describe("the facts row: colony and last seen", () => {
  it("the colony by name, with a link; or No colony", () => {
    const v = view({ colony: { id: 4, name: "Vaporia steps", wasName: null } });
    expect(catFacts(v, NOW, optsFor(v)).find((f) => f.label === "Colony")!.html).toBe(
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

  it("is headed by What we know about this cat, with no separate evidence section", () => {
    expect(html.indexOf('class="catfacts"')).toBeGreaterThan(-1);
    expect(html).toContain('<h2 class="sr">What we know about this cat</h2>');
    expect(html).not.toContain('<details class="evidence"');
  });

  it("no confidence pill sits beside a sterilised or life value anywhere on the page", () => {
    const row = /<dl class="catfacts">[\s\S]*?<\/dl>/.exec(html)![0];
    expect(row).not.toContain('class="tag"');
    // (The Appearance section, SYC-398's, keeps its own levels.)
  });

  it("keeps #192's words", () => {
    expect(html).toContain("What we know about this cat");
    expect(html).toContain("<summary>Update this cat</summary>");
  });

  it("What the public sees is one line under the facts", () => {
    expect(html.indexOf('class="publicline"')).toBeGreaterThan(html.indexOf('class="catfacts"'));
    expect(html).not.toContain("<h2>What the public sees</h2>");
  });
});

describe("the facts panel: sources, Owner and Why we think so (SYC-602 PR 1)", () => {
  const withLife = (author: TeamStatement["author"]) =>
    view({
      life: { value: "street", supportingStatementIds: [5], asOf: "2026-10-14T09:00:00Z" },
      history: [statement(5, { kind: "life_status", author, createdAt: "2026-10-14T09:00:00Z" })],
    });
  const fact = (v: TeamCatView, label: string) => catFacts(v, NOW, optsFor(v)).find((f) => f.label === label);

  it("gives Lives a source line naming who set it", () => {
    expect(fact(withLife({ kind: "team", label: "Maria" }), "Lives")!.source).toBe("Set by Maria, 14 Oct 2026");
    expect(fact(withLife({ kind: "spotter", label: "a spotter" }), "Lives")!.source).toBe("Set by a spotter");
    expect(fact(view(), "Lives")!.source).toBe("Worked out from the sightings");
  });

  const sightingsFrom = (n: number, oldest: string): TeamCatView["sightings"] =>
    Array.from({ length: n }, (_, i) => ({
      id: 100 - i,
      lat: 37.4447,
      lng: 24.9418,
      at: i === n - 1 ? oldest : "2026-10-10T08:00:00Z",
      photoUrl: null,
      extraPhotos: [],
      mixedCats: false,
    }));

  it("gives Last seen a count since the first sighting", () => {
    expect(fact(view({ sightings: sightingsFrom(21, "2026-04-02T08:00:00Z") }), "Last seen")!.source).toBe(
      "Seen 21 times since April",
    );
    expect(fact(view({ sightings: sightingsFrom(21, "2025-11-02T08:00:00Z") }), "Last seen")!.source).toBe(
      "Seen 21 times since Nov 2025",
    );
    expect(fact(view({ sightings: sightingsFrom(1, "2026-10-10T08:00:00Z") }), "Last seen")!.source).toBe("Seen once");
    expect(fact(view(), "Last seen")!.source).toBeUndefined();
  });

  it("shows an Owner row only when there is an owner or an orphaned home", () => {
    const owned = catView({ owner: { has: true, homeDescription: "Second floor, Vaporia" } });
    const o = fact(owned, "Owner")!;
    expect(o.html).toContain("Has an owner");
    expect(o.html).toContain("Second floor, Vaporia");
    const orphaned = catView({
      owner: { orphanedHome: true, homeDescription: "Blue door", homePin: { lat: 37.4447, lng: 24.9418 } },
    });
    expect(fact(orphaned, "Owner")!.html).toContain("Has a home, but the owner deleted their data");
    expect(fact(orphaned, "Owner")!.html).toContain("Home pin");
    expect(fact(catView(), "Owner")).toBeUndefined();
  });

  it("puts Why we think so under Sterilised and Lives, linking into History", () => {
    const v = richCatView();
    const why = fact(v, "Sterilised")!.why!;
    expect(why).toContain("<summary>Why we think so</summary>");
    expect(why).toContain("Since");
    expect(why).toContain('href="#s-298"');
    expect(why).toContain(">Sterilised at Syros Vet</a>");
    expect(why).not.toContain("#298");
    expect(why).not.toContain("Says otherwise");
    expect(fact(v, "Lives")!.why).toContain('href="#s-301"');
    const conflicted = catView({
      records: { sterilised: { value: true, confidence: "reported", conflictingStatementIds: [8] } },
      history: [statement(8, { said: "Not sterilised" })],
    });
    expect(fact(conflicted, "Sterilised")!.why).toContain("Says otherwise");
    expect(fact(conflicted, "Sterilised")!.why).toContain('href="#s-8"');
    const epoch = catView({ records: { sterilised: { asOf: "1970-01-01T00:00:00Z" } } });
    expect(fact(epoch, "Sterilised")!.why).not.toContain("Since");
  });

  it("links to the full history when the statement is not among those shown", () => {
    const v = richCatView();
    const f = catFacts(v, NOW, { byId: optsFor(v).byId, shown: new Set([301]) }).find((x) => x.label === "Sterilised")!;
    expect(f.why).toContain('href="?history=all#s-298"');
  });

  it("keeps the colony's old name", () => {
    const v = catView({ colony: { id: 4, name: "Vaporia steps", wasName: "Vaporia" } });
    expect(fact(v, "Colony")!.html).toContain("(was “Vaporia”)");
  });

  it("keeps the cat guardian's confirmation line under Sterilised", () => {
    const v = view({
      sterilised: { value: true, confidence: "confirmed", asOf: "2026-10-14T09:00:00Z", supportingStatementIds: [3] },
      history: [statement(3, { kind: "sterilised", asGuardian: true, author: { kind: "team", label: "Eleni" } })],
    });
    const why = fact(v, "Sterilised")!.why!;
    expect(why).toContain("Confirmed by");
    expect(why).toContain("Eleni, cat guardian");
    expect(why).toContain("This is wrong?");
  });

  it("keeps the clipped-ear count, the presumed-dead note and where the cat was first recorded", () => {
    const v = view({
      sterilised: { clippedTipSightings: 2 },
      life: { presumedDeceased: true, notSeenSince: "2023-01-01T00:00:00Z" },
    });
    expect(fact(v, "Sterilised")!.why).toContain("Seen in 2 sightings");
    expect(fact(v, "Lives")!.why).toContain("Not seen for over three years");
    expect(fact(v, "Lives")!.why).toContain("First recorded in ");
  });

  it("gives the Sterilised and Lives folds the old Status row, in the old words", () => {
    const cases: [boolean | null, "unknown" | "reported" | "likely" | "confirmed", string][] = [
      [null, "unknown", "Not known yet"],
      [true, "likely", "Probably sterilised"],
      [true, "reported", "Reported sterilised"],
      [true, "confirmed", "Sterilised"],
      [false, "reported", "Reported not sterilised"],
      [false, "confirmed", "Not sterilised"],
    ];
    for (const [value, confidence, words] of cases) {
      const why = fact(view({ sterilised: { value, confidence } }), "Sterilised")!.why!;
      expect(why, words).toContain(`<dt>Status</dt><dd>${words}</dd>`);
    }
    // The fact's own words are untouched: a bare report still reads Not known.
    expect(facts(view({ sterilised: { value: true, confidence: "reported" } }))["Sterilised"]).toBe("Not known");
    expect(fact(view({ life: { value: "homed" } }), "Lives")!.why).toContain("<dt>Status</dt><dd>Has a home</dd>");
    expect(fact(view({ life: { value: null } }), "Lives")!.why).toContain("<dt>Status</dt><dd>Not known</dd>");
  });

  it("opens the Lives fold when the answer is disputed, and not otherwise", () => {
    const disputed = view({
      life: { value: "street", supportingStatementIds: [5], conflictingStatementIds: [6] },
      history: [statement(5, { kind: "life_status" }), statement(6, { kind: "life_status", said: "Has a home" })],
    });
    expect(fact(disputed, "Lives")!.why).toContain('<details class="why" open>');
    expect(fact(view(), "Lives")!.why).toContain('<details class="why">');
  });

  it("never says statement in the words of a link to a change left out of the history", () => {
    const v = view({ life: { supportingStatementIds: [999] } });
    const why = fact(v, "Lives")!.why!;
    expect(why).toContain("An earlier change");
    expect(why.replace(/<[^>]*>/g, " ").toLowerCase()).not.toContain("statement");
  });

  it("renders each fact as a row, with its source and its Why we think so", () => {
    const v = richCatView();
    const html = renderCatFacts(v, NOW, optsFor(v));
    expect(html).toContain('<h2 class="sr">What we know about this cat</h2>');
    expect(html).toContain('<dl class="catfacts">');
    expect(html).toContain('<span class="how">Seen 21 times since April</span>');
    expect(html).toContain('<details class="why"><summary>Why we think so</summary>');
    expect(html).not.toContain("<script");
  });
});

describe("the facts row: Health note (SYC-602 spec §3.1, §3.2 item 3)", () => {
  const note = (id: number, text: string, over: Partial<TeamStatement> = {}) =>
    statement(id, {
      kind: "team_note",
      said: `Note (team only): “${text}”`,
      noteText: text,
      createdAt: `2026-10-0${id}T10:00:00Z`,
      observedAt: `2026-10-0${id}T10:00:00Z`,
      ...over,
    });

  it("is left out when the cat has no standing note", () => {
    expect(facts(view())["Health note"]).toBeUndefined();
    expect(healthNoteOf(view())).toBeNull();
  });

  it("shows the note's text, with 'Maria, 2 Oct 2026 · team only' under it", () => {
    const v = view({ history: [note(2, "Limping on the left.")] });
    expect(facts(v)["Health note"]).toBe("Limping on the left.");
    const fact = catFacts(v, NOW, optsFor(v)).find((f) => f.label === "Health note");
    expect(fact?.source).toBe("Maria, 2 Oct 2026 · team only");
  });

  it("the newest standing note wins", () => {
    const v = view({ history: [note(3, "Newer"), note(2, "Older")] });
    expect(healthNoteOf(v)?.id).toBe(3);
    expect(facts(v)["Health note"]).toBe("Newer");
  });

  it("a note marked wrong drops out and the next older standing one shows", () => {
    const retraction = note(4, "", { said: "Marked wrong", noteText: undefined, replaces: 3 });
    const v = view({ history: [retraction, note(3, "Newer", { replacedBy: [4] }), note(2, "Older")] });
    expect(healthNoteOf(v)?.id).toBe(2);
    expect(facts(v)["Health note"]).toBe("Older");
  });

  it("a retraction row is never the note, and with every note marked wrong the fact goes", () => {
    const retraction = note(3, "", { said: "Marked wrong", noteText: undefined, replaces: 2 });
    const v = view({ history: [retraction, note(2, "Gone", { replacedBy: [3] })] });
    expect(healthNoteOf(v)).toBeNull();
    expect(facts(v)["Health note"]).toBeUndefined();
  });

  it("escapes the text everywhere, and keeps line breaks", () => {
    const v = view({ history: [note(2, '<script>alert("x")</script> & more\nsecond line')] });
    const html = renderCatFacts(v, NOW, optsFor(v));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; more<br>second line");
  });

  it("an author who has left, or is a deleted person, is named as the history names them", () => {
    const v = view({ history: [note(2, "Hi", { author: { kind: "team", label: "Maria (left)" } })] });
    expect(catFacts(v, NOW, optsFor(v)).find((f) => f.label === "Health note")?.source).toBe(
      "Maria (left), 2 Oct 2026 · team only",
    );
  });

  it("the page draws it in the facts panel", () => {
    const v = view({ history: [note(2, "Limping on the left.")] });
    expect(renderCatFacts(v, NOW, optsFor(v))).toContain("<dt>Health note</dt>");
  });
});

describe("the page shows team notes only to someone who may add one (spec §3.2 item 3)", () => {
  const withNote = view({
    history: [
      statement(2, {
        kind: "team_note",
        said: "Note (team only): “Secret health words”",
        noteText: "Secret health words",
      }),
    ],
  });

  it("draws the Health note and the history row for add_team_note", () => {
    const html = renderCatPage(withNote, "Maria", { now: NOW, may: (c) => c === "add_team_note" });
    expect(html).toContain("<dt>Health note</dt>");
    expect(html).toContain("Secret health words");
  });

  it("draws neither, anywhere, for a viewer without it", () => {
    const html = renderCatPage(withNote, "Maria", { now: NOW, may: (c) => c !== "add_team_note" });
    expect(html).not.toContain("Secret health words");
    expect(html).not.toContain("Health note");
    expect(html).not.toContain("team only");
    expect(renderCatPage(withNote, "Maria", { now: NOW })).not.toContain("Secret health words");
  });
});
