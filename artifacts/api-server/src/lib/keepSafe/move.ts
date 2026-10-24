import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { hashToken } from "./tokens";
import { DELETED_BY_THE_PERSON, severPerson } from "../severPerson";

/**
 * Pressing the button: moving a spotter to **the phone that presses it**
 * (SYC-3 plan, "How moving a spotter works", Slice 1 step 6, and Decision 12,
 * which replaced Decision 2's "only the phone that asked" on 12 Oct 2026).
 *
 * **Nothing is copied or re-keyed.** The phone takes over the spotter's device
 * id, and the server replaces the secret fingerprint that id accepts with the
 * fingerprint of the phone's own secret. In one transaction:
 *
 * 1. the token is checked: it exists, is a restore token, is unexpired and
 *    unused. Any phone that opens it may press (Decision 12): the spots go to
 *    the caller, never to the phone that asked;
 * 2. the chosen spotter really is kept safe by that token's address, and is
 *    confirmed (a username, or any other public value, is never enough);
 * 3. the calling phone has no username, or it said `abandonCurrent` after the
 *    warning screen (Decision 7);
 * 4. the token is spent with a conditional write only one server can win;
 * 5. the spotter's `device_credentials.secret_hash` is changed with an
 *    UPDATE, **never a delete and an insert**: in that gap a request carrying
 *    the id would be bound as "first use" (deviceAuth.ts);
 * 6. the replaced fingerprint is recorded on the token, so the old phone can
 *    be told `device_moved`;
 * 7. the spotter's push token goes, so the old phone stops getting
 *    notifications;
 * 8. the calling phone's own (starter or abandoned) credential is retired
 *    with a value no secret can match, never deleted (review A6), and its
 *    push token goes. Whatever that id owns stays under it, untouched.
 *    **Or**, when the person chose "Delete Nikos" (`deleteCurrent`, SYC-266,
 *    Samuel 10 Oct 2026), the abandoned spotter is deleted exactly as "Delete
 *    my data" would (SYC-63 `severPerson`), in this same transaction. If the
 *    abandoned id also asked for this link, `severKeepSafe` swaps it on the
 *    spent link for its one-way `deleted:` key rather than deleting the link,
 *    so the old phone's `device_moved` and the 60-second replay still work,
 *    without keeping the raw id.
 *
 * A deleted spotter (SYC-63) has no credential row under its id, so step 5
 * finds nothing and the whole thing rolls back.
 */

/** Not hex, so it can never equal a secret's sha256 (deviceAuth.hashesMatch). */
export const RETIRED_SECRET_HASH = "retired";

export const SAME_ANSWER_SECONDS = 60;

export type MoveRefusal = { ok: false; reason: string };
export type MoveResult = { ok: true; deviceId: string; username: string | null } | MoveRefusal;

type TokenRow = {
  purpose: string;
  device_id: string;
  address_hmac: string;
  expired: boolean;
  used_at: Date | null;
  used_seconds_ago: number | null;
  restored_device_id: string | null;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The restore row for whatever secret the client holds: the link's token, or
 * the handle `POST /api/restore/code` swapped a right code for (SYC-664). A
 * handle is token-shaped and link-equivalent, so every site that finds the
 * row from the client's secret (peek, the spend, the replaced-secret write
 * and the 60-second replay) must use this, or a handle works in one place and
 * not the next. `handle_hash` is null on rows without one, and `= h` never
 * matches null. Only the latest handle for a row matches (it's overwritten).
 *
 * Bare column names: callers that alias the table must not join another
 * table that has `token_hash` or `handle_hash`.
 */
function rowIs(raw: string) {
  const h = hashToken(raw);
  return sql`(token_hash = ${h} or handle_hash = ${h})`;
}

async function readToken(tx: Tx | typeof db, raw: string): Promise<TokenRow | undefined> {
  const result = await tx.execute(sql`
    select purpose, device_id, address_hmac, used_at, restored_device_id,
           expires_at <= now() as expired,
           extract(epoch from now() - used_at)::float as used_seconds_ago
      from mail_tokens where ${rowIs(raw)}
  `);
  return result.rows[0] as TokenRow | undefined;
}

/** The spotters kept safe by this address, for the picker (Decision 3). */
async function keptSafeBy(tx: Tx | typeof db, hmac: string) {
  const result = await tx.execute(sql`
    select c.device_id, p.username
      from email_contacts c
      left join profiles p on p.device_id = c.device_id
     where c.purpose = 'keep_safe' and c.address_hmac = ${hmac} and c.status = 'confirmed'
     order by c.confirmed_at, c.id
  `);
  return result.rows as { device_id: string; username: string | null }[];
}

/**
 * An opaque id for one spotter on one link's picker (Decision 12, review
 * finding 9): more people can open a page that peeks now, so the page never
 * learns a spotter's device id. Stable for a token, meaningless without it.
 */
export function choiceId(raw: string, spotterDeviceId: string): string {
  return createHash("sha256").update(`choice:${hashToken(raw)}:${spotterDeviceId}`).digest("hex").slice(0, 24);
}

export type PeekResult =
  | {
      ok: true;
      spotters: { choice: string; username: string | null }[];
      /** False when another phone or browser opened the link (Decision 12): the page asks first. */
      openedOnAskingPhone: boolean;
      /** The caller already is the spotter this link would move: nothing to do. */
      alreadyHere: { username: string | null } | null;
    }
  | MoveRefusal;

/**
 * `POST /api/restore/peek`: the same checks as redeem, read-only. Lists the
 * spotters this link can move, by username and an opaque choice id.
 *
 * Decision 12 (Samuel, 11–12 Oct 2026): the link works on whichever phone
 * opens it, so peek no longer refuses another phone. It says whether this is
 * the phone that asked, so the page can ask "is this the app or browser … uses
 * for Cat Spotters?" first. It never changes what can move.
 */
export async function peekRestore(raw: string, callerDeviceId: string): Promise<PeekResult> {
  const token = await readToken(db, raw);
  if (!token) return { ok: false, reason: "no_such_token" };
  if (token.purpose !== "restore") return { ok: false, reason: "wrong_purpose" };
  if (token.expired) return { ok: false, reason: "expired" };
  if (token.used_at) return { ok: false, reason: "used" };
  const all = await keptSafeBy(db, token.address_hmac);
  if (!all.length) return { ok: false, reason: "nobody_kept_safe" };
  const others = all.filter((s) => s.device_id !== callerDeviceId);
  const openedOnAskingPhone = token.device_id === callerDeviceId;
  // "Already here" only when the list is empty because the caller IS the
  // spotter (review finding 10); an address keeping nobody safe is refused above.
  if (!others.length) {
    const me = all.find((s) => s.device_id === callerDeviceId)!;
    return { ok: true, spotters: [], openedOnAskingPhone, alreadyHere: { username: me.username } };
  }
  return {
    ok: true,
    spotters: others.map((s) => ({ choice: choiceId(raw, s.device_id), username: s.username })),
    openedOnAskingPhone,
    alreadyHere: null,
  };
}

/** Which spotter a picker answer means: an opaque choice, or (older pages) a device id. */
export type SpotterPick = { choice?: string; spotterDeviceId?: string };

function matchesPick(raw: string, deviceId: string, pick: SpotterPick): boolean {
  if (pick.choice) return choiceId(raw, deviceId) === pick.choice;
  return Boolean(pick.spotterDeviceId) && pick.spotterDeviceId === deviceId;
}

/**
 * A double tap or a back button (plan step 6): the same phone, asking for the
 * same spotter, within 60 seconds of the move, gets the same answer, and
 * nothing moves twice.
 *
 * By then the phone's starter id is retired (or deleted), so it can't pass the
 * ordinary device check. "The same phone" is proved by its secret alone: the
 * restored spotter's credential now holds exactly that secret's fingerprint,
 * which only the phone that pressed the button has (Decision 12: that may not
 * be the phone that asked). Anything else returns null and the request goes on
 * to the ordinary checks (and their refusal).
 */
export async function replayAfterMove(input: {
  raw: string;
  callerSecretHash: string;
  pick: SpotterPick;
}): Promise<MoveResult | null> {
  const result = await db.execute(sql`
    select t.restored_device_id, p.username
      from mail_tokens t
      join device_credentials c on c.device_id = t.restored_device_id
      left join profiles p on p.device_id = t.restored_device_id
     where ${rowIs(input.raw)}
       and t.purpose = 'restore'
       and t.used_at > now() - make_interval(secs => ${SAME_ANSWER_SECONDS})
       and c.secret_hash = ${input.callerSecretHash}
  `);
  const row = result.rows[0] as { restored_device_id: string; username: string | null } | undefined;
  if (!row || !matchesPick(input.raw, row.restored_device_id, input.pick)) return null;
  return { ok: true, deviceId: row.restored_device_id, username: row.username };
}

let moveHook: (() => Promise<void>) | null = null;

/** Tests only (plan test 5): runs right after the credential is rewritten, inside the transaction. */
export function __setMoveHookForTest(hook: (() => Promise<void>) | null): void {
  if (process.env["NODE_ENV"] !== "test") throw new Error("test only");
  moveHook = hook;
}

class Refused extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * `POST /api/restore/redeem`. `callerSecretHash` is the sha256 of the calling
 * phone's secret, already checked against `callerDeviceId` by deviceAuth.
 */
export async function redeemRestore(input: {
  raw: string;
  callerDeviceId: string;
  callerSecretHash: string;
  pick: SpotterPick;
  abandonCurrent: boolean;
  /** SYC-266: delete the spotter being left behind. Only with `abandonCurrent`. */
  deleteCurrent?: boolean;
  ipHash: string;
}): Promise<MoveResult> {
  const { raw, callerDeviceId } = input;
  if (!input.pick.choice && !input.pick.spotterDeviceId) return { ok: false, reason: "bad_spotter" };
  if (input.deleteCurrent && !input.abandonCurrent) return { ok: false, reason: "delete_without_abandon" };
  try {
    return await db.transaction(async (tx) => {
      // Lock the calling phone's credential first: two links redeemed by one
      // phone at the same moment queue up, and the second finds it retired
      // (review of #106).
      const [self] = (
        await tx.execute(sql`select secret_hash from device_credentials where device_id = ${callerDeviceId} for update`)
      ).rows as { secret_hash: string }[];
      if (!self || self.secret_hash !== input.callerSecretHash) throw new Refused("caller_changed");
      const token = await readToken(tx, raw);
      if (!token) throw new Refused("no_such_token");
      if (token.purpose !== "restore") throw new Refused("wrong_purpose");
      // Decision 12: any phone that opens the link may press the button; the
      // spots go to the phone that presses it, never to the phone that asked.
      // The same holds for a handle (SYC-664): it is a link-equivalent secret
      // that only the asking phone was given, so another phone presenting it
      // is treated exactly like another phone opening the link.

      const chosen = (await keptSafeBy(tx, token.address_hmac)).find((s) => matchesPick(raw, s.device_id, input.pick));
      if (!chosen) throw new Refused("spotter_not_kept_safe_by_this_address");
      const spotterDeviceId = chosen.device_id;
      if (spotterDeviceId === callerDeviceId) throw new Refused("already_here");

      // The conditional write: only one request can spend the token.
      const spent = await tx.execute(sql`
        update mail_tokens
           set used_at = now(), restored_device_id = ${spotterDeviceId}, attempt_ip_hash = ${input.ipHash}
         where ${rowIs(raw)} and purpose = 'restore'
           and used_at is null and expires_at > now()
        returning token_hash
      `);
      // A token already spent (or spent by a request racing this one) is
      // refused here; the same phone's own retry is answered by
      // `replayAfterMove`, before the device check, because by then its
      // starter id is retired.
      if (!spent.rows.length) throw new Refused(token.used_at ? "used" : "expired");

      const [caller] = (
        await tx.execute(sql`select username from profiles where device_id = ${callerDeviceId}`)
      ).rows as { username: string | null }[];
      if (caller?.username && !input.abandonCurrent) throw new Refused("caller_has_a_spotter");

      // The move: lock the spotter's credential, then rewrite it in place.
      const [old] = (
        await tx.execute(sql`
          select secret_hash from device_credentials where device_id = ${spotterDeviceId} for update
        `)
      ).rows as { secret_hash: string }[];
      if (!old) throw new Refused("spotter_has_no_credential");
      await tx.execute(sql`
        update device_credentials set secret_hash = ${input.callerSecretHash}
         where device_id = ${spotterDeviceId}
      `);
      if (moveHook) await moveHook();
      await tx.execute(sql`
        update mail_tokens set replaced_secret_hash = ${old.secret_hash} where ${rowIs(raw)}
      `);
      await tx.execute(sql`delete from push_tokens where device_id = ${spotterDeviceId}`);

      if (input.deleteCurrent) {
        // "Delete Nikos". If Nikos also asked for this link, the deletion keeps
        // the spent link by swapping Nikos's id on it for the one-way key
        // (severKeepSafe), so the old phone is still told device_moved.
        // Its credential becomes the `deleted:` marker, so the id answers 410
        // for ever and can't be re-bound on first use either.
        await severPerson(tx, { deviceId: callerDeviceId, reason: DELETED_BY_THE_PERSON });
        return { ok: true as const, deviceId: spotterDeviceId, username: chosen.username };
      }

      // Retire the calling phone's own id: never deleted, so it can't be re-bound on first use.
      const retired = await tx.execute(sql`
        update device_credentials set secret_hash = ${RETIRED_SECRET_HASH}
         where device_id = ${callerDeviceId}
        returning device_id
      `);
      if (!retired.rows.length) throw new Refused("caller_has_no_credential");
      await tx.execute(sql`delete from push_tokens where device_id = ${callerDeviceId}`);

      return { ok: true as const, deviceId: spotterDeviceId, username: chosen.username };
    });
  } catch (err) {
    if (err instanceof Refused) return { ok: false, reason: err.reason };
    throw err;
  }
}
