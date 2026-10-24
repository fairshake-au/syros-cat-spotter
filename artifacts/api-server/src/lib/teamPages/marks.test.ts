import { describe, expect, it } from "vitest";
import { MARKS } from "../teamCatList";
import { markBadge, markBar, MARK_BAR_WORD, MARK_COLOUR, MARK_CSS, MARK_ORDER, MARK_WORD } from "./marks";

// SYC-396 PR 1.3: the four sterilisation marks are a shape AND a word.

describe("markBadge", () => {
  it("has exactly the four words", () => {
    expect(MARK_WORD).toEqual({
      sterilised: "Sterilised",
      probably: "Probably",
      not_sterilised: "Not sterilised",
      not_known: "Sterilised: not known yet",
    });
  });

  it.each(MARKS.map((m) => [m]))("%s has its word in the text, and its own class", (m) => {
    const html = markBadge(m);
    expect(html).toContain(`class="mark mark-${m}"`);
    // Never colour alone: the word is real text, and the shape is hidden from screen readers.
    expect(html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "")).toBe(MARK_WORD[m]);
    expect(html).toContain('aria-hidden="true"');
  });

  it("each mark has its own shape and its own colour", () => {
    const shapes = new Set(MARKS.map((m) => /<svg[\s\S]*?<\/svg>/.exec(markBadge(m))![0]));
    expect(shapes.size).toBe(4);
    for (const colour of ["#0a4d59", "#2f7884", "#6a949b", "#a6540a"]) expect(MARK_CSS).toContain(colour);
  });
});

// SYC-396 PR 2.0, Task 2.0.3: the four-part sterilisation bar (spec §4, §12.2).
describe("markBar", () => {
  const split = { sterilised: 89, probably: 23, not_known: 18, not_sterilised: 12 };
  const segments = (html: string) => [...html.matchAll(/<span class="markbar-seg mark-(\w+)" style="flex:0 1 ([\d.]+)%;background:(#[0-9a-f]{6})"/g)];
  const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "");

  it("draws one segment per non-zero mark, in MARK_ORDER, with widths that sum to 100%", () => {
    for (const s of [split, { sterilised: 1, probably: 1, not_known: 1, not_sterilised: 0 }, { sterilised: 7, probably: 0, not_known: 3, not_sterilised: 0 }]) {
      const segs = segments(markBar(s));
      expect(segs.map((m) => m[1])).toEqual(MARK_ORDER.filter((m) => s[m] > 0));
      const sum = segs.reduce((n, m) => n + Number(m[2]), 0);
      expect(Math.round(sum * 100) / 100).toBe(100);
    }
  });

  it("each width is proportional to its count", () => {
    const segs = segments(markBar(split));
    const total = 89 + 23 + 18 + 12;
    for (const m of segs) {
      const want = (split[m[1] as keyof typeof split] / total) * 100;
      expect(Math.abs(Number(m[2]) - want)).toBeLessThanOrEqual(0.01);
    }
  });

  it("says every non-zero part in words and numbers, never colour alone", () => {
    const html = markBar(split);
    expect(text(html)).toContain("89 Sterilised · 23 Probably sterilised · 18 Sterilisation not known yet · 12 Not sterilised");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="89 Sterilised, 23 Probably sterilised, 18 Sterilisation not known yet, 12 Not sterilised"');
    // Every legend part carries its mark's shape.
    for (const m of MARK_ORDER) expect(html).toContain(`<span class="mark mark-${m}">`);
  });

  it("hides the legend from screen readers, so the bar's own label is heard once", () => {
    const html = markBar(split);
    expect(html).toMatch(/<p class="markbar-legend" aria-hidden="true">/);
    expect(html).toMatch(/<div class="markbar-track" role="img"/);
  });

  it("leaves a zero part out of the bar and the legend", () => {
    const html = markBar({ sterilised: 4, probably: 0, not_known: 2, not_sterilised: 0 });
    expect(text(html)).toContain("4 Sterilised · 2 Sterilisation not known yet");
    expect(text(html)).not.toContain("Probably");
    expect(html).not.toContain("mark-not_sterilised");
  });

  it("an all-zero split is an empty outline and 'No street cats yet'", () => {
    const html = markBar({ sterilised: 0, probably: 0, not_known: 0, not_sterilised: 0 });
    expect(segments(html)).toHaveLength(0);
    expect(html).toContain("markbar-empty");
    expect(text(html)).toContain("No street cats yet");
    expect(html).toContain('aria-label="No street cats yet"');
  });

  it("treats a count that isn't a finite number as none", () => {
    const html = markBar({ sterilised: Infinity, probably: Number.NaN, not_known: -3, not_sterilised: 2 });
    expect(text(html)).not.toContain("Infinity");
    expect(html).toContain('aria-label="2 Not sterilised"');
  });

  it("uses no segment colour outside MARK_COLOUR", () => {
    const allowed = new Set(Object.values(MARK_COLOUR));
    const segs = segments(markBar(split));
    expect(segs).toHaveLength(4);
    for (const m of segs) {
      expect(allowed.has(m[3]!)).toBe(true);
      expect(m[3]).toBe(MARK_COLOUR[m[1] as keyof typeof MARK_COLOUR]);
    }
  });

  it("puts an optional label in front of the words, escaped", () => {
    const html = markBar(split, { label: "Kini <b>" });
    expect(html).toContain('aria-label="Kini &lt;b&gt;: 89 Sterilised, 23 Probably sterilised, 18 Sterilisation not known yet, 12 Not sterilised"');
    expect(html).not.toContain("<b>");
  });

  it("says sterilisation in every legend word, since the bar has no heading", () => {
    for (const w of Object.values(MARK_BAR_WORD)) expect(w.toLowerCase()).toContain("sterilis");
    const html = markBar({ sterilised: 0, probably: 0, not_known: 16, not_sterilised: 0 });
    expect(text(html)).toContain("16 Sterilisation not known yet");
  });

  it("has its styles in MARK_CSS", () => {
    expect(MARK_CSS).toContain(".markbar{");
    expect(MARK_CSS).toContain(".markbar-track{");
  });

  it("takes a guardian's words and empty line, escaped, in place of the team's English (SYC-396 PR 2.2)", () => {
    const words = { sterilised: "Στειρωμένες", probably: "<b>", not_known: "Άγνωστο", not_sterilised: "Μη στειρωμένες" };
    const html = markBar({ sterilised: 2, probably: 1, not_known: 0, not_sterilised: 3 }, { words });
    expect(text(html)).toContain("2 Στειρωμένες");
    expect(text(html)).toContain("3 Μη στειρωμένες");
    expect(html).toContain("1 &lt;b&gt;");
    expect(html).not.toContain("<b>");
    for (const w of [...Object.values(MARK_WORD), ...Object.values(MARK_BAR_WORD)]) expect(text(html)).not.toContain(w);
    const empty = markBar({ sterilised: 0, probably: 0, not_known: 0, not_sterilised: 0 }, { words, empty: "Καμία <i>" });
    expect(empty).toContain("Καμία &lt;i&gt;");
    expect(empty).not.toContain("No street cats yet");
  });
});
