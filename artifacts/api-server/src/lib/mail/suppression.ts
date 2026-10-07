import { db, emailContactsTable, emailSuppressionsTable } from "@workspace/db";
import { and, eq, inArray, ne, or } from "drizzle-orm";
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
 *   victim ever getting their spots back.
 */

export type KeepSafeMail = "keep_safe_verify" | "restore_link";

export async function isKeepSafeSuppressed(mail: KeepSafeMail, address: string): Promise<boolean> {
  const own = addressFingerprint("keep_safe", address);
  const all = addressFingerprint("all", address);
  const ownReasons =
    mail === "keep_safe_verify"
      ? undefined
      : ne(emailSuppressionsTable.reason, "verify_cap");
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
