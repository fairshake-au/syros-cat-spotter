import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catMapRig, POSITIONS } from "./__fixtures__/catMapRig";

// SYC-396 PR 1.5 (spec §6.3, §10.4); SYC-705 Task 2b.6: the island map's
// script asks our server for one thing only: the cats, by a POST to a fixed
// address with the filters in the body. The map file, its style and fonts are
// map-core.js's to fetch, from the fixed map-data addresses. No position, no
// filter ever goes into an address it builds. The first part reads the
// script itself, so a change that puts something in a query string fails here
// before any browser runs it; the second runs it on the fake MapLibre and
// watches every request the page makes.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "assets", "dashboard-map.js");
const src = readFileSync(SCRIPT, "utf8");

/** The first argument of every call to `name(`, as written. */
function firstArgs(name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${name}\\(`, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if ("([{".includes(src[i]!)) depth++;
      else if (")]}".includes(src[i]!)) depth--;
      else if (src[i] === "," && depth === 1) break;
    }
    out.push(src.slice(start, i).trim());
  }
  return out;
}

describe("the island map's script asks for fixed addresses only", () => {
  it("POSTs to exactly one route, the cats' positions, by fixed address", () => {
    const urls = firstArgs("postJson").filter((a) => a !== "url"); // the helper's own definition
    expect(urls).toEqual(['"/api/team/cats/positions"']);
  });

  it("fetch is called only inside the POST helper", () => {
    expect(firstArgs("fetch")).toEqual(["url"]);
    expect(src).not.toMatch(/XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket|EventSource|import\(/);
  });

  it("the only address it puts in an image is the cat's photo, one of our own", () => {
    const srcs = [...src.matchAll(/\.src\s*=\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(srcs).toEqual(["cat.photo"]);
    expect(src).toContain('c.photo.indexOf("/api/team/photos/") === 0');
  });

  it("no address it builds has a query string, but the page's own (the filter form's fields)", () => {
    // Every string literal that starts an address of ours.
    const literals = [...src.matchAll(/"(\/api\/[^"]*)"/g)].map((m) => m[1]!);
    for (const l of literals) expect(l, l).not.toContain("?");
    // The only "?" joined onto an address is the page's own, from query().
    const joins = [...src.matchAll(/\+\s*"\?"\s*\+\s*([\w.]+)/g)].map((m) => m[1]);
    for (const j of joins) expect(["qs", "gridQs", "findQs"]).toContain(j);
    expect(src).not.toMatch(/[?&](?:lat|lng|z|x|y)=/);
  });

  it("the 'Find from a photo' link is rebuilt from exactly colours, area and colony", () => {
    // The keys the script copies from the filter form onto the link, as written.
    const m = /var findParams = new URLSearchParams\(\);\s*(\[[^\]]*\])\.forEach/.exec(src);
    expect(m, "the findParams key list").not.toBeNull();
    const keys = [...m![1]!.matchAll(/"([^"]*)"/g)].map((k) => k[1]);
    expect(keys).toEqual(["colours", "area", "colony"]);
  });

  it("never builds HTML from strings", () => {
    expect(src).not.toMatch(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|setHTML|createContextualFragment/);
    // Markers are elements made here, handed to MapLibre as elements.
    for (const arg of [...src.matchAll(/new lib\.Marker\(\{([^}]*)\}/g)].map((m) => m[1]!.trim()))
      expect(arg).toBe('element: el, anchor: "center"');
  });
});

const MAP_DATA = new Set([
  "/api/team/map-data/current",
  "/api/team/map-data/v7/syros.pmtiles",
  "/api/team/map-data/v7/style-en.json",
]);

describe("the page's requests, watched", () => {
  it("the script fetches only /api/team/cats/positions and map-data addresses", async () => {
    const t = await catMapRig({ page: { filters: { colours: ["ginger"], sterilised: ["not_known"] } } });
    await t.answer(0, []);
    t.change(() => (t.document.querySelector('#catfilters input[name="q"]').value = "Mimi"));
    await t.answer(1, []);
    const paths = t.fetches.map((f) => new URL(f.url));
    for (const u of paths) {
      expect(u.origin, u.href).toBe("https://team.example");
      expect(u.search, u.href).toBe("");
      expect(u.pathname === POSITIONS || MAP_DATA.has(u.pathname), u.href).toBe(true);
    }
    // map-core's own, and the cats twice: once on load, once for the change.
    expect(paths.filter((u) => MAP_DATA.has(u.pathname)).length).toBeGreaterThanOrEqual(3);
    expect(t.asks).toHaveLength(2);
    for (const a of t.asks) {
      expect(a.init.method).toBe("POST");
      expect(a.init.credentials).toBe("same-origin");
      expect(a.init.headers["Content-Type"]).toBe("application/json");
    }
    // The filters in the body, never `view`, and never a position.
    expect(JSON.parse(t.asks[0]!.init.body)).toEqual({
      colours: ["ginger"],
      sterilised: ["not_known"],
      lives: expect.arrayContaining(["homed", "in_care", "street"]),
      sort: "recent",
    });
    expect(JSON.parse(t.asks[1]!.init.body)).toMatchObject({ colours: ["ginger"], q: "Mimi" });
    for (const a of t.asks) expect(a.init.body).not.toMatch(/"(?:view|lat|lng)"/);
  });

  it("the page's own address keeps only the filter form's fields", async () => {
    const t = await catMapRig();
    await t.answer(0, []);
    t.change(() => (t.document.querySelector('#catfilters input[name="colours"][value="ginger"]').checked = true));
    const u = new URL(t.window.location.href);
    expect(u.pathname).toBe("/api/team/cats");
    const formNames = new Set([...t.form().elements].map((e: any) => e.name).filter(Boolean));
    for (const k of u.searchParams.keys()) expect(formNames.has(k), k).toBe(true);
    expect(u.searchParams.get("colours")).toBe("ginger");
    expect(u.searchParams.get("view")).toBe("map");
  });
});
