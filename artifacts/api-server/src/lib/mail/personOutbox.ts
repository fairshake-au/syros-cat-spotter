import {
  colonyNames,
  db,
  inviteRecipient,
  mailOutboxTable,
  managerRecipient,
  managersToNotify,
  peopleNames,
  recordInviteDelivered,
  type MailOutboxRow,
  type PeopleExec,
  type PeopleTx,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../logger";
import { hashRecipient, sendMail, type PersonMailLookups, type SendDeps } from "./send";
import { isSuppressedEverywhere } from "./suppression";
import { isAccessChange, type AccessChange } from "./personTemplates";

// SYC-53 PR 1.1: the people emails in the outbox (plan PR 1.1; review M9).
// Kept in its own file, reached from outbox.ts's processRow by one branch,
// so other work on the outbox (SYC-44) rebases cleanly.
//
// **Queued by person id, never by address.** A row's payload holds ids and
// role names only; `recipient_hash` is the keyed fingerprint of the address
// as it was when the row was queued. The rows are written in the SAME
// transaction as the change they are about (the actions layer's hook), so a
// change can't happen without its email, and a refused change queues none.
//
// **Re-checked at delivery**, in three steps (processPersonMail): a short
// transaction re-checks the recipient and commits; the provider is called
// with nothing held; a second short transaction records the delivery. For
// an invitation she must STILL be pending, unexpired (a resend excepted)
// and not anonymised, and the address must still be the one queued; for a
// notice, the recipient must still be a joined manager with management in
// force, and not the actor. Otherwise the row is cancelled (`failed`,
// `cancelled: …`) and nothing is sent. The in-flight window: a withdrawal
// or an acceptance that lands while the provider is being called can't stop
// that one email (it holds no secret), and step 3 then records nothing, so
// she is never shown as "Invited".

export const PERSON_OUTBOX_PURPOSES = ["person_invite", "access_change_notice"] as const;

type InvitePayload = {
  personId: string;
  /** `invite_sent` for the first message, `invite_resent` after a resend. */
  kind: "invite_sent" | "invite_resent";
  /** Who asked for it: a person id, or `system:…`. Written on the event. */
  by: string;
};

type NoticePayload = {
  recipientId: string;
  actorId: string;
  subjectId: string;
  change: AccessChange;
};

/** The lookups sendMail uses for people mail, on a transaction or the db. */
export function personMailLookups(exec: PeopleExec, opts: { resend?: boolean } = {}): PersonMailLookups {
  return {
    invitee: (personId) => inviteRecipient(exec, personId, { resend: opts.resend === true }),
    manager: (personId) => managerRecipient(exec, personId),
    names: (ids) => peopleNames(exec, ids),
    colonyNames: (ids) => colonyNames(exec, ids),
  };
}

/** Queue an invitation to this person, inside the change's transaction. */
export async function enqueuePersonInvite(
  tx: PeopleTx,
  invite: { personId: string; email: string; kind: InvitePayload["kind"]; by: string },
): Promise<number> {
  const payload: InvitePayload = { personId: invite.personId, kind: invite.kind, by: invite.by };
  const [row] = await tx
    .insert(mailOutboxTable)
    .values({
      purpose: "person_invite",
      recipientHash: hashRecipient(invite.email, "person_invite"),
      payload,
    })
    .returning({ id: mailOutboxTable.id });
  return row!.id;
}

/**
 * Queue one notice per other management member (joined, on the list,
 * management in force, never the actor), inside the change's transaction,
 * so the list is the one in force as the change commits.
 */
export async function enqueueAccessNotices(
  tx: PeopleTx,
  notice: { actorId: string; subjectId: string; change: AccessChange },
): Promise<number[]> {
  const recipients = await managersToNotify(tx, notice.actorId);
  const ids: number[] = [];
  for (const r of recipients) {
    const payload: NoticePayload = {
      recipientId: r.id,
      actorId: notice.actorId,
      subjectId: notice.subjectId,
      change: notice.change,
    };
    const [row] = await tx
      .insert(mailOutboxTable)
      .values({
        purpose: "access_change_notice",
        recipientHash: hashRecipient(r.email, "access_change_notice"),
        payload,
      })
      .returning({ id: mailOutboxTable.id });
    ids.push(row!.id);
  }
  return ids;
}

/** Reasons a people email won't get better by trying again. */
const FINAL: ReadonlySet<string> = new Set([
  "unknown_purpose",
  "purpose_disabled",
  "recipient_not_allowed",
  "bad_recipient",
  "recipient_check_missing",
  "not_pending",
  "not_a_manager",
  "suppressed",
  "unknown_template",
]);

const BACKOFF_MINUTES = [1, 5, 15, 60];

async function settle(
  tx: PeopleTx,
  row: MailOutboxRow,
  outcome:
    | { state: "sent"; providerMessageId: string }
    | { state: "failed"; error: string }
    | { state: "retry"; error: string },
): Promise<"sent" | "retry" | "failed"> {
  if (outcome.state === "sent") {
    await tx
      .update(mailOutboxTable)
      .set({ state: "sent", sentAt: sql`now()`, providerMessageId: outcome.providerMessageId, lastError: null })
      .where(eq(mailOutboxTable.id, row.id));
    return "sent";
  }
  if (outcome.state === "failed") {
    await tx
      .update(mailOutboxTable)
      .set({ state: "failed", lastError: outcome.error.slice(0, 500) })
      .where(eq(mailOutboxTable.id, row.id));
    logger.warn({ outboxId: row.id, purpose: row.purpose, error: outcome.error }, "mail outbox: people email not sent");
    return "failed";
  }
  const minutes = BACKOFF_MINUTES[Math.max(0, row.attempts - 1)] ?? 60;
  await tx
    .update(mailOutboxTable)
    .set({
      state: "queued",
      lastError: outcome.error.slice(0, 500),
      nextAttemptAt: sql`now() + make_interval(mins => ${minutes})`,
    })
    .where(eq(mailOutboxTable.id, row.id));
  logger.error(
    { outboxId: row.id, purpose: row.purpose, attempts: row.attempts, retryInMinutes: minutes, error: outcome.error.slice(0, 200) },
    "mail outbox: people email failed; will retry",
  );
  return "retry";
}

/**
 * The lookups for one row's send, outside any transaction, refusing an
 * address that is no longer the one the row was queued for.
 */
function lookupsFor(row: MailOutboxRow): PersonMailLookups {
  const base = personMailLookups(db, { resend: isResend(row) });
  const sameAddress = <T extends { email: string } | null>(found: T): T | null =>
    found && hashRecipient(found.email, row.purpose as "person_invite" | "access_change_notice") === row.recipientHash
      ? found
      : null;
  return {
    ...base,
    invitee: async (personId) => sameAddress(await base.invitee(personId)),
    manager: async (personId) => sameAddress(await base.manager(personId)),
  };
}

/** A resend may reopen an Expired invitation when, and only when, it is delivered. */
const isResend = (row: MailOutboxRow) =>
  row.purpose === "person_invite" && (row.payload as Partial<InvitePayload> | null)?.kind === "invite_resent";

const errorOf = (r: { reason: string; detail?: string }) => `${r.reason}${r.detail ? `: ${r.detail}` : ""}`;

/**
 * Sends one claimed people row, re-checking its recipient first.
 *
 * In three steps, and never holding a transaction, a row lock or a pool
 * connection while the provider is called (review M-2: a send can take up
 * to Resend's 10-second timeout, and the suppression check needs its own
 * connection, so holding one per send wedged the pool under load):
 *
 * 1. A short transaction re-checks, under the invitee's row lock, that she
 *    is still pending, unexpired, not anonymised and at the queued address
 *    (for a notice: that the recipient is still a manager there), then
 *    commits. Anything else cancels the row and sends nothing.
 * 2. The send, with nothing held. sendMail looks her up once more (outside
 *    the lock) and refuses if she is no longer pending or has moved.
 * 3. A second short transaction records the delivery (`invite_sent_at`, a
 *    fresh expiry, `invite_sent` / `invite_resent`), guarded on her still
 *    being pending, and marks the row sent.
 *
 * The trade-off: a withdrawal (or acceptance) that lands during the few
 * seconds of step 2 can no longer stop that one email. It holds no secret
 * and no link, the hand-off and the allow-list ask findInvitee, which
 * refuses her, and step 3 records nothing for her, so she is never shown as
 * "Invited". That beats letting one slow provider call hold up management's
 * withdraw button and every other drain.
 */
export async function processPersonMail(row: MailOutboxRow): Promise<"sent" | "retry" | "failed"> {
  const key = `${row.purpose}-${row.id}-${row.createdAt.getTime()}`;
  const deps: SendDeps = { people: lookupsFor(row), isSuppressed: isSuppressedEverywhere };
  if (row.purpose === "person_invite") {
    const p = (row.payload ?? {}) as Partial<InvitePayload>;
    if (typeof p.personId !== "string" || (p.kind !== "invite_sent" && p.kind !== "invite_resent")) {
      return db.transaction((tx) => settle(tx, row, { state: "failed", error: "cancelled: bad_payload" }));
    }
    const personId = p.personId;
    // Step 1: the delivery-time re-check, then commit. FOR UPDATE stays on
    // purpose: it is held only for this short check, but it makes the check
    // wait for a withdrawal or acceptance that is committing right now and
    // read its result, rather than the row as it was a moment before.
    const cancelled = await db.transaction(async (tx) => {
      const now = await inviteRecipient(tx, personId, { lock: true, resend: isResend(row) });
      if (!now) return settle(tx, row, { state: "failed", error: "cancelled: no_longer_pending" });
      if (hashRecipient(now.email, "person_invite") !== row.recipientHash) {
        return settle(tx, row, { state: "failed", error: "cancelled: address_changed" });
      }
      return null;
    });
    if (cancelled) return cancelled;
    // Step 2: the send, nothing held.
    const result = await sendMail({ purpose: "person_invite", personId, idempotencyKey: key }, deps);
    // Step 3: record it, guarded.
    return db.transaction(async (tx) => {
      if (!result.ok) {
        return settle(tx, row, { state: FINAL.has(result.reason) ? "failed" : "retry", error: errorOf(result) });
      }
      // Only now is she "Invited", and only if she still is pending: a
      // failed send stays "Not sent yet", and one withdrawn mid-send is
      // recorded as nothing.
      const recorded = await recordInviteDelivered(tx, personId, p.kind!, typeof p.by === "string" ? p.by : "system:outbox");
      if (!recorded) logger.warn({ outboxId: row.id }, "mail outbox: invitation delivered, but she was no longer pending; not recorded as sent");
      return settle(tx, row, { state: "sent", providerMessageId: result.providerMessageId });
    });
  }
  const n = (row.payload ?? {}) as Partial<NoticePayload>;
  if (
    typeof n.recipientId !== "string" ||
    typeof n.actorId !== "string" ||
    typeof n.subjectId !== "string" ||
    !isAccessChange(n.change)
  ) {
    return db.transaction((tx) => settle(tx, row, { state: "failed", error: "cancelled: bad_payload" }));
  }
  const recipientId = n.recipientId;
  const cancelled = await db.transaction(async (tx) => {
    const manager = recipientId === n.actorId ? null : await managerRecipient(tx, recipientId);
    if (!manager) return settle(tx, row, { state: "failed", error: "cancelled: not_a_manager" });
    if (hashRecipient(manager.email, "access_change_notice") !== row.recipientHash) {
      return settle(tx, row, { state: "failed", error: "cancelled: address_changed" });
    }
    return null;
  });
  if (cancelled) return cancelled;
  const result = await sendMail(
    {
      purpose: "access_change_notice",
      recipientId,
      actorId: n.actorId,
      subjectId: n.subjectId,
      change: n.change,
      idempotencyKey: key,
    },
    deps,
  );
  return db.transaction((tx) =>
    result.ok
      ? settle(tx, row, { state: "sent", providerMessageId: result.providerMessageId })
      : settle(tx, row, { state: FINAL.has(result.reason) ? "failed" : "retry", error: errorOf(result) }),
  );
}
