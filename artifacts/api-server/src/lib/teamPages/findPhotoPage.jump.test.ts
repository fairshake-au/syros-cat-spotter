import { describe, expect, it } from "vitest";
import { renderFindForm, type FindFormOptions } from "./findPhotoPage";

// SYC-619 fix 1: the intro's "Go to the photo" link must always land somewhere.

const base = (over: Partial<FindFormOptions>): FindFormOptions =>
  ({
    personName: "Susan",
    filters: {},
    colonies: [],
    now: new Date("2026-10-23T09:00:00Z"),
    narrowing: { kind: "ok", count: 3, island: false },
    ...over,
  }) as FindFormOptions;

const ids = (html: string) => [...html.matchAll(/<(\w+)[^>]*\sid="find-photo"/g)].map((m) => m[1]);

describe("Go to the photo always has somewhere to go", () => {
  const link = '<a href="#find-photo">Go to the photo</a>';
  it("ok: the file input", () => {
    const html = renderFindForm(base({}));
    expect(html).toContain(link);
    expect(ids(html)).toEqual(["input"]);
  });
  it("cap reached: the cap notice", () => {
    const html = renderFindForm(base({ capped: "person" }));
    expect(html).toContain(link);
    expect(ids(html)).toEqual(["p"]);
  });
  it("place problem: the line that says to choose where first", () => {
    const html = renderFindForm(base({ problem: { field: "place", words: "Pick a place." } }));
    expect(html).toContain(link);
    expect(ids(html)).toEqual(["p"]);
  });
  it("no cats to compare: the line that says so", () => {
    const html = renderFindForm(base({ narrowing: { kind: "none" } }));
    expect(html).toContain(link);
    expect(ids(html)).toEqual(["p"]);
  });
});
