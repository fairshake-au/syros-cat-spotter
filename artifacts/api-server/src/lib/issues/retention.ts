import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { safeError } from "../logger";

/**
 * The one-year clean-up for "Report an issue" rows (SYC-44 plan, Slice 8,
 * PR 8.1; spec D12). A year after an issue report was closed, what anyone
 * wrote on it goes: the reporter's note and the team's note (either may
 * quote the reporter; plan small call, review finding 19). The bare record
 * stays (reason, photo or cat, state, dates), so "have we been asked about
 * this photo before?" still has an answer, and `note_cleared_at` says when.
 *
 * - Only `kind = 'content'`. A welfare report is never touched here: its
 *   three-year rule is SYC-302's job, which doesn't exist yet.
 * - Only `done` and `nothing_needed`, counted from `state_changed_at`. A
 *   report moved back to `looking` is open again, and closing it again
 *   restarts the year.
 * - Safe to run as often as you like. A row is updated only while it still
 *   holds something to clear, or has never been stamped, so a second run
 *   changes nothing and `note_cleared_at` keeps the first clearing's time.
 *   A team note written on a closed report after its clearing goes on the
 *   next run, and the stamp moves to then.
 *
 * It rides on the scheduled mail drain (routes/internalMail.ts), at most once
 * a day per server, as the keep-safe sweep does, so it needs no schedule of
 * its own.
 */

export type IssueRetentionResult = { notesCleared: number };

export async function sweepIssueNotes(now: number = Date.now()): Promise<IssueRetentionResult> {
  const cleared = await db.execute(sql`
    update welfare_reports
       set note = null, team_note = null, team_note_by = null, team_note_at = null,
           note_cleared_at = to_timestamp(${now} / 1000.0)
     where kind = 'content'
       and state in ('done', 'nothing_needed')
       and state_changed_at < to_timestamp(${now} / 1000.0) - interval '1 year'
       and (note is not null or team_note is not null or team_note_by is not null
            or team_note_at is not null or note_cleared_at is null)
  `);
  return { notesCleared: cleared.rowCount ?? 0 };
}

const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;
let lastSweep = 0;

/** At most once a day per server; never throws (same pattern as the keep-safe sweep). */
export async function sweepIssueNotesIfDue(
  log: { error: (o: object, m: string) => void },
): Promise<IssueRetentionResult | null> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return null;
  lastSweep = now;
  try {
    return await sweepIssueNotes(now);
  } catch (err) {
    log.error({ err: safeError(err) }, "issue note clean-up failed");
    return null;
  }
}

/** Test-only: let the next `sweepIssueNotesIfDue` run. */
export function _resetIssueNotesSweepForTests(): void {
  lastSweep = 0;
}
