import { describe, expect, it } from "vitest";
import { db, observationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// SYC-111's proof requirement: a test that depends on a real DB trigger
// fails when the trigger is absent. This runs through the exact pool/`db`
// api-server's own routes use (globalSetup.ts points it at this run's
// throwaway database), so it also proves that database was migrated with
// the checked-in SQL — not a `drizzle-kit push`'d table shape, which would
// never create `observations_append_only` (lib/db/migrations/0001) and
// would let this delete through.
describe("the throwaway database runs real migrations", () => {
  it("refuses to delete an observation (observations_append_only trigger)", async () => {
    const [row] = await db
      .insert(observationsTable)
      .values({
        catId: 1,
        kind: "note",
        value: { text: "SYC-111 proof row" },
        deviceId: "syc-111-proof-device",
        observedAt: new Date(),
      })
      .returning({ id: observationsTable.id });

    // drizzle wraps the driver error (DrizzleQueryError, "Failed query: ...");
    // the Postgres trigger's own message is on `.cause`.
    let threw: unknown;
    try {
      await db.delete(observationsTable).where(eq(observationsTable.id, row!.id));
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(Error);
    const cause = (threw as { cause?: unknown }).cause;
    expect(String((cause as Error)?.message ?? threw)).toMatch(
      /observations are append-only/,
    );
  });
});
