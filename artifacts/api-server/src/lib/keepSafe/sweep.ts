import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { clearExpiredKeepSafePayloads } from "../mail/outbox";
import { MOVED_DAYS } from "../deviceAuth";

/**
 * The keep-safe sweep (SYC-3 plan, Slice 1 step 2; review A5; email-capture.md
 * §5.5). Safe to run as often as you like: it only removes what's past its
 * time. It rides on the scheduled mail drain (routes/internalMail.ts), at most
 * once an hour per server, so it needs no schedule of its own.
 *
 * - An address nobody confirmed goes after 7 days, with its tokens: a
 *   keep-safe address, or one left on a cat report (SYC-42 Slice 3). Its
 *   consent record keeps only that an unconfirmed attempt expired: the
 *   spotter and the contact row are redacted away. The keyed fingerprint stays
 *   on the record, as it does on the suppression list, because the "three
 *   'is this you?' emails in an address's lifetime" cap (§4.4) counts from it.
 * - Used or expired tokens go 30 days after they were used or expired. A
 *   used restore token stays for 90 days, so the old phone is told "moved"
 *   that long (`device_moved` itself also stops at 90 days, in deviceAuth.ts).
 * - Request rows (the limits) go after 24 hours.
 * - Any outbox row still holding an address or a token past its link's expiry
 *   is cleared, and settled keep-safe outbox rows go after 30 days.
 */

export const PENDING_DAYS = 7;
export const TOKEN_KEEP_DAYS = 30;
export const REQUEST_KEEP_HOURS = 24;

export type SweepResult = {
  pendingExpired: number;
  tokensDeleted: number;
  requestsDeleted: number;
  outboxCleared: number;
};

export async function sweepKeepSafe(): Promise<SweepResult> {
  const pendingExpired = await db.transaction(async (tx) => {
    // SYC-42 Slice 3: a reporter's unconfirmed address too. The "is this
    // you?" email promises "we'll forget it in seven days". The report stays;
    // only the link to the address goes (reporter_contact_id is set null).
    const expired = await tx.execute(sql`
      delete from email_contacts
       where purpose in ('keep_safe', 'report')
         and status = 'pending'
         and created_at < now() - make_interval(days => ${PENDING_DAYS})
      returning id, address_hmac, purpose
    `);
    const rows = expired.rows as { id: number; address_hmac: string; purpose: string }[];
    if (rows.some((r) => r.purpose === "report")) {
      // Every email to them goes: queued ones hold a raw link, sent ones the
      // fingerprint, and so do their delivery records.
      const ids = sql.join(
        rows.filter((r) => r.purpose === "report").map((r) => sql`${String(r.id)}`),
        sql`, `,
      );
      await tx.execute(sql`
        delete from mail_deliveries
         where provider_message_id in (
           select provider_message_id from mail_outbox
            where purpose in ('public_verify', 'report_ack', 'report_outcome')
              and provider_message_id is not null
              and payload->>'contactId' in (${ids}))
      `);
      await tx.execute(sql`
        delete from mail_outbox
         where purpose in ('public_verify', 'report_ack', 'report_outcome')
           and payload->>'contactId' in (${ids})
      `);
    }
    for (const row of rows) {
      await tx.execute(sql`
        update email_consent_events
           set contact_id = null, device_id = null,
               redacted_at = now(), redaction_reason = 'unconfirmed address expired'
         where contact_id = ${row.id} and redacted_at is null
      `);
      await tx.execute(sql`
        insert into email_consent_events (address_hmac, purpose, event)
        values (${row.address_hmac}, ${row.purpose}, 'expired')
      `);
    }
    return rows.length;
  });

  const tokens = await db.execute(sql`
    delete from mail_tokens
     where coalesce(used_at, expires_at) < now() - make_interval(days => ${TOKEN_KEEP_DAYS})
       and not (replaced_secret_hash is not null
                and used_at >= now() - make_interval(days => ${MOVED_DAYS}))
  `);
  const requests = await db.execute(sql`
    delete from mail_requests
     where created_at < now() - make_interval(hours => ${REQUEST_KEEP_HOURS})
  `);
  const outboxCleared = await clearExpiredKeepSafePayloads();
  // Settled keep-safe outbox rows carry the address fingerprint; they go
  // with the tokens (review of #106, finding 5).
  await db.execute(sql`
    delete from mail_outbox
     where purpose in ('keep_safe_verify', 'restore_link')
       and state in ('sent', 'failed')
       and created_at < now() - make_interval(days => ${TOKEN_KEEP_DAYS})
  `);
  return {
    pendingExpired,
    tokensDeleted: tokens.rowCount ?? 0,
    requestsDeleted: requests.rowCount ?? 0,
    outboxCleared,
  };
}

const SWEEP_EVERY_MS = 60 * 60 * 1000;
let lastSweep = 0;

/** At most once an hour per server; never throws. */
export async function sweepKeepSafeIfDue(log: { error: (o: object, m: string) => void }): Promise<SweepResult | null> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return null;
  lastSweep = now;
  try {
    return await sweepKeepSafe();
  } catch (err) {
    log.error({ err: { name: (err as Error).name, code: (err as { code?: string }).code } }, "keep-safe sweep failed");
    return null;
  }
}
