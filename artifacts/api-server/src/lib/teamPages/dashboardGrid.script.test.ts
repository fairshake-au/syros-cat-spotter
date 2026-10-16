import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// SYC-396 PR 1.3.4 (adversarial review, finding 1): the Cats grid's script
// in a stand-in page, with fetch held by the test, so the order answers
// arrive in is ours to choose. What is on screen and in the address must
// always match the form as it is now, never an answer the form has moved on
// from.

const SRC = readFileSync(join(__dirname, "../../../assets/dashboard-grid.js"), "utf8");

const page = (shown: string) =>
  "<!doctype html><html><body>" +
  '<form id="catfilters" action="/api/team/cats"><details><summary>Filters (0)</summary>' +
  '<input type="checkbox" name="colours" value="ginger">' +
  '<input type="checkbox" name="colours" value="black">' +
  "</details></form>" +
  `<div id="catresults">${shown}</div></body></html>`;

interface Held {
  url: string;
  aborted: boolean;
  /** Sends the server's answer for this request (ignored by fetch once aborted). */
  answer: () => void;
}

function setUp() {
  const dom = new JSDOM(page("ALL CATS"), { url: "https://team.example/api/team/cats", runScripts: "outside-only" });
  const w = dom.window;
  const held: Held[] = [];
  (w as unknown as { fetch: unknown }).fetch = (url: string, opts: { signal: AbortSignal }) =>
    new Promise((resolve, reject) => {
      const h: Held = {
        url,
        aborted: false,
        answer: () =>
          resolve({
            ok: true,
            redirected: false,
            headers: { get: () => "text/html; charset=utf-8" },
            text: async () => page(`RESULTS FOR ${url}`),
          }),
      };
      opts.signal.addEventListener("abort", () => {
        h.aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
      held.push(h);
    });
  w.eval(SRC);
  const box = (v: string) => w.document.querySelector(`input[value="${v}"]`)!;
  const toggle = (v: string) => {
    box(v).checked = !box(v).checked;
    box(v).dispatchEvent(new w.Event("change", { bubbles: true }));
  };
  const shown = () => w.document.getElementById("catresults")!.textContent;
  const busy = () => w.document.getElementById("catresults")!.hasAttribute("aria-busy");
  return { w, held, toggle, shown, busy };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("dashboard-grid.js never shows an answer the form has moved on from", () => {
  it("one tap applies: the answer swaps in and the address follows", async () => {
    const t = setUp();
    t.toggle("ginger");
    expect(t.held.map((h) => h.url)).toEqual(["/api/team/cats?colours=ginger"]);
    expect(t.busy()).toBe(true);
    t.held[0]!.answer();
    await settle();
    expect(t.shown()).toBe("RESULTS FOR /api/team/cats?colours=ginger");
    expect(t.w.location.search).toBe("?colours=ginger");
    expect(t.busy()).toBe(false);
  });

  it("tick, then untick before the answer: the answer is dropped, and the page still shows every cat", async () => {
    const t = setUp();
    t.toggle("ginger");
    t.toggle("ginger");
    expect(t.held).toHaveLength(1);
    expect(t.held[0]!.aborted).toBe(true);
    t.held[0]!.answer(); // arrives anyway, late
    await settle();
    expect(t.shown()).toBe("ALL CATS");
    expect(t.w.location.search).toBe("");
    expect(t.w.location.href).not.toContain("colours");
    expect(t.busy()).toBe(false);
  });

  it("tick one, then another: only the second answer applies, whatever order they arrive in", async () => {
    const t = setUp();
    t.toggle("ginger");
    t.toggle("black");
    expect(t.held.map((h) => h.url)).toEqual([
      "/api/team/cats?colours=ginger",
      "/api/team/cats?colours=ginger&colours=black",
    ]);
    expect(t.held[0]!.aborted).toBe(true);
    t.held[1]!.answer();
    t.held[0]!.answer();
    await settle();
    expect(t.shown()).toBe("RESULTS FOR /api/team/cats?colours=ginger&colours=black");
    expect(t.w.location.search).toBe("?colours=ginger&colours=black");
  });

  it("after a failed answer, the same choice can be tried again", async () => {
    const t = setUp();
    t.toggle("ginger");
    t.toggle("ginger"); // aborts it
    t.toggle("ginger"); // asks again
    expect(t.held).toHaveLength(2);
    t.held[1]!.answer();
    await settle();
    expect(t.shown()).toBe("RESULTS FOR /api/team/cats?colours=ginger");
  });
});
