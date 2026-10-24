import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { renderCatPage } from "./catPages";
import { historyCounts } from "./catHistory";
import { bareCatView, catView, richCatView, statement } from "./__fixtures__/catView";

// SYC-655 Task 3: the tab row and the panels under the header card.

const NOW = new Date("2026-10-17T09:00:00Z");
const may = () => true;
const page = (v = richCatView(), opts = {}) => renderCatPage(v, "Sam", { now: NOW, may, ...opts });
const sheet = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;

const photo = (i: number) => ({ source: i === 0 ? "main" : "sighting", publicId: `p${i}`, url: `/p${i}.jpg`, hidden: null });
const withFive = () => catView({ ...richCatView(), photos: [0, 1, 2, 3, 4].map(photo) } as never);
const report = (id: string) => ({ id, reason: "wrong_cat", state: "new", at: "2026-10-10T09:00:00Z", others: 0, photo: null });
const issues = { total: 3, reports: [report("i1"), report("i2"), report("i3")] };

let savedKey: string | undefined;
beforeAll(() => {
  savedKey = process.env["TEAM_SESSION_KEYS"];
  process.env["TEAM_SESSION_KEYS"] = "vitest-catmap-key-0123456789abcdef-0123456789";
});
afterAll(() => {
  if (savedKey === undefined) delete process.env["TEAM_SESSION_KEYS"];
  else process.env["TEAM_SESSION_KEYS"] = savedKey;
});

const navOf = (html: string) => {
  const at = html.indexOf('<nav class="cattabs"');
  return html.slice(at, html.indexOf("</nav>", at));
};
const tabs = (html: string) => [...navOf(html).matchAll(/<a href="(#tab-[a-z]+)">([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);

describe("the tab row", () => {
  it("lists the tabs in order, with counts", () => {
    const v = withFive();
    const html = page(v, { issues });
    expect(navOf(html)).toContain('aria-label="Sections of this cat\'s page"');
    expect(tabs(html)).toEqual([
      ["#tab-history", `History (${historyCounts(v, []).all})`],
      ["#tab-photos", "Photos (5)"],
      ["#tab-map", "Map"],
      ["#tab-coat", "Coat and markings"],
      ["#tab-reports", "Reports (3)"],
    ]);
  });

  it("has no Map tab without sightings, and no Reports tab with issues null", () => {
    const html = page(catView({ ...richCatView(), sightings: [] } as never), { issues: null });
    const labels = tabs(html).map((t) => t[0]);
    expect(labels).toEqual(["#tab-history", "#tab-photos", "#tab-coat"]);
    expect(html).not.toContain('id="tab-map"');
    expect(html).not.toContain('id="tab-reports"');
    expect(html).not.toContain('id="map"');
  });

  it("has no Reports tab when the strip has none", () => {
    expect(tabs(page(richCatView(), { issues: { total: 0, reports: [] } })).map((t) => t[0])).not.toContain("#tab-reports");
  });

  it("drops the old jump row and the two columns", () => {
    const html = page(richCatView(), { issues });
    expect(html).not.toContain('<nav class="jump"');
    expect(html).not.toContain("catcols");
    expect(html).not.toContain("catside");
    expect(sheet(html)).not.toMatch(/\.jump|\.catcols|\.catside/);
  });
});

describe("the panels", () => {
  it("each tab has a panel with its own heading", () => {
    const html = page(withFive(), { issues });
    const doc = new JSDOM(html).window.document;
    for (const id of ["history", "photos", "map", "coat", "reports"]) {
      const sec = doc.getElementById(`tab-${id}`)!;
      expect(sec, id).not.toBeNull();
      expect(sec.className).toBe("catpanel");
      expect(sec.getAttribute("aria-labelledby")).toBe(`h-${id}`);
      expect(sec.firstElementChild!.tagName).toBe("H2");
      expect(sec.firstElementChild!.id).toBe(`h-${id}`);
    }
    expect(doc.getElementById("h-map")!.textContent).toBe(`Where ${richCatView().cat.name} has been seen`);
    expect(doc.getElementById("h-reports")!.textContent).toBe("Reports (3)");
    expect(doc.getElementById("h-photos")!.textContent).toBe("Photos (5)");
  });

  it("escapes the cat's name in the Map heading", () => {
    const html = page(catView({ ...richCatView(), cat: { ...richCatView().cat, name: "<b>Tom</b>" } } as never));
    expect(html).toContain("Where &lt;b&gt;Tom&lt;/b&gt; has been seen");
    expect(html).not.toContain("<b>Tom</b>");
  });

  it("keeps the old anchors inside the right panel", () => {
    const doc = new JSDOM(page(withFive(), { issues })).window.document;
    const panelOf = (id: string) => doc.getElementById(id)!.closest(".catpanel")!.id;
    expect(panelOf("history")).toBe("tab-history");
    expect(panelOf("vet-visits")).toBe("tab-history");
    expect(panelOf("photos")).toBe("tab-photos");
    expect(panelOf("p-p3")).toBe("tab-photos");
    expect(panelOf("map")).toBe("tab-map");
    expect(panelOf("appearance")).toBe("tab-coat");
    expect(panelOf("issue-strip")).toBe("tab-reports");
  });

  it("keeps the header card above the tabs, and the corrections anchor outside every panel", () => {
    const html = page(withFive(), { issues });
    const doc = new JSDOM(html).window.document;
    expect(doc.getElementById("corrections")!.closest(".catpanel")).toBeNull();
    expect(html.indexOf('<div class="catcard')).toBeLessThan(html.indexOf('<nav class="cattabs"'));
  });

  it("says 'in History' where the map notes said 'below'", () => {
    const html = page(richCatView());
    expect(html).not.toContain("see History below");
    expect(html).not.toContain("listed below");
  });

  it("every id on the page is unique, rich and bare", () => {
    for (const v of [withFive(), bareCatView()]) {
      const doc = new JSDOM(page(v, { issues })).window.document;
      const ids = [...doc.querySelectorAll("[id]")].map((e) => e.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes).toEqual([]);
    }
  });
});

describe("coat changes in the tabs (SYC-655 Task 4)", () => {
  const coatStatement = (id: number, over: Record<string, unknown>) =>
    statement(id, { kind: "coat", said: "Coat: Black", correction: null, ...over });
  const withPast = () =>
    catView({
      ...richCatView(),
      history: [
        ...richCatView().history,
        coatStatement(901, { said: "Coat: Grey", replaces: 900, correction: { kind: "appearance" } }),
        coatStatement(900, { replacedBy: [901], reason: "Looked black" }),
      ],
    } as never);

  it("every id stays unique with past changes listed, and each History line has its change in the Coat tab", () => {
    const html = page(withPast(), { issues });
    const doc = new JSDOM(html).window.document;
    const ids = [...doc.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(doc.getElementById("a-900")!.closest("#tab-coat")).not.toBeNull();
    expect(doc.getElementById("s-900")!.closest("#tab-history")).not.toBeNull();
    expect(doc.getElementById("s-900")!.querySelector("a")!.getAttribute("href")).toBe("#a-900");
  });

  it("keeps the History count and 'Show all' as they were (the coat line is a normal row)", () => {
    const v = withPast();
    const n = historyCounts(v, []).all;
    const html = page(v, { issues });
    expect(html).toContain(`History (${n})`);
    expect(html).toContain('aria-current="page">All</a>');
  });
});

describe("the tab CSS", () => {
  const css = () => sheet(page());

  it("hides panels only inside @supports selector(:has(a))", () => {
    const c = css();
    const start = c.indexOf("@supports selector(:has(a)){");
    expect(start).toBeGreaterThan(-1);
    // The block ends at the first line that is a lone closing brace.
    const end = c.indexOf("\n}", start);
    const block = c.slice(start, end);
    expect(block).toContain(".catpanel{display:none}");
    expect(c.slice(0, start) + c.slice(end)).not.toMatch(/\.catpanel\{display:none\}/);
    expect(c.split(".catpanel{display:none}")).toHaveLength(2);
  });

  it("opens History by default and on any target inside a panel", () => {
    const c = css();
    expect(c).toContain(".catpanel:target,.catpanel:has(:target){display:block}");
    expect(c).toContain("main:not(:has(.catpanel:target,.catpanel :target)) #tab-history{display:block}");
  });

  it("draws the open tab, and says ', open' for a screen reader", () => {
    const c = css();
    for (const id of ["history", "photos", "map", "coat", "reports"]) {
      expect(c, id).toContain(`main:has(#tab-${id}:target,#tab-${id} :target) .cattabs a[href="#tab-${id}"]`);
    }
    expect(c).toContain('content:"" / ", open"');
    expect(c).toContain('main:not(:has(.catpanel:target,.catpanel :target)) a[href="#tab-history"]');
  });

  it("gives panels and anchored rows room under the sticky row", () => {
    const c = css();
    const sels = [...c.matchAll(/([^{}\n]+)\{scroll-margin-top:72px\}/g)].map((m) => m[1]).join(",");
    for (const s of [".catpanel", '[id^="s-"]', '[id^="sg-"]', '[id^="p-"]', '[id^="vv-"]', '[id^="a-"]']) expect(sels, s).toContain(s);
    // A photo's own rule can't undo it.
    expect(c).not.toMatch(/\.gallery figure\{[^}]*scroll-margin-top:12px/);
  });

  it("makes the tab row sticky and keeps the tap targets big", () => {
    expect(css()).toMatch(/\.cattabs\{position:sticky;/);
    expect(css()).toMatch(/\.cattabs a\{[^}]*min-height:44px/);
  });

  it("lets the map keep its largest picture on a wide screen", () => {
    expect(css()).not.toContain(".catmap .mapband.b256{display:none}");
  });
});

describe("the selected tab's CSS", () => {
  it("draws only the tab-row links as selected, never another link to the same panel", () => {
    const css = sheet(page(withFive(), { issues }));
    const rules = css.slice(css.indexOf("@supports selector(:has(a))"));
    // Every rule that restyles a link to a panel, or adds ", open", names .cattabs.
    const all = rules.match(/a\[href="#tab-/g) ?? [];
    const scoped = rules.match(/\.cattabs a\[href="#tab-/g) ?? [];
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(scoped).toHaveLength(all.length);
  });
});
