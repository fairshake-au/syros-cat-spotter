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
 * **Flagged, not guessed:** PR 3 (`claude/spine-pr3-backfill`) is being built
 * by a parallel chip and had not been pushed as of this PR's branch point —
 * `gh pr list` showed no such branch or PR. {@link PR3_MIGRATION_TAG} below
 * is this PR's best guess at PR 3's migration tag (the next idx after
 * `0005_sighting_matches` in `lib/db/migrations/meta/_journal.json`, in the
 * naming style the plan's prose uses — "the backfill"). If PR 3 lands with
 * a different tag, whichever of PR 3 / PR 4 merges second must update this
 * constant to match — the gate is written to fail safe either way: an
 * unrecognised or missing tag means "not recorded yet", never a crash, and
 * `hasHome` keeps working from the legacy column until it's corrected.
 */
import { readMigrations, defaultMigrationsFolder } from "@workspace/db/migrate/runner";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/** Update this if PR 3 lands under a different migration tag. See the file
 * doc comment above — this is a best guess made before PR 3 was pushed. */
export const PR3_MIGRATION_TAG = "0006_data_spine_backfill";

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
 * database this process is talking to? Looks the migration's tag up in the
 * local migrations folder (so a mismatched {@link PR3_MIGRATION_TAG} fails
 * safe rather than guessing a hash), then checks whether a row with that
 * exact hash exists in `drizzle.__drizzle_migrations` — the same table
 * `lib/db/src/migrate/runner.ts` writes to and the plan names explicitly.
 * That table is schema-only (no `tag` column — see `runner.ts`'s
 * `ensureTable`), which is why the hash has to be looked up by tag locally
 * first rather than queried by tag directly.
 */
export async function pr3Recorded(
  migrationsFolder: string = defaultMigrationsFolder(),
): Promise<boolean> {
  if (cachedTrue) return true;

  let targetHash: string | undefined;
  try {
    const migrations = readMigrations(migrationsFolder);
    targetHash = migrations.find((m) => m.tag === PR3_MIGRATION_TAG)?.hash;
  } catch (err) {
    logger.warn({ err }, "pr3Gate: could not read local migrations folder");
    return false;
  }

  if (!targetHash) {
    // PR 3 hasn't landed in this tree yet, or landed under a different tag
    // than our guess — either way, "not recorded" is the safe answer.
    return false;
  }

  try {
    const result = await db.execute<{ found: boolean }>(
      sql`select exists(
        select 1 from "drizzle"."__drizzle_migrations" where hash = ${targetHash}
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
