import { db, emailContactsTable, emailSuppressionsTable } from "@workspace/db";
import { and, eq, inArray, ne, notInArray, or } from "drizzle-orm";
import { addressFingerprint } from "./fingerprint";

/**
 * The suppression and verification checks `sendMail` needs for the keep-safe
 * purposes (SYC-3 plan, Slice 1 step 2; review A2, A10).
 *
 * What each suppression reason blocks:
 * - `bounce`, `complaint`, and an explicit "never email me" (`unsubscribe`
 *   with scope `all`) block every purpose. They're stored under the `all`
 *   fingerprint.
 * - `forget` from a keep-safe email blocks keep-safe mail only (the two uses
 *   are separate choices, email-capture.md §8.1). Stored under the keep-safe
 *   fingerprint, the only one a "Forget this address" link has to hand.
 * - `verify_cap` blocks **only further "is this you?" emails**, never a
 *   restore link to an address that's already confirmed. Otherwise a stranger
 *   could add a victim's address from three phones and silently stop the
 *   victim ever getting their spots back. And once the address is confirmed
 *   for a spotter, the automatic cap no longer applies at all (Samuel,
 *   8 Oct 2026, SYC-261): a parent adding a second child gets the email.
 * - `forget_verify` (SYC-262, Samuel 8 Oct 2026): "Forget this address" pressed
 *   in an "is this you?" email for an address that already keeps another
 *   spotter safe. The person chose it, so it blocks further "is this you?"
 *   emails, but never that family's own restore links.
 */

export type KeepSafeMail = "keep_safe_verify" | "restore_link";

export async function isKeepSafeSuppressed(mail: KeepSafeMail, address: string): Promise<boolean> {
  const own = addressFingerprint("keep_safe", address);
  const all = addressFingerprint("all", address);
  let ownReasons;
  if (mail === "restore_link") {
    // Only an explicit, full "forget" stops a restore link.
    ownReasons = notInArray(emailSuppressionsTable.reason, ["verify_cap", "forget_verify"]);
  } else if (await isKeepSafeConfirmed(address)) {
    // Confirmed somewhere: the automatic cap no longer applies (SYC-261).
    ownReasons = ne(emailSuppressionsTable.reason, "verify_cap");
  }
  const rows = await db
    .select({ id: emailSuppressionsTable.id })
    .from(emailSuppressionsTable)
    .where(
      or(
        and(
          eq(emailSuppressionsTable.addressHmac, own),
          eq(emailSuppressionsTable.scope, "keep_safe"),
          ownReasons,
        ),
        and(
          eq(emailSuppressionsTable.addressHmac, all),
          eq(emailSuppressionsTable.scope, "all"),
          inArray(emailSuppressionsTable.reason, ["bounce", "complaint", "unsubscribe"]),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** A restore link only ever goes to an address confirmed for at least one spotter (F7b). */
export async function isKeepSafeConfirmed(address: string): Promise<boolean> {
  const rows = await db
    .select({ id: emailContactsTable.id })
    .from(emailContactsTable)
    .where(
      and(
        eq(emailContactsTable.purpose, "keep_safe"),
        eq(emailContactsTable.addressHmac, addressFingerprint("keep_safe", address)),
        eq(emailContactsTable.status, "confirmed"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export function keepSafeSendDeps(mail: KeepSafeMail) {
  return {
    isSuppressed: (address: string) => isKeepSafeSuppressed(mail, address),
    isVerified: isKeepSafeConfirmed,
  };
}

// ── A reporter's address (SYC-42 Slice 3) ──────────────────────────────────

/**
 * Never mail this reporter address: a report-scope suppression (they pressed
 * "Forget this address"), or a bounce, complaint or "never email me" on any
 * purpose (§2.10: the suppression list also blocks verification sends).
 *
 * The three-"is this you?" cap (`verify_cap`) blocks only further "is this
 * you?" emails, never the acknowledgement or outcome to an address its holder
 * did confirm (the keep-safe rule, SYC-261).
 */
export async function isReportSuppressed(address: string, mail: "verify" | "confirmed" = "verify"): Promise<boolean> {
  const rows = await db
    .select({ id: emailSuppressionsTable.id })
    .from(emailSuppressionsTable)
    .where(
      or(
        and(
          eq(emailSuppressionsTable.addressHmac, addressFingerprint("report", address)),
          eq(emailSuppressionsTable.scope, "report"),
          mail === "confirmed" ? ne(emailSuppressionsTable.reason, "verify_cap") : undefined,
        ),
        and(
          eq(emailSuppressionsTable.addressHmac, addressFingerprint("all", address)),
          eq(emailSuppressionsTable.scope, "all"),
          inArray(emailSuppressionsTable.reason, ["bounce", "complaint", "unsubscribe"]),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** The acknowledgement and the outcome go only to an address its holder confirmed (F7b). */
export async function isReportConfirmed(address: string): Promise<boolean> {
  const rows = await db
    .select({ id: emailContactsTable.id })
    .from(emailContactsTable)
    .where(
      and(
        eq(emailContactsTable.purpose, "report"),
        eq(emailContactsTable.addressHmac, addressFingerprint("report", address)),
        eq(emailContactsTable.status, "confirmed"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export function reportSendDeps(mail: "public_verify" | "report_ack" | "report_outcome") {
  return {
    isSuppressed: (address: string) => isReportSuppressed(address, mail === "public_verify" ? "verify" : "confirmed"),
    isVerified: isReportConfirmed,
  };
}

/**
 * SYC-53 PR 1.1: the people emails (an invitation, an access-change notice)
 * are refused to an address that bounced, complained or asked never to be
 * emailed: the suppressions that block every purpose.
 */
export async function isSuppressedEverywhere(address: string): Promise<boolean> {
  const rows = await db
    .select({ id: emailSuppressionsTable.id })
    .from(emailSuppressionsTable)
    .where(
      and(
        eq(emailSuppressionsTable.addressHmac, addressFingerprint("all", address)),
        eq(emailSuppressionsTable.scope, "all"),
        inArray(emailSuppressionsTable.reason, ["bounce", "complaint", "unsubscribe"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
