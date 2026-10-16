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
  place: "Kini",
  notSeenSince: null,
  ...over,
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
    expect(html).toContain('alt="Photo of Mimi &lt;b&gt;, Ginger · White"');
    expect(render({ items: [item({ coat: [] })] })).toContain('alt="Photo of Mimi &lt;b&gt;"');
  });

  it("SYC-398: shows the pattern after the colours, except Plain, never an old word", () => {
    const striped = render({ items: [item({ coat: ["grey"], pattern: "stripes" })] });
    expect(striped).toContain('alt="Photo of Mimi &lt;b&gt;, Grey · Stripes"');
    expect(striped).toContain("Grey · Stripes");
    expect(render({ items: [item({ coat: ["black"], pattern: "plain" })] })).toContain('alt="Photo of Mimi &lt;b&gt;, Black"');
    expect(render({ items: [item({ coat: [], pattern: "patches" })] })).toContain('alt="Photo of Mimi &lt;b&gt;, Patches"');
    expect(striped).not.toMatch(/tabby/i);
  });

  it("words last seen by the shared rule, in Athens time", () => {
    expect(render()).toContain("Last seen 3 days ago");
    const late = render({ items: [item({ lastSeenAt: new Date("2026-08-31T21:30:00Z") })] });
    expect(late).toContain("Last seen on 1 Sept 2026");
    expect(render({ items: [item({ lastSeenAt: null })] })).toContain("Never seen since first recorded");
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
