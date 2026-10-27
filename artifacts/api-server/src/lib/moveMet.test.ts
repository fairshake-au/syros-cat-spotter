import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool, sightingMatchesTable } from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import { moveKit } from "../test/moveKit";
import { moveSighting } from "../test/moves";
import { recordedMerge } from "../test/merges";
import { hasMetCat } from "./claiming";

// SYC-150 PR 3.1 (C10; which-cat-is-which.md §9.9, §5.9): "has met this cat"
// for naming and claiming, after moves and merges.

const kit = moveKit("VitestMoveMet");
beforeAll(kit.cleanup);
afterAll(async () => {
  await kit.cleanup();
  await pool.end();
});

/** Mimi and Agatha; a spotter's sighting filed under Mimi, with the match record given (none when both are null). */
async function matched(choice: "suggested" | null, chosen: "mimi" | null, record = true) {
  const mimi = await kit.cat();
  const agatha = await kit.cat();
  const spotter = kit.device();
  const s = await kit.sighting(mimi, spotter);
  if (record) {
    await db
      .insert(sightingMatchesTable)
      .values(
        choice === null
          ? { sightingId: s.id }
          : { sightingId: s.id, choice, chosenCatId: chosen ? mimi : null, chosenAt: s.createdAt, suggestedRank: 1 },
      );
  }
  return { mimi, agatha, spotter, s };
}

describe("C10 / §9.9: hasMetCat compares canonical cats and leaves out the team's moves", () => {
  it("a sighting the spotter matched to Mimi, moved by the team to Agatha, meets neither", async () => {
    const c = await matched("suggested", "mimi");
    expect(await hasMetCat(db, c.mimi, c.spotter, "claim")).toBe(true);
    await moveSighting(c.s.id, c.agatha);
    for (const purpose of ["claim", "name"] as const) {
      expect(await hasMetCat(db, c.agatha, c.spotter, purpose)).toBe(false);
      expect(await hasMetCat(db, c.mimi, c.spotter, purpose)).toBe(false);
    }
  });

  it("an unlabelled sighting (no match record, or no choice and no cat) the team moved doesn't count", async () => {
    const noChoice = await matched(null, null);
    const noRecord = await matched(null, null, false);
    expect(await hasMetCat(db, noChoice.mimi, noChoice.spotter, "claim")).toBe(true);
    expect(await hasMetCat(db, noRecord.mimi, noRecord.spotter, "claim")).toBe(true);
    await moveSighting(noChoice.s.id, noChoice.agatha);
    await moveSighting(noRecord.s.id, noRecord.agatha);
    expect(await hasMetCat(db, noChoice.agatha, noChoice.spotter, "claim")).toBe(false);
    expect(await hasMetCat(db, noRecord.agatha, noRecord.spotter, "claim")).toBe(false);
  });

  it("a spotter who matched Mimi has met Agatha once Mimi is merged into her (the merge's moves count), from either id", async () => {
    const c = await matched("suggested", "mimi");
    const d = await matched(null, null, false);
    await recordedMerge(c.mimi, c.agatha);
    await recordedMerge(d.mimi, d.agatha);
    expect(await hasMetCat(db, c.agatha, c.spotter, "claim")).toBe(true);
    expect(await hasMetCat(db, c.mimi, c.spotter, "name")).toBe(true);
    // An unlabelled sighting the merge moved counts like its first filing.
    expect(await hasMetCat(db, d.agatha, d.spotter, "claim")).toBe(true);
  });

  it("D3: after 'It's a new cat' with 'Let spotters name it', the spotter may name it but not claim it", async () => {
    const c = await matched("suggested", "mimi");
    const made = await kit.cat();
    await moveSighting(c.s.id, made, { madeNewCat: true, letSpottersName: true });
    expect(await hasMetCat(db, made, c.spotter, "name")).toBe(true);
    expect(await hasMetCat(db, made, c.spotter, "claim")).toBe(false);

    // Without the tick, nobody may.
    const d = await matched("suggested", "mimi");
    const madeQuietly = await kit.cat();
    await moveSighting(d.s.id, madeQuietly, { madeNewCat: true });
    expect(await hasMetCat(db, madeQuietly, d.spotter, "name")).toBe(false);

    // Moved on again since: the newest move decides.
    const e = await matched("suggested", "mimi");
    const first = await kit.cat();
    await moveSighting(e.s.id, first, { madeNewCat: true, letSpottersName: true });
    await moveSighting(e.s.id, e.agatha);
    expect(await hasMetCat(db, e.agatha, e.spotter, "name")).toBe(false);
  });
});
