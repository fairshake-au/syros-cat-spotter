import { db, photoVisibilityEventsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { can, type CapabilityHolder } from "../capabilities";
import { CHANGED_MESSAGE, moveReportStateIn, type ReportState } from "../welfareActions";
import { reasonLabel } from "./alertEmail";

/**
 * What the team does from an Issues row (SYC-44 PR 7.1; spec §5.4; plan
 * Slice 7 and its review, finding 13). Three actions, each in ONE
 * transaction that locks the report row and then the photo row (the same
 * `for update` as setPhotoVisibility and the report-hide, so ids in
 * photo_visibility_events follow the real order):
 *
 * - **Keep hidden** (`hide_photo`): closes the report as Done, and writes no
 *   visibility event (the photo is already hidden; only the state event).
 *   It checks, under the lock, that the photo is **still hidden**: if
 *   someone restored it meanwhile it closes nothing and says so.
 * - **Restore** (`restore_photo`): writes exactly one `restore` event, as the
 *   person, and closes the report as Nothing needed. Refused for a photo
 *   removed for good, or one that is already public.
 * - **Hide this photo** (`hide_photo`): one `hide` event as the person, for a
 *   reported photo that is still public. The report stays open.
 *
 * Each checks its capability here as well as on the route. Nothing is sent
 * to anyone.
 */

type Person = CapabilityHolder & { id: string };

export type IssueActionOutcome =
  /** Keep hidden: closed as Done. */
  | "kept"
  /** Restore: the photo is public again, closed as Nothing needed. */
  | "restored"
  /** Hide: the photo is hidden from the public now. */
  | "hidden"
  /** Keep hidden or Restore found the photo public: nothing written. */
  | "not_hidden"
  /** Hide found the photo already hidden: nothing written. */
  | "already_hidden"
  /** Restore on a photo deleted for good (SYC-462): nothing written. */
  | "removed"
  /** Someone else moved the report first: nothing written. */
  | "changed"
  /** The report points at no photo. */
  | "no_photo"
  /** No such sent issue report. */
  | "not_found"
  | "not_authorised";

/** The fixed words each outcome is shown with on the queue (?issue=<key>). */
export const ISSUE_OUTCOME_TEXT: Record<Exclude<IssueActionOutcome, "not_found" | "not_authorised">, string> = {
  kept: "Saved. The photo stays hidden, and this report is closed as Done.",
  restored: "Saved. The photo is public again, and this report is closed as Nothing needed.",
  hidden: "Saved. The photo is hidden from the public.",
  not_hidden: "Nothing changed: someone has already made this photo public again.",
  already_hidden: "Nothing changed: this photo is already hidden from the public.",
  removed: "Nothing changed: this photo was deleted for good, so it can't be restored.",
  changed: CHANGED_MESSAGE,
  no_photo: "Nothing changed: this report isn't about a photo.",
};

const CAPABILITY = { keep: "hide_photo", restore: "restore_photo", hide: "hide_photo" } as const;

type Action = keyof typeof CAPABILITY;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The report row, locked; null unless it is a sent "Report an issue" row. */
async function lockIssue(tx: Tx, publicId: string) {
  const res = await tx.execute<{ id: number; photo_id: number | null; reason: string }>(sql`
    select id, photo_id, reason from welfare_reports
     where public_id = ${publicId} and kind = 'content' and is_draft = false
     for update`);
  return res.rows[0] ?? null;
}

/** The photo row, locked, and whether it is hidden from the public now. */
async function lockPhoto(tx: Tx, photoId: number) {
  const locked = await tx.execute<{ removed_at: Date | string | null }>(
    sql`select removed_at from photos where id = ${photoId} for update`,
  );
  if (!locked.rows[0]) return null;
  // Newest = highest id, true only because of the lock just taken.
  const newest = await tx.execute<{ action: string }>(sql`
    select action from photo_visibility_events
     where photo_id = ${photoId} order by id desc limit 1`);
  const removed = locked.rows[0].removed_at !== null;
  return { removed, hidden: removed || newest.rows[0]?.action === "hide" };
}

async function act(
  action: Action,
  person: Person,
  input: { publicId: string; from?: ReportState },
  onQueued?: (outboxId: number) => void,
): Promise<IssueActionOutcome> {
  if (!can(person, CAPABILITY[action])) return "not_authorised";
  let queued: number | null = null;
  const outcome = await db.transaction(async (tx): Promise<IssueActionOutcome> => {
    const report = await lockIssue(tx, input.publicId);
    if (!report) return "not_found";
    if (report.photo_id === null) return "no_photo";
    const photo = await lockPhoto(tx, report.photo_id);
    if (!photo) return "no_photo";

    if (action === "hide") {
      if (photo.hidden) return "already_hidden";
      await writeEvent(tx, report.photo_id, "hide", person, `Issue report: ${reasonLabel(report.reason)}`);
      return "hidden";
    }

    if (action === "restore" && photo.removed) return "removed";
    // Finding 13: never close as "kept hidden" (or "restored") a photo that
    // someone has already put back.
    if (!photo.hidden) return "not_hidden";
    const moved = await moveReportStateIn(tx, {
      publicId: input.publicId,
      from: input.from!,
      to: action === "keep" ? "done" : "nothing_needed",
      person,
    });
    if (moved.outcome !== "moved") return moved.outcome === "changed" ? "changed" : "not_found";
    queued = moved.queued;
    if (action === "restore") {
      await writeEvent(tx, report.photo_id, "restore", person, "Restored from an issue report");
      return "restored";
    }
    return "kept";
  });
  if (queued !== null) onQueued?.(queued);
  return outcome;
}

async function writeEvent(tx: Tx, photoId: number, action: "hide" | "restore", person: Person, reason: string) {
  await tx.insert(photoVisibilityEventsTable).values({
    photoId,
    action,
    author: person.id,
    personId: person.id,
    reason,
    // The moment of the write, not the transaction's start.
    at: sql`clock_timestamp()`,
  });
}

/** Keep hidden: close as Done while the photo is still hidden. `from` is the state the page showed. */
export const keepHidden = (person: Person, input: { publicId: string; from: ReportState }, onQueued?: (id: number) => void) =>
  act("keep", person, input, onQueued);

/** Restore: one restore event, and close as Nothing needed. `from` is the state the page showed. */
export const restoreFromIssue = (person: Person, input: { publicId: string; from: ReportState }, onQueued?: (id: number) => void) =>
  act("restore", person, input, onQueued);

/** Hide this photo: one hide event; the report stays as it is. */
export const hideFromIssue = (person: Person, input: { publicId: string }) => act("hide", person, input);
