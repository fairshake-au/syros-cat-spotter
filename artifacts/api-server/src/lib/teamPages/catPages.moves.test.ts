import { describe, expect, it } from "vitest";
import type { TeamSightingMove } from "../teamCatView";
import { historyCounts, historyRows } from "./catHistory";
import { renderCatPage } from "./catPages";
import { catView, statement } from "./__fixtures__/catView";

// SYC-150 PR 3.3 (which-cat-is-which.md §5.1, §5.7): a cat's History on both
// sides of a move, the ⋯ menu's entries, the tick boxes and "Move back".

const sighting = (id: number, at: string) => ({
  id,
  lat: 37.4447,
  lng: 24.9418,
  at,
  photoUrl: `/api/team/photos/p${id}`,
  extraPhotos: [],
  mixedCats: false,
});

const move = (over: Partial<TeamSightingMove> = {}): TeamSightingMove => ({
  id: 70,
  merge: null,
  sightingId: 41,
  direction: "in",
  otherCat: { id: 7, syr: "SYR-0007", name: "Mimi" },
  at: "2026-10-26T10:00:00Z",
  reason: "Different markings",
  reasonText: null,
  by: { name: "Maria", left: false },
  madeNewCat: false,
  latest: true,
  sighting: null,
  ...over,
});

const may = (c: string) => c === "move_sighting";
const mayNot = () => false;

/** Agatha, who got Mimi's sighting 41 and has one of her own (42). */
const agatha = (moves: TeamSightingMove[]) =>
  catView({
    cat: { id: 9, syr: "SYR-0009", name: "Agatha" },
    sightings: [sighting(42, "2026-10-20T08:00:00Z"), sighting(41, "2026-10-03T08:00:00Z")],
    moves,
  });

/** Mimi, who lost sighting 41 to Agatha and keeps 43. */
const mimi = (moves: TeamSightingMove[]) =>
  catView({
    cat: { id: 7, syr: "SYR-0007", name: "Mimi" },
    sightings: [sighting(43, "2026-10-10T08:00:00Z")],
    moves,
  });

const out = (over: Partial<TeamSightingMove> = {}) =>
  move({
    id: 70,
    direction: "out",
    otherCat: { id: 9, syr: "SYR-0009", name: "Agatha" },
    sighting: { id: 41, lat: 37.4447, lng: 24.9418, at: "2026-10-03T08:00:00Z", photoUrl: "/api/team/photos/p41" },
    ...over,
  });

describe("the cat it joined", () => {
  it("says where the sighting came from, who moved it, when and why", () => {
    const html = renderCatPage(agatha([move()]), "Sam", { may });
    expect(html).toContain('Moved here from <a href="/api/team/cats/7">Mimi</a> <span class="syr">SYR-0007</span> by Maria on');
    expect(html).toContain("Why: Different markings.");
  });

  it("says “Started this cat” for the move that started it, and what “Other…” said", () => {
    const html = renderCatPage(agatha([move({ madeNewCat: true, reason: "Other", reasonText: "Two cats at the bowl" })]), "Sam", { may });
    expect(html).toContain("Started this cat. Moved here from");
    expect(html).toContain("Why: Two cats at the bowl.");
  });

  it("names someone who has left, and says so when their details are deleted", () => {
    expect(renderCatPage(agatha([move({ by: { name: "Maria", left: true } })]), "Sam", { may })).toContain("by Maria (left) on");
    expect(renderCatPage(agatha([move({ by: null })]), "Sam", { may })).toContain("by someone who has since deleted their details on");
  });

  it("offers Move back to where it came from", () => {
    const html = renderCatPage(agatha([move()]), "Sam", { may });
    expect(html).toContain('href="/api/team/sightings/move?cat=9&amp;s=41&amp;to=7"');
    expect(html).toContain("Move back to Mimi");
  });

  it("offers no Move back once the sighting has moved on again", () => {
    const html = renderCatPage(agatha([move({ latest: false })]), "Sam", { may });
    expect(html).toContain("Moved here from");
    expect(html).not.toContain("Move back");
  });
});

describe("the cat it left", () => {
  it("keeps a row of where it went, dated when it was seen, under Changes and notes; Sightings counts only those filed under her now", () => {
    const v = mimi([out()]);
    expect(historyRows(v, [], "all").map((r) => r.type)).toEqual(["sighting", "moved"]);
    expect(historyRows(v, [], "sightings").map((r) => r.type)).toEqual(["sighting"]);
    expect(historyRows(v, [], "changes").map((r) => r.type)).toEqual(["moved"]);
    expect(historyCounts(v, [])).toMatchObject({ all: 2, sightings: 1, changes: 1 });
  });

  it("says where it went, who moved it and why, with a link to that cat", () => {
    const html = renderCatPage(mimi([out()]), "Sam", { may });
    expect(html).toContain('id="mv-70"');
    expect(html).toContain('Moved to <a href="/api/team/cats/9">Agatha</a> <span class="syr">SYR-0009</span> by Maria on');
    expect(html).toContain("Why: Different markings.");
    expect(html).toContain('<img class="hthumb" src="/api/team/photos/p41"');
  });

  it("says “Started a new cat” when the move made one", () => {
    expect(renderCatPage(mimi([out({ madeNewCat: true })]), "Sam", { may })).toContain("Started a new cat. Moved to");
  });

  it("offers Move back while it is the sighting's newest move, and not after", () => {
    expect(renderCatPage(mimi([out()]), "Sam", { may })).toContain('href="/api/team/sightings/move?cat=9&amp;s=41&amp;to=7"');
    expect(renderCatPage(mimi([out({ latest: false })]), "Sam", { may })).not.toContain("Move back");
  });

  it("keeps what the spotter said about it, crossed out, on that row", () => {
    const said = statement(500, { kind: "ear_tip", said: "Ear tip clipped, left ear", sightingId: 41, author: { kind: "spotter", label: "a spotter" } });
    const html = renderCatPage(catView({ ...mimi([out()]), history: [said] }), "Sam", { may });
    expect(html).toContain('<span id="s-500"><del>ear tip clipped, left ear</del></span>');
    // …and not as a second row of its own.
    expect(html.match(/id="s-500"/g)).toHaveLength(1);
  });
});

describe("the copied answers say nothing more about the move than its row does", () => {
  it("on the cat it joined: one “Moved here from”, and no “Why: moved” for the copies", () => {
    const copy = statement(501, {
      kind: "ear_tip",
      said: "Ear tip clipped, left ear",
      sightingId: 41,
      author: { kind: "spotter", label: "a spotter" },
      reason: "moved",
      replaces: 500,
      movedFrom: { statementId: 500, cat: { id: 7, syr: "SYR-0007", name: "Mimi" } },
    });
    const html = renderCatPage(catView({ ...agatha([move()]), history: [copy] }), "Sam", { may });
    expect(html.match(/Moved here from/g)).toHaveLength(1);
    expect(html).not.toContain("Why: moved");
  });

  it("on the cat it left: one “Moved to”, however many answers went with it", () => {
    const gone = (id: number) =>
      statement(id, {
        kind: "ear_tip",
        said: "Ear tip clipped, left ear",
        sightingId: 41,
        author: { kind: "spotter", label: "a spotter" },
        replacedBy: [id + 100],
        movedTo: { statementId: id + 100, cat: { id: 9, syr: "SYR-0009", name: "Agatha" }, reason: "moved", at: "2026-10-26T10:00:00Z" },
      });
    const html = renderCatPage(catView({ ...mimi([out()]), history: [gone(500), gone(501)] }), "Sam", { may });
    expect(html.match(/Moved to <a/g)).toHaveLength(1);
  });
});

describe("“See the photo” once per photo", () => {
  const entry = (id: number, extra = {}) =>
    statement(id, { kind: "note", said: `Said ${id}`, sightingId: 41, photoUrl: "/api/team/photos/p41", author: { kind: "spotter", label: "a spotter" }, ...extra });

  it("on the cat it joined, however many answers the sighting has", () => {
    const html = renderCatPage(catView({ ...agatha([move()]), history: [entry(1), entry(2), entry(3)] }), "Sam", { may });
    expect(html.match(/See the photo/g)).toHaveLength(1);
  });

  it("on the cat it left", () => {
    const html = renderCatPage(catView({ ...mimi([out()]), history: [entry(1), entry(2), entry(3)] }), "Sam", { may });
    expect(html.match(/See the photo/g)).toHaveLength(1);
  });
});

describe("the ⋯ menu, the tick boxes and the bar", () => {
  it("each sighting's menu has “Move to a different cat…” and “Move to a new cat”", () => {
    const html = renderCatPage(agatha([]), "Sam", { may });
    expect(html).toContain('href="/api/team/sightings/move?cat=9&amp;s=42">Move to a different cat…</a>');
    expect(html).toContain('href="/api/team/sightings/move?cat=9&amp;s=42&amp;new=1">Move to a new cat</a>');
    expect(html).toContain('href="/api/team/sightings/move?cat=9&amp;s=41">Move to a different cat…</a>');
  });

  it("each sighting has a tick box, and the bar above the list moves the ticked ones", () => {
    const html = renderCatPage(agatha([]), "Sam", { may });
    expect(html).toContain('<form id="move-ticked" method="get" action="/api/team/sightings/move" class="movebar">');
    expect(html).toContain('<input type="hidden" name="cat" value="9">');
    expect(html).toContain('name="mode" value="different">Move ticked sightings to a different cat…');
    expect(html).toContain('name="mode" value="new">Move ticked sightings to a new cat');
    expect(html).toContain('<input type="checkbox" form="move-ticked" name="tick" value="42">');
    expect(html).toContain('<input type="checkbox" form="move-ticked" name="tick" value="41">');
  });

  it("someone who may not move sees none of it", () => {
    const html = renderCatPage(agatha([move()]), "Sam", { may: mayNot });
    expect(html).not.toContain("/api/team/sightings/move");
    expect(html).not.toContain('name="tick"');
    expect(html).not.toContain("Move to a different cat");
    // The history of the move is still there to read.
    expect(html).toContain("Moved here from");
  });

  it("a cat with no sightings has no bar", () => {
    const html = renderCatPage(catView({ cat: { id: 9 } }), "Sam", { may });
    expect(html).not.toContain('id="move-ticked"');
  });
});

describe("the notice after a move", () => {
  it("?done=moved says so at the top of the page", () => {
    const html = renderCatPage(mimi([out()]), "Sam", { may, done: "moved" });
    expect(html).toContain("Saved. The move is in the history below, with where it went. Nobody was told.");
  });
});
