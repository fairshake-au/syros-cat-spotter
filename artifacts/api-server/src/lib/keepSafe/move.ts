import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { hashToken } from "./tokens";

/**
 * Pressing the button: moving a spotter to the phone that asked (SYC-3 plan,
 * "How moving a spotter works" and Slice 1 step 6).
 *
 * **Nothing is copied or re-keyed.** The phone takes over the spotter's device
 * id, and the server replaces the secret fingerprint that id accepts with the
 * fingerprint of the phone's own secret. In one transaction:
 *
 * 1. the token is checked: it exists, is a restore token, is unexpired and
 *    unused, **and was asked for by the phone that is calling** (Decision 2);
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

async function readToken(tx: Tx | typeof db, raw: string): Promise<TokenRow | undefined> {
  const result = await tx.execute(sql`
    select purpose, device_id, address_hmac, used_at, restored_device_id,
           expires_at <= now() as expired,
           extract(epoch from now() - used_at)::float as used_seconds_ago
      from mail_tokens where token_hash = ${hashToken(raw)}
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
 * `POST /api/restore/peek`: the same checks as redeem, read-only. Lists the
 * spotters this link can move, by username. Only the phone that asked, with
 * a live link, ever sees the list.
 */
export async function peekRestore(
  raw: string,
  callerDeviceId: string,
): Promise<{ ok: true; spotters: { deviceId: string; username: string | null }[] } | MoveRefusal> {
  const token = await readToken(db, raw);
  if (!token) return { ok: false, reason: "no_such_token" };
  if (token.purpose !== "restore") return { ok: false, reason: "wrong_purpose" };
  if (token.expired) return { ok: false, reason: "expired" };
  if (token.used_at) return { ok: false, reason: "used" };
  if (token.device_id !== callerDeviceId) return { ok: false, reason: "not_the_asking_phone" };
  const spotters = (await keptSafeBy(db, token.address_hmac)).filter((s) => s.device_id !== callerDeviceId);
  if (!spotters.length) return { ok: false, reason: "nobody_kept_safe" };
  return { ok: true, spotters: spotters.map((s) => ({ deviceId: s.device_id, username: s.username })) };
}

/**
 * A double tap or a back button (plan step 6): the same phone, asking for the
 * same spotter, within 60 seconds of the move, gets the same answer, and
 * nothing moves twice.
 *
 * By then the phone's starter id is retired, so it can't pass the ordinary
 * device check. "The same phone" is proved instead by its secret: the
 * restored spotter's credential now holds exactly that secret's fingerprint,
 * and the token says this starter id asked for it. Anything else returns null
 * and the request goes on to the ordinary checks (and their refusal).
 */
export async function replayAfterMove(input: {
  raw: string;
  callerDeviceId: string;
  callerSecretHash: string;
  spotterDeviceId: string;
}): Promise<MoveResult | null> {
  const result = await db.execute(sql`
    select p.username
      from mail_tokens t
      join device_credentials c on c.device_id = t.restored_device_id
      left join profiles p on p.device_id = t.restored_device_id
     where t.token_hash = ${hashToken(input.raw)}
       and t.purpose = 'restore'
       and t.device_id = ${input.callerDeviceId}
       and t.restored_device_id = ${input.spotterDeviceId}
       and t.used_at > now() - make_interval(secs => ${SAME_ANSWER_SECONDS})
       and c.secret_hash = ${input.callerSecretHash}
  `);
  const row = result.rows[0] as { username: string | null } | undefined;
  if (!row) return null;
  return { ok: true, deviceId: input.spotterDeviceId, username: row.username };
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
  spotterDeviceId: string;
  abandonCurrent: boolean;
  ipHash: string;
}): Promise<MoveResult> {
  const { raw, callerDeviceId, spotterDeviceId } = input;
  if (!spotterDeviceId || spotterDeviceId === callerDeviceId) return { ok: false, reason: "bad_spotter" };
  try {
    return await db.transaction(async (tx) => {
      const token = await readToken(tx, raw);
      if (!token) throw new Refused("no_such_token");
      if (token.purpose !== "restore") throw new Refused("wrong_purpose");
      if (token.device_id !== callerDeviceId) throw new Refused("not_the_asking_phone");

      // The conditional write: only one request can spend the token.
      const spent = await tx.execute(sql`
        update mail_tokens
           set used_at = now(), restored_device_id = ${spotterDeviceId}, attempt_ip_hash = ${input.ipHash}
         where token_hash = ${hashToken(raw)} and purpose = 'restore'
           and used_at is null and expires_at > now()
        returning token_hash
      `);
      // A token already spent (or spent by a request racing this one) is
      // refused here; the same phone's own retry is answered by
      // `replayAfterMove`, before the device check, because by then its
      // starter id is retired.
      if (!spent.rows.length) throw new Refused(token.used_at ? "used" : "expired");

      const chosen = (await keptSafeBy(tx, token.address_hmac)).find((s) => s.device_id === spotterDeviceId);
      if (!chosen) throw new Refused("spotter_not_kept_safe_by_this_address");

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
        update mail_tokens set replaced_secret_hash = ${old.secret_hash} where token_hash = ${hashToken(raw)}
      `);
      await tx.execute(sql`delete from push_tokens where device_id = ${spotterDeviceId}`);

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
