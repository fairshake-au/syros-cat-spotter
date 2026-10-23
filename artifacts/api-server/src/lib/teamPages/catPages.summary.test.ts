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

  it("puts the status line under the name", () => {
    const html = page();
    const h1 = html.indexOf("<h1");
    const line = html.indexOf('class="statusline"');
    expect(line).toBeGreaterThan(h1);
    const at = (needle: string) => html.indexOf(needle, line);
    const order = [at("mark-sterilised"), at("Lives on the street"), at('href="/api/team/colonies/4"'), at("Last seen 4 days ago")];
    expect(order.every((i) => i > line)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
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

  it("keeps each separator inside the part before it, so a wrapped line never starts with a dot", () => {
    const html = page();
    const line = html.slice(html.indexOf('class="statusline"'), html.indexOf("</p>", html.indexOf('class="statusline"')));
    const parts = line.split('<span class="sl">').slice(1).map((p) => p.trim());
    expect(parts.length).toBeGreaterThan(2);
    parts.slice(0, -1).forEach((p) => expect(p).toMatch(/ ·<\/span>$/));
    expect(parts[parts.length - 1]).not.toMatch(/·<\/span>$/);
    expect(line).not.toMatch(/<span class="sl">\s*·/);
  });

  it("leaves the colony out of the status line when the cat has none", () => {
    const html = page(bareCatView());
    const line = html.slice(html.indexOf('class="statusline"'));
    const end = line.slice(0, line.indexOf("</p>"));
    expect(end).not.toMatch(/colon/i);
    expect(end).toContain("Not known");
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
    expect(d).toBeGreaterThan(html.indexOf('class="catfacts"'));
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
    expect(html).toContain(`</time> · ${place}`);
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
      .map(([lat, lng], i) => sighting(900 + i, 0, { lat, lng, at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString() }))
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
    const marks = ['class="photo catmain"', 'class="photostrip"', 'class="catfacts"', 'class="publicline"', 'id="corrections"', 'class="catmap"', '<nav class="jump"'];
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

  it("links to the reports only when there are some", () => {
    const issues = {
      total: 1,
      reports: [{ id: "i1", reason: "wrong_cat", state: "new", at: "2026-10-10T09:00:00Z", others: 0, photo: null }],
    };
    const html = page(richCatView(), { issues });
    expect(html).toContain('href="#issue-strip">Reports (1)</a>');
    expect(html).toContain('id="issue-strip"');
  });

  it("dims hidden photos in the strip", () => {
    const html = page(withPhotos());
    const strip = html.slice(html.indexOf('class="photostrip"'));
    const hiddenLi = /<li class="hidden">[\s\S]*?<\/li>/.exec(strip)?.[0] ?? "";
    expect(hiddenLi).toContain("hidden from the public");
    expect(hiddenLi).toContain('<span class="hiddentag">Hidden</span>');
    expect(strip.slice(0, strip.indexOf("</ul>")).match(/class="hidden"/g)).toHaveLength(1);
  });

  it("shows up to three more photos and an All N tile that jumps to Photos", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      source: i === 0 ? "main" : "sighting",
      publicId: `p${i + 1}`,
      url: `/p${i + 1}.jpg`,
      hidden: null,
    }));
    const v = catView({ cat: { mainPhotoUrl: "/p1.jpg" }, photos: many, sightings: richCatView().sightings } as never);
    const html = page(v);
    const strip = html.slice(html.indexOf('class="photostrip"'), html.indexOf("</ul>", html.indexOf('class="photostrip"')));
    expect(strip.match(/<img /g)).toHaveLength(3);
    expect(strip).toContain('<a class="more" href="#photos">All 6</a>');
    expect(strip).not.toContain("+");
    const few = catView({ cat: { mainPhotoUrl: "/p1.jpg" }, photos: many.slice(0, 3) } as never);
    const f = page(few);
    expect(f.slice(f.indexOf('class="photostrip"'))).toContain("All 3");
  });

  it("leaves no heading with nothing under it on a bare cat", () => {
    const html = page(bareCatView());
    for (const m of html.matchAll(/<h2[^>]*>[^<]*<\/h2>\s*(<[^>]*>)/g)) {
      expect(m[1], m[0]).not.toMatch(/^<\/(main|div|section)/);
    }
    expect(html).not.toMatch(/<h2[^>]*>[^<]*<\/h2>\s*<h2/);
  });
});
