import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { placeLabel } from "../areas/placeLabel";
import { renderCatPage } from "./catPages";
import { bareCatView, catView, richCatView, statement } from "./__fixtures__/catView";

// SYC-602 Task 1.2: the name line, the status line and the notices.

const NOW = new Date("2026-10-17T09:00:00Z");
const page = (v = richCatView(), opts = {}) => renderCatPage(v, "Sam", { now: NOW, ...opts });

/** True when `at` sits inside any <details>...</details> of the html. */
function insideDetails(html: string, at: number): boolean {
  const opens = (html.slice(0, at).match(/<details[\s>]/g) ?? []).length;
  const closes = (html.slice(0, at).match(/<\/details>/g) ?? []).length;
  return opens > closes;
}

describe("the team cat page summary", () => {
  it("says when the cat joined our records", () => {
    const v = catView({ cat: { id: 42, syr: "SYR-0042", createdAt: "2026-04-03T10:00:00Z" } });
    expect(page(v)).toContain("SYR-0042 · on our records since 3 Apr 2026");
  });

  it("never says statement in the guardian-mark notice", () => {
    const v = catView({
      recentGuardianMark: { statementId: 5, status: "homed", at: "2026-10-10T09:00:00Z" },
      history: [statement(5)],
    });
    const html = page(v);
    const notice = html.slice(html.indexOf("Recently marked"), html.indexOf("</p>", html.indexOf("Recently marked")));
    expect(notice).toContain("See the change</a>");
    expect(notice.replace(/<[^>]*>/g, " ").toLowerCase()).not.toContain("statement");
  });

  it("puts notices above the name, never inside a fold", () => {
    const guardian = catView({
      recentGuardianMark: { statementId: 5, status: "homed", at: "2026-10-10T09:00:00Z" },
      history: [statement(5)],
    });
    const died = catView({
      records: { lifeStatus: { value: "deceased", confidence: "confirmed", supportingStatementIds: [9] } },
      history: [statement(9, { kind: "life_status", said: "Has died" })],
    });
    const hidden = catView({
      photos: [
        {
          source: "main",
          publicId: "p1",
          url: "/p1.jpg",
          hidden: { by: "Maria", at: "2026-10-01T09:00:00Z" },
        },
      ],
    } as never);
    for (const [v, needle] of [
      [guardian, "Recently marked"],
      [died, "has died"],
      [hidden, "The main photo is hidden"],
    ] as const) {
      const html = page(v);
      const n = html.indexOf(needle);
      expect(n, needle).toBeGreaterThan(-1);
      expect(n, needle).toBeLessThan(html.indexOf("<h1"));
      expect(insideDetails(html, n), needle).toBe(false);
    }
  });

  it("keeps the description as one line under the facts", () => {
    const html = page();
    const d = html.indexOf('<p class="desc">');
    expect(d).toBeGreaterThan(html.indexOf('class="catfacts kf"'));
    expect(html).toContain('<p class="desc">Grey tabby with white paws, often by the harbour steps.</p>');
  });
});

describe("the small map's caption (SYC-602 Task 1.4)", () => {
  const KEY = "vitest-catmap-key-0123456789abcdef-0123456789";
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env["TEAM_SESSION_KEYS"];
    process.env["TEAM_SESSION_KEYS"] = KEY;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env["TEAM_SESSION_KEYS"];
    else process.env["TEAM_SESSION_KEYS"] = saved;
  });

  const sighting = (id: number, i: number, over = {}) => ({
    id,
    lat: 37.4447 + (i % 5) * 0.0004,
    lng: 24.9418 + (i % 7) * 0.0004,
    at: new Date(Date.UTC(2026, 9, 16) - i * 86_400_000).toISOString(),
    photoUrl: null,
    extraPhotos: [],
    mixedCats: false,
    ...over,
  });
  const withSightings = (n: number, opts = {}) => {
    const v = catView();
    v.sightings = Array.from({ length: n }, (_, i) => sighting(500 + n - i, i));
    return renderCatPage(v, "Sam", { now: NOW, ...opts });
  };
  const caption = (html: string) => /<p class="mapcap">[\s\S]*?<\/p>/.exec(html)![0];

  it("starts with the newest sighting's place, the words Last seen uses", () => {
    const v = catView();
    v.sightings = [sighting(2, 0), sighting(1, 3)];
    const html = renderCatPage(v, "Sam", { now: NOW });
    const place = placeLabel(v.sightings[0]!);
    expect(caption(html)).toMatch(new RegExp(`^<p class="mapcap"><span>${place}</span>`));
    expect(html).toContain(`</time> · <a href="#tab-map">${place}</a>`);
  });

  it("gives a merged marker the pill class, and a lone one not", () => {
    const v = catView();
    v.sightings = [sighting(3, 0, { lat: 37.4447, lng: 24.9418 }), sighting(2, 1, { lat: 37.4447, lng: 24.9418 }), sighting(1, 2, { lat: 37.4500, lng: 24.9500 })];
    const html = renderCatPage(v, "Sam", { now: NOW });
    expect(html).toMatch(/<a class="pin seen multi"[^>]*><span class="pinnum" aria-hidden="true">2–3<\/span>/);
    expect(html).toMatch(/<a class="pin seen"[^>]*><span class="pinnum" aria-hidden="true">1<\/span>/);
  });

  // placeLabel is fixed vocabulary here (an area's name; no site label is passed),
  // so no hostile place string can reach the caption; the caption is escaped anyway.
  it("escapes the place in the caption", () => {
    const v = catView();
    v.sightings = [sighting(2, 0), sighting(1, 3)];
    v.sightings[0]!.lat = 0; // off the island: its place words come from placeLabel, never raw
    const html = renderCatPage(v, "Sam", { now: NOW });
    expect(caption(html)).not.toMatch(/<(?!\/?(p|span|a)\b)/);
  });

  it("adds Newest 30 of 41 when there are more sightings than the map shows", () => {
    expect(caption(withSightings(41))).toContain(" · Newest 30 of 41");
    expect(caption(withSightings(30))).not.toContain("Newest");
  });

  it("says Open the map, keeping the focus address, for people who may see the whole island", () => {
    const html = withSightings(3, { island: true });
    expect(caption(html)).toContain('<a class="tap" href="/api/team/cats?view=map&amp;focus=');
    expect(caption(html)).toContain(">Open the map</a>");
    expect(html).not.toContain("Open the full map");
  });

  it("leaves the link out for people who may not see the whole island", () => {
    expect(caption(withSightings(3))).not.toContain("<a");
  });

  it("draws one marker per spot, with the range of its numbers, linking to the newest", () => {
    const v = catView();
    // Oldest first: 1 and 5 at one spot; 2, 3, 4 at another.
    const spots = [[37.4447, 24.9418], [37.4451, 24.9421], [37.4451, 24.9421], [37.4451, 24.9421], [37.4447, 24.9418]] as const;
    v.sightings = spots
      // mixedCats: never grouped into a run (SYC-602 PR 2), so each marker lands on its own row.
      .map(([lat, lng], i) => sighting(900 + i, 0, { lat, lng, at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), mixedCats: true }))
      .reverse();
    const html = renderCatPage(v, "Sam", { now: NOW });
    const band = /<div class="mapband b179"[\s\S]*?<\/div>/.exec(html)![0];
    const pins = [...band.matchAll(/<a class="pin seen(?: multi)?"[^>]*href="#sg-(\d+)"[^>]*><span class="pinnum"[^>]*>([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
    expect(pins).toEqual([["904", "1, 5"], ["903", "2–4"]]);
  });
});

describe("the layout, page order and jump links (SYC-602 Task 1.5)", () => {
  const photos = [
    { source: "main", publicId: "p1", url: "/p1.jpg", hidden: null },
    { source: "sighting", publicId: "p2", url: "/p2.jpg", hidden: null },
    { source: "sighting", publicId: "p3", url: "/p3.jpg", hidden: { by: "Maria", at: "2026-10-01T09:00:00Z" } },
  ];
  const withPhotos = () => catView({ cat: { mainPhotoUrl: "/p1.jpg" }, photos, sightings: richCatView().sightings } as never);
  const may = () => true;
  let savedKey: string | undefined;
  beforeAll(() => {
    savedKey = process.env["TEAM_SESSION_KEYS"];
    process.env["TEAM_SESSION_KEYS"] = "vitest-catmap-key-0123456789abcdef-0123456789";
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env["TEAM_SESSION_KEYS"];
    else process.env["TEAM_SESSION_KEYS"] = savedKey;
  });

  it("orders the summary for a phone", () => {
    const html = page(withPhotos(), { may, colonies: [] });
    const marks = ['<div class="catcard', 'class="photo catmain"', 'class="catfacts kf"', 'class="publicline"', 'id="corrections"', 'class="catmap"', '<nav class="jump"'];
    const at = marks.map((m) => html.indexOf(m));
    expect(at.every((i) => i > -1), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("has jump links with counts, none marked as selected", () => {
    const html = page(richCatView());
    const nav = html.slice(html.indexOf('<nav class="jump"'), html.indexOf("</nav>", html.indexOf('<nav class="jump"')));
    // Every History row (SYC-602 PR 2): 21 sightings and two changes.
    expect(nav).toContain('href="#history">History (23)</a>');
    expect(nav).toContain('href="#photos">Photos (0)</a>');
    expect(nav).toContain('href="#appearance">Coat and markings</a>');
    expect(nav).not.toContain("#issue-strip");
    expect(nav).not.toContain("aria-current");
    for (const id of ["history", "photos", "appearance"]) expect(html, id).toContain(`id="${id}"`);
  });

  it("orders the jump links like the right-hand column: History, Photos, Reports, Coat and markings", () => {
    const issues = {
      total: 1,
      reports: [{ id: "i1", reason: "wrong_cat", state: "new", at: "2026-10-10T09:00:00Z", others: 0, photo: null }],
    };
    const html = page(richCatView(), { issues });
    const nav = html.slice(html.indexOf('<nav class="jump"'), html.indexOf("</nav>", html.indexOf('<nav class="jump"')));
    const at = ["#history", "#photos", "#issue-strip", "#appearance"].map((h) => nav.indexOf(`href="${h}"`));
    expect(at.every((n) => n > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const none = page(richCatView());
    const n2 = none.slice(none.indexOf('<nav class="jump"'), none.indexOf("</nav>", none.indexOf('<nav class="jump"')));
    expect(n2.indexOf("#photos")).toBeLessThan(n2.indexOf("#appearance"));
  });

  it("links to the reports only when there are some", () => {
    const issues = {
      total: 1,
      reports: [{ id: "i1", reason: "wrong_cat", state: "new", at: "2026-10-10T09:00:00Z", others: 0, photo: null }],
    };
    const html = page(richCatView(), { issues });
    expect(html).toContain('href="#issue-strip">Reports (1)</a>');
    expect(html).toContain('id="issue-strip"');
  });

  describe("the reports box and section (SYC-602 Task 3.3)", () => {
    const rep = (id: string, state: string, at: string, reason = "wrong_cat") => ({ id, reason, state, at, others: 0, photo: null });
    /** The words a person reads: each tag becomes a space (so no new tag can
     * form), then spaces are squeezed. */
    const stripTags = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const box = (html: string) => /<aside class="openreports"[\s\S]*?<\/aside>/.exec(html)?.[0] ?? "";

    it("draws an amber box above the facts for one open report, linking to it", () => {
      const html = page(richCatView(), { issues: { total: 1, reports: [rep("i1", "new", "2026-10-15T09:00:00Z")] } });
      const b = box(html);
      expect(stripTags(b)).toMatch(/^1 open report: .+ · 2 days ago$/);
      expect(b).toContain('href="/api/team?open=i1#r-i1"');
      expect(html.indexOf('class="openreports"')).toBeLessThan(html.indexOf('class="catfacts kf"'));
      // Spec §2: the very top of the card, above the photo.
      expect(html.indexOf('class="openreports"')).toBeGreaterThan(html.indexOf('<div class="catcard'));
      expect(html.indexOf('class="openreports"')).toBeLessThan(html.indexOf('class="cardphoto"'));
    });

    it("says N open reports, names the newest open one, and counts looking as open", () => {
      const html = page(richCatView(), {
        issues: {
          total: 3,
          reports: [
            rep("c1", "done", "2026-10-16T09:00:00Z", "other"),
            rep("o2", "looking", "2026-10-14T09:00:00Z"),
            rep("o1", "new", "2026-10-10T09:00:00Z"),
          ],
        },
      });
      const b = box(html);
      expect(b).toContain("2 open reports:");
      expect(b).toContain('href="/api/team?open=o2#r-o2"');
      expect(b).not.toContain("c1");
    });

    it("escapes the reason", () => {
      const html = page(richCatView(), { issues: { total: 1, reports: [rep("i1", "new", "2026-10-15T09:00:00Z", "<b>x</b>")] } });
      expect(box(html)).not.toContain("<b>x</b>");
    });

    it("keeps the full list in its own Reports section after the photos", () => {
      const html = page(richCatView(), { issues: { total: 1, reports: [rep("i1", "new", "2026-10-15T09:00:00Z")] } });
      const sec = html.indexOf('<section id="issue-strip"');
      expect(sec).toBeGreaterThan(html.indexOf('id="photos"'));
      expect(html.slice(sec)).toContain("<h2>Reports (1)</h2>");
    });

    it("with only closed reports: no box, the section stays", () => {
      const html = page(richCatView(), { issues: { total: 1, reports: [rep("i1", "done", "2026-10-15T09:00:00Z")] } });
      expect(html).not.toContain('class="openreports"');
      expect(html).toContain('id="issue-strip"');
    });

    it("with issues null: neither", () => {
      const html = page(richCatView(), { issues: null });
      expect(html).not.toContain('class="openreports"');
      expect(html).not.toContain('id="issue-strip"');
    });

    it("lays History left and Photos, Reports, Coat right on a wide screen", () => {
      const html = page(richCatView(), { issues: { total: 1, reports: [rep("i1", "new", "2026-10-15T09:00:00Z")] } });
      const cols = html.indexOf('class="catcols"');
      expect(cols).toBeGreaterThan(-1);
      const side = html.indexOf('class="catside"', cols);
      const at = (n: string) => html.indexOf(n, cols);
      expect(at('id="history"')).toBeLessThan(side);
      for (const id of ['id="photos"', 'id="issue-strip"', 'id="appearance"']) expect(at(id), id).toBeGreaterThan(side);
      expect(at('id="photos"')).toBeLessThan(at('id="issue-strip"'));
      expect(at('id="issue-strip"')).toBeLessThan(at('id="appearance"'));
    });
  });

  it("leaves no heading with nothing under it on a bare cat", () => {
    const html = page(bareCatView());
    for (const m of html.matchAll(/<h2[^>]*>[^<]*<\/h2>\s*(<[^>]*>)/g)) {
      expect(m[1], m[0]).not.toMatch(/^<\/(main|div|section)/);
    }
    expect(html).not.toMatch(/<h2[^>]*>[^<]*<\/h2>\s*<h2/);
  });
});

describe("the photos grid (SYC-602 Task 3.1)", () => {
  const photo = (n: number, over: Record<string, unknown> = {}) => ({
    source: n === 1 ? "main" : "sighting",
    publicId: `p${n}`,
    url: `/api/team/photos/p${n}`,
    at: `2026-10-${String(20 - n).padStart(2, "0")}T09:00:00Z`,
    hidden: null,
    ...over,
  });
  const four = (over4: Record<string, unknown> = {}) =>
    catView({ photos: [photo(1), photo(2), photo(3), photo(4, over4)] } as never);
  const may = () => true;
  const figure = (html: string, id: string) => {
    const at = html.indexOf(`<figure id="p-${id}"`);
    return html.slice(at, html.indexOf("</figure>", at));
  };

  it("heads the grid Photos (4) and calls the first Main photo, the others by date", () => {
    const html = page(four(), { may });
    expect(html).toContain('<h2 id="photos">Photos (4)</h2>');
    expect(html).not.toContain("All photos");
    expect(figure(html, "p1")).toContain("Main photo");
    expect(figure(html, "p2")).toContain("18 Oct");
    expect(figure(html, "p2")).not.toContain("Main photo");
  });

  it("puts Hide from the public in each photo's menu", () => {
    const html = page(four(), { may });
    for (const id of ["p1", "p2", "p3", "p4"]) {
      const g = figure(html, id);
      expect(g.indexOf("<form")).toBeGreaterThan(g.indexOf('<details class="rowmenu dots"'));
      expect(g.indexOf("</details>")).toBeGreaterThan(g.indexOf("<form"));
    }
    const f = figure(html, "p2");
    const menu = f.slice(f.indexOf('<details class="rowmenu dots"'));
    expect(menu).toContain('href="/api/team/photos/p2">Open full size');
    expect(menu).toContain("Open full size");
    expect(menu).toContain('action="/api/team/photos/p2/hide"');
    expect(menu).toMatch(/<input type="hidden" name="cat" value="\d+">/);
    expect(menu).toMatch(/class="hide risky"[^>]*>Hide from the public<span class="sr"> \(photo 2 of 4\)<\/span>/);
    expect(figure(html, "p4")).toContain("photo 4 of 4");
  });

  it("offers Show to the public again on a hidden photo, and no form when not allowed", () => {
    const hidden = { by: "Maria", at: "2026-10-03T09:00:00Z", reason: null };
    const html = page(four({ hidden }), { may });
    const f = figure(html, "p4");
    expect(f).toContain('action="/api/team/photos/p4/restore"');
    expect(f).toContain("Show to the public again");
    expect(f).not.toContain("Hide from the public");
    const none = page(four(), { may: () => false });
    expect(figure(none, "p2")).not.toContain("<form");
    expect(figure(none, "p2")).toContain("Open full size");
  });

  it("labels a hidden photo with who and when", () => {
    const hidden = { by: "Maria", at: "2026-10-03T09:00:00Z", reason: "Shows a child" };
    const f = figure(page(four({ hidden }), { may }), "p4");
    expect(f).toContain("Hidden · Maria, <time");
    expect(f).toContain(">3 Oct</time>");
    expect(f).toContain("Shows a child");
    expect(f).toContain('class="ishidden"');
  });

  it("opens the photo's menu and shows the notice on landing", () => {
    const html = page(four(), { may, photo: "p3", done: "hidden" });
    const f = figure(html, "p3");
    expect(f).toContain('<details class="rowmenu dots" open>');
    expect(f).toContain("Hidden. The public no longer sees this photo.");
    expect(insideDetails(html, html.indexOf("Hidden. The public no longer sees"))).toBe(false);
    expect(html.split("Hidden. The public no longer sees").length).toBe(2);
    expect(figure(html, "p2")).not.toContain(" open>");
  });

  it("opens a photo's menu only with a real done key and a found photo", () => {
    expect(figure(page(four(), { may, photo: "p3" }), "p3")).not.toContain(" open>");
    expect(figure(page(four(), { may, photo: "p3", done: "constructor" }), "p3")).not.toContain(" open>");
    expect(figure(page(four(), { may, photo: "p3", done: "restored" }), "p3")).toContain(" open>");
  });

  it("labels Main photo by its source, not its position", () => {
    const moved = catView({
      photos: [photo(2), photo(1), photo(3)],
    } as never);
    const html = page(moved, { may });
    expect(figure(html, "p1")).toContain("Main photo");
    expect(figure(html, "p2")).not.toContain("Main photo");
    const none = catView({ photos: [photo(2), photo(3)] } as never);
    expect(page(none, { may })).not.toContain("Main photo");
  });

  it("puts the notice above the card when the photo isn't found (SYC-655 A7)", () => {
    const html = page(four(), { may, photo: "nope", done: "restored" });
    const at = html.indexOf("Restored. The public sees this photo again.");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf('<div class="catcard'));
    expect(html.match(/Restored\. The public sees this photo again\./g)).toHaveLength(1);
  });
});
