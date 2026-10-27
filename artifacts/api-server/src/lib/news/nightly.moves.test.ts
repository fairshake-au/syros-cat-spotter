import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { catNewsBaselineTable, catNewsChangesTable, db, pool } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import { daysAgo, moveKit } from "../../test/moveKit";
import { moveSighting } from "../../test/moves";
import { recordedMerge } from "../../test/merges";
import { compareCat, loadCorrections, rebaselineNews, seedNewsBaseline, type Corrections } from "./nightly";

// SYC-150 PR 3.1 (which-cat-is-which.md §9.12, §5.8): a move or a merge is a
// correction, never news. The nightly check silences a change one made
// (`moved`, `merged`), and a move or merge re-baselines the cats it touched.

const kit = moveKit("VitestNewsMoves");
beforeAll(kit.cleanup);
afterAll(async () => {
  await db.delete(catNewsBaselineTable).where(inArray(catNewsBaselineTable.catId, made));
  await kit.cleanup();
  await pool.end();
});
const made: number[] = [];
const cat = async () => {
  const id = await kit.cat(daysAgo(400));
  made.push(id);
  return id;
};

const DAY = 86_400_000;
const now = new Date();
const status = { catId: 1, sterilisedConfirmed: true, lifeStatus: "street", dead: false, sterilisedEvidence: [10], lifeEvidence: [], lastSightingAt: null };
const baseline = {
  catId: 1,
  sterilisedConfirmed: false,
  notifiedSterilisedAt: null,
  notifiedHomedAt: null,
  lifeStatus: "street",
  lastSightingAt: new Date(now.getTime() - 200 * DAY),
  updatedAt: new Date(now.getTime() - DAY),
};
const sightings = [
  { id: 1, catId: 1, createdAt: new Date(now.getTime() - 200 * DAY), deviceId: "dev-a" },
  { id: 2, catId: 1, createdAt: new Date(now.getTime() - 10 * DAY), deviceId: "dev-b" },
];
const row = (o: { id: number; moved?: boolean; createdAt?: Date }) =>
  ({ id: o.id, catId: 1, kind: "sterilised", deviceId: null, provenance: "volunteered", observedAt: now, createdAt: o.createdAt ?? now, sightingMoveId: o.moved ? 5 : null }) as never;
const reasons = (corrections?: Corrections, rows = [row({ id: 10 })]) =>
  compareCat(status, rows, sightings, baseline, now, corrections).changes.map((c) => [c.change, c.silencedReason]);

describe("compareCat: a correction since the baseline is never news", () => {
  it("with nothing corrected, both changes are news", () => {
    expect(reasons()).toEqual([
      ["sterilised", null],
      ["seen_again", null],
    ]);
  });

  it("a sighting moved here since the baseline: seen again is silenced `moved` (`merged` when a merge moved it)", () => {
    expect(reasons({ sightingMoves: new Map([[2, { at: now, merge: false }]]), mergedAt: null })).toEqual([
      ["sterilised", null],
      ["seen_again", "moved"],
    ]);
    expect(reasons({ sightingMoves: new Map([[2, { at: now, merge: true }]]), mergedAt: null })).toEqual([
      ["sterilised", null],
      ["seen_again", "merged"],
    ]);
    // A move from before the baseline was already counted then.
    expect(reasons({ sightingMoves: new Map([[2, { at: new Date(now.getTime() - 9 * DAY), merge: false }]]), mergedAt: null })).toEqual([
      ["sterilised", null],
      ["seen_again", null],
    ]);
  });

  it("a merge since the baseline silences every change `merged`", () => {
    expect(reasons({ sightingMoves: new Map(), mergedAt: now })).toEqual([
      ["sterilised", "merged"],
      ["seen_again", "merged"],
    ]);
  });

  it("evidence that is a statement a move copied is silenced `moved`", () => {
    expect(reasons(undefined, [row({ id: 10, moved: true })])).toEqual([
      ["sterilised", "moved"],
      ["seen_again", null],
    ]);
  });
});

describe("the corrections the nightly walk reads, and re-baselining", () => {
  it("loadCorrections finds a sighting's move and a merge touching the cat", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const dora = await cat();
    const s = await kit.sighting(mimi, kit.device(), daysAgo(2));
    const moved = await moveSighting(s.id, agatha);
    expect(moved.moveId).toBeGreaterThan(0);
    await recordedMerge(dora, agatha);
    const c = await loadCorrections([agatha, mimi], new Map([[agatha, [{ id: s.id, catId: agatha, createdAt: s.createdAt, deviceId: s.deviceId }]]]), db);
    expect(c.get(agatha)!.sightingMoves.get(s.id)).toMatchObject({ merge: false });
    expect(c.get(agatha)!.mergedAt).not.toBeNull();
    expect(c.get(mimi)!.mergedAt).toBeNull();
  });

  it("rebaselineNews: after a move, the cat it joined has the moved sighting in its baseline; cats never walked stay unwalked", async () => {
    const mimi = await cat();
    const agatha = await cat();
    const unwalked = await cat();
    await kit.sighting(agatha, kit.device(), daysAgo(200));
    const s = await kit.sighting(mimi, kit.device(), daysAgo(2));
    await seedNewsBaseline([mimi, agatha], db, daysAgo(1));
    await moveSighting(s.id, agatha);
    expect(await rebaselineNews([mimi, agatha, unwalked])).toBe(2);
    const rows = await db.select().from(catNewsBaselineTable).where(inArray(catNewsBaselineTable.catId, [mimi, agatha, unwalked]));
    expect(rows.find((r) => r.catId === agatha)!.lastSightingAt).toEqual(s.createdAt);
    expect(rows.find((r) => r.catId === unwalked)).toBeUndefined();
    expect(await db.select().from(catNewsChangesTable).where(eq(catNewsChangesTable.catId, agatha))).toEqual([]);
  });
});
