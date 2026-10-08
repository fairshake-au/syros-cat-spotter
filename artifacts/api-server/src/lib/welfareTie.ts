import { eq, sql } from "drizzle-orm";
import {
  catsTable,
  db,
  welfareReportsTable,
  type Observation,
} from "@workspace/db";
import { can } from "./capabilities";
import { lockActiveObservation } from "./teamCorrections";
import { ObservationRefused, writeObservation } from "./observations";

/**
 * "Which cat is this?" (SYC-43 part 2 plan, PR 5; SYC-42 Slice 5.1; spec
 * §8.4). Ties a sent welfare report to a cat the team knows.
 *
 * One transaction, every read and write through `tx` (never the global `db`:
 * PR 4's pre-merge review found a second pool connection taken inside a
 * transaction that holds locks can exhaust the pool):
 *
 *  1. `SELECT … FOR UPDATE` on the report row. Of two people tying the same
 *     report at once, the second waits here and then sees the first's result.
 *  2. If the report already has a standing `welfare_report` observation, lock
 *     it with the shared helper (lockActiveObservation) the supersede route
 *     uses.
 *  3. Check `cat_id` is still what the page showed.
 *  4. Set `cat_id` and write ONE `welfare_report` on the chosen cat.
 *
 * **Choosing a different cat later** (Samuel, 8 Oct 2026): the new
 * observation is written on the NEW cat, with `supersedesId` pointing at the
 * old one and the reason "tied to the wrong cat". Nothing is written on the
 * old cat. The old cat's history and evidence of life read that link across
 * cats (teamCatView, loadCatRecords).
 *
 * What is copied from the report: severity, litter flag and the report's id.
 * **Never** the reporter's note (§8.4), and never a photo: a report photo
 * never leaves the team, so the tie references none.
 *
 * Author: the reporter's device, as a member of the public. If the device has
 * been deleted (SYC-63 clears `reporter_device`), the app's own
 * `system:welfare-report`. `observedAt` is when the report was sent;
 * writeObservation clamps a public date older than 30 days to that boundary
 * (the existing rule, unchanged), so a report tied more than a month after it
 * was sent carries the clamped date.
 */

export const TIE_REASON = "tied to the wrong cat";

/** Said (page or JSON) to whoever's tie lost the race. */
export const TIE_CHANGED_MESSAGE = "Someone else tied this report a moment ago.";
/** Said when the chosen cat is the one the report is already tied to. */
export const TIE_SAME_MESSAGE = "This report is already tied to that cat.";

export type TieOutcome =
  /** Tied (or re-tied). Exactly one observation was written. */
  | { kind: "tied"; catId: number; observation: Observation }
  /** `cat_id` is no longer what the page showed: someone else got there first. Nothing written. */
  | { kind: "changed" }
  /** The chosen cat is the one it is already tied to. Nothing written. */
  | { kind: "same" }
  /** No such sent report (a draft is "no such report"). */
  | { kind: "report_not_found" }
  /** No such cat. */
  | { kind: "cat_not_found" };

type Person = { id: string; scopes: { role: string; colonyId: number | null }[] };

export async function tieReportToCat(input: {
  person: Person;
  publicId: string;
  /** The cat the team member chose. */
  catId: number;
  /** The cat the page showed the report tied to; null = not tied. */
  expectedCatId: number | null;
}): Promise<TieOutcome> {
  // The route also checks this capability (requireTeam). Checked again here,
  // as PR 4's functions do, so no caller can reach the write without it.
  if (!can(input.person, "change_report_state")) {
    throw new ObservationRefused("NOT_AUTHORISED", "Not authorised");
  }

  try {
    return await db.transaction(async (tx): Promise<TieOutcome> => {
      // The two locks: the report-row lock below serialises EVERY tie (the
      // burst test pins it). The observation locks are defence in depth for
      // any future path that supersedes a welfare_report or welfare_outcome;
      // no current path can (capabilityFor returns null for them), so no
      // black-box test can pin them alone.
      // 1. The report row. A draft is not a report yet.
      const locked = await tx.execute<{ id: number }>(
        sql`select id from welfare_reports
            where public_id = ${input.publicId} and is_draft = false
            for update`,
      );
      if (locked.rows.length === 0) return { kind: "report_not_found" };
      const [report] = await tx
        .select()
        .from(welfareReportsTable)
        .where(eq(welfareReportsTable.id, locked.rows[0]!.id));
      if (!report) return { kind: "report_not_found" };

      // 2. The standing welfare_report observation for this report, if any.
      const standing = await tx.execute<{ id: number }>(sql`
        select o.id from observations o
        where o.kind = 'welfare_report'
          and o.value->>'reportId' = ${String(report.id)}
          and not exists (select 1 from observations s where s.supersedes_id = o.id)
        order by o.id desc
        limit 1`);
      const previous =
        standing.rows.length > 0
          ? await lockActiveObservation(tx, standing.rows[0]!.id)
          : null;

      // The standing welfare_outcome rows (one per close, so reopening and
      // closing again leaves several). They move with the report: on a
      // re-tie each is carried to the new cat as one linked entry, so the
      // old cat does not keep a live "closed" for a report it no longer owns.
      const outcomeIds = await tx.execute<{ id: number }>(sql`
        select o.id from observations o
        where o.kind = 'welfare_outcome'
          and o.value->>'reportId' = ${String(report.id)}
          and not exists (select 1 from observations s where s.supersedes_id = o.id)
        order by o.id`);
      const outcomes: Observation[] = [];
      for (const row of outcomeIds.rows) {
        outcomes.push(await lockActiveObservation(tx, row.id));
      }

      // 3. Is it still what the page showed?
      if ((report.catId ?? null) !== input.expectedCatId) return { kind: "changed" };

      // The cat must exist. (Said after the race check, so a stale page is
      // always told "someone else", whatever it asked for.)
      const [cat] = await tx
        .select({ id: catsTable.id })
        .from(catsTable)
        .where(eq(catsTable.id, input.catId));
      if (!cat) return { kind: "cat_not_found" };

      // Tying to the cat it is already tied to: nothing to record.
      if (report.catId === input.catId) return { kind: "same" };

      // 4. Tie it.
      await tx
        .update(welfareReportsTable)
        .set({ catId: input.catId })
        .where(eq(welfareReportsTable.id, report.id));

      const author = report.reporterDevice
        ? ({ deviceId: report.reporterDevice, roleAtTime: "public" } as const)
        : ({ accountId: "system:welfare-report", roleAtTime: "system" } as const);
      const observation = await writeObservation(tx, {
        catId: input.catId,
        kind: "welfare_report",
        value: {
          severity: report.severity,
          isLitter: report.isLitter,
          reportId: report.id,
        },
        ...author,
        observedAt: report.submittedAt ?? report.createdAt,
        ...(previous
          ? { supersedesId: previous.id, supersedeReason: TIE_REASON }
          : {}),
      });

      if (outcomes.length > 0) {
        for (const old of outcomes) {
          await writeObservation(tx, {
            catId: input.catId,
            kind: "welfare_outcome",
            value: old.value,
            accountId: old.accountId,
            roleAtTime: old.roleAtTime,
            observedAt: old.observedAt,
            supersedesId: old.id,
            supersedeReason: TIE_REASON,
          });
        }
      } else if (report.state === "done" || report.state === "nothing_needed") {
        // Tying a report that was closed before it had a cat: the close
        // belongs in the cat's history too, by whoever closed it.
        await writeObservation(tx, {
          catId: input.catId,
          kind: "welfare_outcome",
          value: { state: report.state, reportId: report.id },
          accountId: report.stateChangedBy ?? input.person.id,
          roleAtTime: "staff",
          observedAt: report.stateChangedAt ?? new Date(),
        });
      }
      return { kind: "tied", catId: input.catId, observation };
    });
  } catch (err) {
    // Only reachable if the observation was superseded under us, which the
    // report-row lock rules out; if it ever happens, it is "someone else".
    if (err instanceof ObservationRefused && err.code === "ALREADY_SUPERSEDED") {
      return { kind: "changed" };
    }
    throw err;
  }
}

