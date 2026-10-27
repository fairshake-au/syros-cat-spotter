import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, observationsTable, pointsLedgerTable, pool, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import { daysAgo, moveKit } from "../test/moveKit";
import { moveSighting } from "../test/moves";
import { recordedMerge, recordedUndo } from "../test/merges";
import { loadCatRecords, resolveAt } from "./observations";
import { resolveCat } from "./resolve";
import { getProfileStats, spottedCatIds } from "./catHelpers";

// SYC-150 PR 3.1 (which-cat-is-which.md §5.8, §9.5; C11): what each cat
// works out after a move, read the way every screen reads it
// (loadCatRecords, then the resolver).

const kit = moveKit("VitestMoveRecord");
beforeAll(kit.cleanup);
afterAll(async () => {
  await kit.cleanup();
  await pool.end();
});

const T = {
  agathaSeen: daysAgo(20),
  mimiSeen: daysAgo(10),
  moved: daysAgo(3),
};
const NOW = new Date();

/** What a cat's page and lists show, minus row ids. */
async function view(catId: number) {
  const r = (await loadCatRecords([catId])).get(catId)!;
  const s = resolveCat(r.observations, r.evidenceOfLife, NOW);
  return {
    sterilised: s.sterilised,
    lifeStatus: s.lifeStatus,
    lifeStatusConfidence: s.lifeStatusConfidence,
    presumedDeceased: s.presumedDeceased,
    notSeenSince: s.notSeenSince,
    evidence: r.evidenceOfLife,
  };
}

/**
 * Two cats as the spotters filed them: Mimi with her own sighting (the
 * spotter couldn't tell her ear tip), Agatha with hers, and a sighting `s`
 * (a clipped ear, food out, a note) filed under `firstCat`.
 */
async function world(firstCat: "mimi" | "agatha") {
  const mimi = await kit.cat();
  const agatha = await kit.cat();
  const other = await kit.sighting(mimi, kit.device(), T.mimiSeen);
  await kit.answer(other, "ear_tip", { clipped: "cant_tell" });
  await kit.sighting(agatha, kit.device(), T.agathaSeen);
  const s = await kit.sighting(firstCat === "mimi" ? mimi : agatha, kit.device(), T.moved);
  await kit.answer(s, "ear_tip", { clipped: true, side: "left" });
  await kit.answer(s, "food_and_water", { present: true });
  await kit.answer(s, "note", { text: "On the harbour wall" });
  return { mimi, agatha, s };
}

describe("spec test 2: after a move, each cat is as if the sighting had always been where it is now", () => {
  it("the old cat equals a cat that never had it; the new cat equals one it was matched to first", async () => {
    const moved = await world("mimi");
    const before = await view(moved.mimi);
    expect(before.sterilised.confidence, "the clipped answer made Mimi Likely").toBe("likely");
    await moveSighting(moved.s.id, moved.agatha);

    const control = await world("agatha");
    // The control's Mimi never had the sighting at all.
    const neverHad = await (async () => {
      const mimi = await kit.cat();
      const other = await kit.sighting(mimi, kit.device(), T.mimiSeen);
      await kit.answer(other, "ear_tip", { clipped: "cant_tell" });
      return view(mimi);
    })();

    expect(await view(moved.mimi)).toEqual(neverHad);
    expect(await view(moved.agatha)).toEqual(await view(control.agatha));
    expect((await view(moved.agatha)).sterilised.confidence).toBe("likely");
  });
});

/**
 * A moment strictly between what came before and what comes after: the
 * database keeps microseconds and a JavaScript date only milliseconds, so a
 * row written in the same millisecond could otherwise land on either side.
 */
async function moment(): Promise<Date> {
  await new Promise((r) => setTimeout(r, 5));
  const at = new Date();
  await new Promise((r) => setTimeout(r, 5));
  return at;
}

/** What `view` shows, read as the record stood at `asOf`, both ways: loaded as of then, and from the history. */
async function viewAsOf(catId: number, asOf: Date) {
  const r = (await loadCatRecords([catId], db, { asOf })).get(catId)!;
  const s = resolveCat(r.observations, r.evidenceOfLife, NOW);
  const viaAsOf = {
    sterilised: s.sterilised,
    lifeStatus: s.lifeStatus,
    lifeStatusConfidence: s.lifeStatusConfidence,
    presumedDeceased: s.presumedDeceased,
    notSeenSince: s.notSeenSince,
    evidence: r.evidenceOfLife,
  };
  const history = (await loadCatRecords([catId], db, { withHistory: true })).get(catId)!;
  return { viaAsOf, snapshot: s, viaHistory: resolveAt(history, asOf, NOW) };
}

describe("spec test 27: as of a moment before a move or a merge, the record as it stood then", () => {
  it("a move", async () => {
    const w = await world("mimi");
    const mimiBefore = await view(w.mimi);
    const agathaBefore = await view(w.agatha);
    const before = await moment();
    await moveSighting(w.s.id, w.agatha);
    expect(await view(w.mimi)).not.toEqual(mimiBefore);

    for (const [id, was] of [[w.mimi, mimiBefore], [w.agatha, agathaBefore]] as const) {
      const then = await viewAsOf(id, before);
      expect(then.viaAsOf).toEqual(was);
      expect(then.viaHistory).toEqual(then.snapshot);
    }
    // And after it, the history agrees with the record now.
    const after = await moment();
    for (const id of [w.mimi, w.agatha]) {
      const now = await viewAsOf(id, after);
      expect(now.viaAsOf).toEqual(await view(id));
      expect(now.viaHistory).toEqual(now.snapshot);
    }
  });

  it("a merge, and inside the window of a merge undone since", async () => {
    const w = await world("mimi");
    const agathaBefore = await view(w.agatha);
    const beforeMerge = await moment();
    const mergeId = await recordedMerge(w.mimi, w.agatha);
    const merged = await view(w.agatha);
    expect(merged.evidence?.lastSightingAt).toEqual(T.moved);
    const inside = await moment();
    await recordedUndo(mergeId);

    const then = await viewAsOf(w.agatha, beforeMerge);
    expect(then.viaAsOf).toEqual(agathaBefore);
    expect(then.viaHistory).toEqual(then.snapshot);
    const during = await viewAsOf(w.agatha, inside);
    expect(during.viaAsOf).toEqual(merged);
    expect(during.viaHistory).toEqual(during.snapshot);
    expect(await view(w.agatha)).toEqual(agathaBefore);
  });
});

describe("spec test 7: points are unchanged; the collection and stamps show the new cat", () => {
  it("the spotter keeps their points, and has spotted Agatha, not Mimi", async () => {
    const mimi = await kit.cat();
    const agatha = await kit.cat();
    const spotter = kit.device();
    const s = await kit.sighting(mimi, spotter, daysAgo(2));
    await db.insert(profilesTable).values({ deviceId: spotter, points: 15 });
    await db.insert(pointsLedgerTable).values({ deviceId: spotter, sightingId: s.id, catId: mimi, points: 15, athensDay: "2026-10-25", weekStart: "2026-10-19", source: "live" });
    const ledger = () => db.select().from(pointsLedgerTable).where(eq(pointsLedgerTable.deviceId, spotter));
    const ledgerBefore = await ledger();
    const statsBefore = await getProfileStats(spotter);
    expect(await spottedCatIds(spotter)).toEqual([mimi]);

    await moveSighting(s.id, agatha);

    expect(await ledger()).toEqual(ledgerBefore);
    expect(await getProfileStats(spotter)).toEqual(statsBefore);
    expect(statsBefore).toMatchObject({ points: 15, totalSightings: 1, catsSpotted: 1 });
    expect(await spottedCatIds(spotter)).toEqual([agatha]);
  });
});

describe("C11: a welfare report re-tied the old way (no move record) still stops counting for the old cat", () => {
  it("retires Mimi's report when a row on Agatha replaces it", async () => {
    const mimi = await kit.cat();
    const agatha = await kit.cat();
    const reportedAt = daysAgo(1);
    const [report] = await db
      .insert(observationsTable)
      .values({
        catId: mimi,
        kind: "welfare_report",
        value: { severity: "attention", isLitter: false, reportId: 1 },
        accountId: "vitest-move-record-staff",
        roleAtTime: "staff",
        observedAt: reportedAt,
      })
      .returning();
    expect((await view(mimi)).evidence).toMatchObject({ source: "welfare_report", at: reportedAt });

    await db.insert(observationsTable).values({
      catId: agatha,
      kind: "welfare_report",
      value: { severity: "attention", isLitter: false, reportId: 1 },
      accountId: "vitest-move-record-staff",
      roleAtTime: "staff",
      observedAt: reportedAt,
      supersedesId: report!.id,
      supersedeReason: "re-tied",
    });
    expect((await view(mimi)).evidence?.source).toBe("created");
    const r = (await loadCatRecords([mimi])).get(mimi)!;
    expect(r.observations.filter((o) => o.elsewhere).map((o) => o.catId)).toEqual([agatha]);
  });
});

// Folded in from the independent review of #380 (R5).
describe("spec test 27: resolveAt agrees with loadCatRecords({ asOf }) at a move and inside an undone merge (review R5)", () => {
  const agree = async (ids: number[], at: Date) => {
    for (const id of ids) {
      const asOf = (await loadCatRecords([id], db, { asOf: at })).get(id)!;
      const h = (await loadCatRecords([id], db, { withHistory: true })).get(id)!;
      expect(resolveAt(h, at, NOW), `cat ${id}`).toEqual(resolveCat(asOf.observations, asOf.evidenceOfLife, NOW));
    }
  };

  it("just after the move, for both cats", async () => {
    const w = await world("mimi");
    const moved = await moveSighting(w.s.id, w.agatha);
    // A JS date keeps milliseconds, the database microseconds.
    const at = new Date(moved.copied[0]!.createdAt.getTime() + 1);
    await agree([w.mimi, w.agatha], at);
    const ag = (await loadCatRecords([w.agatha], db, { asOf: at })).get(w.agatha)!;
    expect(resolveCat(ag.observations, ag.evidenceOfLife, NOW).sterilised.confidence).toBe("likely");
  });

  it("a sighting moved inside a merge window undone since", async () => {
    const w = await world("mimi");
    const dora = await kit.cat();
    const mergeId = await recordedMerge(w.agatha, dora);
    await moveSighting(w.s.id, dora);
    const inside = await moment();
    await recordedUndo(mergeId);
    await agree([w.mimi, w.agatha, dora], inside);
  });
});
