import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * What "Delete my data" (SYC-63) must do to a spotter's keep-safe records
 * (SYC-3 plan, "How moving a spotter works" and test 16). Runs inside the
 * deletion's own transaction; SYC-63's `severPerson` calls it.
 *
 * - The keep-safe row goes (its verify and forget tokens go with it).
 * - Its queued keep-safe emails go (they hold the address and a raw token).
 * - Every link token naming the spotter goes: ones it asked for, and used
 *   restore tokens that moved it (they hold its id, for `device_moved`).
 * - Its consent events are redacted in place: who they were about (device,
 *   contact row, address fingerprint) is cleared; what was consented to, the
 *   wording, the language and the times stay (email-capture.md §5.5, §5.6).
 *
 * A deleted spotter can never be restored: with SYC-63's marker its
 * credential row is gone, so the move finds nothing to rewrite (move.ts).
 */
export async function severKeepSafe(tx: Tx, deviceId: string, reason: string): Promise<void> {
  // Queued keep-safe emails for this spotter still hold the address and a raw
  // token: matched by the token's hash, before the tokens go (review of #106,
  // finding 5).
  await tx.execute(sql`
    delete from mail_outbox
     where purpose in ('keep_safe_verify', 'restore_link')
       and (
         encode(sha256(convert_to(coalesce(payload->>'token', ''), 'UTF8')), 'hex') in (
           select token_hash from mail_tokens where device_id = ${deviceId} or restored_device_id = ${deviceId})
         or encode(sha256(convert_to(coalesce(payload->>'forgetToken', ''), 'UTF8')), 'hex') in (
           select token_hash from mail_tokens where device_id = ${deviceId})
       )
  `);
  await tx.execute(sql`delete from email_contacts where purpose = 'keep_safe' and device_id = ${deviceId}`);
  await tx.execute(sql`
    delete from mail_tokens where device_id = ${deviceId} or restored_device_id = ${deviceId}
  `);
  await tx.execute(sql`
    update email_consent_events
       set device_id = null, contact_id = null, address_hmac = null,
           redacted_at = coalesce(redacted_at, now()),
           redaction_reason = coalesce(redaction_reason, ${reason})
     where device_id = ${deviceId}
  `);
}
