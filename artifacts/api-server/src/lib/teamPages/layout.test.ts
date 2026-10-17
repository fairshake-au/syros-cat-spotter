import { describe, expect, it } from "vitest";
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
  it("names the team's jobs in the spec's order, keeping phase 1's work lists until Home ships", () => {
    expect(links(page({ island: true, showPeople: false }))).toEqual([
      ["Queue", "/api/team"],
      ["Cats", "/api/team/cats"],
      ["Map", "/api/team/cats?view=map"],
      ["Colonies", "/api/team/colonies"],
      ["Feeding sites", "/api/team/sites"],
      ["Probably sterilised", "/api/team/likely"],
      ["Colour check", "/api/team/colour-check"],
    ]);
  });

  it("puts People last, for those who can manage people, then My page", () => {
    const l = links(page({ island: true, showPeople: true, mine: true })).map((x) => x[0]);
    expect(l.slice(-2)).toEqual(["People", "My page"]);
  });

  it("has no Home or Reports yet: items appear as their screens ship", () => {
    const l = links(page({ island: true, showPeople: true, mine: true })).map((x) => x[0]);
    expect(l).not.toContain("Home");
    expect(l).not.toContain("Reports");
  });

  it("Map opens the Cats page's map view and is underlined when active, alone", () => {
    const html = page({ active: "map" });
    expect(html).toContain('<a class="here" href="/api/team/cats?view=map" aria-current="page">Map</a>');
    expect(bar(html).inner.match(/aria-current/g)).toHaveLength(1);
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
    expect(main.startsWith("<h1>T</h1>")).toBe(true);
  });

  it("appears exactly once", () => {
    const html = page();
    expect(html.match(/Signed in as/g)).toHaveLength(1);
    expect(html.match(/\/api\/team\/signout/g)).toHaveLength(1);
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

  it("keeps the wide bar for a wide page", () => {
    expect(page({ mainClass: "wide" })).toContain('<nav class="bar wide" aria-label="Dashboard">');
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

  it("the phone padding rule reaches the wide bar too", () => {
    expect(page()).toMatch(/@media \(max-width:599px\)\{\.bar,\.bar\.wide\{/);
  });
});
