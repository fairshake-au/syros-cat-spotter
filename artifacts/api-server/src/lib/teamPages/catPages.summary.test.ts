import { describe, expect, it } from "vitest";
import { renderCatPage } from "./catPages";
import { bareCatView, catView, richCatView, statement } from "./__fixtures__/catView";

// SYC-602 Task 1.2: the name line, the status line and the notices.

const NOW = new Date("2026-10-17T09:00:00Z");
const page = (v = richCatView(), opts = {}) => renderCatPage(v, "Sam", { now: NOW, ...opts });

/** True when `at` sits inside any <details>...</details> of the html. */
function insideDetails(html: string, at: number): boolean {
  const opens = (html.slice(0, at).match(/<details[\s>]/g) ?? []).length;
  const closes = (html.slice(0, at).match(/<\/details>/g) ?? []).length;
  return opens > closes;
}

describe("the team cat page summary", () => {
  it("says when the cat joined our records", () => {
    const v = catView({ cat: { id: 42, syr: "SYR-0042", createdAt: "2026-04-03T10:00:00Z" } });
    expect(page(v)).toContain("SYR-0042 · on our records since 3 Apr 2026");
  });

  it("puts the status line under the name", () => {
    const html = page();
    const h1 = html.indexOf("<h1");
    const line = html.indexOf('class="statusline"');
    expect(line).toBeGreaterThan(h1);
    const at = (needle: string) => html.indexOf(needle, line);
    const order = [at("mark-sterilised"), at("On the street"), at('href="/api/team/colonies/4"'), at("Last seen 4 days ago")];
    expect(order.every((i) => i > line)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("leaves the colony out of the status line when the cat has none", () => {
    const html = page(bareCatView());
    const line = html.slice(html.indexOf('class="statusline"'));
    const end = line.slice(0, line.indexOf("</p>"));
    expect(end).not.toMatch(/colon/i);
    expect(end).toContain("Not known");
  });

  it("puts notices above the name, never inside a fold", () => {
    const guardian = catView({
      recentGuardianMark: { statementId: 5, status: "homed", at: "2026-10-10T09:00:00Z" },
      history: [statement(5)],
    });
    const died = catView({
      records: { lifeStatus: { value: "deceased", confidence: "confirmed", supportingStatementIds: [9] } },
      history: [statement(9, { kind: "life_status", said: "Has died" })],
    });
    const hidden = catView({
      photos: [
        {
          source: "main",
          publicId: "p1",
          url: "/p1.jpg",
          hidden: { by: "Maria", at: "2026-10-01T09:00:00Z" },
        },
      ],
    } as never);
    for (const [v, needle] of [
      [guardian, "Recently marked"],
      [died, "has died"],
      [hidden, "The main photo is hidden"],
    ] as const) {
      const html = page(v);
      const n = html.indexOf(needle);
      expect(n, needle).toBeGreaterThan(-1);
      expect(n, needle).toBeLessThan(html.indexOf("<h1"));
      expect(insideDetails(html, n), needle).toBe(false);
    }
  });

  it("keeps the description as one line under the facts", () => {
    const html = page();
    const d = html.indexOf('<p class="desc">');
    expect(d).toBeGreaterThan(html.indexOf('class="catfacts"'));
    expect(html).toContain('<p class="desc">Grey tabby with white paws, often by the harbour steps.</p>');
  });
});
