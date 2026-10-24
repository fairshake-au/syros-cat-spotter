import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { catsTable, coloniesTable, db, observationsTable, pool, sightingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { deleteTestSightings } from "../test/sightings";
import { seedReport } from "../lib/teamAuth/__fixtures__/queueKit";
import app from "../app";
import { RUN, guardianOn, newColony, seedCat, signedPerson, type Signed } from "../test/roleKit";
import { logVetVisit } from "../lib/vetVisits";

// Every team member holds view_vet_costs today, so `can` is wrapped: the
// person in `denied.id` is refused view_vet_costs, and only that (the
// vetVisits.test.ts pattern). Everyone else gets the real answer.
const denied = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("../lib/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/capabilities")>();
  return {
    ...real,
    can: (...args: Parameters<typeof real.can>) =>
      args[1] === "view_vet_costs" && (args[0] as { id?: string }).id === denied.id ? false : real.can(...args),
  };
});

// SYC-396 PR 3.3a, Task 3.3a.3 (spec §9.3, §12.3): the Sterilisation progress
// and Colony health pages, and their spreadsheet files. Assertions are on
// this file's own colonies; the database is shared by the run.

const KEY = "vitest-report-pages-key-0123456789abcdef-0123";
let team: Signed;
/** A colony whose name a spreadsheet would run as a formula. */
let evil: { id: number; name: string };
/** A colony with every cat sterilised. */
let done: { id: number; name: string };

async function colony(name: string) {
  const [c] = await db.insert(coloniesTable).values({ name, normalisedName: name.toLowerCase() }).returning({ id: coloniesTable.id });
  return { id: c!.id, name };
}

async function sterilised(catId: number, yes: boolean) {
  await db.insert(observationsTable).values({
    catId,
    kind: "sterilised",
    value: { sterilised: yes },
    deviceId: `vt-roles-device-${RUN}`,
    roleAtTime: "staff",
    observedAt: new Date(),
  });
}

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  team = await signedPerson("report-pages", ["staff"]);
  evil = await colony(`=cmd|' /C calc'!A0 ${RUN} ${randomBytes(2).toString("hex")}`);
  done = await colony(`A done colony ${RUN} ${randomBytes(2).toString("hex")}`);
  const a = await seedCat(evil.id);
  await sterilised(a.id, false);
  await seedCat(evil.id);
  const b = await seedCat(done.id);
  await sterilised(b.id, true);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  await pool.end();
});

const get = (path: string) => request(app).get(path).set("Cookie", team.cookie).set("Accept", "text/html");

/** The <th> labels of the n-th table on a page, sort arrows and links removed. */
function headers(html: string, n = 0): string[] {
  const table = [...html.matchAll(/<table class="rtable">([\s\S]*?)<\/table>/g)][n]![1]!;
  const head = /<thead>([\s\S]*?)<\/thead>/.exec(table)![1]!;
  return [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
    m[1]!.replace(/<[^>]+>/g, "").replace(/ [▲▼]$/, "").replace(/&#39;/g, "'").replace(/&amp;/g, "&"),
  );
}

/** A CSV's header row. */
const csvHeader = (text: string) => text.replace(/^﻿/, "").split("\r\n")[0]!.split(",");

describe("Sterilisation progress", () => {
  it("draws the headline, the line chart and every colony's bar, each chart with its table", async () => {
    const res = await get("/api/team/insights/progress?range=3months");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<strong>\d+<\/strong> street cats? known on Syros/);
    expect(res.text).toContain('aria-label="Confirmed sterilised and all street cats known, over time"');
    const charts = res.text.match(/<svg class="chart"/g) ?? [];
    expect(charts).toHaveLength(1);
    // Every chart (the line, and the colonies' bars) has its "Show as table".
    expect(res.text.match(/<summary>Show as table<\/summary>/g)).toHaveLength(2);
    expect(res.text).toContain('aria-label="Every colony, fewest confirmed sterilised first"');
  });

  it("orders the colonies fewest confirmed sterilised first", async () => {
    const res = await get("/api/team/insights/progress?range=3months");
    const escaped = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
    const at = (name: string) => res.text.indexOf(`>${escaped(name)}</a>`);
    expect(at(evil.name)).toBeGreaterThan(0);
    expect(at(done.name)).toBeGreaterThan(at(evil.name));
  });

  it("says how the figures are worked out, when, for which period, and the areas' version", async () => {
    const res = await get("/api/team/insights/progress?range=3months");
    expect(res.text).toContain("Each point shows the records as they stood on that date.");
    expect(res.text).toContain("Figures change as records are corrected.");
    expect(res.text).toMatch(/Worked out \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} Syros time · last 3 months/);
    expect(res.text).toMatch(/Place names from the named areas, version \d+\./);
  });

  it("with nothing in the period, says so and links to all time", async () => {
    const res = await get("/api/team/insights/progress?range=custom&from=2001-01-01&to=2001-01-31");
    expect(res.text).toContain("Nothing recorded in this period.");
    expect(res.text).toContain('<a href="/api/team/insights/progress?range=all">See all time</a>');
    expect(res.text).not.toContain('<svg class="chart"');
  });

  it("each spreadsheet's columns are its table's", async () => {
    const page = (await get("/api/team/insights/progress?range=3months")).text;
    const over = await get("/api/team/insights/progress-over.csv?range=3months");
    const cols = await get("/api/team/insights/progress-colonies.csv?range=3months");
    expect(csvHeader(over.text)).toEqual(headers(page, 0));
    // The one column the page words more fully keeps its old spreadsheet header (SYC-601).
    expect(csvHeader(cols.text)).toEqual(
      headers(page, 1).map((h) => (h === "Sterilisation not known yet" ? "Not known yet" : h)),
    );
  });

  it("a colony name starting with = comes out as text in the spreadsheet", async () => {
    const res = await get("/api/team/insights/progress-colonies.csv?range=3months");
    const line = res.text.split("\r\n").find((l) => l.includes(`cmd|`) && l.includes(RUN))!;
    expect(line.startsWith(`"'=cmd|' /C calc'!A0 ${RUN}`) || line.startsWith(`'=cmd|' /C calc'!A0 ${RUN}`)).toBe(true);
  });
});

describe("Colony health", () => {
  it("is one table, every column a sort link with no position in it", async () => {
    const res = await get("/api/team/insights/health?range=3months");
    expect(res.status).toBe(200);
    expect(headers(res.text)).toEqual([
      "Colony",
      "Cats now",
      "Change over 90 days",
      "Kittens reported",
      "Not seen lately",
      "Cat guardian",
      "Last visit",
      "Flags",
    ]);
    const sorts = [...res.text.matchAll(/href="(\/api\/team\/insights\/health\?[^"]*sort=[^"]*)"/g)].map((m) => m[1]!);
    expect(sorts.length).toBeGreaterThanOrEqual(7);
    for (const s of sorts) expect(s).toMatch(/^\/api\/team\/insights\/health\?range=(month|3months|year|all)&amp;sort=(name|cats|change|kittens|notseen|guardian|lastvisit)&amp;dir=(asc|desc)$/);
    expect(res.text).toContain('aria-sort="ascending"');
  });

  it("Dates you choose keeps the chosen sort (review of #260)", async () => {
    const res = await get("/api/team/insights/health?sort=cats&dir=desc");
    const form = /<form method="get" action="\/api\/team\/insights\/health" class="rangeform">([\s\S]*?)<\/form>/.exec(res.text)![1]!;
    expect(form).toContain('<input type="hidden" name="sort" value="cats">');
    expect(form).toContain('<input type="hidden" name="dir" value="desc">');
  });

  it("an unknown sort is by name, never an error", async () => {
    const res = await get("/api/team/insights/health?sort=lat&dir=sideways");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<th scope="col" aria-sort="ascending"><a [^>]*>Colony ▲<\/a>/);
  });

  it("the spreadsheet's columns are the table's, and the = name is text", async () => {
    const page = (await get("/api/team/insights/health?range=3months")).text;
    const csv = await get("/api/team/insights/health.csv?range=3months");
    expect(csvHeader(csv.text)).toEqual(headers(page));
    expect(csv.text).toContain(`'=cmd|' /C calc'!A0 ${RUN}`);
    expect(csv.text).not.toMatch(/(^|\r\n|,)=cmd/);
  });
});

/** The photo of this file's one sighting, for cleaning up. */
let sightingPhoto: number;

describe("Coverage and spotting (PR 3.3b)", () => {
  beforeAll(async () => {
    // One sighting in Kini today, so every table on the page is drawn.
    const c = await seedCat(null);
    sightingPhoto = c.photoId;
    await db.insert(sightingsTable).values({ deviceId: `vt-roles-device-${RUN}`, photoId: c.photoId, lat: 37.4436, lng: 24.8889, status: "pending" });
  });

  afterAll(async () => {
    await deleteTestSightings(eq(sightingsTable.photoId, sightingPhoto));
  });

  it("shows the spotting count, sightings per week and the squares, each chart with its table", async () => {
    const res = await get("/api/team/insights/coverage?range=all");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<strong>\d+<\/strong> sightings?, from <strong>\d+<\/strong> spotters?/);
    expect(res.text).toContain("Spotters are counted, never named.");
    expect(res.text).toContain('aria-label="Squares sighted in this period, and squares not looked at yet"');
    expect(res.text).toContain("Counted by the date each sighting was sent.");
    expect(res.text).toMatch(/id="areas-version">Place names from the named areas, version \d+/);
  });

  it("each spreadsheet's columns are its table's, and holds no position", async () => {
    const page = await get("/api/team/insights/coverage?range=all");
    const captions = [...page.text.matchAll(/<table class="rtable"><caption>([^<]*)<\/caption>/g)].map((m) => m[1]);
    expect(captions).toEqual(["Sightings per week", "Every named area, most squares not looked at yet first"]);
    for (const [file, n] of [["coverage-weeks", 0], ["coverage-areas", 1]] as const) {
      const csv = await get(`/api/team/insights/${file}.csv?range=all`);
      expect(csv.status, file).toBe(200);
      expect(csvHeader(csv.text), file).toEqual(headers(page.text, n));
      expect(csv.text, file).not.toMatch(/\d+\.\d{3,}/);
    }
  });
});

describe("Welfare patterns (PR 3.3b)", () => {
  beforeAll(async () => {
    // One welfare report today, so the chart and both tables are drawn.
    await seedReport({ severity: "urgent", lat: 37.4436, lng: 24.8889 });
  });

  it("shows the kinds, the counts kept apart, and the areas table", async () => {
    const res = await get("/api/team/insights/welfare?range=all");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<strong>\d+<\/strong> welfare reports? sent/);
    expect(res.text).toContain('<li id="drafts">');
    expect(res.text).toContain('<li id="content">');
    // D6: the only mention of response times is the line saying there are none.
    const rest = res.text.replace("No response times and nothing about who sent or handled a report.", "");
    expect(rest).not.toMatch(/response time|time open|handled by/i);
  });

  it("each spreadsheet's columns are its table's", async () => {
    const page = await get("/api/team/insights/welfare?range=all");
    expect([...page.text.matchAll(/<table class="rtable">/g)]).toHaveLength(2);
    const csv = await get("/api/team/insights/welfare-weeks.csv?range=all");
    expect(csv.status).toBe(200);
    expect(csvHeader(csv.text)).toEqual(["Week starting", "Urgent", "Needs attention", "Litter", "All welfare reports"]);
    expect(csvHeader(csv.text)).toEqual(headers(page.text, 0));
    const areas = await get("/api/team/insights/welfare-areas.csv?range=all");
    expect(csvHeader(areas.text)).toEqual(["Area", "Welfare reports"]);
    expect(csvHeader(areas.text)).toEqual(headers(page.text, 1));
  });
});

describe("Vet visits and costs (PR 3.3c)", () => {
  /** A cat whose name a spreadsheet would run as a formula, with two visits today. */
  let cat: { id: number; name: string };
  let noCosts: Signed;
  let guardian: Signed;

  beforeAll(async () => {
    const seeded = await seedCat(null);
    const name = `=HYPERLINK("x") ${RUN} ${randomBytes(2).toString("hex")}`;
    await db.update(catsTable).set({ name }).where(eq(catsTable.id, seeded.id));
    cat = { id: seeded.id, name };
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });
    const staff = { id: team.id, scopes: [{ role: "staff", colonyId: null }] };
    await logVetVisit(staff, { catId: cat.id, date: today, value: { did: ["sterilised", "vaccinated"], vaccines: ["rabies"], clinicId: "symviosis", costEur: 60, paidBy: "syros_cats" } });
    await logVetVisit(staff, { catId: cat.id, date: today, value: { did: ["checked"], clinicId: "symviosis", costEur: 25, paidBy: "owner" } });
    noCosts = await signedPerson("report-pages-no-costs", ["staff"]);
    denied.id = noCosts.id;
    guardian = await guardianOn("report-pages-guardian", [await newColony("report-pages")]);
  });

  afterAll(() => {
    denied.id = null;
  });

  it("shows spend per month, spend by what was done, cost per sterilisation, no cost recorded, and every visit", async () => {
    const res = await get("/api/team/insights/vet?range=month");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<strong>\d+<\/strong> vet visits?/);
    expect(res.text).toContain('aria-label="Syros Cats&#39; spend per month"');
    expect(res.text).toContain('id="by-purpose"');
    expect(res.text).toContain('id="per-sterilisation"');
    expect(res.text).toContain('id="no-cost"');
    expect(res.text).toContain("Counted by the date of the visit.");
    expect(res.text).toContain("Owner-paid visits are listed, but never added into spend.");
    const captions = [...res.text.matchAll(/<table class="rtable"><caption>([^<]*)<\/caption>/g)].map((m) => m[1]);
    expect(captions).toEqual(["Visits and Syros Cats&#39; spend per month", "Syros Cats&#39; spend by what was done", "Every visit, newest first"]);
    expect(headers(res.text, 2)).toEqual(["Cat", "Date", "Clinic", "What was done", "Cost (€)", "Paid by"]);
    // The owner-paid visit is in the table, with its cost and who paid.
    expect(res.text).toContain("The owner");
  });

  it("every spreadsheet's columns are its table's; the visits file lists the owner-paid visit and the = name is text", async () => {
    const page = (await get("/api/team/insights/vet?range=month")).text;
    for (const [file, n] of [["vet-months", 0], ["vet-purposes", 1], ["vet-visits", 2]] as const) {
      const csv = await get(`/api/team/insights/${file}.csv?range=month`);
      expect(csv.status, file).toBe(200);
      expect(csvHeader(csv.text), file).toEqual(headers(page, n));
    }
    const visits = (await get("/api/team/insights/vet-visits.csv?range=month")).text;
    const mine = visits.split("\r\n").filter((l) => l.includes(RUN) && l.includes("HYPERLINK"));
    expect(mine).toHaveLength(2);
    for (const l of mine) expect(l.startsWith(`"'=HYPERLINK(""x"") ${RUN}`)).toBe(true);
    expect(mine.some((l) => l.endsWith(",25,The owner"))).toBe(true);
    expect(mine.some((l) => l.includes("Sterilised, vaccinated (") && l.endsWith(",60,Syros Cats"))).toBe(true);
    expect(visits).not.toMatch(/(^|\r\n|,)=HYPERLINK/);
  });

  it("a vet download is recorded (who, which file, which range) before it is sent", async () => {
    const since = (await pool.query<{ n: number }>("select coalesce(max(id), 0)::int as n from report_downloads")).rows[0]!.n;
    const csv = await get("/api/team/insights/vet-visits.csv?range=month");
    expect(csv.status).toBe(200);
    const rows = await pool.query<{ report: string; range: string }>(
      "select report, range from report_downloads where person_id = $1 and id > $2",
      [team.id, since],
    );
    expect(rows.rows).toEqual([{ report: "vet-visits", range: "range=month" }]);
  });

  it("someone without view_vet_costs is refused the page and every file, and nothing is recorded", async () => {
    const since = (await pool.query<{ n: number }>("select coalesce(max(id), 0)::int as n from report_downloads")).rows[0]!.n;
    const page = await request(app).get("/api/team/insights/vet").set("Cookie", noCosts.cookie).set("Accept", "text/html");
    expect(page.status).toBe(403);
    expect(page.text).not.toContain("spent by Syros Cats");
    for (const file of ["vet-months", "vet-purposes", "vet-visits"]) {
      const csv = await request(app).get(`/api/team/insights/${file}.csv`).set("Cookie", noCosts.cookie).set("Accept", "text/html");
      expect(csv.status, file).toBe(403);
      expect(csv.text, file).not.toContain("HYPERLINK");
    }
    const rows = await pool.query("select 1 from report_downloads where person_id = $1 and id > $2", [noCosts.id, since]);
    expect(rows.rowCount).toBe(0);
    // The list doesn't link a report they can't open.
    const list = await request(app).get("/api/team/insights").set("Cookie", noCosts.cookie).set("Accept", "text/html");
    expect(list.text).not.toContain('href="/api/team/insights/vet"');
    // The same person sees the other reports.
    expect((await request(app).get("/api/team/insights/welfare").set("Cookie", noCosts.cookie).set("Accept", "text/html")).status).toBe(200);
  });

  it("a cat guardian is refused the page and the files", async () => {
    expect((await request(app).get("/api/team/insights/vet").set("Cookie", guardian.cookie).set("Accept", "text/html")).status).toBe(403);
    expect((await request(app).get("/api/team/insights/vet-visits.csv").set("Cookie", guardian.cookie).set("Accept", "text/html")).status).toBe(403);
  });
});

describe("Home links its headline to the report (§4.4)", () => {
  it("shows See Sterilisation progress, and reports are no longer coming soon", async () => {
    const res = await get("/api/team/home");
    expect(res.text).toContain('<a class="hlink" href="/api/team/insights/progress">See Sterilisation progress</a>');
    expect(res.text).not.toMatch(/Coming soon:[^<]*\breports\b/);
  });
});
