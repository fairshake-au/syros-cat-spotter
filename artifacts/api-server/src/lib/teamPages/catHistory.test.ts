import { describe, expect, it } from "vitest";
import type { TeamCatView, TeamStatement } from "../teamCatView";
import { EAR_TIP_NOT_CLIPPED, FOOD_AND_WATER_OUT } from "../teamCatView";
import type { VisitLine } from "../vetVisits";
import * as catPages from "./catPages";
import { bareCatView, catView, statement } from "./__fixtures__/catView";
import { placeLabel } from "../areas/placeLabel";
import {
  HISTORY_SHOWN,
  historyCounts,
  historyRows,
  renderHistory,
  isRoutine,
  groupHistory,
  runWords,
  sightingRunWords,
  type HistoryRow,
  type HistoryShow,
} from "./catHistory";

// SYC-602 PR 2 (spec §3.5): the one History list's rows, as data. Task 2.3 draws them.

type Sighting = TeamCatView["sightings"][number];

const sighting = (id: number, at: string): Sighting => ({
  id,
  lat: 37.4447,
  lng: 24.9418,
  at,
  photoUrl: null,
  extraPhotos: [],
  mixedCats: false,
});

const spotter = { kind: "spotter" as const, label: "A spotter" };

/** A spotter's "food and water were out", sent with sighting `sightingId`. */
const foodOut = (id: number, sightingId: number, at: string): TeamStatement =>
  statement(id, { kind: "food_and_water", said: FOOD_AND_WATER_OUT, author: spotter, sightingId, observedAt: at, createdAt: at });

const visitLine = (visitId: number, date: string): VisitLine => ({
  visitId,
  date,
  did: ["sterilised"],
  clinicName: "Syros Vet",
  by: "Maria",
});

/** What each row is, in order: "s900", "v40", "e12", "run(s3,s2)". */
const shape = (rows: HistoryRow[]): string[] =>
  rows.map((r) => {
    if (r.type === "sighting") return `s${r.sighting.id}`;
    if (r.type === "visit") return `v${r.visit?.visitId ?? r.entries.find((e) => e.kind === "vet_visit")?.id ?? "?"}`;
    if (r.type === "entry") return `e${r.entry.id}`;
    return `run(${r.rows.map((x) => `s${x.sighting.id}`).join(",")})`;
  });

const SHOWS: HistoryShow[] = ["all", "sightings", "visits", "changes"];

describe("historyRows (spec §3.5)", () => {
  it("joins a sighting's entries into one row", () => {
    const at = "2026-10-10T08:00:00Z";
    const v = catView({
      sightings: [sighting(900, at)],
      history: [
        statement(12, { kind: "ear_tip", said: "Ear tip clipped, left ear", author: spotter, sightingId: 900, observedAt: at }),
        foodOut(11, 900, at),
      ],
    });
    const rows = historyRows(v, [], "all");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.type).toBe("sighting");
    if (row.type !== "sighting") return;
    expect(row.sighting.id).toBe(900);
    expect(row.entries.map((e) => e.id)).toEqual([12, 11]);
  });

  it("joins a visit's own changes into the visit row", () => {
    const at = "2026-08-13T12:00:00Z";
    const v = catView({
      history: [
        statement(42, { kind: "vaccinated", said: "Vaccinated: Rabies", vetVisitId: 40, observedAt: at }),
        statement(41, { kind: "sterilised", said: "Sterilised", vetVisitId: 40, observedAt: at }),
        statement(40, { kind: "vet_visit", said: "Vet visit: sterilised, vaccinated", vetVisitId: 40, observedAt: at }),
      ],
    });
    const rows = historyRows(v, [visitLine(40, at)], "all");
    expect(shape(rows)).toEqual(["v40"]);
    const row = rows[0]!;
    if (row.type !== "visit") throw new Error("not a visit row");
    expect(row.visit?.visitId).toBe(40);
    expect(row.entries.map((e) => e.id).sort()).toEqual([40, 41, 42]);
    // No separate sterilised row anywhere.
    expect(rows.some((r) => r.type === "entry")).toBe(false);
  });

  it("never groups a sighting that recorded something that isn't routine", () => {
    const v = catView({
      sightings: [
        sighting(903, "2026-10-13T08:00:00Z"),
        sighting(902, "2026-10-12T08:00:00Z"),
        sighting(901, "2026-10-11T08:00:00Z"),
      ],
      history: [
        foodOut(23, 903, "2026-10-13T08:00:00Z"),
        statement(22, {
          kind: "ear_tip",
          said: "Ear tip clipped, left ear",
          author: spotter,
          sightingId: 902,
          observedAt: "2026-10-12T08:00:00Z",
          correction: { kind: "ear_tip_clipped" },
        }),
        foodOut(21, 901, "2026-10-11T08:00:00Z"),
      ],
    });
    // 903 and 901 are routine but not next to each other: the clipped ear sits between.
    expect(shape(historyRows(v, [], "all"))).toEqual(["s903", "s902", "s901"]);
  });

  it("filters without losing counts", () => {
    const at = "2026-08-13T12:00:00Z";
    const v = catView({
      sightings: [sighting(903, "2026-10-13T08:00:00Z"), sighting(902, "2026-10-12T08:00:00Z")],
      history: [
        statement(50, { kind: "note", said: "Shy with strangers", observedAt: "2026-10-14T08:00:00Z" }),
        statement(41, { kind: "sterilised", said: "Sterilised", vetVisitId: 40, observedAt: at }),
        statement(40, { kind: "vet_visit", said: "Vet visit: sterilised", vetVisitId: 40, observedAt: at }),
        statement(30, { kind: "colony", said: "In Vaporia steps", observedAt: "2026-07-01T08:00:00Z" }),
      ],
    });
    const visits = [visitLine(40, at)];
    expect(shape(historyRows(v, visits, "visits"))).toEqual(["v40"]);
    expect(shape(historyRows(v, visits, "changes"))).toEqual(["e50", "e30"]);
    expect(shape(historyRows(v, visits, "sightings"))).toEqual(["run(s903,s902)"]);
    expect(shape(historyRows(v, visits, "all"))).toEqual(["e50", "run(s903,s902)", "v40", "e30"]);
    const counts = historyCounts(v, visits);
    expect(counts).toEqual({ all: 5, sightings: 2, visits: 1, changes: 2 });
    // The counts don't depend on any filter: there is no filter argument, and
    // every filter's rows (runs opened up) add up to its count.
    for (const show of SHOWS) {
      const n = historyRows(v, visits, show).reduce((sum, r) => sum + (r.type === "run" ? r.rows.length : 1), 0);
      expect(n).toBe(counts[show]);
    }
  });

  it("keeps an undone visit, crossed out", () => {
    // What undoVetVisit writes: a retraction of each statement the visit
    // wrote, then of the visit itself; teamCatView ties each to the visit.
    const at = "2026-08-13T12:00:00Z";
    const undoneAt = "2026-08-20T09:00:00Z";
    const v = catView({
      history: [
        statement(61, { kind: "vet_visit", said: "Marked wrong", replaces: 40, vetVisitId: 40, observedAt: undoneAt, createdAt: undoneAt }),
        statement(60, { kind: "sterilised", said: "Marked wrong", replaces: 41, vetVisitId: 40, observedAt: undoneAt, createdAt: undoneAt }),
        statement(41, { kind: "sterilised", said: "Sterilised", vetVisitId: 40, replacedBy: [60], observedAt: at }),
        statement(40, { kind: "vet_visit", said: "Vet visit: sterilised", vetVisitId: 40, replacedBy: [61], observedAt: at }),
      ],
    });
    // visitsFor leaves out an undone visit.
    const rows = historyRows(v, [], "all");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    if (row.type !== "visit") throw new Error("not a visit row");
    expect(row.visit).toBeNull();
    expect(row.entries.map((e) => e.id).sort()).toEqual([40, 41, 60, 61]);
    expect(historyCounts(v, [])).toEqual({ all: 1, sightings: 0, visits: 1, changes: 0 });
  });

  it("a bare cat has no rows and every count is 0", () => {
    const v = bareCatView();
    for (const show of SHOWS) expect(historyRows(v, [], show)).toEqual([]);
    expect(historyCounts(v, [])).toEqual({ all: 0, sightings: 0, visits: 0, changes: 0 });
  });

  it("a sighting with no entries is still a row, and seen-only sightings group into a run", () => {
    const v = catView({
      sightings: [sighting(902, "2026-10-12T08:00:00Z"), sighting(901, "2026-10-11T08:00:00Z")],
    });
    const rows = historyRows(v, [], "all");
    expect(shape(rows)).toEqual(["run(s902,s901)"]);
    expect(historyCounts(v, [])).toEqual({ all: 2, sightings: 2, visits: 0, changes: 0 });
  });

  it("never groups a sighting that may show more than one cat", () => {
    const v = catView({
      sightings: [
        sighting(903, "2026-10-13T08:00:00Z"),
        { ...sighting(902, "2026-10-12T08:00:00Z"), mixedCats: true },
        sighting(901, "2026-10-11T08:00:00Z"),
      ],
    });
    expect(shape(historyRows(v, [], "all"))).toEqual(["s903", "s902", "s901"]);
  });

  it("a single routine sighting stays a row of its own", () => {
    const v = catView({ sightings: [sighting(901, "2026-10-11T08:00:00Z")], history: [foodOut(1, 901, "2026-10-11T08:00:00Z")] });
    expect(shape(historyRows(v, [], "all"))).toEqual(["s901"]);
  });

  it("an entry whose sighting moved to another cat is its own row, never dropped", () => {
    const v = catView({
      sightings: [sighting(901, "2026-10-11T08:00:00Z")],
      history: [foodOut(5, 777, "2026-10-12T08:00:00Z")],
    });
    const rows = historyRows(v, [], "all");
    expect(shape(rows)).toEqual(["e5", "s901"]);
    expect(historyCounts(v, [])).toEqual({ all: 2, sightings: 1, visits: 0, changes: 1 });
    expect(shape(historyRows(v, [], "changes"))).toEqual(["e5"]);
  });

  it("a visit with no entries in the history is still a row, dated by its visit", () => {
    const v = catView({ history: [statement(9, { observedAt: "2026-09-01T08:00:00Z" })] });
    const rows = historyRows(v, [visitLine(40, "2026-09-05T12:00:00Z")], "all");
    expect(shape(rows)).toEqual(["v40", "e9"]);
    const row = rows[0]!;
    if (row.type !== "visit") throw new Error("not a visit row");
    expect(row.entries).toEqual([]);
  });

  it("never shows a visit twice", () => {
    const at = "2026-08-13T12:00:00Z";
    const v = catView({
      history: [
        statement(41, { kind: "sterilised", vetVisitId: 40, observedAt: at }),
        statement(40, { kind: "vet_visit", vetVisitId: 40, observedAt: at }),
      ],
    });
    const rows = historyRows(v, [visitLine(40, at)], "all");
    expect(rows.filter((r) => r.type === "visit")).toHaveLength(1);
  });

  it("an entry with both a sighting and a visit joins the visit, once", () => {
    const at = "2026-08-13T12:00:00Z";
    const v = catView({
      sightings: [sighting(901, at)],
      history: [
        statement(41, { kind: "sterilised", vetVisitId: 40, sightingId: 901, observedAt: at }),
        statement(40, { kind: "vet_visit", vetVisitId: 40, observedAt: at }),
      ],
    });
    const rows = historyRows(v, [visitLine(40, at)], "all");
    const s = rows.find((r) => r.type === "sighting");
    const vr = rows.find((r) => r.type === "visit");
    if (s?.type !== "sighting" || vr?.type !== "visit") throw new Error("missing rows");
    expect(s.entries).toEqual([]);
    expect(vr.entries.map((e) => e.id).sort()).toEqual([40, 41]);
  });

  it("orders newest first: a sighting by its time, a visit by its visit's date, a change by when it was true", () => {
    const v = catView({
      sightings: [sighting(901, "2026-10-05T08:00:00Z")],
      history: [
        // Recorded last, but true earliest.
        statement(70, { kind: "colony", createdAt: "2026-10-20T08:00:00Z", observedAt: "2026-09-01T08:00:00Z" }),
        statement(41, { kind: "sterilised", vetVisitId: 40, observedAt: "2026-10-10T12:00:00Z" }),
        statement(40, { kind: "vet_visit", vetVisitId: 40, observedAt: "2026-10-10T12:00:00Z" }),
      ],
    });
    expect(shape(historyRows(v, [visitLine(40, "2026-10-10T12:00:00Z")], "all"))).toEqual(["v40", "s901", "e70"]);
  });

  it("breaks a tie in time: sightings, then visits, then changes; within each, the higher id first", () => {
    const at = "2026-10-10T08:00:00Z";
    const v = catView({
      sightings: [sighting(901, at), sighting(905, at)],
      history: [
        statement(3, { kind: "note", observedAt: at }),
        statement(8, { kind: "note", observedAt: at }),
        statement(40, { kind: "vet_visit", vetVisitId: 40, observedAt: at }),
        statement(1, { kind: "life_status", observedAt: at }),
      ],
    });
    expect(shape(historyRows(v, [visitLine(40, at)], "all"))).toEqual(["run(s905,s901)", "v40", "e8", "e3", "e1"]);
  });

  it("groups a long history's routine sightings whole, with every change and visit its own row", () => {
    // 22 routine sightings, one a day, then a colony change, a visit and two notes before them.
    const day = (d: number) => new Date(Date.UTC(2026, 8, 1 + d, 8)).toISOString();
    const sightings = Array.from({ length: 22 }, (_, i) => sighting(1000 - i, day(30 - i)));
    const routine = sightings.map((s, i) => foodOut(500 - i, s.id, s.at));
    const v = catView({
      sightings,
      history: [
        ...routine,
        statement(41, { kind: "sterilised", vetVisitId: 40, observedAt: day(5) }),
        statement(40, { kind: "vet_visit", vetVisitId: 40, observedAt: day(5) }),
        statement(30, { kind: "colony", observedAt: day(4) }),
        statement(20, { kind: "note", observedAt: day(3) }),
        statement(10, { kind: "note", observedAt: day(2) }),
      ],
    });
    expect(v.history.length).toBeGreaterThanOrEqual(25);
    const rows = historyRows(v, [visitLine(40, day(5))], "all");
    expect(rows.map((r) => r.type)).toEqual(["run", "visit", "entry", "entry", "entry"]);
    const run = rows[0]!;
    if (run.type !== "run") throw new Error("not a run");
    expect(run.rows).toHaveLength(22);
    expect(run.rows.map((r) => r.sighting.id)).toEqual(sightings.map((s) => s.id));
    expect(historyCounts(v, [visitLine(40, day(5))])).toEqual({ all: 26, sightings: 22, visits: 1, changes: 3 });
  });

  it("a sightings filter still groups the sightings a change sat between", () => {
    const v = catView({
      sightings: [sighting(903, "2026-10-13T08:00:00Z"), sighting(901, "2026-10-11T08:00:00Z")],
      history: [statement(50, { kind: "colony", observedAt: "2026-10-12T08:00:00Z" })],
    });
    expect(shape(historyRows(v, [], "all"))).toEqual(["s903", "e50", "s901"]);
    expect(shape(historyRows(v, [], "sightings"))).toEqual(["run(s903,s901)"]);
  });

  it("a sighting with a team member's entry is not routine", () => {
    const v = catView({
      sightings: [sighting(902, "2026-10-12T08:00:00Z"), sighting(901, "2026-10-11T08:00:00Z")],
      history: [
        statement(2, { kind: "food_and_water", said: FOOD_AND_WATER_OUT, sightingId: 902, observedAt: "2026-10-12T08:00:00Z" }),
      ],
    });
    expect(shape(historyRows(v, [], "all"))).toEqual(["s902", "s901"]);
  });

  it("a visit whose line exists but was redacted from the history still has one row with its line", () => {
    const v = catView({ history: [] });
    const rows = historyRows(v, [visitLine(40, "2026-09-05T12:00:00Z")], "visits");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type === "visit" && rows[0]!.visit?.visitId).toBe(40);
  });
});

describe("sightingRunWords", () => {
  const now = new Date("2026-10-23T08:00:00Z");
  const row = (id: number, at: string) => ({ type: "sighting" as const, sighting: sighting(id, at), entries: [] });

  it("counts the whole run by sighting, earliest to latest", () => {
    const rows = [row(903, "2026-10-13T08:00:00Z"), row(902, "2026-10-12T08:00:00Z"), row(901, "2026-09-29T08:00:00Z")];
    expect(sightingRunWords(rows, now)).toBe("Seen 3 times by spotters between 29 Sept and 13 Oct, looking well");
  });

  it("says the same words runWords says for the same sightings", () => {
    const rows = [row(903, "2026-10-13T08:00:00Z"), row(902, "2026-10-12T08:00:00Z")];
    const stmts = [foodOut(2, 903, "2026-10-13T08:00:00Z"), foodOut(1, 902, "2026-10-12T08:00:00Z")];
    expect(sightingRunWords(rows, now)).toBe(runWords(stmts, now));
  });

  it("adds the year when the run isn't all in this year", () => {
    const rows = [row(903, "2026-01-02T08:00:00Z"), row(902, "2025-12-30T08:00:00Z")];
    expect(sightingRunWords(rows, now)).toBe("Seen 2 times by spotters between 30 Dec 2025 and 2 Jan 2026, looking well");
  });
});

describe("the moved helpers", () => {
  it("catPages still exports isRoutine, groupHistory and runWords, the same functions", () => {
    expect(catPages.isRoutine).toBe(isRoutine);
    expect(catPages.groupHistory).toBe(groupHistory);
    expect(catPages.runWords).toBe(runWords);
  });

  it("isRoutine still reads a spotter's ear tip not clipped as routine", () => {
    expect(isRoutine(statement(1, { kind: "ear_tip", said: EAR_TIP_NOT_CLIPPED, author: spotter }))).toBe(true);
  });
});

// ── Task 2.3: drawing the one History list (spec §3.5) ──────────────────────

describe("renderHistory (spec §3.5)", () => {
  const NOW = new Date("2026-10-23T08:00:00Z");
  const yes = () => true;
  const draw = (v: TeamCatView, visits: VisitLine[] = [], over: Partial<Parameters<typeof renderHistory>[2]> = {}) =>
    renderHistory(v, visits, { show: "all", all: false, notice: "", may: yes, now: NOW, island: true, ...over });
  /** One row by its id, up to the next row (rows hold no <li> of their own). */
  const rowOf = (html: string, id: string) => {
    const start = html.lastIndexOf("<li", html.indexOf(`id="${id}"`));
    expect(start, id).toBeGreaterThanOrEqual(0);
    return html.slice(start, html.indexOf("</li>", start) + 5);
  };
  const menuOf = (row: string) => /<details class="rowmenu[^"]*"[^>]*>[\s\S]*<\/details>/.exec(row)?.[0] ?? "";
  const at = "2026-10-10T08:00:00Z";
  const clipped = statement(12, {
    kind: "ear_tip",
    said: "Ear tip clipped, left ear",
    author: spotter,
    sightingId: 900,
    observedAt: at,
    createdAt: at,
    correction: { kind: "ear_tip_clipped" },
  });
  const sightingCat = () =>
    catView({
      sightings: [{ ...sighting(900, at), photoUrl: "/api/team/photos/p900" }],
      history: [clipped, foodOut(11, 900, at)],
    });

  it("draws a sighting row with its menu", () => {
    const html = draw(sightingCat());
    const row = rowOf(html, "sg-900");
    expect(row).toContain(`Seen in ${placeLabel({ lat: 37.4447, lng: 24.9418 })}`);
    // The joined words, each keeping its own anchor.
    expect(row).toMatch(/id="s-12">ear tip clipped, left ear</);
    expect(row).toMatch(/id="s-11">food and water were out</);
    expect(row).toContain("A spotter");
    expect(row).toContain('src="/api/team/photos/p900"');
    const menu = menuOf(row);
    expect(menu).toContain("⋯");
    // D9's outbound "Open map" (island only) and the team map's "Show on the map" button.
    expect(menu).toContain(">Open map</a>");
    expect(menu).toContain(">Show on the map</button>");
    expect(menu).toContain("Make a feeding site here");
    expect(menu).toContain("Mark wrong: ear tip clipped");
    // One Mark wrong per markable entry: food and water has none.
    expect(menu.match(/<summary>Mark wrong:/g)).toHaveLength(1);
    // Open map only for an island-wide viewer.
    expect(menuOf(rowOf(draw(sightingCat(), [], { island: false }), "sg-900"))).not.toContain("Open map");
    // Nothing the person may not do.
    const none = menuOf(rowOf(draw(sightingCat(), [], { may: () => false, island: false }), "sg-900"));
    expect(none).not.toContain("<form");
    // SYC-459 item 4: no menu or form inside a <span>.
    expect(html).not.toMatch(/<span\b[^>]*>(?:(?!<\/span>)[\s\S])*<(?:form|details)\b/);
  });

  it("keeps the amber tag on a sighting that may show more than one cat", () => {
    const v = sightingCat();
    v.sightings[0]!.mixedCats = true;
    expect(rowOf(draw(v), "sg-900")).toContain("May show more than one cat");
  });

  it("says a sighting that recorded nothing else was seen, and who saw it", () => {
    const v = catView({ sightings: [sighting(901, at)] });
    const row = rowOf(draw(v), "sg-901");
    expect(row).toContain(`<b>Seen in ${placeLabel({ lat: 37.4447, lng: 24.9418 })}</b>`);
    expect(row).toContain("A spotter");
  });

  it("draws a visit row; cost only with view_vet_costs", () => {
    const v = catView({
      history: [
        statement(41, { kind: "sterilised", said: "Sterilised", vetVisitId: 40, observedAt: at }),
        statement(40, { kind: "vet_visit", said: "Vet visit: sterilised", vetVisitId: 40, observedAt: at }),
      ],
    });
    const line: VisitLine = { visitId: 40, date: at, did: ["sterilised"], clinicName: "Syros Vet", by: "Maria" };
    const priced = rowOf(draw(v, [{ ...line, costEur: 55, paidBy: "syros_cats" }]), "vv-40");
    expect(priced).toContain("€55");
    expect(priced).toContain("paid by Syros Cats");
    const row = rowOf(draw(v, [line]), "vv-40");
    expect(row).not.toContain("€");
    expect(row).not.toContain("paid by");
    expect(row).toContain("Syros Vet");
    expect(row).toContain("logged by Maria");
    // Its own changes are folded in, each keeping its anchor, never listed again.
    expect(row).toContain('id="s-41"');
    expect(draw(v, [line]).match(/id="s-41"/g)).toHaveLength(1);
    const menu = menuOf(row);
    expect(menu).toMatch(/<summary class="risky">Mark the visit wrong<\/summary>/);
    expect(menu).toContain(`action="/api/team/vet-visits/40/wrong"`);
    expect(menuOf(rowOf(draw(v, [line], { may: (c) => c !== "log_vet_visit" }), "vv-40"))).not.toContain("Mark the visit wrong");
  });

  it("draws a visit dated by day only with the date and no clock time; a sighting keeps its time", () => {
    // Stored at midday UTC (15:00 on Syros): a time nobody entered.
    const midday = "2026-08-13T12:00:00Z";
    const v = catView({
      sightings: [sighting(900, "2026-10-10T06:14:00Z")],
      history: [
        statement(41, { kind: "sterilised", said: "Sterilised", vetVisitId: 40, observedAt: midday }),
        statement(40, { kind: "vet_visit", said: "Vet visit: sterilised", vetVisitId: 40, observedAt: midday }),
        foodOut(11, 900, "2026-10-10T06:14:00Z"),
      ],
    });
    const html = draw(v, [visitLine(40, midday)]);
    const whenText = (row: string) => /<div class="when">([\s\S]*?)<\/div>/.exec(row)![1]!.replace(/<[^>]*>/g, " ");
    const visitWhen = whenText(rowOf(html, "vv-40"));
    expect(visitWhen).toContain("13 Aug");
    expect(visitWhen).not.toMatch(/\d\d:\d\d/);
    expect(visitWhen).not.toContain("about");
    const sightingWhen = whenText(rowOf(html, "sg-900"));
    expect(sightingWhen).toContain("09:14");
  });

  it("an undone visit is dated by day only too", () => {
    const midday = "2026-08-13T12:00:00Z";
    const v = catView({
      history: [statement(40, { kind: "vet_visit", said: "Vet visit: sterilised", vetVisitId: 40, observedAt: midday, createdAt: "2026-08-20T09:00:00Z" })],
    });
    const when = /<div class="when">([\s\S]*?)<\/div>/.exec(rowOf(draw(v), "vv-40"))![1]!.replace(/<[^>]*>/g, " ");
    expect(when).not.toMatch(/\d\d:\d\d/);
  });

  it("says cost words only when the line carries a cost (the view_vet_costs guard)", () => {
    const v = catView({
      history: [statement(40, { kind: "vet_visit", said: "Vet visit: sterilised", vetVisitId: 40, observedAt: at })],
    });
    const base = visitLine(40, at);
    expect("costEur" in base).toBe(false);
    const bare = rowOf(draw(v, [base]), "vv-40");
    expect(bare).not.toContain("Cost");
    expect(bare).not.toContain("€");
    expect(bare).not.toContain("paid by");
    const unrecorded = rowOf(draw(v, [{ ...base, costEur: null }]), "vv-40");
    expect(unrecorded).toContain("Cost not recorded");
    const priced = rowOf(draw(v, [{ ...base, costEur: 55, paidBy: "syros_cats" }]), "vv-40");
    expect(priced).toContain("€55");
    expect(priced).toContain("paid by Syros Cats");
  });

  it("says who changed a change, naturally: guardian, deleted author, system, plain", () => {
    const whoOf = (id: number, over: Partial<TeamStatement>) =>
      /<span class="who">([^<]*)/.exec(
        rowOf(draw(catView({ history: [statement(id, { kind: "life_status", said: "Lives on the street", observedAt: at, createdAt: at, ...over })] })), `s-${id}`),
      )![1];
    expect(whoOf(60, {})).toBe("Changed by Maria");
    expect(whoOf(61, { author: { kind: "team", label: "Eleni" }, asGuardian: true })).toBe("Changed by Eleni, cat guardian");
    expect(whoOf(62, { author: { kind: "deleted", label: "someone who has since deleted their details" }, asGuardian: true })).toBe(
      "Changed by someone who has since deleted their details",
    );
    expect(whoOf(63, { author: { kind: "deleted", label: "someone who has since deleted their details" } })).toBe(
      "Changed by someone who has since deleted their details",
    );
    expect(whoOf(64, { author: { kind: "system", label: "imported" } })).toBe("Imported");
    expect(whoOf(65, { kind: "note", said: "Shy" })).toBe("Maria");
  });

  it("a sighting recorded well after it was seen says when it was recorded", () => {
    const seen = "2026-10-10T08:00:00Z";
    const late = "2026-10-12T09:30:00Z";
    const v = catView({
      sightings: [sighting(900, seen)],
      history: [foodOut(11, 900, seen), { ...foodOut(12, 900, seen), createdAt: late }],
    });
    const row = rowOf(draw(v), "sg-900");
    expect(row).toMatch(/recorded <time datetime="2026-10-12T09:30:00Z">/);
    const onTime = catView({ sightings: [sighting(901, seen)], history: [foodOut(13, 901, seen)] });
    expect(rowOf(draw(onTime), "sg-901")).not.toContain("recorded");
  });

  it("keeps an undone visit, crossed out, with who marked it wrong and when", () => {
    const undoneAt = "2026-08-20T09:00:00Z";
    const v = catView({
      history: [
        statement(61, { kind: "vet_visit", said: "Marked wrong", reason: "Wrong cat", replaces: 40, vetVisitId: 40, author: { kind: "team", label: "Susan" }, observedAt: undoneAt, createdAt: undoneAt }),
        statement(60, { kind: "sterilised", said: "Marked wrong", replaces: 41, vetVisitId: 40, observedAt: undoneAt, createdAt: undoneAt }),
        statement(41, { kind: "sterilised", said: "Sterilised", vetVisitId: 40, replacedBy: [60], observedAt: "2026-08-13T12:00:00Z" }),
        statement(40, { kind: "vet_visit", said: "Vet visit: sterilised", vetVisitId: 40, replacedBy: [61], observedAt: "2026-08-13T12:00:00Z" }),
      ],
    });
    const html = draw(v);
    const row = rowOf(html, "vv-40");
    expect(row).toContain("<del>Vet visit: sterilised</del>");
    expect(row).toContain("Marked wrong by Susan on");
    expect(row).toContain("Why: Wrong cat");
    for (const id of [40, 41, 60, 61]) expect(html.match(new RegExp(`id="s-${id}"`, "g")), String(id)).toHaveLength(1);
    // The visit's own crossed-out change says what replaced it (spec §3.5).
    expect(row).toContain("<del>Sterilised</del>");
    expect(row).toMatch(/Replaced by <a href="#s-60">the change of 20 Aug 2026<\/a>: Marked wrong/);
    expect(row).not.toContain("Mark the visit wrong");
  });

  it("offers no Mark wrong on the system's own colony correction", () => {
    const v = catView({
      history: [
        statement(70, { kind: "colony", said: "Put in the colony Vaporia", author: { kind: "system", label: "imported" }, correction: { kind: "colony" } }),
        statement(71, { kind: "colony", said: "Put in the colony Agora", correction: { kind: "colony" }, observedAt: "2026-02-01T10:00:00Z" }),
      ],
    });
    const html = draw(v);
    expect(menuOf(rowOf(html, "s-70"))).not.toContain("Mark wrong");
    expect(menuOf(rowOf(html, "s-71"))).toContain("Mark wrong");
  });

  it("a team note's row carries the 'team only' tag, its text escaped, and a Mark wrong gated on add_team_note", () => {
    const v = catView({
      history: [
        statement(80, {
          kind: "team_note",
          said: "Note (team only): “<b>Limping</b>”",
          noteText: "<b>Limping</b>",
          correction: { kind: "team_note" },
        }),
      ],
    });
    const row = rowOf(draw(v), "s-80");
    expect(row).toContain('<span class="tag note">team only</span>');
    expect(row).toContain("&lt;b&gt;Limping&lt;/b&gt;");
    expect(row).not.toContain("<b>Limping</b>");
    const menu = menuOf(row);
    expect(menu).toContain("<summary>Mark wrong</summary>");
    expect(menu).toContain('action="/api/team/statements/80/wrong"');
    expect(menu).toContain('name="choice" value="retract"');
    const without = draw(v, [], { may: (c) => c !== "add_team_note" });
    expect(menuOf(rowOf(without, "s-80"))).not.toContain("Mark wrong");
    // Even without the permission the page never draws its own tag differently.
    expect(rowOf(without, "s-80")).toContain("team only");
  });

  it("a team note's History row keeps its line breaks as <br>, escaped first", () => {
    const v = catView({
      history: [
        statement(83, {
          kind: "team_note",
          said: "Note (team only): “Line <i>one</i>\r\nLine two\nLine three”",
          noteText: "Line <i>one</i>\r\nLine two\nLine three",
          correction: { kind: "team_note" },
        }),
      ],
    });
    const row = rowOf(draw(v), "s-83");
    expect(row).toContain("Line &lt;i&gt;one&lt;/i&gt;<br>Line two<br>Line three");
    expect(row).not.toContain("<i>one</i>");
    expect(row).not.toContain("\n</b>");
  });

  it("a note marked wrong is struck through and offers no second Mark wrong", () => {
    const v = catView({
      history: [
        statement(82, { kind: "team_note", said: "Marked wrong", replaces: 81 }),
        statement(81, { kind: "team_note", said: "Note (team only): “Old”", replacedBy: [82], correction: null }),
      ],
    });
    const html = draw(v);
    expect(rowOf(html, "s-81")).toContain("<del>");
    expect(menuOf(rowOf(html, "s-81"))).not.toContain("Mark wrong");
    expect(menuOf(rowOf(html, "s-82"))).not.toContain("Mark wrong");
  });

  const coatRow = (id: number, over: Partial<TeamStatement> = {}) =>
    statement(id, { kind: "coat", said: "Coat: Grey tabby", correction: { kind: "appearance" }, ...over });

  it("draws a coat change as one line that links to its change in Coat and markings", () => {
    const v = catView({
      history: [coatRow(80), statement(81, { kind: "markings", said: "Markings: White paws", correction: { kind: "appearance" } })],
      appearance: {
        coat: { statements: [{ id: 80, counts: true, markable: true }] },
        markings: { statements: [{ id: 81, counts: true, markable: true }] },
      },
    } as never);
    const html = draw(v);
    const row = rowOf(html, "s-80");
    expect(row).toContain('id="s-80"');
    expect(row).toContain('href="#a-80"');
    expect(row).toContain("Coat changed to grey tabby");
    expect(row).toContain("Maria");
    expect(row).not.toContain("<details");
    expect(row).not.toContain("<form");
    expect(row).not.toContain("Mark wrong");
    expect(row).not.toContain("open=coat");
    const marks = rowOf(html, "s-81");
    expect(marks).toContain("Markings changed to white paws");
    expect(marks).toContain('href="#a-81"');
  });

  it("draws a replaced coat change as one crossed-out line too, without its extras", () => {
    const v = catView({
      history: [
        statement(83, { kind: "coat", said: "Marked wrong", replaces: 82, reason: "Wrong cat" }),
        coatRow(82, { replacedBy: [83], correction: null, reason: "Not grey", photoUrl: "/api/team/photos/c.jpg" }),
      ],
      appearance: { coat: { statements: [] } },
    } as never);
    const row = rowOf(draw(v), "s-82");
    expect(row).toContain("<del>");
    expect(row).toContain('href="#a-82"');
    expect(row).not.toContain("Not grey");
    expect(row).not.toContain("See the photo");
    expect(row).not.toContain("Replaced by");
    // The retraction itself says nothing about a coat and is a plain row.
    expect(rowOf(draw(v), "s-83")).toContain("Marked wrong");
    expect(rowOf(draw(v), "s-83")).not.toContain("changed to");
  });

  it("keeps the coat line in the counts and in the filters", () => {
    const v = catView({ history: [coatRow(80), statement(90, { kind: "note", said: "Note: hi" })] });
    expect(historyCounts(v, []).changes).toBe(2);
    expect(historyCounts(v, []).all).toBe(2);
    expect(draw(v, [], { show: "changes" })).toContain('id="s-80"');
    expect(draw(v, [], { show: "sightings" })).not.toContain('id="s-80"');
  });

  it("points a 'Corrects the change of' link at a coat row's change in Coat and markings", () => {
    const v = catView({
      history: [
        coatRow(85, { replaces: 84, observedAt: "2026-04-02T10:00:00Z" }),
        statement(86, { kind: "life_status", said: "Corrects a coat row", replaces: 84 }),
        coatRow(84, { replacedBy: [85, 86], correction: null, observedAt: "2026-04-01T10:00:00Z" }),
      ],
    });
    expect(draw(v)).toContain('<a href="#a-84">the change of 1 Apr 2026</a>');
  });

  it("draws the first filter as All with no number, the others with theirs", () => {
    const v = catView({ history: [coatRow(80), statement(90, { kind: "note", said: "Note: hi" })] });
    const filters = /<nav class="hfilters"[\s\S]*?<\/nav>/.exec(draw(v))![0];
    expect(filters).toContain('<a href="?show=all#history" aria-current="page">All</a>');
    expect(filters).toContain(">Changes and notes 2</a>");
  });

  it("counts the whole run even when the list is cut", () => {
    // 19 notes, then five routine sightings in a row (one run), then three older notes.
    const day = (d: number) => new Date(Date.UTC(2026, 8, 1 + d, 8)).toISOString();
    const notes = Array.from({ length: 19 }, (_, i) => statement(300 - i, { observedAt: day(29 - i) }));
    const sightings = Array.from({ length: 5 }, (_, i) => sighting(950 - i, day(9 - i)));
    const routine = sightings.map((s, i) => foodOut(200 - i, s.id, s.at));
    const older = Array.from({ length: 3 }, (_, i) => statement(100 - i, { observedAt: day(3 - i) }));
    const v = catView({ sightings, history: [...notes, ...routine, ...older] });
    expect(HISTORY_SHOWN).toBe(20);
    const html = draw(v);
    // The run is the 20th row: drawn whole, with its full count.
    expect(html).toContain("Seen 5 times by spotters between");
    for (const s of sightings) expect(html, String(s.id)).toContain(`id="sg-${s.id}"`);
    for (const n of older) expect(html, String(n.id)).not.toContain(`id="s-${n.id}"`);
    expect(html).toContain('<a class="tap" href="?history=all#history">Show all 27</a>');
    // ?history=all draws everything, with no Show all.
    const all = draw(v, [], { all: true });
    for (const n of older) expect(all, String(n.id)).toContain(`id="s-${n.id}"`);
    expect(all).not.toContain("Show all");
    // Under a filter, Show all keeps the filter.
    expect(draw(v, [], { show: "changes" })).toContain('href="?show=changes&amp;history=all#history">Show all 22</a>');
  });

  it("filters with links that say how many, the current one marked", () => {
    const html = draw(sightingCat(), [], { show: "sightings" });
    const filters = /<nav class="hfilters"[\s\S]*?<\/nav>/.exec(html)![0];
    expect(filters).toContain('<a href="?show=all#history">All</a>');
    expect(filters).toContain('<a href="?show=sightings#history" aria-current="page">Sightings 1</a>');
    expect(filters).toContain('<a href="?show=visits#history">Vet visits 0</a>');
    expect(filters).toContain('<a href="?show=changes#history">Changes and notes 0</a>');
    expect(filters.match(/aria-current/g)).toHaveLength(1);
  });

  it("opens the row's menu and fold on landing", () => {
    const notice = '<p class="notice" role="status">Saved.</p>';
    const row = rowOf(draw(sightingCat(), [], { at: 12, notice }), "sg-900");
    expect(row).toContain(notice);
    expect(row).toMatch(/<details class="rowmenu dots" open>/);
    // The notice is in the row, not inside the (closed or open) menu.
    expect(row.indexOf(notice)).toBeLessThan(row.indexOf("<details"));
    // Kept typing for that row's Mark wrong: the menu and the form's fold open, the words back.
    const kept = rowOf(draw(sightingCat(), [], { kept: { formKey: "wrong:12", fields: { reason: "Not <b>a</b> clip" } } }), "sg-900");
    expect(kept).toMatch(/<details class="rowmenu dots" open>/);
    expect(kept).toMatch(/<details open><summary>Mark wrong: ear tip clipped/);
    expect(kept).toContain('value="Not &lt;b&gt;a&lt;/b&gt; clip"');
    // A routine row's run opens when the page lands inside it.
    const v = catView({
      sightings: [sighting(903, "2026-10-13T08:00:00Z"), sighting(902, "2026-10-12T08:00:00Z")],
      history: [foodOut(23, 903, "2026-10-13T08:00:00Z"), foodOut(22, 902, "2026-10-12T08:00:00Z")],
    });
    const run = draw(v, [], { at: 22, notice });
    expect(run).toMatch(/<li class="hgroup" id="run-903"><details open>/);
    expect(rowOf(run, "sg-902")).toContain(notice);
    // Landing on a row the filter leaves out shows it anyway.
    expect(draw(sightingCat(), [], { show: "visits", at: 12, notice })).toContain('id="sg-900"');
  });

  it("puts the notice at the top of History when it isn't for a row", () => {
    const notice = '<p class="notice" role="status">Saved. The vet visit is below.</p>';
    const html = draw(sightingCat(), [], { notice });
    expect(html.indexOf(notice)).toBeGreaterThanOrEqual(0);
    expect(html.indexOf(notice)).toBeLessThan(html.indexOf("<li"));
  });

  it("escapes what people wrote", () => {
    const v = catView({ history: [statement(5, { said: "Note: “<script>x</script>”", reason: "<i>why</i>", author: { kind: "team", label: "<b>Eve</b>" } })] });
    const html = draw(v);
    expect(html).not.toContain("<script>x");
    expect(html).not.toContain("<i>why");
    expect(html).not.toContain("<b>Eve");
  });
});
