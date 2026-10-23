import { describe, expect, it } from "vitest";
import type { TeamCatView, TeamStatement } from "../teamCatView";
import { EAR_TIP_NOT_CLIPPED, FOOD_AND_WATER_OUT } from "../teamCatView";
import type { VisitLine } from "../vetVisits";
import * as catPages from "./catPages";
import { bareCatView, catView, statement } from "./__fixtures__/catView";
import {
  historyCounts,
  historyRows,
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
