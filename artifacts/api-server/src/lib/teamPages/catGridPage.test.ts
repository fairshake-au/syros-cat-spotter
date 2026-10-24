import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CatListItem } from "../teamCatList";
import { renderCatGridPage, withoutDefaultLives } from "./catGridPage";

// SYC-396 PR 1.3: pure render tests for the Cats grid (review fixes).

const NOW = new Date("2026-10-15T12:00:00Z");

const item = (over: Partial<CatListItem> = {}): CatListItem => ({
  id: 7,
  name: "Mimi <b>",
  syr: "SYR-0007",
  photoPublicId: "ph7",
  coat: ["ginger", "white"],
  pattern: null,
  colonyId: null,
  mark: "sterilised",
  lives: "street",
  lastSeenAt: new Date("2026-10-12T12:00:00Z"),
  lastSeen: null,
  placedAt: { lat: 37.44, lng: 24.94 },
  place: "Kini",
  notSeenSince: null,
  ...over,
});

describe("the card photo (§5.2)", () => {
  it("offers the 160px and 360px versions, with src kept on small", () => {
    const html = render();
    expect(html).toContain('src="/api/team/photos/ph7/small"');
    expect(html).toContain('srcset="/api/team/photos/ph7/small 160w, /api/team/photos/ph7/card 360w"');
    expect(html).toContain('sizes="(min-width:1000px) 200px, 45vw"');
  });
});

const render = (o: Partial<Parameters<typeof renderCatGridPage>[0]> = {}) =>
  renderCatGridPage({
    items: [item()],
    total: 1,
    catCount: 1,
    filters: {},
    personName: "Susan",
    now: NOW,
    colonies: [],
    ...o,
  });

describe("one row for Grid/Map and Find from a photo (§5.3)", () => {
  it("puts the switch and the photo link in one .viewrow inside #catresults, switch first", () => {
    const html = render({ filters: { colours: ["black"] } });
    const results = html.slice(html.indexOf('<div id="catresults">'));
    const row = /<div class="viewrow">([\s\S]*?)<\/div>/.exec(results)![1]!;
    expect(row).toContain('<nav class="viewswitch"');
    expect(row).toContain('<a class="findentrylink" href="/api/team/cats/find?colours=black">Find from a photo</a>');
    expect(row.indexOf("viewswitch")).toBeLessThan(row.indexOf("findentrylink"));
    expect(html).not.toContain('class="findentry"');
    expect(html.match(/class="viewrow"/g)).toHaveLength(1);
  });

  it("styles the row as wrapping flex, switch left and link right", () => {
    const css = readFileSync(join(__dirname, "layout.ts"), "utf8");
    expect(css).toMatch(/\.viewrow\{[^}]*display:flex[^}]*flex-wrap:wrap[^}]*\}/);
  });
});

describe("the grid's links and styles", () => {
  it("uses its own class, so the colony page's 'Add cats' link keeps its look", () => {
    const html = render();
    expect(html).toContain('class="catcardlink"');
    expect(html).not.toContain('class="cardlink"');
    // The old rule is untouched: one a.cardlink rule, a row, teal, with padding.
    const rules = html.match(/a\.cardlink\{[^}]*\}/g) ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]).not.toMatch(/flex-direction|color:inherit|padding:0[;}]/);
    // And the colony page still draws "Add cats" with the original classes.
    const colonyPages = readFileSync(join(__dirname, "colonyPages.ts"), "utf8");
    expect(colonyPages).toContain('<a class="tap cardlink"');
  });

  it("left-aligns the card's facts at normal weight, with only the name bold", () => {
    const html = render();
    expect(html).toMatch(/a\.catcardlink\{[^}]*text-align:left[^}]*font-weight:400/);
    expect(html).toMatch(/\.cardfact\{[^}]*font-weight:400/);
  });
});

describe("card contents", () => {
  it("describes the photo for a screen reader, escaped", () => {
    const html = render();
    expect(html).toContain('alt="Photo of Mimi &lt;b&gt;, Ginger and white, pattern not known"');
    expect(render({ items: [item({ coat: [] })] })).toContain('alt="Photo of Mimi &lt;b&gt;"');
  });

  it("SYC-443: the card says the coat in the team's words (§15.1)", () => {
    const striped = render({ items: [item({ coat: ["grey"], pattern: "stripes" })] });
    expect(striped).toContain('alt="Photo of Mimi &lt;b&gt;, Grey tabby"');
    expect(striped).toContain('<span class="cardfact">Grey tabby</span>');
    expect(striped).not.toContain("Grey · Stripes");
    expect(render({ items: [item({ coat: ["black"], pattern: "plain" })] })).toContain('alt="Photo of Mimi &lt;b&gt;, Black"');
    expect(render({ items: [item({ coat: [], pattern: "patches" })] })).toContain(
      'alt="Photo of Mimi &lt;b&gt;, Patched, colours not known"',
    );
    const calico = render({ items: [item({ coat: ["black", "ginger", "white"], pattern: "patches" })] });
    expect(calico).toContain('<span class="cardfact">Calico</span>');
  });

  it("SYC-443 / SYC-619 §5.1: a card with nothing known leaves the coat line out, and the description leaves the coat out", () => {
    const none = render({ items: [item({ coat: [], pattern: null })] });
    expect(none).not.toContain("Coat not known");
    expect(none).toContain('alt="Photo of Mimi &lt;b&gt;"');
    expect(none).not.toMatch(/Colour not known|undefined|null/);
  });

  it("words last seen by the shared rule, in Athens time", () => {
    expect(render()).toContain("Last seen 3 days ago");
    const late = render({ items: [item({ lastSeenAt: new Date("2026-08-31T21:30:00Z") })] });
    expect(late).toContain("Last seen on 1 Sept 2026");
    expect(render({ items: [item({ lastSeenAt: null })] })).toContain("Never seen since first recorded");
  });
});

describe("SYC-619 §5.1: a card draws only what is known", () => {
  const cardOf = (html: string, id: number) => {
    const start = html.indexOf(`<li class="catcard"><a class="catcardlink" href="/api/team/cats/${id}"`);
    expect(start).toBeGreaterThan(-1);
    return html.slice(start, html.indexOf("</li>", start));
  };

  it("leaves out the coat and colony lines when neither is known; the mark line still shows", () => {
    const card = cardOf(render({ items: [item({ id: 7, coat: [], pattern: null, colonyId: null })] }), 7);
    expect(card).not.toContain("Coat not known");
    expect(card).not.toContain("No colony");
    expect(card).toContain('<span class="mark-word">Sterilised</span>');
    expect(card).toContain('alt="Photo of Mimi &lt;b&gt;"');
  });

  it("shows the coat and the colony when both are known", () => {
    const card = cardOf(
      render({
        items: [item({ id: 7, colonyId: 3 })],
        colonies: [{ id: 3, name: "Ano Syros" }],
      }),
      7,
    );
    expect(card).toContain('<span class="cardfact">Ginger and white, pattern not known</span>');
    expect(card).toContain('<span class="cardfact">Ano Syros</span>');
  });

  it("keeps the word Colony when the colony id is set but its name can't be found", () => {
    const card = cardOf(render({ items: [item({ id: 7, colonyId: 9 })], colonies: [] }), 7);
    expect(card).toContain('<span class="cardfact">Colony</span>');
    expect(card).not.toContain("No colony");
  });

  it("draws the lines in the §5.1 order: name, coat, colony, mark, last seen, tag", () => {
    const full = cardOf(
      render({
        items: [item({ id: 7, colonyId: 3, lives: "homed" })],
        colonies: [{ id: 3, name: "Ano Syros" }],
      }),
      7,
    );
    // The alt text also names the coat, so look only at what is drawn.
    const card = full.slice(full.indexOf('<span class="cardname">'));
    const at = (s: string) => {
      const i = card.indexOf(s);
      expect(i).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      at("<strong>Mimi &lt;b&gt;</strong>"),
      at("Ginger and white"),
      at("Ano Syros"),
      at('<span class="mark-word">Sterilised</span>'),
      at("Last seen"),
      at("Has a home"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("empty states", () => {
  it("says none are recorded only when there are no cats at all", () => {
    const html = render({ items: [], total: 0, catCount: 0 });
    expect(html).toContain("No cats recorded yet");
  });

  it("when cats exist but all are hidden by the default, says no cats match, with a way to include 'No longer with us'", () => {
    const html = render({ items: [], total: 0, catCount: 5 });
    expect(html).not.toContain("No cats recorded yet");
    expect(html).toContain("No cats match these filters");
    expect(html).toMatch(/href="[^"]*lives=gone[^"]*">[^<]*no longer with us/i);
  });
});

describe("tie mode", () => {
  const tie = {
    publicId: "r1",
    report: { id: "r1", severity: "attention", isLitter: false, at: "2026-10-15T10:00:00Z", cat: { id: 7, name: "Mimi" } } as never,
    canTie: true,
  };

  it("includes 'No longer with us' by default, so the cat already tied always shows", () => {
    const html = render({ tie });
    expect(html).toMatch(/name="lives" value="gone" checked/);
    expect(html).toContain("<summary>Filters (0)</summary>");
    expect(html).not.toContain("No longer with us</a>");
  });

  it("treats all four as the default in tie mode, and the usual three otherwise", () => {
    const all = { lives: ["street", "homed", "in_care", "gone"] as never };
    expect(withoutDefaultLives(all, true)).toEqual({});
    expect(withoutDefaultLives(all, false)).toEqual(all);
  });
});

describe("a typed search (D11)", () => {
  it("round-trips into the chip and the Show more link, escaped", () => {
    const q = `Mimi "<b>" & 37.44471`;
    const items = Array.from({ length: 48 }, (_, i) => item({ id: i + 1 }));
    const html = render({ items, total: 120, catCount: 120, filters: { q } });
    const enc = "q=Mimi+%22%3Cb%3E%22+%26+37.44471";
    expect(html).toContain(`href="/api/team/cats?${enc}&amp;page=2">Show more`);
    // The chip's link drops the search; the chip shows the text, escaped.
    expect(html).toContain("“Mimi &quot;&lt;b&gt;&quot; &amp; 37.44471”");
    expect(html).not.toContain("<b>");
    // The box carries it back, escaped.
    expect(html).toContain('value="Mimi &quot;&lt;b&gt;&quot; &amp; 37.44471"');
  });
});

describe("the Pattern filter (SYC-435; coat spec §15.2)", () => {
  it("offers Solid, Tabby, Patched and Not known, ticking the chosen ones", () => {
    const html = render({ filters: { patterns: ["stripes"] } });
    for (const w of ["Solid", "Tabby", "Patched", "Not known"]) {
      expect(html).toMatch(new RegExp(`name="patterns" value="[a-z_]+"[^>]*> ${w}</label>`));
    }
    expect(html).toContain('name="patterns" value="stripes" checked> Tabby');
    expect(html).toContain("Filters (1)");
  });

  it("shows a chip in the team's word that removes just that pattern, keeping the code in the address", () => {
    const html = render({ filters: { patterns: ["stripes", "patches"], colours: ["black"] } });
    const chips = [...html.matchAll(/<a class="fchip" href="([^"]*)">([^<]*?) /g)].map((m) => ({ href: m[1]!, label: m[2]! }));
    const tabby = chips.find((c) => c.label === "Tabby")!;
    const patched = chips.find((c) => c.label === "Patched")!;
    // Removing Tabby keeps Patched (and the colour); removing Patched keeps Tabby.
    expect(tabby.href).toContain("patterns=patches");
    expect(tabby.href).not.toContain("patterns=stripes");
    expect(patched.href).toContain("patterns=stripes");
    expect(patched.href).not.toContain("patterns=patches");
    expect(tabby.href).toContain("colours=black");
  });
});
