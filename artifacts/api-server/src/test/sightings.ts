import { db, sightingsTable } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";

/**
 * Test cleanup for sightings, which are append-only (SYC-63's migration
 * refuses delete). The throwaway database (SYC-111) is dropped at the end of
 * the run, but files share it while it lives, so a test still tidies the
 * rows it made.
 *
 * As `lib/db/src/migrate/dataSpine.test.ts` does for observations, the table
 * owner switches the guard off for one statement, inside one transaction, so
 * it is never off for any other connection. Nothing in the trigger itself
 * can be flipped: the guard protects against app code and mistakes, and the
 * owner could always drop it anyway.
 */
export async function deleteTestSightings(
  where: SQL | undefined,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`alter table sightings disable trigger sightings_append_only`,
    );
    await tx.delete(sightingsTable).where(where);
    await tx.execute(
      sql`alter table sightings enable trigger sightings_append_only`,
    );
  });
}
