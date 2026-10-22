import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { like } from "drizzle-orm";
import { db, welfareReportsTable } from "@workspace/db";
import app from "../app";
import { seedReport } from "../lib/teamAuth/__fixtures__/queueKit";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";
import { readFileSync } from "node:fs";
import { homeData, type HomeData, type HomeDeps, type HomeNeeds } from "../lib/dashboard/home";
import type { TrapColony } from "../lib/dashboard/trapNext";
import { AREAS_LINE, NOTHING_WAITING, renderHomePage, UNAVAILABLE } from "../lib/teamPages/homePage";
import { firstWords } from "../lib/teamPages/noteWords";
import type { QueueReport, WelfareQueue } from "../lib/welfareQueue";
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

const trapColony = (id: number, name: string, over: Partial<TrapColony> = {}): TrapColony => ({
  colonyId: id,
  name,
  toDo: 9,
  street: 14,
  sterilised: 5,
  split: { sterilised: 5, probably: 0, not_known: 0, not_sterilised: 9 },
  kittens: false,
  ...over,
});

/** A full Home, built by hand: the headline is tested here, never by reading the shared island twice. */
function full(over: Partial<HomeData> = {}): HomeData {
  return {
    needs: {
      ok: true,
      value: {
        lines: [report("r1", { severity: "urgent" }), report("r2", { isLitter: true, note: "x".repeat(120) + "<b>" })],
        linesTotal: 2,
        otherOpen: 7,
        unchecked: 2,
        issuesOpen: 3,
        awaitingMatch: 0,
      },
    },
    toCheck: { ok: true, value: { earClips: 4, colour: 2 } },
    trapNext: {
      ok: true,
      value: {
        colonies: [trapColony(12, "Galissas beach", { kittens: true }), trapColony(13, "Kini harbour", { toDo: 8, street: 11, sterilised: 3 })],
        colonyCount: 5,
        noColony: 0,
        priceEur: 60,
      },
    },
    headline: {
      ok: true,
      value: { street: 142, split: { sterilised: 89, probably: 23, not_known: 18, not_sterilised: 12 }, homed: 31, inCare: 4, at: NOW },
    },
    month: {
      ok: true,
      value: { now: { sightings: 214, newCats: 6, sterilisations: 11, vetSpendEur: 660 }, last: { sightings: 187, newCats: 4, sterilisations: 9, vetSpendEur: 542.5 } },
    },
    at: NOW,
    ...over,
  };
}

const page = (d: HomeData, costs = false) => renderHomePage(d, { personName: "Maria", now: NOW, costs });
const between = (html: string, from: string, to?: string) =>
  html.slice(html.indexOf(`id="${from}"`), to ? html.indexOf(`id="${to}"`) : undefined);
const noNeeds: HomeNeeds = { lines: [], linesTotal: 0, otherOpen: 0, unchecked: 0, issuesOpen: 0, awaitingMatch: 0 };

describe("GET /api/team/home", () => {
  it("a team member gets Home, with its parts in the spec's order", async () => {
    const res = await get("/api/team/home", staff);
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).toContain("<title>Home</title>");
    expect(res.text).toContain('<a class="here" href="/api/team/home" aria-current="page">Home</a>');
    const at = (id: string) => res.text.indexOf(`id="${id}"`);
    expect([at("today"), at("trap"), at("progress")].every((i) => i > -1)).toBe(true);
    expect(at("today")).toBeLessThan(at("trap"));
    expect(at("trap")).toBeLessThan(at("progress"));
    expect(res.text).toContain(`${PREFIX} a cat by the steps`);
    // The island's figures, never "isn't available", for an island-wide team member.
    expect(between(res.text, "trap", "progress")).not.toContain(UNAVAILABLE_HTML);
  });

  it("a cat guardian gets the 403: Home is island-wide", async () => {
    const res = await get("/api/team/home", guardian, false);
    expect([res.status, res.text]).toEqual([403, '{"error":"forbidden"}']);
  });
});

describe("renderHomePage", () => {
  it("draws Today, Where to trap next, How we're doing in that order", () => {
    const html = page(full());
    const ids = ["today", "trap", "progress"].map((id) => html.indexOf(`id="${id}"`));
    expect(ids.every((i) => i > -1)).toBe(true);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(html).toContain("<h2>Today</h2>");
    expect(html).toContain("<h2>Where to trap next</h2>");
    expect(html).toContain("<h2>How we're doing</h2>");
    expect(html).not.toContain('id="notseen"');
    expect(html).not.toMatch(/not seen lately/i);
  });

  it("urgent and kitten lines link to the Queue with ?open=", () => {
    const today = between(page(full()), "today", "trap");
    expect(today).toContain('href="/api/team?open=r1#r-r1"');
    expect(today).toContain('href="/api/team?open=r2#r-r2"');
    expect(today).toContain('src="/api/team/report-photos/r1"');
    expect(today).toContain("Galissas");
    expect(today).toContain(`${"x".repeat(80)}…`);
    expect(today).not.toContain("x".repeat(81));
    expect(today).not.toContain("<b>");
    expect(today).toContain('<span class="tag urgent">Urgent</span>');
    expect(today).toContain('<span class="tag kittens">Kittens</span>');
    expect(today).not.toContain("See all");
  });

  it("past five lines, says how many there are in all", () => {
    const d = full();
    if (d.needs.ok) d.needs.value.linesTotal = 8;
    expect(page(d)).toContain('<a class="hlink" href="/api/team">See all 8 urgent and kitten reports in the Queue</a>');
  });

  it("a report both urgent and kittens shows both words", () => {
    const d = full({ needs: { ok: true, value: { ...noNeeds, lines: [report("b", { severity: "urgent", isLitter: true })], linesTotal: 1 } } });
    const line = between(page(d), "today", "trap");
    expect(line).toContain('<span class="tag urgent">Urgent</span>');
    expect(line).toContain('<span class="tag kittens">Kittens</span>');
    expect(line.match(/class="hrow/g)).toHaveLength(1);
  });

  it("the spam-check line is a notice that links to the unchecked reports", () => {
    expect(page(full())).toContain(
      '<p class="notice"><a href="/api/team#unchecked">2 reports arrived while our spam check was down</a></p>',
    );
  });

  it("tiles show only when above zero, with the number and words in one link", () => {
    const today = between(page(full()), "today", "trap");
    expect(today).toContain('<a class="htile" href="/api/team"><span class="hn">7</span> <span>more reports</span></a>');
    expect(today).toContain('<a class="htile" href="/api/team#issues"><span class="hn">3</span> <span>problems with photos or names</span></a>');
    expect(today).toContain('<a class="htile" href="/api/team/likely"><span class="hn">4</span> <span>ear clips to check</span></a>');
    expect(today).toContain('<a class="htile" href="/api/team/colour-check"><span class="hn">2</span> <span>cats for the colour check</span></a>');
    expect(today).not.toContain("sightings to match");
    const d = full();
    if (d.needs.ok) Object.assign(d.needs.value, { issuesOpen: 0, awaitingMatch: 1, otherOpen: 1 });
    const one = page(d);
    expect(one).not.toContain("problems with");
    expect(one).toContain('<a class="htile" href="/api/team/cats"><span class="hn">1</span> <span>sighting to match</span></a>');
    expect(one).toContain("<span>more report</span>");
  });

  it("with no lines above, other reports are 'open reports', not 'more'", () => {
    const d = full({ needs: { ok: true, value: { ...noNeeds, otherOpen: 3 } } });
    expect(page(d)).toContain('<span class="hn">3</span> <span>open reports</span>');
  });

  it("a failed Queue read never says nothing is waiting", () => {
    const html = page(full({ needs: { ok: false }, toCheck: { ok: true, value: { earClips: 0, colour: 0 } } }));
    const today = between(html, "today", "trap");
    expect(today).toContain(UNAVAILABLE_HTML);
    expect(today).not.toContain(NOTHING_WAITING);
  });

  it("a failed check-list read never says nothing is waiting either", () => {
    const html = page(full({ needs: { ok: true, value: noNeeds }, toCheck: { ok: false } }));
    const today = between(html, "today", "trap");
    expect(today).toContain(UNAVAILABLE_HTML);
    expect(today).not.toContain(NOTHING_WAITING);
  });

  it("with nothing waiting, Today says so and the other parts still draw", () => {
    const html = page(full({ needs: { ok: true, value: noNeeds }, toCheck: { ok: true, value: { earClips: 0, colour: 0 } } }));
    expect(between(html, "today", "trap")).toContain(NOTHING_WAITING);
    expect(html).toContain('id="trap"');
    expect(html).toContain('id="progress"');
    expect(page(full())).not.toContain(NOTHING_WAITING);
  });

  it("trap rows: name links to the colony, to do, up to €, bar, kittens flag", () => {
    const trap = between(page(full()), "trap", "progress");
    expect(trap).toContain('<a href="/api/team/colonies/12"><strong>Galissas beach</strong></a>');
    expect(trap).toContain("9 to do · up to €540");
    expect(trap).toContain("8 to do · up to €480");
    expect(trap).toContain('class="markbar"');
    expect(trap).toContain("14 street cats · 5 sterilised");
    expect(trap.match(/Kittens reported/g)).toHaveLength(1);
    expect(trap).toContain("To do: street cats not sterilised, not known, or probably sterilised. At the standard price of €60 a cat.");
    expect(trap).toContain('<a class="hlink" href="/api/team/colonies">See all colonies</a>');
    expect(trap).not.toContain("aren't in a colony");
  });

  it("the price comes from Vet settings, not a fixed 60", () => {
    const d = full();
    if (d.trapNext.ok) d.trapNext.value.priceEur = 55;
    const trap = between(page(d), "trap", "progress");
    expect(trap).toContain("9 to do · up to €495");
    expect(trap).toContain("€55 a cat");
    const source = readFileSync(new URL("../lib/teamPages/homePage.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/€\s?60/);
  });

  it("street cats to do outside any colony get one line", () => {
    const d = full();
    if (d.trapNext.ok) d.trapNext.value.noColony = 1;
    expect(page(d)).toContain("Plus 1 street cat to do that isn't in a colony.");
    if (d.trapNext.ok) d.trapNext.value.noColony = 6;
    expect(page(d)).toContain("Plus 6 street cats to do that aren't in a colony.");
  });

  it("no colonies, and all done, each say so", () => {
    const none = full({ trapNext: { ok: true, value: { colonies: [], colonyCount: 0, noColony: 0, priceEur: 60 } } });
    const t1 = between(page(none), "trap", "progress");
    expect(t1).toContain("No colonies yet. Grouping cats into colonies lets you plan trapping rounds.");
    expect(t1).toContain('href="/api/team/colonies#create">Create a colony</a>');
    const done = full({ trapNext: { ok: true, value: { colonies: [], colonyCount: 4, noColony: 0, priceEur: 60 } } });
    expect(page(done)).toContain("Every colony's street cats are sterilised.");
  });

  it("How we're doing: count, % confirmed sterilised, bar, month line, time, homes and care", () => {
    const progress = between(page(full()), "progress");
    expect(progress).toContain("<strong>142</strong> street cats · 63% confirmed sterilised");
    expect(progress).toContain('class="markbar"');
    expect(progress).toContain("89 Sterilised");
    expect(progress).toContain("11 sterilisations this month (9 last month)");
    expect(progress).toContain("As of 18 Oct 2026, 16:40");
    expect(progress).toContain("Also 31 cats with homes and 4 in care.");
    expect(progress).toContain('href="/api/team/insights/progress">See Sterilisation progress</a>');
    expect(progress).not.toContain("Sightings");
    expect(progress).not.toContain("New cats");
  });

  it("one sterilised in 300 reads 1%", () => {
    const d = full({
      headline: { ok: true, value: { street: 300, split: { sterilised: 1, probably: 0, not_known: 299, not_sterilised: 0 }, homed: 0, inCare: 0, at: NOW } },
    });
    expect(page(d)).toContain("<strong>300</strong> street cats · 1% confirmed sterilised");
  });

  it("with no street cats, the progress part says so and nothing else", () => {
    const d = full({ headline: { ok: true, value: { street: 0, split: { sterilised: 0, probably: 0, not_known: 0, not_sterilised: 0 }, homed: 2, inCare: 0, at: NOW } } });
    const progress = between(page(d), "progress");
    expect(progress).toContain("No street cats recorded yet");
    expect(progress).not.toContain("markbar");
    expect(progress).not.toContain("sterilisations this month");
  });

  it("vet spend shows only with costs", () => {
    expect(page(full(), true)).toContain("11 sterilisations this month (9 last month) · €660 vet spend, paid by Syros Cats or by donations");
    expect(page(full())).not.toContain("vet spend");
  });

  it("a failed month read greys out only the month line", () => {
    const progress = between(page(full({ month: { ok: false } })), "progress");
    expect(progress).toContain(UNAVAILABLE_HTML);
    expect(progress).toContain("<strong>142</strong>");
  });

  it("failed trapping and headline reads each say so in their own part", () => {
    const html = page(full({ trapNext: { ok: false }, headline: { ok: false } }));
    expect(between(html, "trap", "progress")).toContain(UNAVAILABLE_HTML);
    expect(between(html, "progress")).toContain(UNAVAILABLE_HTML);
    expect(between(html, "today", "trap")).not.toContain(UNAVAILABLE_HTML);
  });

  it("never shows response times, ages of reports as 'open for', or any team member's name (D6)", () => {
    const main = mainOf(page(full(), true));
    // "paid by Syros Cats" is the charity, not a person (spec §4.3's own words).
    for (const banned of [/minutes? open/i, /open for/i, /response/i, /Jacky/, /\bby (?!Syros Cats\b)[A-Z]/, /fastest|slowest|league/i]) {
      expect(main, String(banned)).not.toMatch(banned);
    }
  });
});

describe("everything typed by someone else is escaped (review of #243)", () => {
  const EVIL = `"><img src=x onerror=alert(1)><script>alert(2)</script>`;
  const raw = (html: string) => /<img src=x|<script|"onerror=/.test(html);

  it("a short note, a colony's name and a place never reach the page raw", () => {
    const d = full({
      needs: {
        ok: true,
        value: { ...noNeeds, lines: [report("evil1", { severity: "urgent", note: EVIL, photo: { status: "attached", url: `/x"onerror="alert(1)` } })], linesTotal: 1 },
      },
      trapNext: { ok: true, value: { colonies: [trapColony(1, EVIL)], colonyCount: 1, noColony: 0, priceEur: 60 } },
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
    monthFigures: async () => ({ sightings: 1, newCats: 2, sterilisations: 3, vetSpendEur: 0 }),
    allColonyChoices: async () => [],
    colonyFigures: async () => new Map(),
    standardPriceNow: async () => 60,
  };

  it("a forced throw in the Queue still renders the page, with the fallback line in Today", async () => {
    const d = await homeData(NOW, quiet, { ids: null } as never);
    const html = page(d);
    expect(between(html, "today", "trap")).toContain(UNAVAILABLE_HTML);
    expect(html).toContain('id="trap"');
    expect(between(html, "progress")).toContain("No street cats recorded yet");
  });
});

describe("the Areas link (SYC-396 PR 2.4)", () => {
  it("sits at the foot of Home and goes to the Areas page", () => {
    const html = page(full());
    const link = html.indexOf('<a class="hlink" href="/api/team/areas">');
    expect(link).toBeGreaterThan(html.indexOf('id="progress"'));
    expect(html.indexOf(AREAS_LINE)).toBeGreaterThan(-1);
  });
});

describe("Home advertises nothing it cannot open (SYC-522)", () => {
  it("has no Coming soon line", () => {
    const html = page(full());
    expect(html).not.toContain("Coming soon");
    expect(html).not.toContain('id="soon"');
  });

  it("says Nothing waiting right now, not that nothing needs the team", () => {
    expect(NOTHING_WAITING).toBe("Nothing waiting right now.");
    expect(NOTHING_WAITING).not.toMatch(/needs you/i);
  });
});

describe("the menu's Workspace link (admin.catspotters.com opens the dashboard first)", () => {
  const WORKSPACE_LINK = '<a href="https://admin.catspotters.com/workspace">Workspace</a>';

  it("is there for the team, who may use the shared workspace", async () => {
    const res = await get("/api/team/home", staff);
    expect(res.status).toBe(200);
    expect(res.text).toContain(WORKSPACE_LINK);
  });

  it("isn't there for a cat guardian, whom the workspace would refuse", async () => {
    const res = await get("/api/team/my", guardian);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("admin.catspotters.com/workspace");
  });
});
