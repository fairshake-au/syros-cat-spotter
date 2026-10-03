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
 *
 * The suite's shared throwaway database (globalSetup.ts) now has PR 3's
 * migration (0006) applied for real — the row this file tests for is
 * already there before any test runs. So this file snapshots and removes
 * that real row in `beforeAll`, runs every case against a clean slate, and
 * restores the exact original row in `afterAll` — never leaving the shared
 * database in a different state than it found it.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import {
  PR3_MIGRATION_WHEN,
  pr3Recorded,
  resetPr3GateCacheForTests,
} from "./pr3Gate";

interface MigrationRow {
  hash: string;
  created_at: number;
}

async function fetchMigrationRow(
  createdAt: number,
): Promise<MigrationRow | null> {
  const result = await db.execute<{ hash: string; created_at: string }>(
    sql`select hash, created_at from "drizzle"."__drizzle_migrations"
        where created_at = ${createdAt}`,
  );
  const row = result.rows[0] as
    | { hash: string; created_at: string }
    | undefined;
  return row ? { hash: row.hash, created_at: Number(row.created_at) } : null;
}

async function insertMigrationRow(
  createdAt: number,
  hash = `test-hash-${createdAt}-${Math.random()}`,
): Promise<void> {
  await db.execute(
    sql`insert into "drizzle"."__drizzle_migrations" (hash, created_at)
        values (${hash}, ${createdAt})`,
  );
}

async function deleteMigrationRow(createdAt: number): Promise<void> {
  await db.execute(
    sql`delete from "drizzle"."__drizzle_migrations" where created_at = ${createdAt}`,
  );
}

describe("pr3Recorded", () => {
  // The real row (or absence of one) that this database had before this
  // file touched anything. Restored in `afterAll` no matter what the tests
  // below do to it.
  let originalRow: MigrationRow | null = null;

  beforeAll(async () => {
    originalRow = await fetchMigrationRow(PR3_MIGRATION_WHEN);
    if (originalRow) await deleteMigrationRow(PR3_MIGRATION_WHEN);
  });

  afterAll(async () => {
    if (originalRow) {
      await insertMigrationRow(originalRow.created_at, originalRow.hash);
    }
  });

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

  // Guards against the constant drifting from the migration it's meant to
  // key on: a mutant that bumps PR3_MIGRATION_WHEN by +1 (or any other
  // value) must turn this red. The runtime gate itself must never read this
  // file (see pr3Gate.ts's doc comment on why reading the filesystem at
  // runtime was wrong in the bundled build) — only the test is allowed to.
  it("PR3_MIGRATION_WHEN matches 0006_data_spine_backfill's `when` in the journal", () => {
    const journalPath = path.resolve(
      import.meta.dirname,
      "../../../../lib/db/migrations/meta/_journal.json",
    );
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
      entries: { tag: string; when: number }[];
    };
    const entry = journal.entries.find(
      (e) => e.tag === "0006_data_spine_backfill",
    );
    expect(entry).toBeDefined();
    expect(PR3_MIGRATION_WHEN).toBe(entry!.when);
  });
});
