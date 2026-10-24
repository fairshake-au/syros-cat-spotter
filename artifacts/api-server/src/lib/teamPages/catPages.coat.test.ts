import { describe, expect, it } from "vitest";
import { renderCatPage } from "./catPages";
import { renderColourCheckPage } from "./appearancePage";
import { catView } from "./__fixtures__/catView";
import type { TeamAppearance, TeamAppearanceStatement } from "../teamCatView";

// SYC-602 Task 3.2 (spec §3.7): the Coat and markings fold.

const NOW = new Date("2026-10-17T09:00:00Z");

const stmt = (over: Partial<TeamAppearanceStatement>): TeamAppearanceStatement => ({
  id: 501,
  codes: ["grey", "stripes"],
  author: { kind: "system", label: "read automatically" },
  source: "machine",
  prompted: false,
  agreesWith: null,
  createdAt: "2026-04-03T10:00:00Z",
  photoUrl: "/api/team/photos/coat-1.jpg",
  modelVersion: "gpt-test-1",
  counts: true,
  markable: true,
  ...over,
});

const coat = (over: Partial<TeamAppearance> = {}): TeamAppearance => ({
  value: ["grey", "stripes"],
  confidence: "likely",
  parts: {
    colours: { value: ["grey"], confidence: "likely" },
    pattern: { value: "stripes", confidence: "reported" },
  },
  checkReasons: [],
  statements: [
    stmt({
      id: 502,
      codes: ["grey", "stripes"],
      source: "team",
      author: { kind: "team", label: "Maria" },
      agreesWith: 501,
      createdAt: "2026-04-05T10:00:00Z",
      photoUrl: null,
      modelVersion: null,
    }),
    stmt({}),
  ],
  guardianDecides: false,
  aboveTeamIds: [],
  guardianDisagrees: false,
  ...over,
});

const markings = (over: Partial<TeamAppearance> = {}): TeamAppearance => ({
  value: ["white_paws"],
  confidence: "reported",
  checkReasons: [],
  statements: [
    stmt({
      id: 503,
      codes: ["white_paws"],
      source: "spotter",
      author: { kind: "spotter", label: "A spotter" },
      photoUrl: null,
      modelVersion: null,
    }),
  ],
  guardianDecides: false,
  aboveTeamIds: [],
  guardianDisagrees: false,
  ...over,
});

const view = (c: Partial<TeamAppearance> = {}, m: Partial<TeamAppearance> = {}) =>
  catView({
    appearance: { coat: coat(c), markings: markings(m) },
    publicStatus: { markings: ["white_paws"] },
  } as never);

const page = (v = view(), opts = {}) => renderCatPage(v, "Sam", { now: NOW, may: () => true, ...opts });
const fold = (html: string) => {
  const at = html.indexOf('<details class="fold"');
  if (at === -1) return "";
  let depth = 0;
  for (const m of html.slice(at).matchAll(/<details[\s>]|<\/details>/g)) {
    depth += m[0] === "</details>" ? -1 : 1;
    if (depth === 0) return html.slice(at, at + m.index! + m[0].length);
  }
  return html.slice(at);
};
const foldOpening = (html: string) => html.slice(html.indexOf('<details class="fold"'), html.indexOf(">", html.indexOf('<details class="fold"')) + 1);
/** The words a person reads: inside <main> when given a whole page (the
 * styles sit in the head), tags removed until none are left. */
const text = (h: string) => {
  let t = h.includes("<main") ? h.slice(h.indexOf("<main"), h.lastIndexOf("</main>")) : h;
  for (let prev = ""; prev !== t; ) [prev, t] = [t, t.replace(/<[^>]*>/g, " ")];
  return t.replace(/&#39;/g, "'").replace(/\s+/g, " ");
};

describe("the Coat and markings fold (SYC-602 Task 3.2)", () => {
  it("folds the section with a one-line summary", () => {
    const html = page();
    expect(html).toContain('<details class="fold" id="appearance">');
    const summary = html.slice(html.indexOf('<details class="fold"'), html.indexOf("</summary>", html.indexOf('<details class="fold"')));
    expect(summary).toContain("Grey tabby, white paws");
    expect(summary).toContain("Read from the photo on 3 Apr · Maria agreed on 5 Apr");
  });

  it("leaves out a part of the summary that has no data", () => {
    const onlyMachine = view({ statements: [stmt({})] });
    const s1 = page(onlyMachine);
    expect(s1).toContain("Read from the photo on 3 Apr</span>");
    expect(s1).not.toContain("agreed on");
    const none = view({ statements: [], value: null, parts: undefined }, { statements: [] });
    const s2 = page(none);
    expect(s2).not.toContain("Read from the photo");
    expect(s2).not.toContain("agreed");
  });

  it("opens by itself when it should", () => {
    expect(foldOpening(page())).toBe('<details class="fold" id="appearance">');
    for (const done of ["a_confirmed", "a_corrected", "a_wrong", "a_coat_corrected"]) {
      expect(foldOpening(page(view(), { done })), done).toContain(" open");
    }
    expect(foldOpening(page(view({ checkReasons: ["tied_camps"] })))).toContain(" open");
    expect(foldOpening(page(view({ guardianDisagrees: true })))).toContain(" open");
    expect(foldOpening(page(view(), { openCoat: true }))).toContain(" open");
    // Another notice does not open it.
    expect(foldOpening(page(view(), { done: "visit" }))).not.toContain(" open");
  });

  it("puts the notice inside the open fold", () => {
    const html = page(view(), { done: "a_confirmed" });
    const f = fold(html);
    expect(f).toContain("Saved. The team&#39;s agreement is added.");
  });

  it("says what each button agrees with", () => {
    const f = fold(page());
    expect(f).toContain("Yes, the coat is right");
    expect(f).toContain("Yes, the markings are right");
    expect(f).toContain("Change the coat or markings");
    expect(f).not.toContain("That&#39;s right");
    expect(f).not.toContain("That's right");
    expect(f).not.toContain("Update the colour");
    expect(f).not.toContain("Update the markings");
    // The forms are as they were.
    expect(f).toContain('action="/api/team/cats/7/appearance/confirm"');
    expect(f).toContain('action="/api/team/cats/7/appearance/correct"');
    expect(f).toContain('name="expectedColours" value="grey"');
    expect(f).toContain('name="kind" value="markings"');
  });

  it("draws no forms without the capability", () => {
    const f = fold(page(view(), { may: () => false }));
    expect(f).not.toContain("/appearance/confirm");
    expect(f).not.toContain("/appearance/correct");
    expect(f).not.toContain("/wrong");
  });

  it("shows no confidence tags, record numbers or model names", () => {
    const f = fold(page(view({ checkReasons: ["tied_camps"] })));
    expect(f).not.toContain('class="tag"');
    const t = text(f);
    expect(t).not.toMatch(/#\d+/);
    expect(t).not.toContain("model ");
    expect(t).not.toContain("gpt-test-1");
    expect(t).not.toMatch(/\b(likely|reported)\b/);
  });

  it("keeps Mark wrong on each coat change that counts, with the photo", () => {
    const f = fold(page());
    expect(f).toContain('action="/api/team/statements/501/wrong"');
    expect(f).toContain('action="/api/team/statements/502/wrong"');
    expect(f).toContain('href="/api/team/photos/coat-1.jpg"');
    expect(f).toContain('id="a-501"');
    const uncounted = view({ statements: [stmt({ counts: false, markable: false })] });
    expect(fold(page(uncounted))).not.toContain("/statements/501/wrong");
  });

  it("shows the counting changes and their photo to a viewer who may not change the coat, with no Mark wrong", () => {
    const f = fold(page(view(), { may: () => false }));
    expect(f).toContain("Read from the photo on 3 Apr");
    expect(f).toContain('href="/api/team/photos/coat-1.jpg"');
    expect(f).toContain('id="a-501"');
    expect(f).not.toContain("/wrong");
    const editor = fold(page(view(), { may: () => true }));
    expect(editor).toContain('href="/api/team/photos/coat-1.jpg"');
    expect(editor).toContain('action="/api/team/statements/501/wrong"');
  });

  it("lists an outvoted guardian statement under Also recorded, not counted, with Mark wrong", () => {
    const outvoted = stmt({
      id: 510,
      codes: ["black"],
      source: "guardian",
      author: { kind: "team", label: "Eleni" },
      photoUrl: "/api/team/photos/coat-2.jpg",
      modelVersion: null,
      counts: false,
      markable: true,
      createdAt: "2026-04-07T10:00:00Z",
    });
    const v = view({ guardianDisagrees: true, statements: [stmt({}), outvoted] });
    const f = fold(page(v));
    const at = f.indexOf("Also recorded, not counted");
    expect(at).toBeGreaterThan(-1);
    const rest = f.slice(at);
    expect(rest).toContain("Eleni, cat guardian, said so on 7 Apr");
    expect(rest).toContain('href="/api/team/photos/coat-2.jpg"');
    expect(rest).toContain('action="/api/team/statements/510/wrong"');
    expect(rest).toContain('id="a-510"');
    // The counting one stays above the heading.
    expect(f.indexOf('action="/api/team/statements/501/wrong"')).toBeLessThan(at);
    // Read-only: listed, no form.
    const ro = fold(page(v, { may: () => false }));
    expect(ro).toContain("Also recorded, not counted");
    expect(ro).toContain("Eleni, cat guardian, said so on 7 Apr");
    expect(ro).not.toContain("/wrong");
    // No heading when nothing is uncounted.
    expect(fold(page())).not.toContain("Also recorded, not counted");
  });

  it("draws no origin sentence when no change counts for a value", () => {
    const v = view({}, { statements: [stmt({ id: 520, codes: ["white_paws"], source: "spotter", counts: false, markable: true, photoUrl: null })] });
    const f = fold(page(v));
    const mark = f.slice(f.indexOf("<h3>Markings"));
    expect(mark).not.toContain("Not recorded yet");
    // Straight after the heading comes the uncounted-list label, not an origin sentence.
    expect(mark.slice(mark.indexOf("</h3>") + 5).startsWith('<p class="label">Also recorded, not counted</p>')).toBe(true);
  });

  it("keeps Worth a second look and the guardian warning", () => {
    const f = fold(page(view({ checkReasons: ["tied_camps"], guardianDisagrees: true })));
    expect(f).toContain("Worth a second look");
    expect(f).toContain("Spotters are split between two colours");
    expect(f).toContain("A cat guardian&#39;s change decides this");
  });

  it("points the jump link, the facts and History at the fold", () => {
    const html = page();
    expect(html).toContain('href="#appearance">Coat and markings</a>');
    expect((html.match(/id="appearance"/g) ?? []).length).toBe(1);
  });

  it("the Colour check links open the fold", () => {
    const cat = {
      catId: 7, name: "Tiger", syr: "SYR-0007", group: "check", reasons: ["tied_camps"], photoUrl: null,
      coatColours: ["grey"], coatPattern: "stripes", markings: [], above: { coat: [], markings: [] },
    };
    const html = renderColourCheckPage([cat] as never, "Sam");
    expect(html.match(/href="\/api\/team\/cats\/7\?open=coat#appearance"/g)).toHaveLength(2);
    expect(html).not.toContain('/cats/7#appearance');
  });

  it("the Not yet described fold opens only when there is nothing to check (SYC-619 §9.2)", () => {
    const mk = (id: number, group: "check" | "not_described") => ({
      catId: id, name: `Cat ${id}`, syr: `SYR-${id}`, group, reasons: group === "check" ? ["tied_camps"] : [],
      photoUrl: null, coatColours: null, coatPattern: null, markings: null, above: { coat: [], markings: [] },
    });
    expect(renderColourCheckPage([mk(1, "not_described")] as never, "Sam")).toContain('<details class="notdescribed" open>');
    const both = renderColourCheckPage([mk(1, "check"), mk(2, "not_described")] as never, "Sam");
    expect(both).toContain('<details class="notdescribed">');
    expect(both).not.toContain('<details class="notdescribed" open>');
  });

  it("the page opened with openCoat has the fold open", () => {
    expect(foldOpening(page(view(), { openCoat: true }))).toBe('<details class="fold" id="appearance" open>');
  });
});
