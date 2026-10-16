import { describe, expect, it } from "vitest";
import type { TeamCatView, TeamStatement } from "../teamCatView";
import { renderCatPage } from "./catPages";

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
      markings: [],
    },
    records: {
      lifeStatus: { ...resolved([1], [2]), presumedDeceased: false, notSeenSince: null },
      sterilised: { ...resolved([1], [2]), clippedTipSightings: 0 },
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
      "Team only. How we got to what the public sees.",
      ">Update this cat</h2>",
      "<dt>Status</dt>",
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
    ]) {
      expect(html, word).toContain(word);
    }
  });
});
