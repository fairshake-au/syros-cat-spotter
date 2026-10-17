import { describe, expect, it } from "vitest";
import type { QueueReport, WelfareQueue } from "../welfareQueue";
import { renderQueuePage } from "./queuePage";

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
  contactLeft: false,
  emailToReporter: null,
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
    expect(nav).toContain('<span class="who">Signed in as Maria</span>');
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

  it("keeps an open report unfolded (no details around the report itself)", () => {
    const a = article(render(queue([report("a")])), "a");
    expect(a).not.toContain("<details>");
    expect(a).not.toContain("<details open>");
    expect(a).not.toContain("said1");
    expect(a).toContain('<div class="head">');
  });

  it("folds a closed report: tags and a one-line summary inside <summary>, forms inside <details>", () => {
    const html = render(queue([], [closed()]));
    const a = article(html, "c");
    const m = /<details><summary>([\s\S]*?)<\/summary>([\s\S]*)<\/details>/.exec(a)!;
    expect(m).not.toBeNull();
    const summary = m[1]!;
    expect(summary).toContain('<span class="head">');
    expect(summary).toContain('<span class="tag urgent">Urgent</span>');
    expect(summary).toContain('<span class="tag state">Done</span>');
    expect(summary).toContain('<span class="said1">Cat was hurt</span>');
    const inside = m[2]!;
    expect(inside).toContain('<div class="actions">');
    expect(inside).toContain('action="/api/team/reports/c/state"');
    expect(inside).toContain('action="/api/team/reports/c/note"');
    // The tags are not repeated in the body.
    expect(inside).not.toContain('<div class="head">');
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
    expect(article(html, "c")).toContain("<details open><summary>");
    expect(article(html, "d")).toContain("<details><summary>");
    expect(render(q)).not.toContain("<details open>");
  });

  it("is open when it is the tied one", () => {
    const html = render(queue([], [closed()]), undefined, { id: "c", key: "ok" });
    expect(article(html, "c")).toContain("<details open><summary>");
  });

  it("escapes a note containing <script> inside the summary", () => {
    const evil = '<script>alert("x")</script>';
    const html = render(queue([], [closed({ note: evil, teamNote: evil })]));
    expect(html).not.toContain("<script>");
    const summary = /<summary><span class="head">[\s\S]*?<\/summary>/.exec(article(html, "c"))![0];
    expect(summary).toContain("&lt;script&gt;");
    expect(summary).not.toContain("<script");
  });

  it("puts the photo in the closed report's body with a photolink", () => {
    const html = render(queue([], [closed({ photo: { status: "attached", url: "/api/team/photos/p9" } })]));
    const a = article(html, "c");
    expect(a).toContain('<div class="has-photo">');
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
  it("has a short label for Feeding sites, hidden on desktop by CSS; Queue is already short (SYC-396 PR 1.6)", () => {
    const html = render(queue([report("a")]));
    expect(html).toContain('aria-current="page">Queue</a>');
    expect(html).toContain('<span class="long">Feeding sites</span><span class="short">Sites</span>');
  });
});
