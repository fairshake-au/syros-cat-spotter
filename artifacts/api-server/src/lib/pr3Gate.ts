/**
 * Data spine PR 4's code gate (plan `docs/superpowers/plans/data-spine.md`,
 * PR 4; spec `cat-record-data-spine.md` §10.2/§11): this PR must be merged
 * only after PR 3's backfill migration has actually run in production, and
 * the plan requires that to be enforced in code, not only by merge order —
 * "the check is read once per process and re-read until it passes".
 *
 * Before PR 3's backfill, a claimed cat has no `homed` observation at all
 * (12 of production's 28 cats, per the plan's R28/R1). Deriving `hasHome`
 * from `resolveCat` before that backfill has run would silently strip every
 * one of those cats of its home badge. So every reader of derived status
 * checks {@link pr3Recorded} first and falls back to the legacy columns
 * (`cats.owner_device_id`, the old `desexed` care update) until it reports
 * true.
 *
 * **Keyed on the migration's fixed `when` timestamp, not its file hash or
 * tag.** An earlier version of this file called
 * `readMigrations(defaultMigrationsFolder())` to look the tag up by file
 * content — found in review (Opus review of PR 3, #67) to resolve, in the
 * esbuild-bundled `dist/index.mjs` this ships as, to a path under
 * `artifacts/migrations` that doesn't exist in production. That isn't a
 * crash (the gate fails safe), but it's a *silent, permanent* OFF: the
 * gate would never see the local migrations folder at all once deployed,
 * so the legacy home-badge fallback would run forever even with PR 3 long
 * since applied. The fix is to depend on nothing at the filesystem at
 * runtime: `drizzle.__drizzle_migrations.created_at` stores exactly the
 * `when` value from `meta/_journal.json` at the moment a migration is
 * applied (see `lib/db/src/migrate/runner.ts`), and that `when` is fixed
 * the moment PR 3's migration file is generated — unlike its hash, which
 * changes with every edit to the migration's SQL. PR 3
 * (`claude/spine-pr3-backfill`, journal entry `idx: 6`,
 * `tag: "0006_data_spine_backfill"`) is being edited for a bug fix as this
 * PR is written, which changes its hash but not its `when` — confirmed
 * against that branch's own `meta/_journal.json` at the time this was
 * written. If PR 3's migration is ever regenerated with a new `when` (a
 * rename, not an edit), whichever of PR 3 / PR 4 merges second must update
 * {@link PR3_MIGRATION_WHEN} to match.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * PR 3's migration `when` (`lib/db/migrations/meta/_journal.json`,
 * `0006_data_spine_backfill`, confirmed against
 * `origin/claude/spine-pr3-backfill`). Update this only if PR 3's migration
 * is regenerated under a different `when` — see the file doc comment.
 */
export const PR3_MIGRATION_WHEN = 1791010153072;

// Cached only once true: a migration that has run stays run. While false we
// deliberately never cache, so the gate flips the moment the real production
// migration history catches up — "read once per process and re-read until it
// passes" (plan, PR 4).
let cachedTrue = false;

/** Test-only: forget the cached true, so a test can start from "not yet". */
export function resetPr3GateCacheForTests(): void {
  cachedTrue = false;
}

/**
 * Has PR 3's backfill migration been recorded as applied, in whichever
 * database this process is talking to? A pure database check —
 * {@link PR3_MIGRATION_WHEN} is a compile-time constant, never read from
 * the filesystem at runtime (see the file doc comment for why that matters
 * in the bundled build).
 */
export async function pr3Recorded(): Promise<boolean> {
  if (cachedTrue) return true;

  try {
    const result = await db.execute<{ found: boolean }>(
      sql`select exists(
        select 1 from "drizzle"."__drizzle_migrations" where created_at = ${PR3_MIGRATION_WHEN}
      ) as found`,
    );
    const found = Boolean((result.rows[0] as { found?: boolean } | undefined)?.found);
    if (found) cachedTrue = true;
    return found;
  } catch (err) {
    // The migrations table may not exist yet on a brand-new database (the
    // runner creates it lazily on first migrate) — that's "not recorded",
    // not an error worth surfacing on every cat-page request.
    logger.warn({ err }, "pr3Gate: could not query drizzle.__drizzle_migrations");
    return false;
  }
}
