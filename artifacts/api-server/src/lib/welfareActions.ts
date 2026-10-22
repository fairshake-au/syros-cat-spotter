import { db, reportStateEventsTable, welfareReportsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { actingRole, type CapabilityHolder } from "./capabilities";
import { catTarget } from "./capabilityTargets";
import { writeObservation } from "./observations";
import { onReportStateChanged } from "./welfare/reporterEmail";

/**
 * What the team does to a sent report (SYC-43 part 2 plan, PR 2; spec §3.1,
 * §8.5): move it between the four states, and write the team note.
 *
 * A move to a closing state queues the reporter's one outcome email, if they
 * left an address and confirmed it (SYC-42 Slice 3; spec §5.3h). "Looking at
 * it" sends nothing. The team note never reaches the reporter.
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type MoveInput = {
  publicId: string;
  from: ReportState;
  to: ReportState;
  /** The signed-in person: their id is recorded, and their scopes decide
   * the role the cat's history row is written with (actingRole). */
  person: CapabilityHolder & { id: string };
  /** SYC-42 Slice 3: the optional line for the reporter's "Done" email. */
  reporterSentence?: string | null;
  /** Called with the outcome email's outbox row, to send after the commit. */
  onQueued?: (outboxId: number) => void;
};

/**
 * Moves a sent report from `from` to `to`, as `person`. One transaction:
 * the UPDATE only matches while the report is still in the state the page
 * showed (`state = from`), so of two people moving it at once exactly one
 * matches, and only that one writes the event. Postgres makes the second
 * UPDATE wait for the first's row lock and then re-check the condition.
 */
export async function moveReportState(input: MoveInput): Promise<MoveOutcome> {
  let queued: number | null = null;
  const outcome = await db.transaction(async (tx) => {
    const moved = await moveReportStateIn(tx, input);
    queued = moved.queued;
    return moved.outcome;
  });
  if (queued !== null) input.onQueued?.(queued);
  return outcome;
}

/**
 * {@link moveReportState}'s work inside a transaction the caller already
 * holds (SYC-44 PR 7.1: the Issues row's Keep hidden and Restore move the
 * report in the same transaction as the photo). The caller calls `onQueued`
 * with `queued` after its commit.
 */
export async function moveReportStateIn(
  tx: Tx,
  input: MoveInput,
): Promise<{ outcome: MoveOutcome; queued: number | null }> {
  const { publicId, from, to, person } = input;
  const personId = person.id;
  let queued: number | null = null;
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
    .returning({
      id: welfareReportsTable.id,
      catId: welfareReportsTable.catId,
      kind: welfareReportsTable.kind,
    });
  if (updated.length === 1) {
    const [event] = await tx
      .insert(reportStateEventsTable)
      .values({
        reportId: updated[0]!.id,
        fromState: from,
        toState: to,
        personId,
      })
      .returning({ id: reportStateEventsTable.id });
    const outboxId = await onReportStateChanged(tx, {
      reportId: updated[0]!.id,
      eventId: event!.id,
      to,
      teamSentence: to === "done" ? (input.reporterSentence ?? null) : null,
    });
    if (outboxId !== null) queued = outboxId;
    // Closing a report that is tied to a cat leaves a mark on the cat's
    // history (PR 5; spec §8.4): who closed it, and how. In this same
    // transaction, so the move and its outcome stand or fall together.
    // Reopening and closing again writes a second one: that is history.
    // Nothing is emailed. `catId` comes from the UPDATE's own RETURNING,
    // read through `tx`, so it is the cat the row had when it moved.
    //
    // SYC-44 PR 4.1 (spec §5.1): only a *welfare* report leaves that mark.
    // A "Report an issue" row can carry a cat from the start, and a close
    // on it is not an outcome for the cat (a `cat_died` report closed as
    // done is not evidence the cat was seen).
    const catId = updated[0]!.catId;
    if (
      updated[0]!.kind === "welfare" &&
      catId !== null &&
      (to === "done" || to === "nothing_needed")
    ) {
      await writeObservation(tx, {
        catId,
        kind: "welfare_outcome",
        value: { state: to, reportId: updated[0]!.id },
        accountId: personId,
        roleAtTime: actingRole(person, "change_report_state", await catTarget(catId, tx)),
        observedAt: new Date(),
      });
    }
    return { outcome: "moved", queued };
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
  return { outcome: exists ? "changed" : "not_found", queued };
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
