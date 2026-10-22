import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TeamCatView, TeamStatement } from "../teamCatView";
import { HISTORY_SHOWN, renderCatPage } from "./catPages";
import { renderPage } from "./layout";

// Pure render tests for the cat page's history cap and wide layout (SYC-219).

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

/** `n` statements, newest first: ids n, n-1, …, 1. */
const history = (n: number) =>
  Array.from({ length: n }, (_, i) => statement(n - i));

/** No colour or markings known (SYC-2 PR 3.1's Appearance section). */
const appearanceNone = {
  value: null,
  confidence: "unknown" as const,
  checkReasons: [],
  statements: [],
  guardianDecides: false,
  aboveTeamIds: [],
  guardianDisagrees: false,
};

function view(
  n: number,
  opts: { life?: number[]; sterilised?: number[]; history?: TeamStatement[] } = {},
): TeamCatView {
  const resolved = (ids: number[]) => ({
    value: null,
    confidence: "unknown" as const,
    asOf: "2026-03-01T10:00:00Z",
    supportingStatementIds: ids,
    conflictingStatementIds: [],
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
    owner: { has: false, orphanedHome: false, homeDescription: null, homePin: null },
    colony: null,
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
      lifeStatus: {
        ...resolved(opts.life ?? []),
        presumedDeceased: false,
        notSeenSince: null,
      },
      sterilised: { ...resolved(opts.sterilised ?? []), clippedTipSightings: 0 },
      vaccinations: [],
    },
    appearance: {
      coat: appearanceNone,
      markings: appearanceNone,
      handPick: false,
    },
    sightings: [],
    photos: [],
    history: opts.history ?? history(n),
    recentGuardianMark: null,
  };
}

const statementCount = (html: string) => (html.match(/<li class="statement/g) ?? []).length;
const statementIds = (html: string) =>
  [...html.matchAll(/<li class="statement[^"]*" id="s-(\d+)"/g)].map((m) => Number(m[1]));
const showAll = (html: string) => /Show all \d+/.exec(html)?.[0] ?? null;
const may = () => true;
const mayNot = () => false;

describe("cat page history cap", () => {
  it("shows 20 as the cap", () => {
    expect(HISTORY_SHOWN).toBe(20);
  });

  it("shows every statement and no Show all at or under the cap", () => {
    for (const n of [0, 5, 20]) {
      const html = renderCatPage(view(n), "Sam");
      expect(statementCount(html)).toBe(n);
      expect(html).not.toContain("Show all");
      expect(html).not.toContain("history=all");
    }
  });

  it("with 25 shows the newest 20, newest first, and a Show all 25 link", () => {
    const html = renderCatPage(view(25), "Sam");
    const ids = statementIds(html);
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe(25);
    expect(ids[19]).toBe(6);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(html).toContain("History (25)");
    expect(html).toContain('<p class="more"><a class="tap" href="?history=all#history">Show all 25</a></p>');
  });

  it("allHistory shows all 25 and no link", () => {
    const html = renderCatPage(view(25), "Sam", { allHistory: true });
    expect(statementCount(html)).toBe(25);
    expect(showAll(html)).toBeNull();
  });

  it("landing on an old statement (at) shows all 25", () => {
    const html = renderCatPage(view(25), "Sam", { at: 3 });
    expect(statementCount(html)).toBe(25);
    expect(html).toContain('id="s-3"');
    expect(showAll(html)).toBeNull();
  });

  it("landing on a statement inside the newest 20 keeps the cap", () => {
    const html = renderCatPage(view(25), "Sam", { at: 24 });
    expect(statementCount(html)).toBe(20);
    expect(showAll(html)).toBe("Show all 25");
  });

  it("links a Based on ref outside the newest 20 to ?history=all#s-<id>, and inside to #s-<id>", () => {
    const html = renderCatPage(view(25, { sterilised: [3], life: [24] }), "Sam");
    expect(html).toContain('<a href="?history=all#s-3">Said 3</a>');
    expect(html).toContain('<a href="#s-24">Said 24</a>');
    expect(html).not.toContain('href="?history=all#s-24"');
  });

  it("links Replaced by and Corrects to a hidden statement via ?history=all", () => {
    const h = history(25);
    h[0] = statement(25, { replaces: 2 });
    h[24] = statement(1, { replacedBy: [25] });
    h[1] = statement(24, { replacedBy: [1] });
    const html = renderCatPage(view(25, { history: h }), "Sam");
    // #24 (shown) is replaced by #1 (not shown).
    expect(html).toContain('Replaced by <a href="?history=all#s-1">#1</a>');
    // #25 (shown) corrects #2 (not shown).
    expect(html).toContain('Corrects <a href="?history=all#s-2">#2</a>');
  });

  it("links Replaced by and Corrects straight to #s-<id> when every statement is shown", () => {
    const h = history(5);
    h[0] = statement(5, { replaces: 2 });
    h[3] = statement(2, { replacedBy: [5] });
    const html = renderCatPage(view(5, { history: h }), "Sam");
    expect(html).toContain('Replaced by <a href="#s-5">#5</a>');
    expect(html).toContain('Corrects <a href="#s-2">#2</a>');
    expect(html).not.toContain("history=all");
  });
});

describe("cat page layout", () => {
  it("uses the wide page and names the gallery All photos (n)", () => {
    const v = view(1);
    v.photos = [
      { url: "/api/team/photos/a", publicId: "a", source: "main", hidden: null },
      { url: "/api/team/photos/b", publicId: "b", source: "sighting", hidden: null },
    ];
    const html = renderCatPage(v, "Sam");
    expect(html).toContain('<main id="main" tabindex="-1" class="wide">');
    expect(html).toContain('<h2 id="photos">All photos (2)</h2>');
  });

  it("puts the summary beside the forms in catsummary when the person may correct (spec §7.1–7.2)", () => {
    const html = renderCatPage(view(1), "Sam", { may });
    expect(html).not.toContain("twocol");
    expect(html).toContain('<div class="catsummary">');
    expect(html).toContain('<div class="catactions"><div class="fixes" id="corrections">');
    // The facts (headed "What we know about this cat") first, then the forms.
    const summary = html.indexOf('<div class="catsummary">');
    expect(html.indexOf('class="catfacts"')).toBeGreaterThan(summary);
    expect(html.indexOf('id="corrections"')).toBeGreaterThan(html.indexOf('class="catfacts"'));
    expect(html.indexOf("What we know about this cat")).toBeLessThan(html.indexOf('id="corrections"'));
  });

  it("folds the evidence under each fact, and opens it by itself when something says otherwise", () => {
    const quiet = renderCatPage(view(1), "Sam");
    expect(quiet).toContain('<details class="why"><summary>Why we think so</summary>');
    expect(quiet).not.toContain('<details class="evidence"');
    const v = view(3);
    v.records.sterilised.conflictingStatementIds = [2];
    expect(renderCatPage(v, "Sam")).toContain('<details class="why" open>');
  });

  it("folds how changes work into a short note, in #192's words", () => {
    const html = renderCatPage(view(1), "Sam", { may });
    expect(html).toMatch(/<details class="hownote"><summary>How changes work<\/summary><p class="hint">Every change is saved with your name\./);
  });

  it("has no actions column when the person may not correct anything", () => {
    const html = renderCatPage(view(1), "Sam", { may: mayNot });
    expect(html).not.toContain('class="catactions"');
    expect(html).not.toContain('id="corrections"');
    expect(html).toContain("What we know about this cat");
  });

  it("has no actions column with the default (no may) either", () => {
    expect(renderCatPage(view(1), "Sam")).not.toContain('class="catactions"');
  });

  it("Log a vet visit is the main button, only for someone who may log one (SYC-396 PR 3.1a)", () => {
    expect(renderCatPage(view(1), "Sam", { may })).toContain('class="primary wide">Log a vet visit</button>');
    const cannot = renderCatPage(view(1), "Sam", { may: (c) => c !== "log_vet_visit" });
    expect(cannot).not.toContain("Log a vet visit");
    expect(cannot).not.toContain("Mark the visit wrong");
  });
});

// ── Routine sightings in the history (spec §7.3, plan Task 1.4.2) ───────────

const NOW = new Date("2026-10-17T09:00:00Z");

/** A spotter's "food and water were out", sent with sighting `sighting`, on day `d` of Aug or Sep 2026. */
const routine = (id: number, sighting: number, iso: string, over: Partial<TeamStatement> = {}) =>
  statement(id, {
    kind: "food_and_water",
    said: "Food and water were out",
    author: { kind: "spotter", label: "a spotter" },
    observedAt: iso,
    createdAt: iso,
    sightingId: sighting,
    ...over,
  });

/** `n` routine rows, newest first, one per sighting, a day apart ending 24 Sep 2026. */
const routineRun = (n: number, firstId = 100) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 24, 9) - i * 86_400_000).toISOString();
    return routine(firstId + n - i, 500 + n - i, d);
  });

const groupLines = (html: string) =>
  [...html.matchAll(/<li class="statement routine"><details[^>]*><summary>([^<]*)<\/summary>/g)].map((m) => m[1]);

describe("routine sightings in the history", () => {
  it("twenty in a row with no change between them are one line, and expanding it lists them", () => {
    const html = renderCatPage(view(0, { history: routineRun(20) }), "Sam", { now: NOW });
    expect(groupLines(html)).toEqual(["Seen 20 times by spotters between 5 Sept and 24 Sept, looking well"]);
    const group = /<li class="statement routine">[\s\S]*<\/details><\/li>/.exec(html)![0];
    expect(statementIds(group)).toHaveLength(20);
    // Every row is still there with its own anchor, so links to it work.
    expect(statementIds(html)).toHaveLength(20);
  });

  it("counts sightings, not rows: one sighting can say two routine things", () => {
    const iso = "2026-09-20T09:00:00Z";
    const rows = [
      routine(3, 77, iso),
      routine(2, 77, iso, { kind: "ear_tip", said: "Ear tip not clipped" }),
      routine(1, 76, "2026-09-10T09:00:00Z"),
    ];
    const html = renderCatPage(view(0, { history: rows }), "Sam", { now: NOW });
    expect(groupLines(html)).toEqual(["Seen 2 times by spotters between 10 Sept and 20 Sept, looking well"]);
  });

  it("a colony change between two runs splits them into two groups", () => {
    const newer = routineRun(3, 200);
    const older = routineRun(4, 100).map((s) => ({ ...s, sightingId: (s.sightingId ?? 0) - 100 }));
    const colony = statement(150, { kind: "colony", said: "Put in the colony Vaporia" });
    const html = renderCatPage(view(0, { history: [...newer, colony, ...older] }), "Sam", { now: NOW });
    expect(groupLines(html)).toHaveLength(2);
    expect(html.indexOf("Put in the colony Vaporia")).toBeGreaterThan(html.indexOf(groupLines(html)[0]!));
  });

  it("never groups vet visits, status, colour, name, notes, welfare reports or a clipped ear", () => {
    const never: Partial<TeamStatement>[] = [
      { kind: "sterilised", said: "Sterilised (vet)" },
      { kind: "life_status", said: "Lives on the street" },
      { kind: "coat", said: "Coat: Grey tabby" },
      { kind: "name", said: "Named “Mavros”" },
      { kind: "note", said: "Note: “thin”" },
      { kind: "welfare_report", said: "Welfare report: urgent" },
      { kind: "ear_tip", said: "Ear tip clipped", correction: { kind: "ear_tip_clipped" } },
    ];
    for (const over of never) {
      // Every row by a spotter, from its own sighting: only the kind differs.
      const rows = [1, 2, 3].map((i) =>
        statement(i, { author: { kind: "spotter", label: "a spotter" }, sightingId: i, ...over }),
      );
      const html = renderCatPage(view(0, { history: rows }), "Sam", { now: NOW });
      expect(groupLines(html), over.kind).toEqual([]);
      expect(statementIds(html), over.kind).toHaveLength(3);
    }
  });

  it("never groups a team member's rows, or a row that was corrected", () => {
    const team = routineRun(3).map((s) => ({ ...s, author: { kind: "team" as const, label: "Maria" } }));
    expect(groupLines(renderCatPage(view(0, { history: team }), "Sam", { now: NOW }))).toEqual([]);
    const fixed = routineRun(2).map((s) => ({ ...s, replacedBy: [999] }));
    expect(groupLines(renderCatPage(view(0, { history: fixed }), "Sam", { now: NOW }))).toEqual([]);
  });

  it("never folds a worrying sighting under looking well: No food or water, Couldn't tell (review finding 1)", () => {
    for (const said of ["No food or water", "Couldn't tell about food and water"]) {
      const rows = [routine(3, 3, "2026-09-20T09:00:00Z", { said }), routine(2, 2, "2026-09-19T09:00:00Z", { said })];
      expect(groupLines(renderCatPage(view(0, { history: rows }), "Sam", { now: NOW })), said).toEqual([]);
    }
    const ear = [1, 2].map((i) =>
      routine(i, i, "2026-09-20T09:00:00Z", { kind: "ear_tip", said: "Couldn't tell whether the ear is clipped" }),
    );
    expect(groupLines(renderCatPage(view(0, { history: ear }), "Sam", { now: NOW }))).toEqual([]);
  });

  it("dates run from the earliest seen to the latest, whatever order they were matched in (review finding 2)", () => {
    // Matched newest first, but the newer-matched one was seen earlier.
    const rows = [routine(2, 2, "2026-09-01T09:00:00Z"), routine(1, 1, "2026-09-10T09:00:00Z")];
    expect(groupLines(renderCatPage(view(0, { history: rows }), "Sam", { now: NOW }))).toEqual([
      "Seen 2 times by spotters between 1 Sept and 10 Sept, looking well",
    ]);
  });

  it("opens a group that Why we think so links into (review finding 6)", () => {
    const rows = routineRun(4);
    const v = view(0, { history: rows, sterilised: [rows[1]!.id] });
    expect(renderCatPage(v, "Sam", { now: NOW })).toContain('<li class="statement routine"><details open>');
    expect(renderCatPage(view(0, { history: rows }), "Sam", { now: NOW })).not.toContain(
      '<li class="statement routine"><details open>',
    );
  });

  it("a single routine row stays a row of its own", () => {
    const html = renderCatPage(view(0, { history: routineRun(1) }), "Sam", { now: NOW });
    expect(groupLines(html)).toEqual([]);
    expect(statementIds(html)).toHaveLength(1);
  });

  it("adds the year when the run isn't all in this year", () => {
    const old = routineRun(2).map((s) => ({ ...s, observedAt: s.observedAt.replace("2026", "2025") }));
    expect(groupLines(renderCatPage(view(0, { history: old }), "Sam", { now: NOW }))).toEqual([
      "Seen 2 times by spotters between 23 Sept 2025 and 24 Sept 2025, looking well",
    ]);
  });

  it("opens the group the page lands on after a correction", () => {
    const rows = routineRun(5);
    const html = renderCatPage(view(0, { history: rows }), "Sam", { now: NOW, at: rows[2]!.id, done: "wrong" });
    expect(html).toContain('<li class="statement routine"><details open>');
  });

  it("groups within the newest 20, and Show all still counts every row", () => {
    const html = renderCatPage(view(0, { history: routineRun(25) }), "Sam", { now: NOW });
    expect(showAll(html)).toBe("Show all 25");
    expect(statementIds(html)).toHaveLength(20);
    expect(groupLines(html)).toEqual(["Seen 20 times by spotters between 5 Sept and 24 Sept, looking well"]);
  });
});

// ── Each sighting's "More" menu (spec §7.3) ─────────────────────────────────

describe("each sighting's More menu", () => {
  const sighting = { id: 41, lat: 37.4447, lng: 24.9418, at: "2026-10-14T08:00:00Z", photoUrl: null, extraPhotos: [], mixedCats: false };

  it("puts Make a feeding site here, Show on the map and the position inside a <details> menu", () => {
    const v = view(0);
    v.sightings = [sighting];
    const html = renderCatPage(v, "Sam", { may, island: true, now: NOW });
    const li = /<li id="sg-41">[\s\S]*?<\/li>/.exec(html)![0];
    const menu = /<details class="rowmenu">[\s\S]*?<\/details>/.exec(li)![0];
    expect(menu).toContain("<summary>More");
    for (const inside of ["/api/team/sites/from-sighting", "/api/team/sites/map-at-sighting#map", ">Open map</a>"]) {
      expect(menu, inside).toContain(inside);
      // …and nowhere else on the row.
      expect(li.replace(menu, ""), inside).not.toContain(inside);
    }
    // No numbers anywhere on the row or in the menu (SYC-517).
    expect(li.replace(/<[^>]*>/g, " ")).not.toMatch(/\d{2}\.\d{4}/);
    // The row itself shows the date and the named area, not numbers.
    expect(li.replace(menu, "")).toMatch(/<\/time><br>[A-Z][a-z]/);
  });

  it("shows no position and no Open map to someone who is not island-wide and may not use either button", () => {
    const v = view(0);
    v.sightings = [sighting];
    const html = renderCatPage(v, "Sam", { now: NOW });
    const li = /<li id="sg-41">[\s\S]*?<\/li>/.exec(html)![0];
    expect(li.replace(/<[^>]*>/g, " ")).not.toMatch(/\d{2}\.\d{4}/);
    expect(li).not.toContain("Open map");
    expect(li).not.toContain("<form");
  });
});

describe("renderPage chrome (SYC-219)", () => {
  const page = (nav?: boolean) =>
    renderPage({ title: "T", active: "queue", personName: "Maria <b>", body: "<p>x</p>", nav });

  it("nav:false renders no nav but still has Sign out beside the name, in the bar", () => {
    const html = page(false);
    expect(html).not.toContain("<nav");
    expect(/<div class="bar">([\s\S]*?)<\/div>/.exec(html)![1]).toContain("Signed in as Maria &lt;b&gt;");
    expect(html).toContain('<form method="post" action="/api/team/signout"><button type="submit">Sign out</button></form>');
    expect(html).toContain("Signed in as Maria &lt;b&gt;");
  });

  it("with the nav, the name and Sign out end the menu bar, not under the heading (SYC-396 PR 1.6)", () => {
    const html = page();
    const nav = /<nav class="bar"[^>]*>([\s\S]*?)<\/nav>/.exec(html)![1]!;
    expect(nav).toContain('<span class="who" title="Maria &lt;b&gt;">Signed in as Maria &lt;b&gt;</span>');
    expect(nav.endsWith('<button type="submit">Sign out</button></form>')).toBe(true);
    expect(/<main[^>]*>([\s\S]*)<\/main>/.exec(html)![1]).not.toContain("Signed in as");
  });
});

// ── The small map of the cat's sightings (spec §7.1, plan Task 1.4.2) ───────

describe("the small sightings map", () => {
  // A throwaway key, only so the map pictures' tokens can be signed here.
  const KEY = "vitest-catmap-key-0123456789abcdef-0123456789";
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env["TEAM_SESSION_KEYS"];
    process.env["TEAM_SESSION_KEYS"] = KEY;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env["TEAM_SESSION_KEYS"];
    else process.env["TEAM_SESSION_KEYS"] = saved;
  });

  /** `n` sightings round Ermoupoli's harbour, newest first. */
  const sightings = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: 1000 + n - i,
      lat: 37.4447 + ((n - i) % 5) * 0.0004,
      lng: 24.9418 + ((n - i) % 7) * 0.0004,
      at: new Date(Date.UTC(2026, 9, 16) - i * 86_400_000).toISOString(),
      photoUrl: null,
      extraPhotos: [],
      mixedCats: false,
    }));

  const withSightings = (n: number) => {
    const v = view(0);
    v.sightings = sightings(n);
    return renderCatPage(v, "Sam", { now: NOW });
  };

  /** The markers drawn in one picture band (the page draws one band per screen width). */
  const pins = (html: string) => {
    const band = /<div class="mapband b179"[\s\S]*?<\/div>/.exec(html)![0];
    return [...band.matchAll(/<a class="pin seen" style="[^"]*" href="#sg-(\d+)" title="([^"]*)"><span class="pinnum" aria-hidden="true">(\d+)<\/span>/g)].map(
      (m) => ({ id: Number(m[1]), title: m[2]!, n: Number(m[3]) }),
    );
  };

  it("numbers every sighting in time order, 1 the oldest, each linking to its row", () => {
    const html = withSightings(4);
    expect(html).toContain('<div class="catmap">');
    expect(pins(html)).toEqual([
      { id: 1001, title: expect.stringMatching(/^Sighting 1, /), n: 1 },
      { id: 1002, title: expect.stringMatching(/^Sighting 2, /), n: 2 },
      { id: 1003, title: expect.stringMatching(/^Sighting 3, /), n: 3 },
      { id: 1004, title: expect.stringMatching(/^Sighting 4, /), n: 4 },
    ]);
    for (const p of pins(html)) expect(html).toContain(`<li id="sg-${p.id}">`);
  });

  it("is the server-joined map picture: no script, and no position in any address", () => {
    const html = withSightings(4);
    const map = /<div class="catmap">[\s\S]*?<\/div><p class="attrib">/.exec(html)![0];
    expect(map).not.toContain("<script");
    expect(map).toMatch(/<img src="\/api\/team\/map-tiles\/[^"]+"/);
    for (const m of map.matchAll(/(?:href|src|action)="([^"]*)"/g)) expect(m[1]).not.toMatch(/\d+\.\d{3}/);
    // No zoom, pan or area buttons on the small map.
    expect(html).not.toContain('class="mapmove"');
  });

  it("links to the full island Map focused on this cat, by its number only (PR 1.5)", () => {
    const html = withSightings(2);
    expect(html).toContain('<p class="maplink"><a class="tap" href="/api/team/cats?view=map&amp;focus=7">Open the full map</a></p>');
    // Under the picture, never around it: no link holds another.
    expect(html).not.toMatch(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/);
  });

  it("shows the newest 30 when there are more, and says so", () => {
    const html = withSightings(34);
    expect(pins(html)).toHaveLength(30);
    expect(pins(html)[29]!.id).toBe(1034);
    expect(html).toContain("The newest 30 of 34 sightings, numbered oldest first.");
  });

  it("sightings at both ends of Syros: every one is on the map, or the page says how many aren't (review finding 3)", () => {
    const v = view(0);
    v.sightings = [
      { id: 2, lat: 37.51, lng: 24.9, at: "2026-10-10T08:00:00Z", photoUrl: null, extraPhotos: [], mixedCats: false },
      { id: 1, lat: 37.37, lng: 24.92, at: "2026-10-01T08:00:00Z", photoUrl: null, extraPhotos: [], mixedCats: false },
    ];
    const html = renderCatPage(v, "Sam", { now: NOW });
    const drawn = pins(html).length;
    if (drawn < 2) expect(html).toContain(`${2 - drawn} ${2 - drawn === 1 ? "is" : "are"} too far from the others`);
    else expect(html).not.toContain("too far from the others");
    // Too far apart for one picture at the widest zoom: one is drawn, and the other is said.
    expect(drawn).toBe(1);
  });

  it("a sighting off Syros is said, never silently dropped", () => {
    const v = view(0);
    v.sightings = [
      { id: 2, lat: 37.44, lng: 24.94, at: "2026-10-10T08:00:00Z", photoUrl: null, extraPhotos: [], mixedCats: false },
      { id: 1, lat: 33.45, lng: -112.07, at: "2026-10-01T08:00:00Z", photoUrl: null, extraPhotos: [], mixedCats: false },
    ];
    const html = renderCatPage(v, "Sam", { now: NOW });
    expect(pins(html).length).toBeLessThan(2);
    expect(html).toContain("too far from the others to fit on this map; see Sightings below.");
  });

  it("has no map with no sightings", () => {
    expect(renderCatPage(view(0), "Sam", { now: NOW })).not.toMatch(/class="[^"]*catmap/);
  });

  it("says the map isn't available, and draws the rest of the page, when the picture can't be signed", () => {
    delete process.env["TEAM_SESSION_KEYS"];
    try {
      const html = withSightings(2);
      expect(html).toContain("The map isn't available right now. The sightings are listed below.");
      expect(html).toContain('<li id="sg-1002">');
    } finally {
      process.env["TEAM_SESSION_KEYS"] = KEY;
    }
  });
});
