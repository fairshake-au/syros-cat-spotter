import { describe, expect, it } from "vitest";
import type { TeamMergeEvent, TeamSightingMove } from "../teamCatView";
import { historyCounts, historyRows } from "./catHistory";
import { renderCatPage } from "./catPages";
import { catView, statement } from "./__fixtures__/catView";

// SYC-59 PR 4.2 (which-cat-is-which.md §4.3): a cat's History on both sides
// of a merge and its undo: the merge row with Undo merge in its ⋯ menu, the
// "from Mimi" tags, and the sighting lines a merge's moves make. Drawn from
// views built by hand; the same page from real data is in
// routes/team.mergeHistory.test.ts.

const sighting = (id: number, at: string) => ({
  id,
  lat: 37.4447,
  lng: 24.9418,
  at,
  photoUrl: `/api/team/photos/p${id}`,
  extraPhotos: [],
  mixedCats: false,
});

const may = (c: string) => c === "merge_cats" || c === "move_sighting";
const mayNot = () => false;

const MIMI = { id: 7, syr: "SYR-0007", name: "Mimi" };
const AGATHA = { id: 9, syr: "SYR-0009", name: "Agatha" };

const event = (over: Partial<TeamMergeEvent> = {}): TeamMergeEvent => ({
  id: 31,
  kind: "merged",
  mergeId: 31,
  at: "2026-10-26T10:00:00Z",
  role: "survivor",
  otherCat: MIMI,
  by: { name: "Maria", left: false },
  reasonText: "Same face markings and torn left ear",
  standing: true,
  sightings: 2,
  ...over,
});

const mergeMove = (over: Partial<TeamSightingMove> = {}): TeamSightingMove => ({
  id: 70,
  merge: "merged",
  sightingId: 41,
  direction: "in",
  otherCat: MIMI,
  at: "2026-10-26T10:00:00Z",
  reason: "Merged",
  reasonText: null,
  by: { name: "Maria", left: false },
  madeNewCat: false,
  latest: true,
  sighting: null,
  ...over,
});

/** Agatha, who has her own sighting 42 and Mimi's 41, and a note that came from Mimi. */
const agatha = (over: Parameters<typeof catView>[0] = {}) =>
  catView({
    cat: AGATHA,
    sightings: [sighting(42, "2026-10-20T08:00:00Z"), sighting(41, "2026-10-03T08:00:00Z")],
    moves: [mergeMove()],
    merges: [event()],
    ...over,
  });

describe("the cat that stays", () => {
  it("says “Merged with Mimi by Maria, 26 Oct: reason”, how many sightings came, and links to Mimi", () => {
    const html = renderCatPage(agatha(), "Sam", { may });
    expect(html).toContain('id="mg-31"');
    expect(html).toContain('Merged with <a href="/api/team/cats/7">Mimi</a> <span class="syr">SYR-0007</span>');
    expect(html).toContain("Merged by Maria: “Same face markings and torn left ear”");
    expect(html).toContain("2 sightings came with Mimi.");
  });

  it("has Undo merge in the row's ⋯ menu, only for someone who may merge, and only while the merge stands", () => {
    expect(renderCatPage(agatha(), "Sam", { may })).toContain('<a class="tap" href="/api/team/cats/merge/31/undo">Undo merge</a>');
    expect(renderCatPage(agatha(), "Sam", { may: mayNot })).not.toContain("Undo merge");
    const undone = renderCatPage(agatha({ merges: [event({ standing: false }), event({ id: 32, kind: "undone", mergeId: 31, at: "2026-10-27T10:00:00Z", reasonText: "Two cats" })] }), "Sam", { may });
    expect(undone).not.toContain("Undo merge");
    expect(undone).toContain("Undone since.");
  });

  it("draws the undo as its own row, saying the sightings went back", () => {
    const html = renderCatPage(
      agatha({ merges: [event({ standing: false }), event({ id: 32, kind: "undone", mergeId: 31, at: "2026-10-27T10:00:00Z", reasonText: "Two cats" })] }),
      "Sam",
      { may },
    );
    expect(html).toContain('id="mg-32"');
    expect(html).toContain('Merge with <a href="/api/team/cats/7">Mimi</a> <span class="syr">SYR-0007</span> undone');
    expect(html).toContain("Undone by Maria: “Two cats”");
    expect(html).toContain("2 sightings went back to Mimi.");
  });

  it("a sighting Mimi brought says it came with her, and is tagged “from Mimi”; no Move back (Undo merge does that)", () => {
    const html = renderCatPage(agatha(), "Sam", { may });
    expect(html).toContain('<span class="tag from">from Mimi</span>');
    expect(html).toContain('Came with <a href="/api/team/cats/7">Mimi</a> <span class="syr">SYR-0007</span> when it was merged in by Maria on');
    expect(html).not.toContain("Move back");
    // Agatha's own sighting 42 carries neither.
    expect(html.match(/class="tag from"/g)).toHaveLength(1);
  });

  it("a statement written about the merged-in cat is tagged “from Mimi”; Agatha's own is not", () => {
    const v = agatha({
      history: [
        statement(5, { said: "Limping, left leg", fromCat: MIMI }),
        statement(6, { said: "Fed daily" }),
      ],
    });
    const html = renderCatPage(v, "Sam", { may });
    expect(html).toMatch(/Limping, left leg<\/b> <span class="tag from">from Mimi<\/span>/);
    expect(html).not.toMatch(/Fed daily<\/b> <span class="tag from">/);
  });

  it("the merge is under Changes and notes and in the History count, not under Sightings", () => {
    const v = agatha();
    expect(historyRows(v, [], "all").map((r) => r.type)).toEqual(["merge", "run"]);
    expect(historyRows(v, [], "changes").map((r) => r.type)).toEqual(["merge"]);
    expect(historyRows(v, [], "sightings").map((r) => r.type)).toEqual(["run"]);
    expect(historyCounts(v, [])).toMatchObject({ all: 3, sightings: 2, changes: 1 });
  });
});

describe("the cat that was merged away, and after an undo", () => {
  const mimi = (over: Parameters<typeof catView>[0] = {}) =>
    catView({ cat: MIMI, sightings: [], moves: [], merges: [event({ role: "merged", otherCat: AGATHA })], ...over });

  it("says “Merged into Agatha” and how many sightings went", () => {
    const html = renderCatPage(mimi(), "Sam", { may });
    expect(html).toContain('Merged into <a href="/api/team/cats/9">Agatha</a> <span class="syr">SYR-0009</span>');
    expect(html).toContain("2 sightings went to Agatha.");
    expect(html).toContain("Undo merge");
  });

  it("after the undo her sightings are back, with “Back here from Agatha when the merge was undone”, not a Moved-to row for each", () => {
    const v = mimi({
      sightings: [sighting(41, "2026-10-03T08:00:00Z")],
      moves: [
        mergeMove({ id: 71, merge: "merge_undone", otherCat: AGATHA, at: "2026-10-27T10:00:00Z", reason: "Merge undone" }),
        mergeMove({ id: 70, direction: "out", otherCat: AGATHA, sighting: { id: 41, lat: 37.4447, lng: 24.9418, at: "2026-10-03T08:00:00Z", photoUrl: "/api/team/photos/p41" } }),
      ],
      merges: [event({ role: "merged", otherCat: AGATHA, standing: false }), event({ id: 32, kind: "undone", mergeId: 31, role: "merged", otherCat: AGATHA, at: "2026-10-27T10:00:00Z" })],
    });
    const html = renderCatPage(v, "Sam", { may });
    expect(html).toContain('Back here from <a href="/api/team/cats/9">Agatha</a> <span class="syr">SYR-0009</span> when the merge was undone by Maria on');
    expect(historyRows(v, [], "all").map((r) => r.type)).toEqual(["merge", "merge", "sighting"]);
    expect(html).not.toContain('class="tag from"');
    expect(html).not.toContain("Moved to <a");
  });
});

describe("escaping and words", () => {
  it("names and reasons are escaped", () => {
    const html = renderCatPage(
      agatha({ merges: [event({ reasonText: '<img src=x onerror=alert(1)>', otherCat: { id: 7, syr: "SYR-0007", name: "<b>Mimi</b>" } })] }),
      "Sam",
      { may },
    );
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;Mimi&lt;/b&gt;");
  });

  it("names someone who has left, and says so when their details are deleted", () => {
    expect(renderCatPage(agatha({ merges: [event({ by: { name: "Maria", left: true } })] }), "Sam", { may })).toContain("Merged by Maria (left)");
    expect(renderCatPage(agatha({ merges: [event({ by: null })] }), "Sam", { may })).toContain("Merged by someone who has since deleted their details");
  });

  it("one sighting is “1 sighting”", () => {
    expect(renderCatPage(agatha({ merges: [event({ sightings: 1 })] }), "Sam", { may })).toContain("1 sighting came with Mimi.");
  });
});
