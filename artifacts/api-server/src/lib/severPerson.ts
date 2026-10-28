import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { DELETED_SECRET_HASH, deletedMarkerKey } from "./deviceAuth";
import { severKeepSafe } from "./keepSafe/sever";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** What `redaction_reason` says when a person deletes themselves in the app. */
export const DELETED_BY_THE_PERSON = "deleted by the person";

/**
 * Severs a spotter from everything they did, and keeps the cats' history
 * (cat-record-data-spine.md §8; plan syc-63-self-service-deletion.md §4.2).
 *
 * One function, three doors: the in-app "Delete my data" button calls it
 * today; the delete link in emails (SYC-45) and the team's "Delete this
 * person's details" (SYC-43) call it when they're built, so there is one
 * mechanism and one test suite.
 *
 * Runs inside the caller's transaction, so it all happens or none of it does.
 * It is synchronous: no queue, no nightly sweep (§8.5).
 *
 * Acts on a device identity only. Rows attributed to a staff account
 * (`account_id`, `people`) are never touched (plan §7).
 *
 * The test that scans every text and jsonb column of every table for the
 * person's device id (severPerson.test.ts) fails if a table added later holds
 * a device id this function forgets.
 */
export async function severPerson(
  tx: Tx,
  { deviceId, reason }: { deviceId: string; reason: string },
): Promise<void> {
  // 0. SYC-706: the badges lock every badge writer takes (a resolve, the
  //    backfill, the weekly close), taken first. A close that has frozen a
  //    winner's result either finishes before this runs (and step 6 then
  //    blanks the name) or sees the profile gone and skips them; it can't
  //    write a result naming a spotter deleted a moment ago.
  //    THE RULE: for one device, the badges lock is always taken before any
  //    device_credentials row lock. So a caller that will end here, having
  //    locked that device's credentials row first, must take the badges lock
  //    before it (keepSafe/move.ts does when deleting the phone's old
  //    spotter). Badge writers never lock a credentials row, and DELETE /me
  //    takes no lock before this, so nothing waits in a circle.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${"badges:" + deviceId}))`,
  );

  // 1. Two deletes of the same device queue up rather than interleave.
  await tx.execute(
    sql`select device_id from device_credentials where device_id = ${deviceId} for update`,
  );

  // 2. Their statements about cats stay, with nobody on them. A note's text
  //    is emptied in SQL: the observations guard (migration 0001) compares
  //    values exactly, so a value re-serialised from JavaScript is refused.
  //    Every other kind keeps its value, names included (§8.4).
  await tx.execute(sql`
    update observations
       set device_id = null,
           redacted_at = coalesce(redacted_at, now()),
           redaction_reason = coalesce(redaction_reason, ${reason}),
           value = case when kind = 'note' then '{}'::jsonb else value end
     where device_id = ${deviceId}
  `);

  // 3. Their sightings stay: photo, date, place, cat and status.
  await tx.execute(sql`
    update sightings
       set device_id = null,
           redacted_at = now(),
           redaction_reason = ${reason}
     where device_id = ${deviceId}
  `);

  // 4. Cats they discovered credit "a spotter". Cats they said live with them
  //    lose the owner's name and link (decision A, flag 5 b); the home note
  //    stays, and the cat stays homed through its life status (spine PR 4).
  await tx.execute(sql`
    update cats
       set discoverer_device_id = null,
           redacted_at = coalesce(redacted_at, now()),
           redaction_reason = coalesce(redaction_reason, ${reason})
     where discoverer_device_id = ${deviceId}
  `);
  await tx.execute(sql`
    update cats
       set owner_name = null,
           owner_device_id = null
     where owner_device_id = ${deviceId}
  `);

  // 5. Welfare reports they sent stay, with the photo, as the cat's history
  //    (SYC-42; Samuel, 30 Sep 2026). Only the link to them goes.
  //    Deliberately NO `kind` filter (SYC-44 PR 4.1): this clears the device
  //    from "needs help" and "Report an issue" rows alike.
  await tx.execute(sql`
    update welfare_reports
       set reporter_device = null
     where reporter_device = ${deviceId}
  `);

  // 5a. Which cat is which (SYC-150; which-cat-is-which.md §9.11). Their
  //     "same cat?" answers stay as evidence about the two cats, with nobody
  //     on them (the table allows only this). The follows a merge copied
  //     for them are deleted with their follows in step 6, so the record of
  //     which ones it copied goes too. Statements a move copied carry their
  //     device like any other, and step 2 has already cleared them; the
  //     move takes this device's badges lock before copying (§9.7), so none
  //     can be copied after this runs.
  await tx.execute(sql`
    update duplicate_reports
       set device_id = null,
           redacted_at = coalesce(redacted_at, now())
     where device_id = ${deviceId}
  `);
  await tx.execute(sql`delete from merge_follow_changes where device_id = ${deviceId}`);

  // 5b. "Keep my spots safe" (SYC-3): the keep-safe row, its queued emails
  //     and link tokens go, and its consent events are redacted in place.
  //     SYC-3 built this to run inside deletion's transaction.
  await severKeepSafe(tx, deviceId, reason);

  // 6. Everything that was only theirs.
  await tx.execute(
    sql`delete from cat_subscriptions where device_id = ${deviceId}`,
  );
  // SYC-624: the "I stopped following" records are theirs too.
  await tx.execute(
    sql`delete from cat_unfollows where device_id = ${deviceId}`,
  );
  await tx.execute(
    sql`delete from notifications where device_id = ${deviceId}`,
  );
  await tx.execute(sql`delete from push_tokens where device_id = ${deviceId}`);
  // SYC-706: badges and waiting celebrations go. Points and frozen weekly
  // results stay as the cats' and the week's history, but name nobody: the
  // points keep counting, and a podium place renders as "a spotter".
  await tx.execute(sql`delete from spotter_badges where device_id = ${deviceId}`);
  await tx.execute(sql`delete from badge_moments where device_id = ${deviceId}`);
  await tx.execute(
    sql`update points_ledger set device_id = null where device_id = ${deviceId}`,
  );
  await tx.execute(sql`
    update weekly_results
       set device_id = null,
           display_name = null
     where device_id = ${deviceId}
  `);
  await tx.execute(sql`delete from profiles where device_id = ${deviceId}`);
  await tx.execute(
    sql`delete from device_credentials where device_id = ${deviceId}`,
  );

  // 7. The one-way marker, so the old id and secret can never bring the
  //    identity back (§4.3, decision D).
  await tx.execute(sql`
    insert into device_credentials (device_id, secret_hash)
    values (${deletedMarkerKey(deviceId)}, ${DELETED_SECRET_HASH})
    on conflict (device_id) do nothing
  `);
}

/**
 * Severs a team member from the records of who moved, merged and decided
 * (which-cat-is-which.md §9.11), and from their statements. The moves,
 * merges, decisions and statements stay, as the cats' history, with nobody
 * on them: each table's guard allows exactly this (clear who, stamp
 * `redacted_at`).
 *
 * Runs inside the caller's transaction. Nothing deletes a team member's
 * details yet (people are marked as left, never deleted); SYC-43's "Delete
 * this person's details" calls this when it is built, beside its own work
 * on the people tables. Like `severPerson`, safe to run twice.
 */
export async function severTeamMember(
  tx: Tx,
  { accountId, reason }: { accountId: string; reason: string },
): Promise<void> {
  // Their statements: the author goes, the value stays, as for a spotter.
  await tx.execute(sql`
    update observations
       set account_id = null,
           redacted_at = coalesce(redacted_at, now()),
           redaction_reason = coalesce(redaction_reason, ${reason}),
           value = case when kind = 'note' then '{}'::jsonb else value end
     where account_id = ${accountId}
  `);
  for (const [table, column] of [
    ["sighting_moves", "moved_by_account_id"],
    ["cat_identity", "by_account_id"],
    ["duplicate_decisions", "by_account_id"],
    ["new_cat_checks", "by_account_id"],
  ] as const) {
    await tx.execute(sql`
      update ${sql.identifier(table)}
         set ${sql.identifier(column)} = null,
             redacted_at = coalesce(redacted_at, now())
       where ${sql.identifier(column)} = ${accountId}
    `);
  }
}
