import { catIdentityTable, db, sightingMovesTable, sightingsTable, type CatIdentity } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

// Tests only: this switches a database guard off. Refuse to load anywhere else.
if (!process.env["VITEST"]) {
  throw new Error("test/merges is for tests only (VITEST is not set).");
}

/**
 * Tests only (SYC-150 PR 2.1). Writes a merge row the way these tests did
 * before migration 0053: the merged-away cat keeps its resolved sightings.
 * Since 0053 the database refuses that at commit (cat_identity_no_sighting_left:
 * a merge moves every resolved sighting to the survivor), and today's readers
 * (hasMetCat, the claim rules, asOf) are still written for this shape until
 * the plan's PR 3.1 and PR 4.1 move them and these tests onto recorded
 * merges. So the test's own transaction switches that one trigger off for
 * the insert, as `deleteTestSightings` does for the sightings guard.
 */
export async function mergeKeepingSightings(
  values: typeof catIdentityTable.$inferInsert,
): Promise<CatIdentity> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`alter table cat_identity disable trigger cat_identity_no_sighting_left`);
    const [row] = await tx.insert(catIdentityTable).values(values).returning();
    await tx.execute(sql`alter table cat_identity enable trigger cat_identity_no_sighting_left`);
    return row!;
  });
}

/**
 * Tests only (SYC-150 PR 2.1). Writes a `cat_identity` row the database now
 * refuses: an undo naming another cat than the merge it supersedes. Since
 * migration 0053 `cat_identity_supersedes_own_cat` refuses that at insert,
 * so the reader tests that prove such a row undoes nothing (review of #375,
 * A2: bad data the readers must still survive) switch that one trigger off
 * for the insert, in the test's own transaction.
 */
export async function identityRowPastTheGuard(
  values: typeof catIdentityTable.$inferInsert,
): Promise<CatIdentity> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`alter table cat_identity disable trigger cat_identity_supersedes_own_cat`);
    const [row] = await tx.insert(catIdentityTable).values(values).returning();
    // The deferred "no sighting left" check still runs; run it now, so the
    // table has no pending trigger events when the guard goes back on.
    await tx.execute(sql`set constraints cat_identity_no_sighting_left immediate`);
    await tx.execute(sql`alter table cat_identity enable trigger cat_identity_supersedes_own_cat`);
    return row!;
  });
}

/**
 * Tests only (SYC-150 PR 3.1). A merge as PR 4.1's route will record one
 * (spec §9.7 merge steps 2–3, as migration 0053's own tests do in raw SQL):
 * the merge row, the setting, then one `merged` move per resolved sighting
 * of the merged-away cat, each filed under the survivor. No statements are
 * copied. `createdAt` dates the merge and its moves.
 */
export async function recordedMerge(mergedId: number, survivorId: number, createdAt?: Date, by = "vitest-merger"): Promise<number> {
  return db.transaction(async (tx) => {
    const [merge] = await tx
      .insert(catIdentityTable)
      .values({ catId: mergedId, canonicalCatId: survivorId, reason: "vitest merge", byAccountId: by, roleAtTime: "staff", survivorChosen: "default", ...(createdAt ? { createdAt } : {}) })
      .returning({ id: catIdentityTable.id });
    await tx.execute(sql`select set_config('app.cat_merge_id', ${String(merge!.id)}, true)`);
    const batchId = randomUUID();
    const sightings = await tx
      .select({ id: sightingsTable.id })
      .from(sightingsTable)
      .where(and(eq(sightingsTable.catId, mergedId), eq(sightingsTable.status, "resolved")));
    for (const s of sightings) {
      await tx.insert(sightingMovesTable).values({
        sightingId: s.id,
        fromCatId: mergedId,
        toCatId: survivorId,
        mergeId: merge!.id,
        batchId,
        reason: "merged",
        source: "merge",
        movedByAccountId: by,
        roleAtTime: "staff",
        ...(createdAt ? { createdAt } : {}),
      });
      await tx.update(sightingsTable).set({ catId: survivorId }).where(eq(sightingsTable.id, s.id));
    }
    return merge!.id;
  });
}

/** Tests only (SYC-150 PR 3.1). The undo of a recorded merge: the undo row, then its `merge_undone` moves back. */
export async function recordedUndo(mergeId: number, createdAt?: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(catIdentityTable).where(eq(catIdentityTable.id, mergeId));
    const [undo] = await tx
      .insert(catIdentityTable)
      .values({ catId: m!.catId, canonicalCatId: m!.catId, supersedesId: mergeId, reason: "vitest undo", byAccountId: "vitest-merger", roleAtTime: "staff", ...(createdAt ? { createdAt } : {}) })
      .returning({ id: catIdentityTable.id });
    await tx.execute(sql`select set_config('app.cat_merge_id', ${String(undo!.id)}, true)`);
    const batchId = randomUUID();
    const moved = await tx.select({ sightingId: sightingMovesTable.sightingId }).from(sightingMovesTable).where(eq(sightingMovesTable.mergeId, mergeId));
    for (const s of moved) {
      await tx.insert(sightingMovesTable).values({
        sightingId: s.sightingId,
        fromCatId: m!.canonicalCatId,
        toCatId: m!.catId,
        mergeId: undo!.id,
        batchId,
        reason: "merge_undone",
        source: "undo",
        movedByAccountId: "vitest-merger",
        roleAtTime: "staff",
        ...(createdAt ? { createdAt } : {}),
      });
      await tx.update(sightingsTable).set({ catId: m!.catId }).where(eq(sightingsTable.id, s.sightingId));
    }
    return undo!.id;
  });
}
