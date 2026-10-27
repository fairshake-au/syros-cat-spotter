import { describe, expect, it } from "vitest";
import { feedingFrom, feedingSteps, type MergeEvent } from "./catIdentity";

// SYC-150 PR 3.1, independent review of #380 (finding 1, HIGH): the progress
// report loads every team cat with its history (reports/progress.ts,
// `withHistory`) and asks `resolveAt` for each cat at each point. The dated
// merge timeline used to be worked out per cat per merge moment, each time
// rescanning every row: 1,500 cats and 150 merges took about 11 seconds,
// inside a request. Now each cat's feeding steps are built once for all cats
// (`feedingSteps`) and `resolveAt` looks them up (`feedingFrom`). In memory,
// so the budget measures only that work.

/** An island of `cats` cats and `merges` merges, every other one undone an hour later. */
function island(cats: number, merges: number): MergeEvent[] {
  const events: MergeEvent[] = [];
  let id = 1;
  const t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i < merges; i++) {
    const merged = 1 + ((i * 7) % cats);
    const into = 1 + ((i * 7 + 3) % cats);
    const m: MergeEvent = { id: id++, catId: merged, canonicalCatId: into, supersedesId: null, createdAt: new Date(t0 + i * 3_600_000) };
    events.push(m);
    if (i % 2 === 0) events.push({ id: id++, catId: merged, canonicalCatId: merged, supersedesId: m.id, createdAt: new Date(t0 + i * 3_600_000 + 60_000) });
  }
  return events;
}

describe("the cost of the dated merge timeline", () => {
  it("1,500 cats and 150 merges: every cat's steps, then 12 report points per cat, well under 2 seconds", () => {
    const CATS = 1500;
    const timeline = island(CATS, 150);
    const ids = Array.from({ length: CATS }, (_, i) => i + 1);
    const points = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 15 * 3_600_000));

    const started = performance.now();
    const steps = feedingSteps(timeline, ids);
    let fed = 0;
    for (const id of ids) for (const at of points) fed += feedingFrom(steps.get(id)!, at).size;
    const ms = performance.now() - started;

    expect(fed).toBeGreaterThan(0);
    expect(ms, `took ${Math.round(ms)} ms`).toBeLessThan(2000);
  });
});
