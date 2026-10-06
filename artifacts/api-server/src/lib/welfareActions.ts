import { db, reportStateEventsTable, welfareReportsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/**
 * What the team does to a sent report (SYC-43 part 2 plan, PR 2; spec §3.1,
 * §8.5): move it between the four states, and write the team note.
 *
 * Neither writes to `mail_outbox`: the reporter's email is SYC-42 Slice 3,
 * and nothing here may send one before then (spec §5.3h).
 */

export const REPORT_STATES = [
  "new",
  "looking",
  "done",
  "nothing_needed",
] as const;
export type ReportState = (typeof REPORT_STATES)[number];

export const NOTE_MAX = 2000;

/** Said (page or JSON) to whoever's move lost the race. */
export const CHANGED_MESSAGE =
  "Someone else changed this report a moment ago. Here's where it is now.";

export type MoveOutcome =
  /** The report moved, and exactly one event was written. */
  | "moved"
  /** Someone else moved it first (or it was already in `to`): nothing written. */
  | "changed"
  /** No such sent report. A draft is "no such report" here: it can't be moved. */
  | "not_found";

/**
 * Moves a sent report from `from` to `to`, as `personId`. One transaction:
 * the UPDATE only matches while the report is still in the state the page
 * showed (`state = from`), so of two people moving it at once exactly one
 * matches, and only that one writes the event. Postgres makes the second
 * UPDATE wait for the first's row lock and then re-check the condition.
 */
export async function moveReportState(input: {
  publicId: string;
  from: ReportState;
  to: ReportState;
  personId: string;
}): Promise<MoveOutcome> {
  const { publicId, from, to, personId } = input;
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(welfareReportsTable)
      .set({ state: to, stateChangedAt: new Date(), stateChangedBy: personId })
      .where(
        and(
          eq(welfareReportsTable.publicId, publicId),
          eq(welfareReportsTable.state, from),
          eq(welfareReportsTable.isDraft, false),
        ),
      )
      .returning({ id: welfareReportsTable.id });
    if (updated.length === 1) {
      await tx.insert(reportStateEventsTable).values({
        reportId: updated[0]!.id,
        fromState: from,
        toState: to,
        personId,
      });
      return "moved";
    }
    const [exists] = await tx
      .select({ id: welfareReportsTable.id })
      .from(welfareReportsTable)
      .where(
        and(
          eq(welfareReportsTable.publicId, publicId),
          eq(welfareReportsTable.isDraft, false),
        ),
      );
    return exists ? "changed" : "not_found";
  });
}

/**
 * Writes the team note on a sent report: the text, who, and when. An empty
 * note (after trimming) clears the text; who and when still record the
 * change. False when there is no such sent report.
 */
export async function writeTeamNote(input: {
  publicId: string;
  note: string;
  personId: string;
}): Promise<boolean> {
  const text = input.note.trim() === "" ? null : input.note;
  const updated = await db
    .update(welfareReportsTable)
    .set({ teamNote: text, teamNoteBy: input.personId, teamNoteAt: new Date() })
    .where(
      and(
        eq(welfareReportsTable.publicId, input.publicId),
        eq(welfareReportsTable.isDraft, false),
      ),
    )
    .returning({ id: welfareReportsTable.id });
  return updated.length === 1;
}
