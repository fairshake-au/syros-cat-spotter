import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accessEndedPage, forbiddenPage } from "../teamAuth/refuse";
import { mayUseWorkspace } from "../capabilities";
import { renderPage, type PageOptions } from "./layout";

// The page shell (SYC-396 PR 1.6; spec §3.1, §3.2, §12.5): the menu names the
// team's jobs, "Signed in as" and Sign out sit in the menu bar, and every page
// has a skip link and a visible focus outline (SYC-366).

const page = (over: Partial<PageOptions> = {}) =>
  renderPage({ title: "T", active: null, personName: "Maria <b>", body: "<p>x</p>", ...over });

/** The bar: <nav class="bar…"> with the menu, or <div class="bar…"> without one. */
const bar = (html: string) => {
  const m = /<(nav|div) class="bar[^"]*"[^>]*>([\s\S]*?)<\/\1>/.exec(html);
  if (!m) throw new Error("no bar");
  return { tag: m[1]!, inner: m[2]! };
};

/** The menu's links, in order, as [text, href]. The phone-only short label is dropped. */
const links = (html: string) =>
  [...bar(html).inner.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [
    m[2]!.replace(/<span class="short">[\s\S]*?<\/span>/, "").replace(/<[^>]+>/g, ""),
    m[1]!,
  ]);

describe("the team's menu (spec §3.1)", () => {
  it("names the team's jobs in the spec's order: Home · Cats · Map · Queue · Colonies · Reports", () => {
    expect(links(page({ island: true, showPeople: false }))).toEqual([
      ["Home", "/api/team/home"],
      ["Cats", "/api/team/cats"],
      ["Map", "/api/team/cats?view=map"],
      ["Queue", "/api/team"],
      ["Colonies", "/api/team/colonies"],
      ["Reports", "/api/team/insights"],
    ]);
  });

  it("with People, is exactly the seven labels in order (SYC-450; Reports since PR 3.3a)", () => {
    expect(links(page({ island: true, showPeople: true })).map((x) => x[0])).toEqual([
      "Home",
      "Cats",
      "Map",
      "Queue",
      "Colonies",
      "Reports",
      "People",
    ]);
  });

  it("the work lists and Feeding sites have left it, and underline their parent instead", () => {
    for (const [active, parent] of [
      ["likely", "Home"],
      ["colour", "Home"],
      ["sites", "Colonies"],
    ] as const) {
      const html = page({ active });
      const inner = bar(html).inner;
      expect(inner).not.toContain("Probably sterilised");
      expect(inner).not.toContain("Colour check");
      expect(inner).not.toContain("Feeding sites");
      expect(inner.match(/aria-current/g)).toHaveLength(1);
      expect(inner).toMatch(new RegExp(`aria-current="page">${parent}</a>`));
    }
  });

  it("puts People last, for those who can manage people, then My page", () => {
    const l = links(page({ island: true, showPeople: true, mine: true })).map((x) => x[0]);
    expect(l.slice(-2)).toEqual(["People", "My page"]);
  });

  it("Reports opens the Reports area at /insights (/api/team/reports is the welfare queue's), and a guardian's menu has none", () => {
    expect(page({ active: "reports" })).toContain('<a class="here" href="/api/team/insights" aria-current="page">Reports</a>');
    const l = links(page({ island: false, mine: true })).map((x) => x[0]);
    expect(l).not.toContain("Reports");
  });

  it("Map opens the Cats page's map view and is underlined when active, alone", () => {
    const html = page({ active: "map" });
    expect(html).toContain('<a class="here" href="/api/team/cats?view=map" aria-current="page">Map</a>');
    expect(bar(html).inner.match(/aria-current/g)).toHaveLength(1);
  });

  it("ends with Workspace, on the sign-in site, for people who may use the workspace", () => {
    const l = links(page({ island: true, showPeople: true, mine: true, workspace: true }));
    expect(l.slice(-3)).toEqual([
      ["People", "/api/team/people"],
      ["My page", "/api/team/my"],
      ["Workspace", "https://admin.catspotters.com/workspace"],
    ]);
  });

  it("a staff member's menu has no Workspace; a manager's does", () => {
    // SYC-619 §2.2 (N1): the link follows the capability (requireTeam.ts sets
    // navContext.workspace = mayUseWorkspace(person)), so it is asked the same way here.
    const staff = { scopes: [{ role: "staff", colonyId: null, reach: "island" }] };
    const manager = { scopes: [{ role: "management", colonyId: null, reach: "island" }] };
    const menu = (who: typeof staff) =>
      page({ island: true, showPeople: false, mine: true, workspace: mayUseWorkspace(who) });
    expect(menu(staff)).not.toContain("admin.catspotters.com/workspace");
    expect(links(menu(manager)).at(-1)).toEqual(["Workspace", "https://admin.catspotters.com/workspace"]);
  });

  it("has no Workspace link for anyone else, or on a refusal page or a cat guardian's menu", () => {
    for (const over of [
      { island: true, mine: true },
      { island: true, mine: true, workspace: false },
      { island: true, mine: true, workspace: true, nav: false },
      { island: false, mine: true, workspace: true },
      { mine: true, workspace: true, nav: "guardian" },
    ] as const) {
      expect(page(over)).not.toContain("/workspace");
    }
  });

  it("is a labelled menu (SYC-366)", () => {
    expect(page()).toContain('<nav class="bar" aria-label="Dashboard">');
  });
});

describe("Signed in as and Sign out sit in the menu bar (spec §3.2)", () => {
  it("are inside nav.bar, after the menu, with Sign out last", () => {
    const b = bar(page({ mine: true }));
    expect(b.tag).toBe("nav");
    expect(b.inner).toContain("Signed in as Maria &lt;b&gt;");
    expect(b.inner).toContain(
      '<form method="post" action="/api/team/signout"><button type="submit">Sign out</button></form>',
    );
    expect(b.inner.indexOf("My page")).toBeLessThan(b.inner.indexOf("Signed in as"));
    expect(b.inner.endsWith("</form>")).toBe(true);
  });

  it("the page title comes first: nothing of the sign-in inside <main>", () => {
    const main = /<main[^>]*>([\s\S]*)<\/main>/.exec(page())![1]!;
    expect(main).not.toContain("Signed in as");
    expect(main).not.toContain("/api/team/signout");
    expect(main.replace(/^<div class="readcol">/, "").startsWith("<h1>T</h1>")).toBe(true);
  });

  it("appears once in each copy of the menu: the bar and the phone fold (SYC-619 §2.1)", () => {
    const html = page();
    expect(html.match(/Signed in as/g)).toHaveLength(2);
    expect(html.match(/\/api\/team\/signout/g)).toHaveLength(2);
    expect(bar(html).inner.match(/Signed in as/g)).toHaveLength(1);
    // A page with no links has the one plain bar.
    expect(page({ nav: false }).match(/Signed in as/g)).toHaveLength(1);
  });

  it("a page without the menu (a refusal) keeps the bar with the name and Sign out, and no <nav>", () => {
    const html = page({ nav: false });
    expect(html).not.toContain("<nav");
    const b = bar(html);
    expect(b.tag).toBe("div");
    expect(b.inner).toContain("Signed in as Maria &lt;b&gt;");
    expect(b.inner).toContain('action="/api/team/signout"');
    expect(links(html)).toEqual([]);
  });

  it("the real refusal pages keep the skip link, the name and Sign out in the bar", () => {
    for (const html of [
      forbiddenPage({ name: "Maria <b>", language: "en", island: true }),
      forbiddenPage({ name: "Maria <b>", language: "en", island: false }),
      accessEndedPage({ name: "Maria <b>", language: "en" }),
    ]) {
      expect(html).toContain('<a class="skip" href="#main">Skip to the page</a>');
      const b = bar(html);
      expect(b.inner).toContain("Signed in as Maria &lt;b&gt;");
      expect(b.inner.endsWith('<button type="submit">Sign out</button></form>')).toBe(true);
      expect(/<main[^>]*>([\s\S]*)<\/main>/.exec(html)![1]).not.toContain("Signed in as");
    }
  });

  it("on a desktop, Sign out stays pinned at the right while a long menu slides under it", () => {
    expect(page()).toMatch(/@media \(min-width:600px\)\{[^@]*\.bar>form\{position:sticky;right:0/);
  });

  it("keeps the bar at one width on every page, wide or narrow (SYC-577)", () => {
    expect(page({ mainClass: "wide" })).toContain('<nav class="bar wide" aria-label="Dashboard">');
    expect(page()).toMatch(/\.bar,\.bar\.wide\{padding-inline:max\(12px,calc\(\(100% - 1120px\)/);
    expect(page()).not.toMatch(/\.bar\{padding-inline:max\(12px,calc\(\(100% - 760px\)/);
  });
});

describe("a cat guardian's menu is untouched by the team menu's changes (review of #243)", () => {
  it("underlines Feeding sites itself, never its team parent Colonies", () => {
    for (const active of ["sites", "colonies"] as const) {
      const html = page({ nav: "guardian", active, mine: true });
      const inner = bar(html).inner;
      expect(inner.match(/aria-current/g), active).toHaveLength(1);
      const label = active === "sites" ? "Feeding sites" : "Colonies";
      expect(inner).toMatch(new RegExp(`aria-current="page">[^<]*(<span[^>]*>)?${label}`));
    }
  });
});

describe("Back home on the refusal page (SYC-396 PR 2.1)", () => {
  it("takes a team member to Home, which is where signing in lands", () => {
    const html = forbiddenPage({ name: "Maria", language: "en", island: true });
    expect(html).toMatch(/<a class="tap" href="\/api\/team\/home">/);
  });
});

describe("the skip link (SYC-366)", () => {
  it("is the first thing in the body, on every kind of page, and points at <main id=main>", () => {
    for (const nav of [true, false, "guardian"] as const) {
      const html = page({ nav });
      const body = html.slice(html.indexOf("<body>") + "<body>".length);
      expect(body.startsWith('<a class="skip" href="#main">Skip to the page</a>')).toBe(true);
      expect(html).toContain('<main id="main" tabindex="-1">');
    }
  });

  it("keeps main's class beside its id", () => {
    expect(page({ mainClass: "mappage" })).toContain('<main id="main" tabindex="-1" class="mappage">');
  });

  it("is hidden until focused, and focus gets a visible outline", () => {
    const html = page();
    expect(html).toMatch(/\.skip\{[^}]*position:absolute/);
    expect(html).toMatch(/\.skip:focus\{[^}]*top:/);
    expect(html).toMatch(/:focus-visible\{[^}]*outline:3px solid #0b5c6b/);
  });
});

describe("a cat guardian's menu is unchanged (SYC-209 owns it)", () => {
  it("is Colonies and Feeding sites only, then her own links", () => {
    expect(links(page({ nav: "guardian", island: false, mine: true }))).toEqual([
      ["Colonies", "/api/team/colonies"],
      ["Feeding sites", "/api/team/sites"],
      ["My colonies", "/api/team/my/colonies"],
      ["My page", "/api/team/my"],
    ]);
  });

  it("a guardian on any other page gets only her own links", () => {
    expect(links(page({ island: false, mine: true })).map((x) => x[1])).toEqual([
      "/api/team/my/colonies",
      "/api/team/my",
    ]);
  });
});

describe("the phone menu (SYC-374)", () => {
  it("never dims the menu's text: no fading mask over the bar", () => {
    expect(page()).not.toMatch(/mask-image/);
  });

  it("the phone bar is one row, with the links in a fold, so none is hidden off the edge (SYC-522, now SYC-619 §2.1)", () => {
    expect(page()).toMatch(/\.phonebar\{[^}]*display:grid/);
    expect(page()).toMatch(/\.menulinks a,\.menulinks button\{[^}]*display:flex[^}]*min-height:44px[^}]*width:100%/);
  });
});

describe("phone menu (SYC-619 §2.1)", () => {
  const css = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
  const phonebar = (html: string) => {
    const m = /<nav class="phonebar[^"]*"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
    if (!m) throw new Error("no phonebar");
    return m[1]!;
  };
  const hrefs = (s: string) => [...s.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]!);
  const full = () => page({ active: "cats", island: true, showPeople: true, mine: true, workspace: true });

  it("draws .bar and .phonebar, each with every link once", () => {
    const html = full();
    const barHrefs = hrefs(bar(html).inner);
    const pbHrefs = hrefs(phonebar(html));
    expect(barHrefs.length).toBeGreaterThan(6);
    expect(pbHrefs).toEqual(barHrefs);
    const pb = phonebar(html);
    expect(pb).toContain('<details class="menufold"><summary>Menu</summary>');
    expect(pb.indexOf("Cats")).toBeGreaterThan(-1);
    expect(pb.indexOf("Cats")).toBeLessThan(pb.indexOf("<details"));
    expect(/<summary>[\s\S]*?<\/summary>/.exec(pb)![0]).not.toContain("Cats");
    expect(pb).toContain('<span class="phonehere">Cats</span>');
  });

  it("one copy shows at a time", () => {
    const c = css(full()).replace(/\/\*[\s\S]*?\*\//g, "");
    const MQ = /@media \(max-width:599px\)\{((?:[^{}]*\{[^}]*\})*)\}/g;
    const inside = [...c.matchAll(MQ)].map((m) => m[1]!).join("");
    const outside = c.replace(MQ, "");
    const rules = (sheet: string) => [...sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
    // Outside the phone query, the only display any .phonebar rule sets is none.
    for (const r of rules(outside).filter((x) => /\.phonebar\b/.test(x.sel))) {
      const displays = [...r.body.matchAll(/(?:^|;)\s*display:([^;]+)/g)].map((m) => m[1]!.trim());
      expect(displays.every((d) => d === "none"), `${r.sel}{${r.body}}`).toBe(true);
    }
    expect(outside).toContain(".phonebar{display:none}");
    // No rule outside it hides nav.bar.
    for (const r of rules(outside).filter((x) => /\bnav\.bar\b/.test(x.sel))) {
      expect(r.body, r.sel).not.toMatch(/display:none/);
    }
    expect(outside).not.toMatch(/(^|[^.\w-])\.bar\{display:none/);
    // Inside it, the bar goes and the phone bar shows.
    expect(rules(inside).some((r) => r.sel === "nav.bar" && /display:none/.test(r.body))).toBe(true);
    expect(rules(inside).some((r) => r.sel === ".phonebar" && /display:grid/.test(r.body))).toBe(true);
  });

  it("a long page name stays on one line and never runs under the Menu button (SYC-619 §2.1)", () => {
    expect(css(full())).toMatch(/\.phonehere\{[^}]*white-space:nowrap[^}]*overflow:hidden[^}]*text-overflow:ellipsis/);
    expect(css(full())).toMatch(/\.phonehere\{[^}]*max-width:calc\(100% - 110px\)/);
  });

  it("the fold ends with the name and Sign out", () => {
    const pb = phonebar(full());
    const links = /<div class="menulinks">([\s\S]*)<\/div><\/details>/.exec(pb)![1]!;
    expect(links.endsWith('</a><span class="who" title="Maria &lt;b&gt;">Signed in as Maria &lt;b&gt;</span><form method="post" action="/api/team/signout"><button type="submit">Sign out</button></form>')).toBe(true);
  });

  it("aria-current stays on the current link inside the fold", () => {
    const pb = phonebar(full());
    expect(pb).toContain('<a class="here" href="/api/team/cats" aria-current="page">Cats</a>');
    expect(pb.match(/aria-current/g)).toHaveLength(1);
  });

  it("a guardian's menu folds too", () => {
    const html = page({ nav: "guardian", active: "colonies", island: false, mine: true });
    const pb = phonebar(html);
    expect(pb).toContain("<details");
    expect(hrefs(pb)).toEqual(hrefs(bar(html).inner));
    expect(hrefs(pb).length).toBeGreaterThanOrEqual(2);
  });

  it("null active: Menu with no page name", () => {
    const pb = phonebar(page({ active: null }));
    expect(pb).toContain('<span class="phonehere"></span>');
    expect(pb).toContain("<summary>Menu</summary>");
  });

  it("refusal, welcome and error bars are unchanged", () => {
    const welcome = page({ nav: false });
    expect(welcome).not.toContain("<nav");
    expect(welcome).toContain('<div class="bar">');
    expect(page({ nav: false, personName: null })).not.toMatch(/<(nav|div) class="(phone)?bar/);
    // A page with no links keeps today's plain bar (name and Sign out only).
    expect(welcome).toContain('<div class="bar"><span class="who" title="Maria &lt;b&gt;">Signed in as Maria &lt;b&gt;</span>');
  });

  it("a page with no links keeps its div bar visible on a phone, with Sign out", () => {
    const html = page({ nav: false });
    expect(html).toContain('<div class="bar"><span class="who"');
    expect(html).toContain('action="/api/team/signout"');
    expect(css(html)).not.toMatch(/div\.bar[^{]*\{display:none/);
    expect(css(html)).toMatch(/@media \(max-width:599px\)\{div\.bar,div\.bar\.wide\{[^}]*flex-wrap:wrap/);
  });

  it("Menu looks like a button: outlined, 44px, no marker", () => {
    expect(css(page())).toMatch(/\.menufold>summary\{[^}]*min-height:44px[^}]*border:1px solid #0b5c6b[^}]*border-radius:8px[^}]*background:#fff/);
    expect(css(page())).toContain(".menufold>summary::-webkit-details-marker{display:none}");
  });

  it("a long name wraps", () => {
    const name = "Alexandra ".repeat(6).trim();
    const html = page({ personName: name });
    expect(phonebar(html)).toContain(name);
    expect(css(html)).toMatch(/\.phonebar \.who\{[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
  });
});

describe("the cat page's folded \"What we know\" is not a photo grid", () => {
  it("only the Probably sterilised list's photo box is a grid (its class name is shared)", () => {
    const html = renderPage({ title: "T", active: null, personName: "Sam", body: "" });
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    expect(css).toContain("div.evidence{display:grid");
    expect(css).not.toMatch(/(^|[}\s,])\.evidence[\s{]/);
    expect(css).not.toMatch(/(^|[}\s,])\.evidence (img|figure)/);
  });
});

describe("one left edge at every width (SYC-619 §2.4)", () => {
  const styles = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
  const inner = (html: string) => /<main[^>]*>([\s\S]*)<\/main>/.exec(html)![1]!;

  it("main is 1120px on every page", () => {
    const css = styles(page());
    expect(css).toMatch(/(^|\n)main\{max-width:1120px;margin:0 auto;/);
    expect(css).not.toMatch(/main\{max-width:760px/);
  });

  it("a narrow page wraps its content in .readcol, 736px (today's reading width inside main's 12px padding), left-aligned", () => {
    for (const mainClass of [undefined, "mappage"] as const) {
      const html = page({ mainClass, beforeTitle: "<a>back</a>", banner: "<p>b</p>", afterTitle: "<p>a</p>" });
      const body = inner(html);
      expect(body.startsWith('<div class="readcol"><p>b</p><a>back</a><h1>T</h1><p>a</p><p>x</p></div>')).toBe(true);
      expect(body.endsWith("</div>")).toBe(true);
    }
    expect(styles(page())).toMatch(/\.readcol\{max-width:736px\}/);
    expect(styles(page())).not.toMatch(/\.readcol\{[^}]*margin/);
  });

  it("wide pages have no .readcol", () => {
    expect(inner(page({ mainClass: "wide" }))).not.toContain('class="readcol"');
  });

  it("the .mappage margin rule uses the 1120px frame and still rounds down to 1px", () => {
    const css = styles(page({ mainClass: "mappage" }));
    expect(css).toContain("round(down,(100% - 1120px) / 2,1px)");
    expect(css).not.toContain("(100% - 760px) / 2,1px");
  });
});

describe("the .readcol wrapper's name is the shell's alone (SYC-619 §2.4)", () => {
  it("no page module defines its own .readcol (My page already owns .col)", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const own = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "layout.ts");
    expect(own.length).toBeGreaterThan(10);
    for (const f of own) {
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/\.readcol\b/);
    }
  });
});

describe("folds look like folds (SYC-619 §2.6)", () => {
  const sheet = () => /<style>([\s\S]*?)<\/style>/.exec(page())![1]!;
  const MARKED = [
    ".fixes summary",
    ".typedfold summary",
    "details.hist>summary",
    "details.notdescribed>summary",
    "details.invitefold>summary",
    "details.method>summary",
  ];
  const ruleFor = (css: string, tail: string) => {
    const m = new RegExp(`(^|\\n)([^{}\\n]*${tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^{}\\n]*)\\{([^}]*)\\}`).exec(css);
    return m ? { selectors: m[2]!.split(",").map((s) => s.trim()), body: m[3]! } : null;
  };

  it("the marker rule lists exactly the six summaries", () => {
    const r = ruleFor(sheet(), "::before");
    const marker = sheet().split("\n").find((l) => l.includes('content:"▸" / ""'))!;
    expect(marker).toBeTruthy();
    const selectors = marker.slice(0, marker.indexOf("{")).split(",").map((s) => s.trim());
    expect(selectors).toEqual(MARKED.map((s) => `${s}::before`));
    expect(r).not.toBeNull();
  });

  it("closed shows ▸ and open shows ▾, both with empty alternative text", () => {
    const css = sheet();
    expect(css).toMatch(/::before\{content:"▸" \/ "";flex:none;width:1\.2em;color:#0b4553\}/);
    const open = css.split("\n").find((l) => l.includes('content:"▾" / ""'))!;
    expect(open).toBeTruthy();
    const selectors = open.slice(0, open.indexOf("{")).split(",").map((s) => s.trim());
    expect(selectors).toEqual([
      ".fixes details[open]>summary::before",
      ".typedfold[open]>summary::before",
      "details.hist[open]>summary::before",
      "details.notdescribed[open]>summary::before",
      "details.invitefold[open]>summary::before",
      "details.method[open]>summary::before",
    ]);
  });

  it("a button-styled summary keeps no marker, open or closed: the override out-ranks the open marker rule (SYC-619 §2.6)", () => {
    const css = sheet();
    // Specificity as [ids, classes/attributes, elements/pseudo-elements].
    const spec = (sel: string): [number, number, number] => [
      0,
      (sel.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length,
      (sel.replace(/\.[\w-]+|\[[^\]]+\]/g, "").match(/[a-z]+|::before/g) ?? []).length,
    ];
    const cmp = (x: number[], y: number[]) => x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
    const none = css.split("\n").find((l) => /\{content:none\}$/.test(l) && l.includes("summary.risky::before"))!;
    expect(none).toBeTruthy();
    const overrides = none.slice(0, none.indexOf("{")).split(",").map((x) => x.trim());
    const openRule = css.split("\n").find((l) => l.includes('content:"▾" / ""'))!;
    const openSel = ".fixes details[open]>summary::before";
    expect(openRule).toContain(openSel);
    // The open states of a risky summary and of the Update button each beat the open marker.
    for (const sel of [".fixes details[open]>summary.risky::before", ".fixes details.update[open]>summary::before"]) {
      expect(overrides, sel).toContain(sel);
      expect(cmp(spec(sel), spec(openSel)), sel).toBeGreaterThan(0);
    }
    // The closed states match too, and the override comes after every marker rule.
    expect(overrides).toContain(".fixes details>summary.risky::before");
    expect(overrides).toContain(".fixes details.update>summary::before");
    expect(css.indexOf(none)).toBeGreaterThan(css.indexOf('content:"▾" / ""'));
    expect(css.indexOf(none)).toBeGreaterThan(css.indexOf('content:"▸" / ""'));
  });

  it("each marked summary is a flex row and hides the browser's own triangle", () => {
    const css = sheet();
    const flex = css.split("\n").find((l) => /\{[^}]*display:flex[^}]*align-items:center[^}]*\}/.test(l) && MARKED.every((s) => l.split("{")[0]!.includes(s)))!;
    expect(flex, "one rule gives every marked summary flex + centre").toBeTruthy();
    expect(flex).toContain("list-style:none");
    const hide = css.split("\n").find((l) => l.includes("::-webkit-details-marker{display:none}") && MARKED.every((s) => l.includes(`${s}::-webkit-details-marker`)))!;
    expect(hide).toBeTruthy();
  });

  it("rows and buttons with their own look get no marker", () => {
    const css = sheet();
    const lines = css.split("\n").filter((l) => l.includes('content:"▸" / ""') || l.includes('content:"▾" / ""'));
    expect(lines.length).toBe(2);
    for (const l of lines) {
      const sel = l.slice(0, l.indexOf("{"));
      for (const no of ["summary.rowline", "details.filters", ".rowmenu", "details.confirm", ".menufold", "details.person", "details.arearow"]) {
        expect(sel, no).not.toContain(no);
      }
    }
  });

  it("Invite someone hugs its text: inline-flex, not a full-width row", () => {
    expect(sheet()).toMatch(/\ndetails\.invitefold>summary\{[^}]*display:inline-flex[^}]*\}/);
  });

  it("the cat page's existing marker rules are untouched", () => {
    const css = sheet();
    expect(css).toContain(
      'li.statement.routine>details>summary::before,.hownote>summary::before{content:"▸";flex:none;width:1.2em;color:#0b4553}',
    );
  });

  it("the How this is worked out summary is 44px, bold and teal", () => {
    expect(sheet()).toMatch(/details\.method>summary\{[^}]*min-height:44px[^}]*font-weight:700[^}]*color:#0b4553/);
  });
});
