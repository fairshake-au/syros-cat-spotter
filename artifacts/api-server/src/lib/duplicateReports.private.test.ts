import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, duplicateDecisionsTable, duplicateReportsTable, newCatChecksTable, pool } from "@workspace/db";
import { sourceFiles } from "../test/sourceScan";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("./push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { moveKit, tag } from "../test/moveKit";

// SYC-59 PR 5.1, spec test 24 (which-cat-is-which.md §9.13): duplicate
// reports, decisions and "checked, it's new" rows are never in a public
// payload. Two ways to be sure. The source says it: only these files name
// the tables, none is a public route, and no public route reads the lists
// built from them. And the payloads say it: with a report, a decision and a
// note about a cat on file, the public cat routes and the leaderboard say
// nothing of them.

const kit = moveKit("VitestDupPrivate");
const NOTE = `zznote${tag()}`;

/** Files that name a duplicate table, and why each may (all team-side or write-only). */
const MAY_NAME_THE_TABLES: Record<string, string> = {
  "lib/db/src/schema/duplicates.ts": "the definitions",
  "artifacts/api-server/src/lib/duplicateList.ts": "the list's reads (team)",
  "artifacts/api-server/src/lib/duplicateDecide.ts": "the team's two answers (team)",
  "artifacts/api-server/src/lib/duplicateSweep.ts": "the nightly sweep: reads decisions and recent sweep reports, writes sweep reports (internal job, behind its switch)",
  "artifacts/api-server/src/lib/newCatCheck.ts": "the resolve's write of new_cat_check reports (write only)",
  "artifacts/api-server/src/lib/duplicateQuestion.ts": "the resolve's question (reads decisions only to skip a decided pair) and the spotter's answer (writes a spotter_question report; reads back only that sighting's own answer, to refuse a second)",
  "artifacts/api-server/src/lib/mergeCats.ts": "the merge's `merged` decision and its points (team)",
  "artifacts/api-server/src/lib/matcherHealth.ts": "New cats to check leaves out cats marked checked (team)",
  "artifacts/api-server/src/lib/severPerson.ts": "deletion clears the spotter from reports and decisions",
};

const NAMES_A_TABLE = /duplicate_reports|duplicateReportsTable|duplicate_decisions|duplicateDecisionsTable|new_cat_checks|newCatChecksTable/;
const TEAM_ONLY_READERS = /lib\/duplicate(List|Cards|Decide)|lib\/newCatsNearby/;

beforeAll(kit.cleanup);
afterAll(async () => {
  await kit.cleanup();
  await pool.end();
});

describe("the source (spec test 24)", () => {
  it("only the listed files name the three tables, and none is a route", () => {
    const hits = sourceFiles()
      .filter((f) => NAMES_A_TABLE.test(f.code))
      .map((f) => f.rel);
    expect(hits.filter((rel) => !(rel in MAY_NAME_THE_TABLES))).toEqual([]);
    expect(hits.filter((rel) => rel.includes("/routes/"))).toEqual([]);
  });

  it("no public route reads the list, its cards, the team's answers or the nearby cats", () => {
    const publicRoutes = sourceFiles().filter(
      (f) => f.rel.startsWith("artifacts/api-server/src/routes/") && !/\/team[A-Z.]/.test(f.rel) && !f.rel.endsWith("/team.ts"),
    );
    expect(publicRoutes.length).toBeGreaterThan(10);
    expect(publicRoutes.filter((f) => TEAM_ONLY_READERS.test(f.code)).map((f) => f.rel)).toEqual([]);
  });
});

/**
 * Files that may import the team-side readers (duplicateList, duplicateCards,
 * duplicateDecide, newCatsNearby). A wrapper module that a public route used
 * to reach them would have to import them too, so it turns this red.
 */
const MAY_IMPORT_THE_READERS: Record<string, string> = {
  "artifacts/api-server/src/lib/duplicateCards.ts": "builds a row from the list (team)",
  "artifacts/api-server/src/lib/newCatsNearby.ts": "uses the cards' distance words (team)",
  "artifacts/api-server/src/lib/teamPages/duplicatesPage.ts": "draws the list (team)",
  "artifacts/api-server/src/lib/teamPages/newCatsPage.ts": "draws New cats to check (team)",
  "artifacts/api-server/src/routes/teamDuplicates.ts": "the list's routes (review_duplicates)",
  "artifacts/api-server/src/routes/teamHome.ts": "Home's count and the nearby cats (team)",
  "artifacts/api-server/src/routes/teamCats.ts": "the not-sure notes on the team cat page (review_duplicates)",
};
const IMPORTS_A_READER = /from\s+["'][^"']*\/(duplicateList|duplicateCards|duplicateDecide|newCatsNearby)["']/;

describe("the importers (spec test 24)", () => {
  it("only the listed team-side files import the list, its cards, the answers or the nearby cats", () => {
    const hits = sourceFiles()
      .filter((f) => IMPORTS_A_READER.test(f.code))
      .map((f) => f.rel);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter((rel) => !(rel in MAY_IMPORT_THE_READERS))).toEqual([]);
    for (const rel of Object.keys(MAY_IMPORT_THE_READERS)) expect(hits, `${rel} should still import a reader`).toContain(rel);
  });
});

describe("the payloads (spec test 24)", () => {
  it("a report, a decision, a note and a 'checked' row about a cat never reach the public routes", async () => {
    const a = await kit.cat();
    const b = await kit.cat();
    const device = kit.device();
    await kit.sighting(a, device);
    const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
    await db.insert(duplicateReportsTable).values({ catLow: lo, catHigh: hi, source: "spotter_question", says: "same", deviceId: device });
    await db.insert(duplicateDecisionsTable).values({ catLow: lo, catHigh: hi, decision: "not_sure", note: NOTE, byAccountId: "vitest-private-decider" });
    await db.insert(newCatChecksTable).values({ catId: a, byAccountId: "vitest-private-decider" });

    const bodies: string[] = [];
    for (const url of [`/api/cats/${a}`, `/api/cats/${b}`, "/api/cats", "/api/leaderboard", "/api/leaderboard/week"]) {
      const res = await request(app).get(url);
      expect(res.status, url).toBeLessThan(500);
      bodies.push(res.text);
    }
    for (const body of bodies) {
      expect(body).not.toContain(NOTE);
      expect(body).not.toContain("vitest-private-decider");
      expect(body).not.toMatch(/duplicate|new_cat_check|newCatCheck|not_sure|spotter_question/i);
    }
    // The public cat page does exist, so the test is not passing on an empty answer.
    expect((await request(app).get(`/api/cats/${a}`)).status).toBe(200);
  });
});
