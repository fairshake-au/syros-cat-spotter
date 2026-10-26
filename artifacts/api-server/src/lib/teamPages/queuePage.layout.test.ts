import { describe, expect, it } from "vitest";
import type { QueueReport, WelfareQueue } from "../welfareQueue";
import type { IssueReport, IssuesSection } from "../issues/queue";
import type { ColourCheckCat } from "../colourCheck";
import type { LikelyCat } from "../likelyReview";
import { renderColourCheckPage } from "./appearancePage";
import { renderLikelyPage } from "./likelyPage";
import { placeLabel } from "../areas/placeLabel";
import { nextStep, renderQueuePage } from "./queuePage";

// Pure render tests for the welfare queue's phone/desktop layout (SYC-219).

const NOW = new Date("2026-10-15T12:00:00Z");

const report = (id: string, over: Partial<QueueReport> = {}): QueueReport => ({
  id,
  severity: "attention",
  isLitter: false,
  lat: 37.44,
  lng: 24.94,
  at: "2026-10-15T10:00:00Z",
  note: "A thin cat by the bins",
  state: "new",
  stateChangedAt: null,
  stateChangedBy: null,
  photo: { status: "none", url: null },
  cat: null,
  suggestedCat: null,
  contactLeft: false,
  emailToReporter: null,
  onClose: "none",
  teamNote: null,
  teamNoteAt: null,
  teamNoteBy: null,
  emailToTeam: null,
  unchecked: false,
  ...over,
});

const queue = (open: QueueReport[], closed: QueueReport[] = []): WelfareQueue => ({
  open,
  closed,
  closedTotal: closed.length,
  drafts: [],
  draftsTotal: 0,
  unchecked: { reports: [], reportsTotal: 0, drafts: [], draftsTotal: 0 },
  mail: { failed: 0, late: 0 },
});

const render = (
  q: WelfareQueue,
  changedId?: string,
  tied?: { id: string; key: string },
) => renderQueuePage(q, "Maria", NOW, changedId, tied, true);

/** The article for one report. */
const article = (html: string, id: string) => {
  const m = new RegExp(`<article [^>]*id="r-${id}">[\\s\\S]*?</article>`).exec(html);
  if (!m) throw new Error(`no article r-${id}`);
  return m[0];
};

describe("queue page chrome", () => {
  it("puts the name and Sign out at the end of the menu bar, not under the heading (SYC-396 PR 1.6)", () => {
    const html = render(queue([report("a")]));
    const nav = /<nav class="bar[^"]*"[^>]*>([\s\S]*?)<\/nav>/.exec(html)![1]!;
    expect(nav).toContain('<span class="who" title="Maria">Signed in as Maria</span>');
    expect(nav.endsWith('<button type="submit">Sign out</button></form>')).toBe(true);
    expect(/<main[^>]*>([\s\S]*)<\/main>/.exec(html)![1]).not.toContain("Signed in as");
  });

  it("uses the wide page", () => {
    expect(render(queue([]))).toContain('<main id="main" tabindex="-1" class="wide">');
  });
});

describe("queue page photo", () => {
  it("wraps a report photo in a.photolink to the photo", () => {
    const html = render(queue([report("a", { photo: { status: "attached", url: "/api/team/photos/p1" } })]));
    expect(article(html, "a")).toContain(
      '<a class="photolink" href="/api/team/photos/p1"><img class="photo" src="/api/team/photos/p1"',
    );
  });

  it("has no photolink without a photo", () => {
    expect(render(queue([report("a")]))).not.toContain('class="photolink"');
  });
});

describe("queue page team note box", () => {
  const noteBox = (html: string) =>
    /<details class="notebox"( open)?><summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/.exec(html)!;

  it("folds the note form in details.notebox: Add a team note when there is none", () => {
    const m = noteBox(article(render(queue([report("a")])), "a"));
    expect(m[1]).toBeUndefined();
    expect(m[2]).toBe("Add a team note");
    expect(m[3]).toContain('<form method="post" action="/api/team/reports/a/note">');
    expect(m[3]).toContain("<textarea");
  });

  it("says Change the team note when one exists", () => {
    const html = render(
      queue([report("a", { teamNote: "Fed twice", teamNoteBy: { name: "Eleni", left: false }, teamNoteAt: "2026-10-15T11:00:00Z" })]),
    );
    expect(noteBox(article(html, "a"))[2]).toBe("Change the team note");
  });

  it("opens the note box when the report is the changedId", () => {
    const html = render(queue([report("a"), report("b")]), "a");
    expect(noteBox(article(html, "a"))[1]).toBe(" open");
    expect(noteBox(article(html, "b"))[1]).toBeUndefined();
  });

  it("opens the note box when the report is the tied one", () => {
    const html = render(queue([report("a"), report("b")]), undefined, { id: "b", key: "ok" });
    expect(noteBox(article(html, "b"))[1]).toBe(" open");
    expect(noteBox(article(html, "a"))[1]).toBeUndefined();
  });
});

describe("queue page closed reports", () => {
  const closed = (over: Partial<QueueReport> = {}) =>
    report("c", { state: "done", severity: "urgent", note: "Cat was hurt", ...over });

  it("draws an open report as one line in a fold: a closed <details> in the article, anchor outside it", () => {
    const a = article(render(queue([report("a")])), "a");
    expect(a).toMatch(/^<article [^>]*id="r-a"><details><summary/);
    expect(a).not.toContain("<details open>");
    expect(a).toContain('<div class="actions">');
  });

  it("folds a closed report: tags and a one-line summary inside <summary>, forms inside <details>", () => {
    const html = render(queue([], [closed()]));
    const a = article(html, "c");
    const m = /<details><summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*)<\/details>/.exec(a)!;
    expect(m).not.toBeNull();
    const summary = m[1]!;
    expect(summary).toContain('<span class="tag urgent">Urgent</span>');
    expect(summary).toContain('<span class="tag state">Done</span>');
    expect(summary).toContain('<span class="said1">Cat was hurt</span>');
    const inside = m[2]!;
    expect(inside).toContain('<div class="actions">');
    expect(inside).toContain('action="/api/team/reports/c/state"');
    expect(inside).toContain('action="/api/team/reports/c/note"');
    // The tags are not repeated in the body.
    expect(inside).not.toContain('<span class="tag state">');
    // Nothing of the forms leaks into the summary.
    expect(summary).not.toContain("<form");
  });

  it("says Nothing written in the summary when the report has no note", () => {
    const a = article(render(queue([], [closed({ note: null })])), "c");
    expect(a).toContain('<span class="said1">Nothing written</span>');
  });

  it("is closed by default and open when it is the changedId", () => {
    const q = queue([], [closed(), report("d", { state: "nothing_needed" })]);
    const html = render(q, "c");
    expect(article(html, "c")).toMatch(/<details open><summary/);
    expect(article(html, "d")).toMatch(/<details><summary/);
    expect(render(q)).not.toMatch(/<details open>/);
  });

  it("is open when it is the tied one", () => {
    const html = render(queue([], [closed()]), undefined, { id: "c", key: "ok" });
    expect(article(html, "c")).toMatch(/<details open><summary/);
  });

  it("escapes a note containing <script> inside the summary", () => {
    const evil = '<script>alert("x")</script>';
    const html = render(queue([], [closed({ note: evil, teamNote: evil })]));
    expect(html).not.toContain("<script>");
    const summary = /<summary[\s\S]*?<\/summary>/.exec(article(html, "c"))![0];
    expect(summary).toContain("&lt;script&gt;");
    expect(summary).not.toContain("<script");
  });

  it("puts the photo in the closed report's body with a photolink", () => {
    const html = render(queue([], [closed({ photo: { status: "attached", url: "/api/team/photos/p9" } })]));
    const a = article(html, "c");
    expect(a).toContain('<a class="photolink" href="/api/team/photos/p9">');
    expect(a.indexOf("</summary>")).toBeLessThan(a.indexOf("photolink"));
  });
});

describe("after a team note is saved (?noted=)", () => {
  const noted = (q: WelfareQueue, id: string) =>
    renderQueuePage(q, "Maria", NOW, undefined, undefined, true, id);

  it("says it's saved and keeps a closed report and its note box open", () => {
    const html = noted(queue([report("a")], [report("c", { state: "done", teamNote: "Fed" })]), "c");
    const card = article(html, "c");
    expect(card).toContain("<details open>");
    expect(card).toContain('<details class="notebox" open>');
    expect(card).toContain("Saved. The team note is updated.");
    expect(article(html, "a")).not.toContain("Saved. The team note is updated.");
  });

  it("shows nothing for an id that isn't on the page", () => {
    const html = noted(queue([report("a")]), "zzz");
    expect(html).not.toContain("Saved. The team note is updated.");
  });
});

describe("the phone menu", () => {
  it("is one short row: the long/short pair left with Feeding sites, and Queue is current (SYC-396 PR 2.1)", () => {
    const html = render(queue([report("a")]));
    expect(html).toContain('aria-current="page">Queue</a>');
    expect(html).not.toContain('class="long"');
    expect(html).not.toContain("Feeding sites</a>");
  });
});

describe("one-line rows (SYC-519 D1)", () => {
  const line = (html: string, id: string) =>
    /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(article(html, id))![1]!;
  const renderOpen = (q: WelfareQueue, open?: string) =>
    renderQueuePage(q, "Maria", NOW, undefined, undefined, true, undefined, false, undefined, open);

  it("holds the place, how long ago, the first words and the state in <summary>", () => {
    const html = render(queue([report("a", { photo: { status: "attached", url: "/api/team/photos/p1" }, note: "A thin cat by the bins" })]));
    const sum = line(html, "a");
    expect(sum).toContain(placeLabel({ lat: 37.44, lng: 24.94 }));
    expect(sum).toContain("2 hours ago");
    expect(sum).toContain("A thin cat by the bins");
    expect(sum).toContain('<span class="tag state">New</span>');
    expect(sum).toContain('<img class="hthumb" src="/api/team/photos/p1"');
    expect(sum).not.toContain("<form");
    expect(sum).not.toContain("<dl");
  });

  it("marks urgent, kittens and unchecked in the line", () => {
    const sum = line(render(queue([report("a", { severity: "urgent", isLitter: true, unchecked: true })])), "a");
    expect(sum).toContain('<span class="tag urgent">Urgent</span>');
    expect(sum).toContain('<span class="tag kittens">Kittens</span>');
    expect(sum).toContain('<span class="tag unchecked">Unchecked</span>');
  });

  it("keeps the full note, the dl and the buttons in the body, not the line", () => {
    const a = article(render(queue([report("a")])), "a");
    expect(a.indexOf("</summary>")).toBeLessThan(a.indexOf("<dl>"));
    expect(a.indexOf("</summary>")).toBeLessThan(a.indexOf('class="actions"'));
  });

  it("opens exactly the report named by open", () => {
    const html = renderOpen(queue([report("a"), report("b")]), "b");
    expect(article(html, "b")).toMatch(/<details open><summary/);
    expect(article(html, "a")).toMatch(/<details><summary/);
  });

  it("opens nothing for an open that matches no report, and never prints it", () => {
    for (const bad of ["nope", "<script>alert(1)</script>"]) {
      const html = renderOpen(queue([report("a")]), bad);
      expect(html).not.toMatch(/<details open>/);
      expect(html).not.toContain(bad);
      expect(html).not.toContain("alert(1)");
    }
  });

  it("opens the report just changed, noted or tied", () => {
    expect(article(render(queue([report("a")]), "a"), "a")).toMatch(/<details open>/);
    expect(article(renderQueuePage(queue([report("a")]), "Maria", NOW, undefined, undefined, true, "a"), "a")).toMatch(/<details open>/);
    expect(article(render(queue([report("a")]), undefined, { id: "a", key: "ok" }), "a")).toMatch(/<details open>/);
  });

  it("escapes the note in the line", () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = render(queue([report("a", { note: evil })]));
    expect(line(html, "a")).toContain("&lt;img");
    expect(html).not.toContain(evil);
  });
});

describe("Queue: the next step, the folded row and the stripe (SYC-619 task 15, spec §6)", () => {
  const closed = (over: Partial<QueueReport> = {}) => report("c", { state: "done", ...over });
  const css = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
  const forms = (a: string) => /<form method="post" action="[^"]*\/state">[\s\S]*?<\/form>/.exec(a)![0];

  it("nextStep: new -> looking, looking -> done, nothing else, and null when not offered", () => {
    const all = ["new", "looking", "done", "nothing_needed"] as const;
    expect(nextStep("new", all)).toBe("looking");
    expect(nextStep("looking", all)).toBe("done");
    expect(nextStep("done", all)).toBeNull();
    expect(nextStep("nothing_needed", all)).toBeNull();
    expect(nextStep("looking", ["new", "looking"])).toBeNull();
  });

  it("a New report says 'Now: New' in words and fills Looking at it", () => {
    const f = forms(article(render(queue([report("a")])), "a"));
    expect(f).toContain("Now: New");
    expect(f).not.toContain("(current)");
    expect(f).not.toContain("disabled");
    expect(f).not.toContain('name="to" value="new"');
    expect(f).toMatch(/<button type="submit" name="to" value="looking" class="go">Looking at it<\/button>/);
    expect(f.match(/class="go"/g)).toHaveLength(1);
    expect(f).toContain('name="to" value="done"');
    expect(f).toContain("Move this report to");
  });

  it("a Looking at it report fills Done", () => {
    const f = forms(article(render(queue([report("a", { state: "looking" })])), "a"));
    expect(f).toContain("Now: Looking at it");
    expect(f).toMatch(/name="to" value="done" class="go">Done<\/button>/);
    expect(f.match(/class="go"/g)).toHaveLength(1);
  });

  it("Done and Nothing needed have no filled button", () => {
    for (const state of ["done", "nothing_needed"] as const) {
      const f = forms(article(render(queue([], [closed({ state })])), "c"));
      expect(f).not.toContain('class="go"');
      expect(f).toContain('name="to" value="new"');
    }
  });

  it("the filled button only exists in CSS scoped to the Queue's own cards", () => {
    const c = css(render(queue([report("a")])));
    expect(c).toMatch(/article\.report \.actions button\.go\{[^}]*background:var\(--accent\)/);
  });

  it("a report with no photo has no tile; its body says No photo", () => {
    const a = article(render(queue([report("a")])), "a");
    expect(a).not.toContain("hthumb");
    expect(a).not.toContain("nothumb");
    expect(a).toContain('<div class="nophoto">No photo</div>');
    expect(a.match(/No photo/g)).toHaveLength(1);
  });

  it("a report with a photo still has its 56px thumbnail", () => {
    const a = article(render(queue([report("a", { photo: { status: "attached", url: "/p/1" } })])), "a");
    expect(a).toContain('class="hthumb"');
    expect(a).not.toContain("No photo");
  });

  it("the short words run to two lines, and are hidden while the row is open", () => {
    const c = css(render(queue([report("a")])));
    expect(c).toContain("-webkit-line-clamp:2");
    expect(c).toContain("article.report details[open] .said1{display:none}");
    // The base rule, which Colour check and Ear clips share, is untouched.
    expect(c).toContain(".said1{display:block;margin:0;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}");
  });

  it("an open non-urgent card has the light border; urgent, issue and closed keep their colours", () => {
    const c = css(render(queue([report("a")])));
    expect(c).toMatch(/article\.report:not\(\.urgent\):not\(\.issue\):not\(\.closed\):not\(\.likely\)\{border-left-color:var\(--line\)\}/);
    expect(c).toContain(".report.urgent{border-left-color:var(--danger)}");
    expect(c).toContain(".report.issue{border-left-color:var(--issue)}");
    expect(c).toContain(".report.closed{border-left-color:var(--line-strong);background:var(--card-quiet)}");
  });

  it("Colour check and Ear clips cards render with today's CSS: the shared rules are unchanged and every new rule is scoped to article.report", () => {
    const c = css(render(queue([report("a")])));
    expect(c).toContain(".report{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--warn-line);border-radius:10px;padding:12px;margin:10px 0;overflow-wrap:anywhere}");
    expect(c).toContain(".hthumb.nothumb{display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:var(--muted);text-align:center}");
    expect(c).toContain(".states{display:grid;grid-template-columns:1fr 1fr;gap:8px}");
    expect(c).toContain(".actions button.here{background:var(--sunk);border-color:var(--line);color:var(--ink-2);font-weight:700;cursor:default}");
    const block = /\/\* SYC-619 §6: Queue cards only \*\/\n([\s\S]*?)\/\* end SYC-619 §6 \*\//.exec(c)![1]!;
    const rules = block.split("\n").filter(Boolean);
    expect(rules.length).toBeGreaterThan(3);
    for (const l of rules) expect(l.startsWith("article.report")).toBe(true);
  });

  it("the Queue's new row rules never reach the Colour check or Ear clips pages", () => {
    const colourCat = {
      catId: 1,
      syr: "SYR-1",
      name: "Mimi",
      photoUrl: null,
      coatColours: null,
      coatPattern: null,
      markings: null,
      reasons: ["hand_pick"],
      above: { coat: [], markings: [] },
      group: "check",
      newestAt: "2026-10-01T10:00:00.000Z",
    } as unknown as ColourCheckCat;
    const clipCat: LikelyCat = {
      catId: 2,
      name: "Tiger",
      sterilisedAsOf: "2026-10-01T10:00:00.000Z",
      matchedByHand: false,
      reviewObservationId: 22,
      evidence: [],
    };
    const colour = renderColourCheckPage([colourCat], "Maria");
    const likely = renderLikelyPage([clipCat], "Maria");
    expect(colour).toContain("Mimi");
    expect(likely).toContain("Tiger");
    // The markup only: the shared stylesheet names the Queue's classes, but no card here uses them.
    for (const page of [colour, likely]) {
      const html = page.replace(/<style>[\s\S]*?<\/style>/, "");
      expect(html).not.toContain("said1");
      expect(html).not.toContain('class="go"');
      expect(html).not.toContain('class="now"');
    }
  });

  it("an Issues row whose hidden photo can't offer the next step has no go button", () => {
    const issue = (state: IssueReport["state"]): IssueReport => ({
      id: "i1",
      reason: "privacy",
      at: "2026-10-15T10:00:00Z",
      note: "Shows my face",
      state,
      stateChangedAt: null,
      stateChangedBy: null,
      teamNote: null,
      teamNoteAt: null,
      teamNoteBy: null,
      cat: null,
      photo: { url: "/api/team/photos/p1", hidden: true, removed: false },
      hiddenByReport: true,
      hideSkipped: null,
      others: 0,
      unchecked: false,
      group: "hidden",
    });
    const section = (i: IssueReport): IssuesSection => ({
      hidden: [i],
      needsPerson: [],
      other: [],
      unchecked: [],
      totals: { hidden: 1, needsPerson: 0, other: 0, unchecked: 0 },
      closed: [],
      closedTotal: 0,
      brake: { on: false, hidesToday: 0, limit: 10 },
    });
    const draw = (i: IssueReport) =>
      renderQueuePage(queue([]), "Maria", NOW, undefined, undefined, true, undefined, false, undefined, undefined, section(i));
    // Looking at it would go to Done, which a hidden photo can't offer: nothing is filled in.
    expect(draw(issue("looking"))).not.toContain('class="go"');
    // Control: New goes to Looking at it, which is offered, so the same row does fill it in.
    expect(draw(issue("new"))).toContain('class="go"');
  });
  // SYC-655 §3.2 and final review M1: a report that carries a photo opens the cat's Photos tab; one without keeps the plain page.
  it("an Issues row that carries a photo links to the cat's Photos tab", () => {
    const issue = (reason: string, withPhoto = true): IssueReport => ({
      id: "i1",
      reason,
      at: "2026-10-15T10:00:00Z",
      note: null,
      state: "new",
      stateChangedAt: null,
      stateChangedBy: null,
      teamNote: null,
      teamNoteAt: null,
      teamNoteBy: null,
      cat: { id: 42, name: "Mittens" },
      photo: withPhoto ? { url: "/api/team/photos/p1", hidden: false, removed: false } : null,
      hiddenByReport: false,
      hideSkipped: null,
      others: 0,
      unchecked: false,
      group: "other",
    });
    const draw = (i: IssueReport) =>
      renderQueuePage(queue([]), "Maria", NOW, undefined, undefined, true, undefined, false, undefined, undefined, {
        hidden: [],
        needsPerson: [],
        other: [i],
        unchecked: [],
        totals: { hidden: 0, needsPerson: 0, other: 1, unchecked: 0 },
        closed: [],
        closedTotal: 0,
        brake: { on: false, hidesToday: 0, limit: 10 },
      });
    for (const reason of ["photo_private", "photo_inappropriate", "photo_not_cat", "wrong_cat", "other"]) {
      expect(draw(issue(reason)), reason).toContain(`href="/api/team/cats/42#tab-photos">Open the cat's page</a>`);
    }
    // A "different cat" report with no photo opens the plain page.
    for (const reason of ["wrong_cat", "wrong_name", "other"]) {
      const plain = draw(issue(reason, false));
      expect(plain, reason).toContain(`href="/api/team/cats/42">Open the cat's page</a>`);
      expect(plain, reason).not.toContain("cats/42#tab-photos");
    }
  });
});
