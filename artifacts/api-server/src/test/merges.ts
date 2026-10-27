import { catIdentityTable, db, type CatIdentity } from "@workspace/db";
import { sql } from "drizzle-orm";

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
