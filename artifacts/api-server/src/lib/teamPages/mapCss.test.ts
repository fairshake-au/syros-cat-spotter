import { describe, expect, it } from "vitest";
import { renderPage } from "./layout";

// SYC-705 Task 2b.7 (from the 2b.6 review): a map box with no map collapses
// round its one line, on the cat page's and colony plan's small maps too. Their
// own height rule (.catmap/.planmap .map[data-map]) used to outrank the
// collapse rules, so those pages kept a tall empty box. And the place pin's
// own rules.

const css = (() => {
  const html = renderPage({ title: "T", active: null, personName: "P", body: "" });
  // Comments out: they hold braces and words, not rules.
  return /<style>([\s\S]*?)<\/style>/.exec(html)![1]!.replace(/\/\*[\s\S]*?\*\//g, "");
})();

/** Every rule (selector list and body), in order, with the @media it sits in. */
function rules(text: string): Array<{ media: string | null; selectors: string[]; body: string; at: number }> {
  const out: Array<{ media: string | null; selectors: string[]; body: string; at: number }> = [];
  const walk = (block: string, media: string | null, offset: number) => {
    const re = /([^{}]+)\{((?:[^{}]|\{[^{}]*\})*)\}/g;
    for (let m = re.exec(block); m; m = re.exec(block)) {
      const head = m[1]!.trim();
      if (head.startsWith("@media")) walk(m[2]!, head, offset + m.index);
      else if (!head.startsWith("@")) out.push({ media, selectors: head.split(",").map((s) => s.trim()), body: m[2]!, at: offset + m.index });
    }
  };
  walk(text, null, 0);
  return out;
}

/** CSS specificity as [ids, classes/attributes/pseudo-classes, elements]. */
function specificity(sel: string): [number, number, number] {
  const ids = (sel.match(/#[\w-]+/g) ?? []).length;
  const classes = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (sel.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(\([^)]*\))?/g, " ").match(/[a-z][\w-]*/gi) ?? []).length;
  return [ids, classes, elements];
}
/** -1, 0 or 1: how specificity a compares with b. */
const compare = (a: [number, number, number], b: [number, number, number]) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]! ? 1 : -1;
  return 0;
};

describe("map box CSS", () => {
  const all = rules(css);
  /** A selector for the map box itself (not something inside it). */
  const isBox = (s: string) => /\.map\[data-map\]$/.test(s);
  /** Every rule giving a map box a height outside the collapse rules. */
  const heights = all.filter((r) => /(^|;)height:/.test(r.body) && r.selectors.some(isBox) && !/height:auto/.test(r.body));

  it("has the small maps' own height rule (the case this guards)", () => {
    const small = heights.find((r) => r.selectors.includes(".catmap .map[data-map]"));
    expect(small).toBeDefined();
    expect(small!.selectors).toContain(".planmap .map[data-map]");
  });

  for (const [name, test] of [
    ["no scripting", (r: ReturnType<typeof rules>[number]) => r.media === "@media (scripting:none)"],
    ["map-core's nomap", (r: ReturnType<typeof rules>[number]) => r.media === null && r.selectors.some((s) => s.endsWith(".nomap"))],
  ] as const) {
    it(`with ${name}, the collapse rule wins over every map box height rule, the cat page's and plan's small maps too`, () => {
      const collapse = all.filter((r) => test(r) && /height:auto/.test(r.body) && /min-height:0/.test(r.body));
      expect(collapse.length).toBeGreaterThan(0);
      for (const h of heights) {
        for (const sel of h.selectors.filter(isBox)) {
          // A collapse selector reaching the same box: it must outrank this one, or tie and come later.
          const target = name === "no scripting" ? sel : `${sel}.nomap`;
          const winner = collapse.some((c) =>
            c.selectors.some((cs) => {
              if (cs !== target) return false;
              const order = compare(specificity(cs), specificity(sel));
              return order > 0 || (order === 0 && c.at > h.at);
            }),
          );
          expect(winner, `${name}: nothing collapses "${sel}"`).toBe(true);
        }
      }
    });
  }

  it("the place pin sits in the middle of the box, never takes a tap, and the map's hidden parts stay hidden", () => {
    expect(css).toContain(".map[data-map] .placepin{position:absolute;left:50%;top:50%;");
    expect(css).toMatch(/\.map\[data-map\] \.placepin\{[^}]*pointer-events:none/);
    expect(css).toContain("[data-mapon][hidden]{display:none}");
  });
});
