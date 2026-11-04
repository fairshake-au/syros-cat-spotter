import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";
import { STRICT_CSP } from "../test/wideCsp";

// SYC-795 Task 5: the Launch measures report's page and downloads. Same access
// rules as Coverage: team-only (a cat guardian's view_reports is refused),
// downloads need export_report and are recorded before they are sent.
// The launch date is a setting; it is stood in for here, so the shared test
// database's settings are never touched.

const launch = vi.hoisted(() => ({ date: "2026-10-28" as string | null }));
vi.mock("../lib/appSettings", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/appSettings")>();
  return { ...real, getAppSettings: async () => ({ ...(await real.getAppSettings()), launchDate: launch.date }) };
});

const KEY = "vitest-launch-report-key-0123456789abcdef-0123";
let team: Signed;
let guardian: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  team = await signedPerson("launch-team", ["staff"]);
  guardian = await guardianOn("launch-guardian", [await newColony("launchrep")]);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  launch.date = "2026-10-28";
});

afterAll(async () => {
  await pool.end();
});

const get = (path: string, cookie: string, html = true) =>
  request(app).get(path).set("Cookie", cookie).set("Accept", html ? "text/html" : "application/json");

const lastId = async () => (await pool.query<{ n: number }>(`select coalesce(max(id), 0)::int as n from report_downloads`)).rows[0]!.n;
const downloadsSince = async (personId: string, after: number) =>
  (await pool.query<{ report: string; range: string }>(`select report, range from report_downloads where person_id = $1 and id > $2 order by id`, [personId, after])).rows;

const FILES = [
  ["launch-use", "launch-sightings-and-spotters", "Week starting,Part of launch,Baseline,Sightings,Spotters"],
  ["launch-matched", "launch-share-matched", "Week starting,Part of launch,Baseline,Sightings,Not finished"],
  ["launch-accuracy", "launch-matching-accuracy", "Week starting,Part of launch,Baseline,Right first time"],
  ["launch-wait", "launch-match-wait", 'Week starting,Part of launch,Baseline,"Wait on the phone, typical"'],
  ["launch-follow", "launch-follow-up", "Week starting,Part of launch,Baseline,Finished sightings"],
] as const;

describe("the Launch measures page", () => {
  it("is in the Reports list, after Vet visits and costs", async () => {
    const res = await get("/api/team/insights", team.cookie);
    const keys = [...res.text.matchAll(/<li class="card reportcard" id="report-(\w+)">/g)].map((m) => m[1]);
    expect(keys.indexOf("launch")).toBe(keys.indexOf("vet") + 1);
    expect(res.text).toContain('<a href="/api/team/insights/launch">Launch measures</a>');
  });

  it("opens for the team on Since launch, with the strict header and no script", async () => {
    const res = await get("/api/team/insights/launch", team.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Since launch");
    expect(res.text).toContain("Worked out");
    expect(res.headers["content-security-policy"]).toBe(STRICT_CSP);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).not.toContain("<script");
  });

  it("says the date isn't set when it isn't, and shows the last 3 months", async () => {
    launch.date = null;
    const res = await get("/api/team/insights/launch", team.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Launch date not set yet. Showing the last 3 months.");
  });

  it("works with another range", async () => {
    const res = await get("/api/team/insights/launch?range=all", team.cookie);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Launch date not set yet");
  });

  it("refuses a cat guardian, who holds view_reports for her colony", async () => {
    expect((await get("/api/team/insights/launch", guardian.cookie)).status).toBe(403);
  });
});

describe("the Launch measures downloads", () => {
  for (const [key, file, header] of FILES) {
    it(`${key}: a header row with Baseline, dates as YYYY-MM-DD, the right file name, one logged download`, async () => {
      const since = await lastId();
      const res = await get(`/api/team/insights/${key}.csv?range=since`, team.cookie, false);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^text\/csv; charset=utf-8/);
      expect(res.headers["content-disposition"]).toMatch(new RegExp(`^attachment; filename="${file}-\\d{4}-\\d{2}-\\d{2}\\.csv"$`));
      expect(res.text.startsWith("﻿" + header)).toBe(true);
      for (const line of res.text.split("\r\n").slice(1).filter(Boolean)) expect(line).toMatch(/^\d{4}-\d{2}-\d{2},/);
      const rows = await downloadsSince(team.id, since);
      expect(rows).toEqual([{ report: key, range: "range=since" }]);
    });
  }

  it("a cat guardian is refused every file, and nothing is logged", async () => {
    const since = await lastId();
    for (const [key] of FILES) expect((await get(`/api/team/insights/${key}.csv`, guardian.cookie, false)).status, key).toBe(403);
    expect(await downloadsSince(guardian.id, since)).toHaveLength(0);
  });

  it("a range that isn't Since launch is logged as the shared range query", async () => {
    const since = await lastId();
    await get("/api/team/insights/launch-use.csv?range=custom&from=2026-08-01&to=2026-09-30", team.cookie, false);
    expect(await downloadsSince(team.id, since)).toEqual([{ report: "launch-use", range: "range=custom&from=2026-08-01&to=2026-09-30" }]);
  });
});
