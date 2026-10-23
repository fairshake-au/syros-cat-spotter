import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backLink, HOME_PATH } from "./backLink";
import { renderAreasPage } from "./areasPage";
import { renderLikelyPage } from "./likelyPage";
import { renderColourCheckPage } from "./appearancePage";
import { renderVetSettingsPage } from "./vetSettingsPage";
import { renderColonyPage, renderAddCatsPage } from "./colonyPages";
import { renderSitePage } from "./sitePages";
import { renderRolesPage, renderBringBackPage } from "./peoplePages";
import { renderFindForm, renderFindProblem } from "./findPhotoPage";
import { renderCatGridPage } from "./catGridPage";
import { renderHealthPage } from "./reportPages";
import { CATALOGUE } from "./strings";
import { parseRange } from "../reports/range";

// SYC-619 PR1 Task 4: one kind of back link, going to the right place (spec §2.5).
// Each row renders a page and reads its `p.back` link: the text and the href.

// One pass, so "&amp;lt;" becomes "&lt;" and is never unescaped twice.
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' };
const unescape = (s: string) => s.replace(/&(?:amp|lt|gt|quot);/g, (e) => ENTITIES[e]!);

function backOf(html: string): { href: string; label: string } | null {
  const m = html.match(/<p class="back"><a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a><\/p>/);
  return m ? { href: unescape(m[1]!), label: m[2]! } : null;
}

const person = {
  id: "p1",
  name: "Susan",
  email: "s@example.com",
  anonymised: false,
  state: "active",
  chip: "",
  roles: "A member of the Syros Cats team.",
  placements: [],
  timing: "",
  holdsWorkspace: false,
  joinedAt: null,
  history: [],
  isSelf: false,
  starting: false,
} as never;

const NOW = new Date("2026-10-20T12:00:00Z");
// A report someone sent: what the "from a report" pages show about it.
const REPORT = { id: "rep1", severity: "attention", isLitter: false, at: NOW.toISOString(), cat: null } as never;
const TIE = { publicId: "rep1", report: REPORT, canTie: true };

// The feeding site's small map signs its tile tokens, so it needs a key here.
const KEY = "vitest-backlinks-key-0123456789abcdef-0123456789";
let savedKey: string | undefined;
beforeAll(() => {
  savedKey = process.env["TEAM_SESSION_KEYS"];
  process.env["TEAM_SESSION_KEYS"] = KEY;
});
afterAll(() => {
  if (savedKey === undefined) delete process.env["TEAM_SESSION_KEYS"];
  else process.env["TEAM_SESSION_KEYS"] = savedKey;
});

const ROWS: [string, () => string, string, string][] = [
  ["Areas", () => renderAreasPage({ personName: "Susan", link: true, areas: [], version: 1, history: [] }), "← Home", HOME_PATH],
  ["Ear clips to check", () => renderLikelyPage([], "Susan"), "← Home", HOME_PATH],
  ["Colour check", () => renderColourCheckPage([], "Susan"), "← Home", HOME_PATH],
  ["Vet settings", () => renderVetSettingsPage({ personName: "Susan", priceEur: 55, history: [] }), "← Home", HOME_PATH],
  [
    "A colony",
    () =>
      renderColonyPage(
        { id: 3, name: "Kalamos", guardianName: null, notes: null, lat: null, lng: null, siteCount: 0, catCount: 0, sites: [], cats: [], history: [] } as never,
        "Susan",
        { may: () => true },
      ),
    "← Colonies",
    "/api/team/colonies",
  ],
  [
    "Add cats to a colony",
    () => renderAddCatsPage({ colony: { id: 3, name: "Kalamos" }, query: "", results: [], personName: "Susan" }),
    "← Kalamos",
    "/api/team/colonies/3",
  ],
  [
    "A feeding site",
    () =>
      renderSitePage({
        personName: "Susan",
        site: { id: 4, name: "Harbour bins", lat: 37.4, lng: 24.9, isPublic: false, madePublicAt: null, madePublicBy: null, retiredAt: null, publicLabel: null, colony: null, notes: null, directions: null, updatedAt: "0", history: [] } as never,
        view: { z: 14, x: 1, y: 1 },
        colonies: [],
      }),
    "← Feeding sites",
    "/api/team/sites",
  ],
  ["Change someone's roles", () => renderRolesPage({ viewer: "Susan", person, colonies: [], pre: { roles: [], colonies: new Map() } }), "← People", "/api/team/people"],
  [
    "Bring someone back",
    () => renderBringBackPage({ viewer: "Susan", person, held: null, colonies: [] }),
    "← People who left",
    "/api/team/people?tab=left",
  ],
  ["Find from a photo", () => renderFindForm({ personName: "Susan", filters: {}, colonies: [], now: NOW, narrowing: { kind: "none" } }), "← Cats", "/api/team/cats"],
  ["Find from a photo, from a report", () => renderFindProblem({ personName: "Susan", filters: {}, colonies: [], now: NOW, tie: TIE, words: "x", gridLink: false }), "← The report", "/api/team?open=rep1#r-rep1"],
  [
    "The Cats grid, from a report",
    () => renderCatGridPage({ items: [], total: 0, catCount: 0, filters: {}, personName: "Susan", now: NOW, colonies: [], tie: TIE }),
    "← The report",
    "/api/team?open=rep1#r-rep1",
  ],
  [
    "A report",
    () => renderHealthPage({ rows: [], areasVersion: 1, workedOutAt: NOW, ms: 0 }, { personName: "Susan", range: parseRange(undefined, NOW), sort: "name", dir: "asc", canExport: false }),
    "← Reports",
    "/api/team/insights",
  ],
];

describe("the back link helper", () => {
  it("draws the arrow, then the label, and escapes the label", () => {
    expect(backLink("/api/team/home", "Home")).toBe('<p class="back"><a href="/api/team/home">← Home</a></p>');
    expect(backLink("/x", "<b>Rock & roll</b>")).toBe('<p class="back"><a href="/x">← &lt;b&gt;Rock &amp; roll&lt;/b&gt;</a></p>');
  });
});

describe("the Colour check label in each language", () => {
  // Team pages draw English until a language goes live (strings/index.ts), so
  // Greek and French are checked in the catalogue itself.
  it("is Home in each catalogue", () => {
    expect(CATALOGUE.en["colourCheck.back"]).toBe("Home");
    expect(CATALOGUE.el["colourCheck.back"]).toBe("Αρχική");
    expect(CATALOGUE.fr["colourCheck.back"]).toBe("Accueil");
  });
});

describe("back links on every page in spec §2.5", () => {
  it.each(ROWS)("%s: one back link, to the right place", (_name, render, label, href) => {
    expect(backOf(render())).toEqual({ href, label });
  });
});
