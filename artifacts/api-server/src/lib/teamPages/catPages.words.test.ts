import { describe, expect, it } from "vitest";
import type { TeamCatView, TeamStatement } from "../teamCatView";
import { renderCatPage } from "./catPages";
import { renderDiedPage } from "./diedPage";

const appearanceNone = {
  value: null,
  confidence: "unknown" as const,
  checkReasons: [],
  statements: [],
  guardianDecides: false,
  aboveTeamIds: [],
  guardianDisagrees: false,
};

// SYC-362 D3: the old words must not come back on the team cat page.

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

function ownedCatView(): TeamCatView {
  const resolved = (ids: number[], conflicting: number[]) => ({
    value: null,
    confidence: "unknown" as const,
    asOf: "2026-03-01T10:00:00Z",
    supportingStatementIds: ids,
    conflictingStatementIds: conflicting,
  });
  return {
    cat: {
      id: 7,
      syr: "SYR-0007",
      name: "Tiger",
      description: "",
      lat: 37.44,
      lng: 24.94,
      createdAt: "2026-01-01T10:00:00Z",
      mainPhotoUrl: null,
    },
    owner: { has: true, orphanedHome: false, homeDescription: "Near the port", homePin: null },
    colony: null,
    publicStatus: {
      hasHome: true,
      lifeStatus: "street",
      notSeenSince: null,
      sterilised: { value: null, confidence: "unknown", clippedTipSightings: 0 },
      coat: [],
      coatColours: [],
      coatPattern: null,
      markings: [],
    },
    records: {
      lifeStatus: { ...resolved([1], [2]), presumedDeceased: false, notSeenSince: null },
      sterilised: { ...resolved([1], [2]), clippedTipSightings: 0 },
      vaccinations: [],
    },
    // SYC-2 PR 3.1: no colour or markings known.
    appearance: {
      coat: appearanceNone,
      markings: appearanceNone,
      handPick: false,
    },
    sightings: [],
    photos: [],
    history: [
      statement(3, { replaces: 1 }),
      statement(2, { ownerClaim: true }),
      statement(1, { replacedBy: [3] }),
    ],
    recentGuardianMark: null,
  };
}

const withoutStyle = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "");

describe("the team cat page's words (SYC-362 D3)", () => {
  const html = withoutStyle(renderCatPage(ownedCatView(), "Sam", { may: () => true }));

  it("never uses the old words", () => {
    for (const old of [
      "Records say",
      "As of<",
      "Based on",
      "true on",
      "Correct the record",
      "What has been said",
      "Also remove the owner",
      "Date the team knows of",
    ]) {
      expect(html, old).not.toContain(old);
    }
  });

  it("never says \"statement\" in anything staff read", () => {
    // Tags stripped: the CSS class name `statement` is not words on the page.
    const text = html.replace(/<[^>]*>/g, " ");
    expect(text.toLowerCase()).not.toContain("statement");
  });

  it("uses the new headings and labels", () => {
    for (const word of [
      "What we know about this cat",
      ">Update this cat</h2>",
      "<dt>Since</dt>",
      "<dt>Why we think so</dt>",
      "<dt>Says otherwise</dt>",
      "Update where the cat lives",
      "Update whether sterilised",
      "Date it happened",
      "How we know",
      "History (3)",
      "Newest first. A change marked wrong stays here, crossed out, with what replaced it.",
      "Every change is saved with your name.",
      "under “Update this cat”",
      // SYC-513: the died button, and the tidied older forms.
      '<button type="submit">This cat has died</button>',
      "If the cat has died, use “This cat has died” instead.",
    ]) {
      expect(html, word).toContain(word);
    }
  });
});

describe("nothing known: no 1 Jan 1970 (SYC-270)", () => {
  it("leaves out Since when the resolver has no date", () => {
    const v = ownedCatView();
    const epoch = new Date(0).toISOString();
    v.records.sterilised = { ...v.records.sterilised, asOf: epoch, supportingStatementIds: [], conflictingStatementIds: [] };
    v.records.lifeStatus = { ...v.records.lifeStatus, asOf: epoch, supportingStatementIds: [], conflictingStatementIds: [] };
    const html = withoutStyle(renderCatPage(v, "Sam", { may: () => true }));
    expect(html).not.toContain("1970");
    expect(html).not.toContain("<dt>Since</dt>");
  });
});

describe("the died page and the dead cat's page words (SYC-513)", () => {
  const dead = () => {
    const v = ownedCatView();
    v.records.lifeStatus = {
      ...v.records.lifeStatus,
      value: "deceased",
      conflictingStatementIds: [],
      supportingStatementIds: [4],
    };
    v.history = [statement(4, { kind: "life_status", said: "No longer with us", reason: "Found by the harbour" }), ...v.history];
    return v;
  };

  it("the died page uses the spec's words and never says statement", () => {
    const html = withoutStyle(renderDiedPage(ownedCatView(), "Sam", { fields: { reason: "<b>x</b>", date: "2026-10-01" } }));
    for (const word of [
      "<h1>Tiger has died</h1>",
      "The public will see “No longer with us” on Tiger&#39;s page.",
      "Tiger&#39;s owner stays. They aren&#39;t told",
      "Date it happened <span",
      "(leave blank if you're not sure)",
      "How do you know?",
      "For example: found by the harbour; Maria, her cat guardian, told us; the vet let us know.",
      "Save: Tiger has died",
      "Back to Tiger (nothing changed)",
    ]) {
      expect(html, word).toContain(word);
    }
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html.replace(/<[^>]*>/g, " ").toLowerCase()).not.toContain("statement");
    expect(html).not.toContain("<script");
  });

  it("a dead cat: the notice, no died button, Remove owner offers 'Still no longer with us'", () => {
    const html = withoutStyle(renderCatPage(dead(), "Sam", { may: () => true }));
    expect(html).toContain("<strong>Tiger has died</strong>");
    expect(html).toContain("Still no longer with us");
    expect(html).not.toContain("This cat has died</button>");
    expect(html.replace(/<[^>]*>/g, " ").toLowerCase()).not.toContain("statement");
  });
});
