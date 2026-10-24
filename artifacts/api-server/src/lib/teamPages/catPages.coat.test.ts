import { describe, expect, it } from "vitest";
import { renderCatPage } from "./catPages";
import { renderColourCheckPage } from "./appearancePage";
import { catView, statement } from "./__fixtures__/catView";
import type { TeamAppearance, TeamAppearanceStatement } from "../teamCatView";

// SYC-602 Task 3.2 (spec §3.7), as SYC-655 Task 4 made it: the Coat and markings tab's plain section.

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
/** The plain Coat and markings section (SYC-655 §6): from its opening tag to its closing one. */
const fold = (html: string) => {
  const at = html.indexOf('<section id="appearance"');
  if (at === -1) return "";
  let depth = 0;
  for (const m of html.slice(at).matchAll(/<section[\s>]|<\/section>/g)) {
    depth += m[0] === "</section>" ? -1 : 1;
    if (depth === 0) return html.slice(at, at + m.index! + m[0].length);
  }
  return html.slice(at);
};
/** The words a person reads: inside <main> when given a whole page (the
 * styles sit in the head), tags removed until none are left. */
const text = (h: string) => {
  let t = h.includes("<main") ? h.slice(h.indexOf("<main"), h.lastIndexOf("</main>")) : h;
  for (let prev = ""; prev !== t; ) [prev, t] = [t, t.replace(/<[^>]*>/g, " ")];
  return t.replace(/&#39;/g, "'").replace(/\s+/g, " ");
};

describe("the Coat and markings section (SYC-602 Task 3.2, SYC-655 Task 4)", () => {
  it("is a plain section, not a fold", () => {
    const html = page();
    expect(html).toContain('<section id="appearance">');
    expect(html).not.toContain("<details class=\"fold\"");
    expect(html).not.toContain("foldbody");
    const f = fold(html);
    expect(f).toContain("Grey tabby, white paws");
    expect(f).toContain("Read from the photo on 3 Apr · Maria agreed on 5 Apr");
    // It sits in the Coat panel, under that panel's own heading.
    const panel = html.slice(html.indexOf('id="tab-coat"'));
    expect(panel.indexOf('<h2 id="h-coat">')).toBeLessThan(panel.indexOf('<section id="appearance"'));
    expect((html.match(/id="appearance"/g) ?? []).length).toBe(1);
  });

  it("leaves out a part that has no data", () => {
    const onlyMachine = view({ statements: [stmt({})] });
    const s1 = fold(page(onlyMachine));
    expect(s1).toContain("Read from the photo on 3 Apr</span>");
    expect(s1).not.toContain("agreed on");
    const none = view({ statements: [], value: null, parts: undefined }, { statements: [] });
    const s2 = fold(page(none));
    expect(s2).not.toContain("Read from the photo");
    expect(s2).not.toContain("agreed");
  });

  it("is open whatever the state: no open attribute, no fold rules, and ?open=coat is no longer read", () => {
    for (const done of [undefined, "a_confirmed", "a_corrected"]) {
      const f = fold(page(view({ checkReasons: ["tied_camps"], guardianDisagrees: true }), { done }));
      expect(f.startsWith('<section id="appearance">')).toBe(true);
      expect(f).not.toContain("<details class=\"fold\"");
    }
    expect(page(view(), { openCoat: true } as never)).toBe(page(view()));
  });

  it("puts the notice inside the section", () => {
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

  it("points the tab at the panel, which has the one heading", () => {
    const html = page();
    expect(html).toContain('href="#tab-coat">Coat and markings</a>');
    expect(html).toContain('<h2 id="h-coat">Coat and markings</h2>');
    expect(fold(html)).not.toContain("<h2");
  });

  it("the Colour check links land on the section", () => {
    const cat = {
      catId: 7, name: "Tiger", syr: "SYR-0007", group: "check", reasons: ["tied_camps"], photoUrl: null,
      coatColours: ["grey"], coatPattern: "stripes", markings: [], above: { coat: [], markings: [] },
    };
    const html = renderColourCheckPage([cat] as never, "Sam");
    expect(html.match(/href="\/api\/team\/cats\/7#appearance"/g)).toHaveLength(2);
    expect(html).not.toContain("open=coat");
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
});

describe("Past changes (SYC-655 Task 4, review A1)", () => {
  const who = { kind: "team" as const, label: "Maria" };
  const entry = (id: number, over: Record<string, unknown>) =>
    statement(id, { author: who, correction: null, observedAt: "2026-04-1" + (id % 9) + "T10:00:00Z", createdAt: "2026-04-1" + (id % 9) + "T10:00:00Z", ...over });
  const history = [
    // 605 marked 604 wrong; 603 replaced 601, which a photo showed black.
    entry(605, { kind: "markings", said: "Marked wrong", replaces: 604, reason: "Not a mark" }),
    entry(604, { kind: "markings", said: "Markings: White paws", replacedBy: [605], reason: "Seemed so", photoUrl: "/api/team/photos/m.jpg" }),
    entry(603, { kind: "coat", said: "Coat: Grey tabby", replaces: 601, reason: "Better light", correction: { kind: "appearance" } }),
    entry(601, { kind: "coat", said: "Coat: Black", replacedBy: [603], reason: "Looked black in shade", photoUrl: "/api/team/photos/old.jpg" }),
  ];
  const withPast = () =>
    catView({
      history,
      appearance: {
        coat: coat({ statements: [stmt({ id: 603, source: "team", author: who, photoUrl: null, modelVersion: null })] }),
        markings: markings({ statements: [] }),
      },
      publicStatus: { markings: ["white_paws"] },
    } as never);
  const past = (html: string) => {
    const f = fold(html);
    const at = f.indexOf("Past changes</h3>");
    return at === -1 ? "" : f.slice(at);
  };

  it("lists every change that no longer counts, crossed out, with its reason, photo and what replaced it", () => {
    const p = past(page(withPast()));
    expect(p).toContain("Past changes");
    expect(p).toContain('id="a-601"');
    expect(p).toContain("<del>Coat: Black</del>");
    expect(p).toContain("Why: Looked black in shade");
    expect(p).toContain('href="/api/team/photos/old.jpg"');
    // Replaced by the change that stands, which is listed in this same tab.
    expect(p).toContain('Replaced by <a href="#a-603">the change of');
    expect(p).toContain("Grey tabby");
    // A change marked wrong: its reason, photo, and the retraction (a row in History).
    expect(p).toContain('id="a-604"');
    expect(p).toContain("<del>Markings: White paws</del>");
    expect(p).toContain("Why: Seemed so");
    expect(p).toContain('href="/api/team/photos/m.jpg"');
    expect(p).toContain('Replaced by <a href="#s-605">');
    expect(p).toContain("Not a mark");
    // The retraction itself is not a coat change, and the standing one is not "past".
    expect(p).not.toContain('id="a-605"');
    expect(p).not.toContain('id="a-603"');
  });

  it("keeps Mark wrong on the change that counts and offers none on a past one", () => {
    const f = fold(page(withPast()));
    expect(f).toContain('action="/api/team/statements/603/wrong"');
    expect(past(page(withPast()))).not.toContain("/wrong");
    expect(f).toContain('id="a-603"');
  });

  it("shows past changes to a viewer who may not change the coat", () => {
    const p = past(page(withPast(), { may: () => false }));
    expect(p).toContain('id="a-601"');
    expect(p).toContain("Why: Looked black in shade");
  });

  it("says where the past changes are, and only when there are some", () => {
    const f = fold(page(withPast()));
    expect(f).toContain("Past changes are listed below.");
    expect(f.indexOf("Past changes are listed below.")).toBeLessThan(f.indexOf("Past changes</h3>"));
    expect(f).not.toContain("Older and replaced changes are in History");
    const none = fold(page());
    expect(none).not.toContain("Past changes");
    expect(none).not.toContain("Older and replaced changes are in History");
  });

  it("every change is listed in this tab once: a-<id> ids are unique and History links to them", () => {
    const html = page(withPast());
    const ids = [...html.matchAll(/ id="(a-\d+)"/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual(["a-601", "a-603", "a-604"]);
    expect(html).toContain('<li class="hrow replaced" id="s-601"');
    expect(html).toContain('href="#a-601"');
    expect(html).toContain("Coat changed to grey tabby");
    expect(html).toContain("Markings changed to white paws");
  });

  it("lists a standing change that was outvoted only once (under Also recorded, not counted)", () => {
    const outvoted = stmt({ id: 610, codes: ["black"], source: "team", author: who, counts: false, markable: true, photoUrl: null, modelVersion: null });
    const v = catView({
      history: [entry(610, { kind: "coat", said: "Coat: Black", correction: { kind: "appearance" } })],
      appearance: { coat: coat({ statements: [stmt({}), outvoted] }), markings: markings() },
    } as never);
    const html = page(v);
    expect(html.match(/ id="a-610"/g)).toHaveLength(1);
    expect(past(html)).toBe("");
    expect(html).toContain('href="#a-610"');
  });
});
