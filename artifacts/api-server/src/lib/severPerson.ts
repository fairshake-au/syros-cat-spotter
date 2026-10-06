import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { DELETED_SECRET_HASH, deletedMarkerKey } from "./deviceAuth";

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
  await tx.execute(sql`
    update welfare_reports
       set reporter_device = null
     where reporter_device = ${deviceId}
  `);

  // 6. Everything that was only theirs.
  await tx.execute(sql`delete from cat_subscriptions where device_id = ${deviceId}`);
  await tx.execute(sql`delete from notifications where device_id = ${deviceId}`);
  await tx.execute(sql`delete from push_tokens where device_id = ${deviceId}`);
  await tx.execute(sql`delete from profiles where device_id = ${deviceId}`);
  await tx.execute(sql`delete from device_credentials where device_id = ${deviceId}`);

  // 7. The one-way marker, so the old id and secret can never bring the
  //    identity back (§4.3, decision D).
  await tx.execute(sql`
    insert into device_credentials (device_id, secret_hash)
    values (${deletedMarkerKey(deviceId)}, ${DELETED_SECRET_HASH})
    on conflict (device_id) do nothing
  `);
}
