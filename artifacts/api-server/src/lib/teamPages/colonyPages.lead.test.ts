import { describe, expect, it } from "vitest";
import { renderColoniesPage } from "./colonyPages";
import { renderPeoplePage } from "./peoplePages";
import { renderPage } from "./layout";

// SYC-577: the empty Colonies page leads with what a colony is; People leads
// with its list; "This cat has died" is an outlined danger button.

const LEAD = "A colony is a group of street cats";
const colonies = (o: Partial<Parameters<typeof renderColoniesPage>[0]> = {}) =>
  renderColoniesPage({
    query: "",
    colonies: [],
    personName: "Sam",
    canCreate: true,
    figures: new Map(),
    sort: "name",
    now: new Date("2026-10-22T00:00:00Z"),
    recentChanges: [],
    ...o,
  });

describe("Colonies with none yet (SYC-577)", () => {
  it("says what a colony is, then Create a colony; no search and no Recent changes yet (SYC-619 §7.1)", () => {
    const html = colonies();
    const lead = html.indexOf(LEAD);
    expect(lead).toBeGreaterThan(-1);
    expect(html.indexOf("Create a colony")).toBeGreaterThan(lead);
    expect(html).not.toContain("Recent changes by cat guardians");
    expect(html).not.toContain('role="search"');
    expect(html.match(/id="create"/g)).toHaveLength(1);
    // Said once, not again by the empty list under it (SYC-522 review).
    expect(html.split(LEAD)).toHaveLength(2);
  });

  it("explains Growing only when a colony on the page is growing (SYC-522)", () => {
    const row = (id: number) => ({ id, name: `C${id}`, guardianName: null, siteCount: 0, catCount: 4 });
    const fig = (id: number, flags: ("growing" | "kittens")[]) =>
      ({ colonyId: id, street: 4, split: { sterilised: 0, probably: 0, not_known: 4, not_sterilised: 0 }, confirmedPct: 0, catCount: 4, latestSightingAt: null, flags, guardianNames: [] }) as never;
    const figures = new Map([[1, fig(1, ["growing"])], [2, fig(2, ["kittens"])]]);
    const KEY = "Growing: 3 or more new cats in the last 90 days";
    expect(colonies({ colonies: [row(1), row(2)], figures })).toContain(KEY);
    // A search that leaves only the colony that isn't growing: no key.
    expect(colonies({ colonies: [row(2)], figures, query: "C2" })).not.toContain(KEY);
  });

  it("is left out when the team cannot create, when searching, and for a cat guardian", () => {
    // Without Create, the empty list itself says what a colony is (SYC-522), once, with no button.
    const readOnly = colonies({ canCreate: false });
    expect(readOnly.split(LEAD)).toHaveLength(2);
    expect(readOnly).not.toContain("Create a colony");
    expect(colonies({ query: "zzz" })).not.toContain(LEAD);
    expect(colonies({ searched: true })).not.toContain(LEAD);
    expect(colonies({ island: false })).not.toContain(LEAD);
  });
});

describe("Colonies list order (SYC-619 §7.1)", () => {
  const row = (id: number, name: string) => ({ id, name, guardianName: null, siteCount: 0, catCount: 4 });
  const two = [row(1, "Alpha"), row(2, "Beta")];
  const inOrder = (html: string, marks: string[]) => {
    const at = marks.map((m) => html.indexOf(m));
    at.forEach((i, n) => expect(i, marks[n]).toBeGreaterThan(-1));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  };

  it("with colonies: search, sort, figures, list, Create, then Recent changes last", () => {
    const html = colonies({ colonies: two });
    inOrder(html, [
      'role="search"',
      'class="sortbar"',
      'class="figat"',
      'class="cats colonylist"',
      'id="create"',
      "Recent changes by cat guardians",
    ]);
  });

  it("searching with no matches keeps the search form, with Recent changes after it", () => {
    const html = colonies({ query: "zzz" });
    inOrder(html, ['role="search"', "Recent changes by cat guardians"]);
  });

  it("a cat guardian with no colony gets no search and no Recent changes, but her Create form", () => {
    const html = colonies({ island: false });
    expect(html).not.toContain('role="search"');
    expect(html).not.toContain("Recent changes by cat guardians");
    expect(html).toContain('id="create"');
  });
});

describe("People (SYC-577)", () => {
  const html = renderPeoplePage({ viewer: "Sam", tab: "people", people: [], left: [], recent: [], colonies: [], done: null });

  it("keeps the invite form behind an Invite someone button, above the list", () => {
    const fold = /<details class="invitefold"><summary[^>]*>Invite someone<\/summary>([\s\S]*?)<\/details>/.exec(html);
    expect(fold).not.toBeNull();
    expect(fold![1]).toContain('name="email"');
    expect(html.indexOf("Invite someone")).toBeLessThan(html.indexOf("<h2>Everyone</h2>"));
  });

  it("no longer says to type the address carefully", () => {
    expect(html).not.toContain("type it carefully");
    expect(html).toContain("Their email address");
  });
});

describe("This cat has died (SYC-577)", () => {
  it("is outlined in the danger colour, not the solid dark button", () => {
    const css = renderPage({ title: "x", body: "", active: null, personName: "Sam" });
    expect(css).toMatch(/\.fixes form\.diedform button\{[^}]*background:#fff;color:#8c1d18;border:2px solid #8c1d18/);
  });
});
