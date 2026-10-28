import { db, sightingMovesTable, sightingsTable } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { lockSpotterFirst, writeMovedObservation, type MovedStatements } from "../lib/movedStatements";
import type { DbOrTx } from "../lib/observations";

if (!process.env["VITEST"]) {
  throw new Error("test/moves is for tests only (VITEST is not set).");
}

export interface TestMove extends MovedStatements {
  moveId: number;
}

/**
 * Tests only (SYC-150 PR 3.1). A move as the route (PR 3.2) will make one,
 * minus its other locks and checks: the spotter's badges lock first, the move row, the setting, the sighting filed
 * under the new cat, then the statements (`writeMovedObservation`), all in
 * one transaction. `exec` lets a test run it inside a transaction it holds.
 */
export async function moveSighting(
  sightingId: number,
  toCatId: number,
  opts: { by?: string; role?: "staff" | "management"; createdAt?: Date; madeNewCat?: boolean; letSpottersName?: boolean } = {},
  exec?: DbOrTx,
): Promise<TestMove> {
  const run = async (tx: DbOrTx): Promise<TestMove> => {
    // §9.7 lock 1 before anything touches the sighting, as deletion orders them.
    await lockSpotterFirst(tx, sightingId);
    const [s] = await tx.select({ catId: sightingsTable.catId }).from(sightingsTable).where(eq(sightingsTable.id, sightingId));
    if (s?.catId == null) throw new Error(`sighting ${sightingId} has no cat`);
    const [move] = await tx
      .insert(sightingMovesTable)
      .values({
        sightingId,
        fromCatId: s.catId,
        toCatId,
        batchId: randomUUID(),
        reason: "wrong_pick",
        source: "cat_page",
        movedByAccountId: opts.by ?? "vitest-mover",
        roleAtTime: opts.role ?? "staff",
        madeNewCat: opts.madeNewCat ?? false,
        letSpottersName: opts.letSpottersName ?? false,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      })
      .returning({ id: sightingMovesTable.id });
    await tx.execute(sql`select set_config('app.sighting_move_id', ${String(move!.id)}, true)`);
    await tx.update(sightingsTable).set({ catId: toCatId }).where(eq(sightingsTable.id, sightingId));
    return { moveId: move!.id, ...(await writeMovedObservation(tx, move!.id)) };
  };
  return exec ? run(exec) : db.transaction(run);
}
