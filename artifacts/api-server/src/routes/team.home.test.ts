import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { like } from "drizzle-orm";
import { db, welfareReportsTable } from "@workspace/db";
import app from "../app";
import { seedReport } from "../lib/teamAuth/__fixtures__/queueKit";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";
import { homeData, type HomeData, type HomeDeps } from "../lib/dashboard/home";
import { AREAS_LINE, COMING_SOON, comingSoonLine, firstWords, NOTHING_NEEDS_YOU, renderHomePage, UNAVAILABLE } from "../lib/teamPages/homePage";
import type { QueueReport, WelfareQueue } from "../lib/welfareQueue";
import type { TeamCat } from "../lib/teamCatList";
import { escapeHtml } from "../lib/teamPages/escape";

const UNAVAILABLE_HTML = escapeHtml(UNAVAILABLE);

// SYC-396 PR 2.1, Task 2.1.2: Home, the first page after signing in (spec §4, §13).

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-homepage-${RUN}-`;
const KEY = "vitest-home-key-0123456789abcdef-0123456789ab";
const NOW = new Date("2026-10-18T13:40:00Z"); // 16:40 on Syros

let staff: Signed;
let guardian: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  staff = await signedPerson(`homepage-staff-${RUN}`, ["staff"]);
  guardian = await guardianOn(`homepage-guardian-${RUN}`, [await newColony(`homepage-${RUN}`)]);
  await seedReport({ publicId: `${PREFIX}urgent`, severity: "urgent", note: `${PREFIX} a cat by the steps` });
});

afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.publicId, `${PREFIX}%`));
});

const get = (path: string, who: Signed, browser = true) => {
  const r = request(app).get(path).set("Cookie", who.cookie);
  return browser ? r.set("Accept", "text/html").set("Sec-Fetch-Mode", "navigate") : r;
};

/** <main> only: the bar carries the viewer's own name, which is fine. */
const mainOf = (html: string) => /<main[^>]*>([\s\S]*)<\/main>/.exec(html)![1]!;

const report = (id: string, over: Partial<QueueReport> = {}): QueueReport =>
  ({
    id,
    severity: "attention",
    isLitter: false,
    lat: 37.4226,
    lng: 24.8825,
    at: "2026-10-18T13:10:00Z",
    note: "A thin grey cat",
    state: "new",
    stateChangedAt: "2026-10-18T13:20:00Z",
    stateChangedBy: { name: "Jacky Example", left: false },
    photo: { status: "attached", url: `/api/team/report-photos/${id}` },
    cat: null,
    contactLeft: false,
    emailToReporter: null,
    teamNote: "Jacky is going",
    teamNoteAt: "2026-10-18T13:25:00Z",
    teamNoteBy: { name: "Jacky Example", left: false },
    emailToTeam: "delivered",
    unchecked: false,
    ...over,
  }) as QueueReport;

const quietCat = (id: number): TeamCat =>
  ({
    id,
    name: `Cat ${id}`,
    photoPublicId: `ph${id}`,
    colonyId: 7,
    lives: "street",
    mark: "not_known",
    place: "Galissas",
    lastSeenAt: new Date("2026-08-20T10:00:00Z"),
  }) as unknown as TeamCat;

/** A full Home, built by hand: the headline is tested here, never by reading the shared island twice. */
function full(over: Partial<HomeData> = {}): HomeData {
  return {
    needs: {
      ok: true,
      value: {
        reports: [report("r1", { severity: "urgent" }), report("r2", { note: "x".repeat(120) + "<b>" })],
        reportsTotal: 9,
        unchecked: 2,
        drafts: [{ id: "d1", severity: "urgent", lat: 37.4447, lng: 24.9417, startedAt: "2026-10-18T12:40:00Z" }],
        draftsTotal: 1,
        issuesOpen: 3,
        awaitingMatch: 0,
      },
    },
    toCheck: {
      ok: true,
      value: {
        earClips: { count: 5, photos: ["/api/team/photos/e1/small"] },
        colour: { count: 2, photos: ["/api/team/photos/c1/small"] },
      },
    },
    notSeenLately: { ok: true, value: { cats: [quietCat(1), quietCat(2)], total: 9, colonyNames: { 7: "Harbour steps" } } },
    headline: {
      ok: true,
      value: { street: 142, split: { sterilised: 89, probably: 23, not_known: 18, not_sterilised: 12 }, homed: 31, inCare: 4, at: NOW },
    },
    month: {
      ok: true,
      value: { now: { sightings: 214, newCats: 6, sterilisations: 11 }, last: { sightings: 187, newCats: 4, sterilisations: 9 } },
    },
    at: NOW,
    ...over,
  };
}

const page = (d: HomeData) => renderHomePage(d, { personName: "Maria", now: NOW });

describe("GET /api/team/home", () => {
  it("a team member gets Home, with its sections in the spec's order", async () => {
    const res = await get("/api/team/home", staff);
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).toContain("<title>Home</title>");
    expect(res.text).toContain('<a class="here" href="/api/team/home" aria-current="page">Home</a>');
    // The shared database decides which optional sections show; the ones
    // that do must be in order. Needs shows: this file seeded an urgent report.
    const at = (id: string) => res.text.indexOf(`id="${id}"`);
    const order = ["needs", "tocheck", "notseen", "headline", "month", "soon"].map(at).filter((i) => i > -1);
    expect(at("needs")).toBeGreaterThan(-1);
    expect(at("headline")).toBeGreaterThan(-1);
    expect(at("month")).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(res.text).toContain(`${PREFIX} a cat by the steps`);
  });

  it("a cat guardian gets the 403: Home is island-wide", async () => {
    const res = await get("/api/team/home", guardian, false);
    expect([res.status, res.text]).toEqual([403, '{"error":"forbidden"}']);
  });
});

describe("renderHomePage", () => {
  it("draws the sections in order: needs, cats to check, not seen lately, headline, this month, coming soon", () => {
    const html = page(full());
    const ids = ["needs", "tocheck", "notseen", "headline", "month", "soon"].map((id) => html.indexOf(`id="${id}"`));
    expect(ids.every((i) => i > -1)).toBe(true);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("each report is one line linking to its row in the Queue, with the queue's photo and the first 80 characters", () => {
    const html = page(full());
    expect(html).toContain('href="/api/team#r-r1"');
    expect(html).toContain('src="/api/team/report-photos/r1"');
    expect(html).toContain("Galissas");
    expect(html).toContain(`${"x".repeat(80)}…`);
    expect(html).not.toContain("x".repeat(81));
    expect(html).not.toContain("<b>");
    expect(html).toContain('<a class="hlink" href="/api/team">See all 9 in the Queue</a>');
    expect(html).toContain('href="/api/team#unchecked">2 reports waiting for a check</a>');
    expect(html).toContain("Started but not sent (1)");
    expect(html).toContain('href="/api/team#d-d1"');
    expect(html).toContain('href="/api/team#issues">Problems reported with photos or names (3)</a>');
  });

  it("Sightings waiting for a match shows only when there are some", () => {
    expect(page(full())).not.toContain("Sightings waiting for a match");
    const d = full();
    if (d.needs.ok) d.needs.value.awaitingMatch = 4;
    expect(page(d)).toContain('href="/api/team/cats">Sightings waiting for a match (4)</a>');
  });

  it("Cats to check links each list with its count and small photos", () => {
    const html = page(full());
    expect(html).toContain('href="/api/team/likely">Ear clips to check (5)</a>');
    expect(html).toContain('href="/api/team/colour-check">Colour check (2)</a>');
    expect(html).toContain('src="/api/team/photos/e1/small"');
  });

  it("Not seen lately: small photos, colony, last seen and place, then 'and N more'; never a death", () => {
    const html = page(full());
    const section = html.slice(html.indexOf('id="notseen"'), html.indexOf('id="headline"'));
    expect(section).toContain('src="/api/team/photos/ph1/small"');
    expect(section).toContain("Harbour steps");
    expect(section).toContain("Last seen on 20 Aug 2026 · Galissas");
    expect(section).toContain('href="/api/team/cats?lives=street&amp;lastSeen=over3">and 7 more</a>');
    expect(section).not.toMatch(/died|dead|deceased|no longer with us/i);
  });

  it("the headline: the large figure, the four-part bar, the time, and homes and care apart", () => {
    const html = page(full());
    expect(html).toContain("<strong>142</strong> street cats known on Syros");
    expect(html).toContain('class="markbar"');
    expect(html).toContain("89 Sterilised");
    expect(html).toContain("As of 18 Oct 2026, 16:40");
    expect(html).toContain("Also 31 cats with homes and 4 in care.");
  });

  it("This month: each figure with last month in brackets", () => {
    const html = page(full());
    expect(html).toMatch(/214<\/span> <span>Sightings<\/span> <span class="hint">\(last month 187\)/);
    expect(html).toContain("(last month 4)");
    expect(html).toContain("(last month 9)");
    // SYC-486 (Samuel, 19 Oct): they read as activity, not as a headcount.
    expect(html).toContain("New cats recorded");
    expect(html).toContain("Sterilisations done");
  });

  it("never shows response times, ages of reports as 'open for', or any team member's name (D6)", () => {
    const main = mainOf(page(full()));
    for (const banned of [/minutes? open/i, /open for/i, /response/i, /Jacky/, /\bby [A-Z]/, /fastest|slowest|league/i]) {
      expect(main, String(banned)).not.toMatch(banned);
    }
  });

  it("an empty Needs section is absent, and with nothing to act on Home says so; the headline and This month still show", () => {
    const empty = full({
      needs: { ok: true, value: { reports: [], reportsTotal: 0, unchecked: 0, drafts: [], draftsTotal: 0, issuesOpen: 0, awaitingMatch: 0 } },
      toCheck: { ok: true, value: { earClips: { count: 0, photos: [] }, colour: { count: 0, photos: [] } } },
      notSeenLately: { ok: true, value: { cats: [], total: 0, colonyNames: {} } },
    });
    const html = page(empty);
    expect(html).not.toContain('id="needs"');
    expect(html).not.toContain('id="tocheck"');
    expect(html).not.toContain('id="notseen"');
    expect(html).toContain(NOTHING_NEEDS_YOU);
    expect(html).toContain('id="headline"');
    expect(html).toContain('id="month"');
    expect(page(full())).not.toContain(NOTHING_NEEDS_YOU);
  });

  it("a failed figure says so, and the rest of Home still draws", () => {
    const html = page(full({ needs: { ok: false }, headline: { ok: false } }));
    expect(html.split(UNAVAILABLE_HTML)).toHaveLength(3);
    expect(html).toContain('id="tocheck"');
    expect(html).toContain('id="month"');
    expect(html).not.toContain(NOTHING_NEEDS_YOU);
  });
});

describe("everything typed by someone else is escaped (review of #243)", () => {
  const EVIL = `"><img src=x onerror=alert(1)><script>alert(2)</script>`;
  const raw = (html: string) => /<img src=x|<script|"onerror=/.test(html);

  it("a short note, a cat's name, a colony's name and a place never reach the page raw", () => {
    const cat = { ...quietCat(1), name: EVIL, place: EVIL } as TeamCat;
    const d = full({
      needs: {
        ok: true,
        value: {
          reports: [report("evil1", { note: EVIL, photo: { status: "attached", url: `/x"onerror="alert(1)` } })],
          reportsTotal: 1,
          unchecked: 0,
          drafts: [],
          draftsTotal: 0,
          issuesOpen: 0,
          awaitingMatch: 0,
        },
      },
      notSeenLately: { ok: true, value: { cats: [cat], total: 1, colonyNames: { 7: EVIL } } },
    });
    const html = page(d);
    expect(raw(html)).toBe(false);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain('onerror="alert(1)');
  });
});

describe("small wording rules", () => {
  it("firstWords never cuts a family emoji or a flag in half", () => {
    const family = "👩‍👩‍👧‍👦";
    const out = firstWords(family.repeat(100));
    expect(out).toBe(`${family.repeat(80)}…`);
    expect(firstWords("🇬🇷".repeat(90))).toBe(`${"🇬🇷".repeat(80)}…`);
    expect(firstWords("  short   note ")).toBe("short note");
    expect(firstWords(null)).toBe("");
  });

  it("a colony the viewer can't name is 'Another colony', never its name", () => {
    const d = full({ notSeenLately: { ok: true, value: { cats: [quietCat(1)], total: 1, colonyNames: {} } } });
    const html = page(d);
    expect(html).toContain("Another colony");
    expect(html).not.toContain("Harbour steps");
  });
});

describe("one failing loader doesn't take Home down", () => {
  // homeData takes its loaders as an argument, so the test injects a throwing one.
  const quiet: Partial<HomeDeps> = {
    listWelfareQueue: async () => {
      throw new Error("queue down");
    },
    countOpenIssues: async () => 0,
    countAwaitingMatch: async () => 0,
    listLikelyForReview: async () => [],
    listColourCheck: async () => [],
    loadTeamCats: async () => [],
    monthFigures: async () => ({ sightings: 1, newCats: 2, sterilisations: 3 }),
    allColonyChoices: async () => [],
  };

  it("a forced throw in Needs still renders the page, with the fallback line there", async () => {
    const d = await homeData(NOW, quiet);
    const html = page(d);
    const needs = html.slice(html.indexOf('id="needs"'), html.indexOf('id="headline"'));
    expect(needs).toContain(UNAVAILABLE_HTML);
    expect(html).toContain('id="headline"');
    expect(html).toContain('id="month"');
    expect(html).toContain("(last month 1)");
  });
});

describe("the Areas link (SYC-396 PR 2.4)", () => {
  it("sits at the foot of Home, just above Coming soon, and goes to the Areas page", () => {
    const html = page(full());
    const link = html.indexOf('<a class="hlink" href="/api/team/areas">');
    expect(link).toBeGreaterThan(html.indexOf('id="month"'));
    expect(html.indexOf(AREAS_LINE)).toBeGreaterThan(-1);
    const soon = html.indexOf('id="soon"');
    if (soon > -1) expect(link).toBeLessThan(soon);
    expect(COMING_SOON.map((f) => f.label)).not.toContain("editable areas");
  });
});

describe("Coming soon (Samuel, 18 Oct 2026)", () => {
  it("is one quiet line at the foot of Home, naming features with no links", () => {
    const html = page(full());
    const line = comingSoonLine();
    expect(COMING_SOON.length).toBeGreaterThan(0);
    expect(line).not.toContain("<a");
    for (const f of COMING_SOON) expect(line).toContain(f.label);
    expect(html.indexOf('id="soon"')).toBeGreaterThan(html.indexOf('id="month"'));
    expect(html.trimEnd().endsWith(`${line}</main></body></html>`)).toBe(true);
  });

  it("disappears once every feature has arrived", () => {
    expect(comingSoonLine([])).toBe("");
  });
});
