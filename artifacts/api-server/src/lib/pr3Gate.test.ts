/**
 * The PR 4 code gate (plan `docs/superpowers/plans/data-spine.md`, PR 4):
 * "with PR 3's step not recorded, a claimed cat with no `homed` observation
 * still has `hasHome: true`; once it's recorded, `hasHome` follows life
 * status." This file tests {@link pr3Recorded} itself in isolation; the
 * end-to-end behaviour it gates is tested in `catHelpers.derivedStatus.test.ts`
 * and `sightings.deceasedGuard.test.ts`.
 *
 * Deliberately touches no filesystem path (see `pr3Gate.ts`'s doc comment on
 * why an earlier version that did was wrong in the bundled build) — every
 * case here is a plain `drizzle.__drizzle_migrations` row keyed on
 * {@link PR3_MIGRATION_WHEN}.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  PR3_MIGRATION_WHEN,
  pr3Recorded,
  resetPr3GateCacheForTests,
} from "./pr3Gate";

async function insertMigrationRow(createdAt: number): Promise<void> {
  await db.execute(
    sql`insert into "drizzle"."__drizzle_migrations" (hash, created_at)
        values (${`test-hash-${createdAt}-${Math.random()}`}, ${createdAt})`,
  );
}

async function deleteMigrationRow(createdAt: number): Promise<void> {
  await db.execute(
    sql`delete from "drizzle"."__drizzle_migrations" where created_at = ${createdAt}`,
  );
}

describe("pr3Recorded", () => {
  beforeEach(() => resetPr3GateCacheForTests());

  afterEach(async () => {
    await deleteMigrationRow(PR3_MIGRATION_WHEN);
    resetPr3GateCacheForTests();
  });

  it("is false when no row with PR 3's created_at exists", async () => {
    await expect(pr3Recorded()).resolves.toBe(false);
  });

  it("is false when a DIFFERENT migration's created_at exists, but not PR 3's", async () => {
    await insertMigrationRow(PR3_MIGRATION_WHEN + 1);
    try {
      await expect(pr3Recorded()).resolves.toBe(false);
    } finally {
      await deleteMigrationRow(PR3_MIGRATION_WHEN + 1);
    }
  });

  it("is true once a row with PR 3's exact created_at is recorded, and stays true after the row is removed (cached)", async () => {
    await insertMigrationRow(PR3_MIGRATION_WHEN);

    await expect(pr3Recorded()).resolves.toBe(true);

    // Remove the row: once observed true in this process, it must never
    // flip back to false, because a migration that has run stays run.
    await deleteMigrationRow(PR3_MIGRATION_WHEN);
    await expect(pr3Recorded()).resolves.toBe(true);
  });

  it("re-reads on every call while false — no caching of a negative result", async () => {
    await expect(pr3Recorded()).resolves.toBe(false);

    await insertMigrationRow(PR3_MIGRATION_WHEN);

    // The same process, same call, now sees it — proving the earlier
    // `false` wasn't cached.
    await expect(pr3Recorded()).resolves.toBe(true);
  });
});
