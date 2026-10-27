import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, observationsTable, pool, sightingMovesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import { moveKit } from "../test/moveKit";
import { moveSighting } from "../test/moves";
import { lockSpotterFirst, writeMovedObservation } from "./movedStatements";
import { agreeWithClip } from "./teamCorrections";

// SYC-150 PR 3.1 (which-cat-is-which.md §5.7, §9.5): what a move writes about
// the statements on the moved sighting. Spec test 3 (a copied answer stays
// the spotter's) and the writer's half of test 4 (the team's agreement is
// withdrawn, not copied). What each cat then works out is in moveRecord.test.ts.

const kit = moveKit("VitestMovedStatements");
beforeAll(kit.cleanup);
afterAll(async () => {
  await kit.cleanup();
  await pool.end();
});

const STAFF = { id: "vitest-moved-statements-staff", scopes: [{ role: "staff", colonyId: null }] };

async function scene() {
  const mimi = await kit.cat();
  const agatha = await kit.cat();
  const spotter = kit.device();
  const s = await kit.sighting(mimi, spotter);
  const ear = await kit.answer(s, "ear_tip", { clipped: true, side: "left" });
  const food = await kit.answer(s, "food_and_water", { present: true });
  const note = await kit.answer(s, "note", { text: "Sleeping on the steps" });
  return { mimi, agatha, spotter, s, ear, food, note };
}

describe("spec test 3: a copied answer is still the spotter's", () => {
  it("copies each of the spotter's answers onto the new cat, in their name and role, replacing the original", async () => {
    const c = await scene();
    const moved = await moveSighting(c.s.id, c.agatha, { by: "vitest-mover-alice" });
    expect(moved.withdrawn).toEqual([]);
    expect(moved.copied.map((o) => o.kind).sort()).toEqual(["ear_tip", "food_and_water", "note"]);
    for (const [copy, original] of [
      [moved.copied.find((o) => o.kind === "ear_tip")!, c.ear],
      [moved.copied.find((o) => o.kind === "food_and_water")!, c.food],
      [moved.copied.find((o) => o.kind === "note")!, c.note],
    ] as const) {
      expect(copy).toMatchObject({
        catId: c.agatha,
        kind: original.kind,
        value: original.value,
        deviceId: c.spotter,
        accountId: null,
        roleAtTime: "public",
        authorityScope: "none",
        provenance: "volunteered",
        sightingId: c.s.id,
        photoId: c.s.photoId,
        observedAt: original.observedAt,
        supersedesId: original.id,
        supersedeReason: "moved",
        sightingMoveId: moved.moveId,
      });
    }
    // Who moved it is on the move, never on the statement.
    const [move] = await db.select().from(sightingMovesTable).where(eq(sightingMovesTable.id, moved.moveId));
    expect(move!.movedByAccountId).toBe("vitest-mover-alice");
    expect(moved.copied.every((o) => o.accountId === null)).toBe(true);
  });

  it("a deleted spotter's answer moves with nobody on it", async () => {
    const c = await scene();
    await db.execute(sql`
      update observations set device_id = null, redacted_at = now(), redaction_reason = 'vitest deleted',
             value = case when kind = 'note' then '{}'::jsonb else value end
       where device_id = ${c.spotter}`);
    // As deletion does (severPerson step 3); the sightings guard allows it.
    await db.execute(sql`update sightings set device_id = null, redacted_at = now(), redaction_reason = 'vitest deleted' where id = ${c.s.id}`);
    const moved = await moveSighting(c.s.id, c.agatha);
    expect(moved.withdrawn).toEqual([]);
    expect(moved.copied).toHaveLength(3);
    for (const o of moved.copied) {
      expect(o).toMatchObject({ deviceId: null, accountId: null, roleAtTime: "public" });
      expect(o.redactedAt).not.toBeNull();
    }
  });
});

describe("spec test 4 (the writer): the team's agreement is withdrawn, not copied", () => {
  it("withdraws it on its own cat in the mover's name, with the sighting's id and the agreement's date", async () => {
    const c = await scene();
    const agreed = await agreeWithClip(STAFF, c.ear.id);
    if (agreed === "already") throw new Error("expected an agreement");
    const moved = await moveSighting(c.s.id, c.agatha, { by: "vitest-mover-bob" });
    expect(moved.copied.map((o) => o.kind).sort()).toEqual(["ear_tip", "food_and_water", "note"]);
    expect(moved.copied.some((o) => o.accountId === STAFF.id)).toBe(false);
    expect(moved.withdrawn).toHaveLength(1);
    expect(moved.withdrawn[0]).toMatchObject({
      catId: c.mimi,
      kind: "ear_tip",
      value: { retracted: true },
      accountId: "vitest-mover-bob",
      deviceId: null,
      roleAtTime: "staff",
      sightingId: c.s.id,
      observedAt: agreed.observedAt,
      supersedesId: agreed.id,
      supersedeReason: "moved",
      sightingMoveId: moved.moveId,
    });
  });

  it("leaves a row that was already replaced, and a retraction, alone", async () => {
    const c = await scene();
    const changed = await db
      .insert(observationsTable)
      .values({
        catId: c.mimi,
        kind: "ear_tip",
        value: { clipped: false },
        deviceId: c.spotter,
        roleAtTime: "public",
        sightingId: c.s.id,
        photoId: c.s.photoId,
        observedAt: c.s.createdAt,
        supersedesId: c.ear.id,
      })
      .returning();
    const moved = await moveSighting(c.s.id, c.agatha);
    expect(moved.copied.map((o) => o.supersedesId).sort()).toEqual([changed[0]!.id, c.food.id, c.note.id].sort());
  });
});

describe("writeMovedObservation's own refusals", () => {
  it("refuses a merge's move: a merge copies nothing", async () => {
    const c = await scene();
    await expect(
      db.transaction(async (tx) => {
        const [m] = await tx
          .insert(sightingMovesTable)
          .values({ sightingId: c.s.id, fromCatId: c.mimi, toCatId: c.agatha, mergeId: 1, batchId: crypto.randomUUID(), reason: "merged", source: "merge", movedByAccountId: "vitest", roleAtTime: "staff" })
          .returning();
        await writeMovedObservation(tx, m!.id);
      }),
    ).rejects.toThrow(/copy no statements/);
  });

  it("refuses unless the caller took the spotter's badges lock first (review of #380, finding 5)", async () => {
    const c = await scene();
    const attempt = (lockFirst: boolean) =>
      db.transaction(async (tx) => {
        if (lockFirst) await lockSpotterFirst(tx, c.s.id);
        const [m] = await tx
          .insert(sightingMovesTable)
          .values({ sightingId: c.s.id, fromCatId: c.mimi, toCatId: c.agatha, batchId: crypto.randomUUID(), reason: "wrong_pick", source: "cat_page", movedByAccountId: "vitest", roleAtTime: "staff" })
          .returning();
        await tx.execute(sql`select set_config('app.sighting_move_id', ${String(m!.id)}, true)`);
        await tx.execute(sql`update sightings set cat_id = ${c.agatha} where id = ${c.s.id}`);
        return writeMovedObservation(tx, m!.id);
      });
    await expect(attempt(false)).rejects.toThrow(/badges lock/);
    await expect(attempt(true)).resolves.toMatchObject({ copied: expect.any(Array) });
  });

  it("the database refuses a copy outside the move's own transaction", async () => {
    const c = await scene();
    const moved = await moveSighting(c.s.id, c.agatha);
    await expect(
      db.insert(observationsTable).values({
        catId: c.agatha,
        kind: "note",
        value: { text: "again" },
        deviceId: c.spotter,
        roleAtTime: "public",
        sightingId: c.s.id,
        observedAt: c.s.createdAt,
        supersedesId: c.note.id,
        sightingMoveId: moved.moveId,
      }),
    ).rejects.toThrow();
  });
});
