import { describe, expect, it } from "vitest";
import type { TeamCatView, TeamStatement } from "../teamCatView";
import { HISTORY_SHOWN, renderCatPage } from "./catPages";
import { renderPage } from "./layout";

// Pure render tests for the cat page's history cap and wide layout (SYC-219).

const statement = (id: number, over: Partial<TeamStatement> = {}): TeamStatement => ({
  id,
  kind: "note",
  said: `Said ${id}`,
  reason: null,
  author: { kind: "team", label: "Maria" },
  observedAt: "2026-03-01T10:00:00Z",
  createdAt: "2026-03-01T10:00:00Z",
  replaces: null,
  replacedBy: [],
  movedTo: null,
  ownerClaim: false,
  movedFrom: null,
  photoUrl: null,
  correction: null,
  ...over,
});

/** `n` statements, newest first: ids n, n-1, …, 1. */
const history = (n: number) =>
  Array.from({ length: n }, (_, i) => statement(n - i));

function view(
  n: number,
  opts: { life?: number[]; sterilised?: number[]; history?: TeamStatement[] } = {},
): TeamCatView {
  const resolved = (ids: number[]) => ({
    value: null,
    confidence: "unknown" as const,
    asOf: "2026-03-01T10:00:00Z",
    supportingStatementIds: ids,
    conflictingStatementIds: [],
  });
  return {
    cat: {
      id: 7,
      syr: "SYR-0007",
      name: "Tiger",
      description: "",
      lat: 37.44,
      lng: 24.94,
      createdAt: "2026-01-01T10:00:00Z",
      mainPhotoUrl: null,
    },
    owner: { has: false, orphanedHome: false, homeDescription: null, homePin: null },
    colony: null,
    publicStatus: {
      hasHome: false,
      lifeStatus: "street",
      notSeenSince: null,
      sterilised: { value: null, confidence: "unknown", clippedTipSightings: 0 },
      coat: [],
      markings: [],
    },
    records: {
      lifeStatus: {
        ...resolved(opts.life ?? []),
        presumedDeceased: false,
        notSeenSince: null,
      },
      sterilised: { ...resolved(opts.sterilised ?? []), clippedTipSightings: 0 },
    },
    sightings: [],
    photos: [],
    history: opts.history ?? history(n),
  };
}

const statementCount = (html: string) => (html.match(/<li class="statement/g) ?? []).length;
const statementIds = (html: string) =>
  [...html.matchAll(/<li class="statement[^"]*" id="s-(\d+)"/g)].map((m) => Number(m[1]));
const showAll = (html: string) => /Show all \d+/.exec(html)?.[0] ?? null;
const may = () => true;
const mayNot = () => false;

describe("cat page history cap", () => {
  it("shows 20 as the cap", () => {
    expect(HISTORY_SHOWN).toBe(20);
  });

  it("shows every statement and no Show all at or under the cap", () => {
    for (const n of [0, 5, 20]) {
      const html = renderCatPage(view(n), "Sam");
      expect(statementCount(html)).toBe(n);
      expect(html).not.toContain("Show all");
      expect(html).not.toContain("history=all");
    }
  });

  it("with 25 shows the newest 20, newest first, and a Show all 25 link", () => {
    const html = renderCatPage(view(25), "Sam");
    const ids = statementIds(html);
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe(25);
    expect(ids[19]).toBe(6);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(html).toContain("What has been said (25)");
    expect(html).toContain('<p class="more"><a class="tap" href="?history=all#history">Show all 25</a></p>');
  });

  it("allHistory shows all 25 and no link", () => {
    const html = renderCatPage(view(25), "Sam", { allHistory: true });
    expect(statementCount(html)).toBe(25);
    expect(showAll(html)).toBeNull();
  });

  it("landing on an old statement (at) shows all 25", () => {
    const html = renderCatPage(view(25), "Sam", { at: 3 });
    expect(statementCount(html)).toBe(25);
    expect(html).toContain('id="s-3"');
    expect(showAll(html)).toBeNull();
  });

  it("landing on a statement inside the newest 20 keeps the cap", () => {
    const html = renderCatPage(view(25), "Sam", { at: 24 });
    expect(statementCount(html)).toBe(20);
    expect(showAll(html)).toBe("Show all 25");
  });

  it("links a Based on ref outside the newest 20 to ?history=all#s-<id>, and inside to #s-<id>", () => {
    const html = renderCatPage(view(25, { sterilised: [3], life: [24] }), "Sam");
    expect(html).toContain('<a href="?history=all#s-3">Said 3</a>');
    expect(html).toContain('<a href="#s-24">Said 24</a>');
    expect(html).not.toContain('href="?history=all#s-24"');
  });

  it("links Replaced by and Corrects to a hidden statement via ?history=all", () => {
    const h = history(25);
    h[0] = statement(25, { replaces: 2 });
    h[24] = statement(1, { replacedBy: [25] });
    h[1] = statement(24, { replacedBy: [1] });
    const html = renderCatPage(view(25, { history: h }), "Sam");
    // #24 (shown) is replaced by #1 (not shown).
    expect(html).toContain('Replaced by <a href="?history=all#s-1">#1</a>');
    // #25 (shown) corrects #2 (not shown).
    expect(html).toContain('Corrects <a href="?history=all#s-2">#2</a>');
  });

  it("links Replaced by and Corrects straight to #s-<id> when every statement is shown", () => {
    const h = history(5);
    h[0] = statement(5, { replaces: 2 });
    h[3] = statement(2, { replacedBy: [5] });
    const html = renderCatPage(view(5, { history: h }), "Sam");
    expect(html).toContain('Replaced by <a href="#s-5">#5</a>');
    expect(html).toContain('Corrects <a href="#s-2">#2</a>');
    expect(html).not.toContain("history=all");
  });
});

describe("cat page layout", () => {
  it("uses the wide page and names the gallery All photos (n)", () => {
    const v = view(1);
    v.photos = [
      { url: "/api/team/photos/a", publicId: "a", source: "main", hidden: null },
      { url: "/api/team/photos/b", publicId: "b", source: "sighting", hidden: null },
    ];
    const html = renderCatPage(v, "Sam");
    expect(html).toContain('<main class="wide">');
    expect(html).toContain('<h2 id="photos">All photos (2)</h2>');
  });

  it("wraps the record and the forms in twocol when the person may correct", () => {
    const html = renderCatPage(view(1), "Sam", { may });
    expect(html).toContain('<div class="twocol">');
    expect(html).toContain('id="corrections"');
    // The record is in the first column, the forms in the second.
    const two = html.indexOf('<div class="twocol">');
    expect(html.indexOf("What the records say")).toBeGreaterThan(two);
    expect(html.indexOf('id="corrections"')).toBeGreaterThan(html.indexOf("What the records say"));
  });

  it("has no twocol when the person may not correct anything", () => {
    const html = renderCatPage(view(1), "Sam", { may: mayNot });
    expect(html).not.toContain('<div class="twocol">');
    expect(html).not.toContain('id="corrections"');
    expect(html).toContain("What the records say");
  });

  it("has no twocol with the default (no may) either", () => {
    expect(renderCatPage(view(1), "Sam")).not.toContain('<div class="twocol">');
  });
});

describe("renderPage chrome (SYC-219)", () => {
  const page = (nav?: boolean) =>
    renderPage({ title: "T", active: "queue", personName: "Maria <b>", body: "<p>x</p>", nav });

  it("nav:false renders no nav but still has Sign out beside the name", () => {
    const html = page(false);
    expect(html).not.toContain("<nav");
    expect(html).toContain('<form method="post" action="/api/team/signout"><button type="submit">Sign out</button></form>');
    expect(html).toContain("Signed in as Maria &lt;b&gt;");
  });

  it("with the nav, Sign out is in div.who and not in the nav", () => {
    const html = page();
    const nav = /<nav class="bar">([\s\S]*?)<\/nav>/.exec(html)![1]!;
    expect(nav).not.toContain("Sign out");
    const who = /<div class="who">([\s\S]*?)<\/div>/.exec(html)![1]!;
    expect(who).toContain("Signed in as");
    expect(who).toContain("Sign out");
  });
});
