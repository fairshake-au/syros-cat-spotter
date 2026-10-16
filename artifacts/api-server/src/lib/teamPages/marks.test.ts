import { describe, expect, it } from "vitest";
import { MARKS } from "../teamCatList";
import { markBadge, MARK_CSS, MARK_WORD } from "./marks";

// SYC-396 PR 1.3: the four sterilisation marks are a shape AND a word.

describe("markBadge", () => {
  it("has exactly the four words", () => {
    expect(MARK_WORD).toEqual({
      sterilised: "Sterilised",
      probably: "Probably",
      not_sterilised: "Not sterilised",
      not_known: "Not known",
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
