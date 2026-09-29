import type { ClientBase } from "pg";

/**
 * SYC-121, task B.3 carry-back — STUB, NOT IMPLEMENTED HERE.
 *
 * Escalated to Opus in the plan's Model delegation table (docs/superpowers/
 * plans/syc-121-neon-switchover.md, Part B.3): "it's the only code that
 * writes to the old database, and its failure modes are silent (a missed
 * update or a wrong sequence looks fine until a tester's row is gone)".
 *
 * This chip (Sonnet, Chip I) built fingerprint.ts, guard.ts and cli.ts's
 * `fingerprint`, `guard-target`, `mark` and `compare` commands, but was told
 * explicitly NOT to implement carry-back. A follow-on Opus chip builds it on
 * this same branch (`claude/syc-121-build`), following the plan's §B.3
 * "Carry-back" section (rows 1–5) and its own tests (test 4 end to end,
 * test 5, and the "skip update" / "skip setval" mutation probes), plus the
 * D.5 rehearsal against a real copy.
 *
 * The interface below is the contract `cli.ts`'s `carry-back` command binds
 * to, so the CLI, the db-ops workflow (B.4) and its tests can all be written
 * against a stable shape before carry-back itself exists. Calling it today
 * throws "not implemented".
 */

export interface CarryBackTableReport {
  table: string;
  /** Primary-key values (never row contents) of rows that would be/were inserted. */
  toInsert: unknown[];
  /** Primary-key values of rows that would be/were updated. */
  toUpdate: unknown[];
  /** Primary-key values of rows that would be/were deleted. */
  toDelete: unknown[];
}

export interface CarryBackReport {
  /** Per baseline table, what changed (or would change without --apply). */
  tables: CarryBackTableReport[];
  /**
   * Rows that exist only in tables the old (target) database doesn't have at
   * all — added by a migration after the baseline. Reported by table name
   * only ("no home in the old database"), never by content.
   */
  noHomeInTarget: string[];
  applied: boolean;
}

export interface CarryBackOptions {
  /** Without this, carryBack is a dry run: it reports and changes nothing. */
  apply?: boolean;
}

/**
 * Makes each of the nine baseline tables in `target` (the old database)
 * equal to `source`'s rows (Neon production), projected onto the target's
 * columns. See the plan's §B.3 "Carry-back" for the full algorithm (insert/
 * update/delete by primary key, parents-first / children-first by foreign
 * key, sequence catch-up, and a `compare --projected` check inside the same
 * transaction that only commits if it passes).
 *
 * NOT IMPLEMENTED in this chip's scope. Built by the Opus follow-on chip on
 * this branch.
 */
export async function carryBack(
  _source: ClientBase,
  _target: ClientBase,
  _opts: CarryBackOptions = {},
): Promise<CarryBackReport> {
  throw new Error(
    "carryBack is not implemented yet (SYC-121, task B.3 carry-back). " +
      "It is deliberately left as a stub for a follow-on Opus chip on this " +
      "branch — see the comment at the top of lib/db/src/switchover/carryBack.ts.",
  );
}
