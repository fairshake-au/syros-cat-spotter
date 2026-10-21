import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";
import { STRICT_CSP } from "../test/wideCsp";

// SYC-396 PR 3.3a, Task 3.3a.2 (spec §9.3): the Reports area. Team-only at
// launch (Samuel's Q1: the guardian variant is SYC-472, 16 Nov). Every
// download is recorded (who, which report, which range, when; never the
// contents) BEFORE the file is sent: if the record fails, 503 and no file.
// Mutation probe: move recordDownload after res.send, and "a download that
// can't be recorded" must go red.

const failing = vi.hoisted(() => ({ on: false }));
vi.mock("../lib/reports/downloads", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/reports/downloads")>();
  return {
    ...real,
    recordDownload: async (...args: Parameters<typeof real.recordDownload>) => {
      if (failing.on) throw new Error("vitest: the download record is down");
      return real.recordDownload(...args);
    },
  };
});

const KEY = "vitest-reports-area-key-0123456789abcdef-0123";
let team: Signed;
let guardian: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  team = await signedPerson("reports-team", ["staff"]);
  guardian = await guardianOn("reports-guardian", [await newColony("reports")]);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  failing.on = false;
});

afterAll(async () => {
  await pool.end();
});

const get = (path: string, cookie: string, html = true) =>
  request(app).get(path).set("Cookie", cookie).set("Accept", html ? "text/html" : "application/json");

/** The newest download row's id now: the delta is what a test wrote (the database is shared by the run). */
const lastId = async () => (await pool.query<{ n: number }>(`select coalesce(max(id), 0)::int as n from report_downloads`)).rows[0]!.n;

const downloadsSince = async (personId: string, after: number) =>
  (
    await pool.query<{ person_id: string; report: string; range: string; at: Date }>(
      `select * from report_downloads where person_id = $1 and id > $2 order by id`,
      [personId, after],
    )
  ).rows;

describe("the Reports list", () => {
  it("lists the seven reports; the two built ones are linked, Donations says it's coming once donations are set up", async () => {
    const res = await get("/api/team/insights", team.cookie);
    expect(res.status).toBe(200);
    const cards = [...res.text.matchAll(/<li class="card reportcard" id="report-(\w+)">([\s\S]*?)<\/li>/g)];
    expect(cards.map((m) => m[1])).toEqual(["progress", "health", "coverage", "welfare", "vet", "impact", "donations"]);
    const card = (key: string) => cards.find((m) => m[1] === key)![2]!;
    expect(card("progress")).toContain('<a href="/api/team/insights/progress">Sterilisation progress</a>');
    expect(card("health")).toContain('<a href="/api/team/insights/health">Colony health</a>');
    expect(card("donations")).not.toContain("<a ");
    expect(card("donations")).toContain("Coming once donations are set up");
    for (const key of ["coverage", "welfare", "vet", "impact"]) {
      expect(card(key), key).not.toContain("<a ");
      expect(card(key), key).toContain("Coming soon");
    }
    // Reports is in the menu, underlined here.
    expect(res.text).toContain('<a class="here" href="/api/team/insights" aria-current="page">Reports</a>');
  });

  it("a report not built yet is a 404, not a page", async () => {
    expect((await get("/api/team/insights/coverage", team.cookie, false)).status).toBe(404);
    expect((await get("/api/team/insights/coverage.csv", team.cookie, false)).status).toBe(404);
  });
});

describe("downloads are recorded, never their contents", () => {
  it("a download writes exactly one row (who, which report, which range, when) and sends the file", async () => {
    const since = await lastId();
    const res = await get("/api/team/insights/health.csv?range=custom&from=2026-08-01&to=2026-09-30", team.cookie, false);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="colony-health-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.text.startsWith("﻿Colony,Cats now,Change over 90 days,")).toBe(true);
    const rows = await downloadsSince(team.id, since);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["at", "id", "person_id", "range", "report"]);
    expect(rows[0]).toMatchObject({ person_id: team.id, report: "health", range: "range=custom&from=2026-08-01&to=2026-09-30" });
  });

  it("the table has no column that could hold contents", async () => {
    const cols = (
      await pool.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'report_downloads' order by ordinal_position`,
      )
    ).rows.map((r) => r.column_name);
    expect(cols).toEqual(["id", "person_id", "report", "range", "at"]);
  });

  it("a download that can't be recorded is a 503 and sends no file", async () => {
    failing.on = true;
    const since = await lastId();
    const res = await get("/api/team/insights/progress-colonies.csv?range=all", team.cookie, false);
    expect(res.status).toBe(503);
    expect(res.headers["content-type"]).not.toMatch(/csv/);
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.text).not.toContain("Colony,");
    expect(res.text).toContain("couldn't be recorded");
    expect(await downloadsSince(team.id, since)).toHaveLength(0);
  });
});

describe("team-only at launch (Samuel's Q1, 16 Nov)", () => {
  it("a cat guardian, who holds view_reports for her colony, gets the 403 on every Reports route, and no Reports in her menu", async () => {
    for (const path of [
      "/api/team/insights",
      "/api/team/insights/progress",
      "/api/team/insights/health",
      "/api/team/insights/health.csv",
      "/api/team/insights/progress-over.csv",
    ]) {
      const res = await get(path, guardian.cookie);
      expect(res.status, path).toBe(403);
    }
    const home = await get("/api/team/colonies", guardian.cookie);
    expect(home.text).not.toContain("/api/team/insights");
  });
});

describe("the strict security header (no script on these pages)", () => {
  it("every Reports page and download keeps it, refusals too", async () => {
    for (const [path, cookie] of [
      ["/api/team/insights", team.cookie],
      ["/api/team/insights/progress", team.cookie],
      ["/api/team/insights/health?sort=cats&dir=desc", team.cookie],
      ["/api/team/insights/health.csv", team.cookie],
      ["/api/team/insights", guardian.cookie],
    ] as const) {
      const res = await get(path, cookie);
      expect(res.headers["content-security-policy"], path).toBe(STRICT_CSP);
      expect(res.headers["cache-control"], path).toBe("no-store");
      // The pages carry no script tag. (A spreadsheet is text: a colony
      // called "<script>" is just its name there, sent as an attachment.)
      if (!path.includes(".csv")) expect(res.text, path).not.toContain("<script");
    }
  });
});
