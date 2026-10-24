import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { codeHash, hashToken, newToken, RESTORE_CODE_TRIES } from "./tokens";

/**
 * The one place a restore code is checked (SYC-664, spec "Technical notes"):
 * a right code, typed on the phone that asked, becomes a fresh 256-bit handle
 * stored as `handle_hash` on the same `mail_tokens` row. From then on the app
 * uses peek and redeem with the handle; they never see codes.
 *
 * The try is counted BEFORE the comparison, by one conditional UPDATE that
 * locks the rows it touches: with twenty attempts at once, each waits for the
 * one before to commit and then re-reads `code_attempts < 5`, so a row is
 * compared at most five times, ever.
 */

export type CodeRow = { token_hash: string; code_hash: string | null; code_attempts: number };

/** Does `code` belong to this row? Constant time. */
function codeMatches(row: CodeRow, code: string): boolean {
  if (!row.code_hash) return false;
  const want = Buffer.from(row.code_hash, "utf8");
  const got = Buffer.from(codeHash(row.token_hash, code), "utf8");
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * Called through this object (never directly), so a test can count every
 * comparison with `vi.spyOn(codeCheck, "matches")`.
 */
export const codeCheck = { matches: codeMatches };

let codeHook: (() => Promise<void>) | null = null;

/**
 * Tests only: runs inside the transaction (after BEGIN, so `now()` is
 * fixed), before the try is counted. The 20-at-once test holds transactions
 * here and lets them on in an order where a row's expiry can't stop the
 * waiting ones, so only `code_attempts < 5` can.
 */
export function __setCodeHookForTest(hook: (() => Promise<void>) | null): void {
  if (process.env["NODE_ENV"] !== "test") throw new Error("test only");
  codeHook = hook;
}

export type ExchangeResult =
  | { ok: true; handle: string; tokenLogId: string }
  | { ok: false; live: number; attempts: number[] };

/**
 * Swap a code for a handle. The caller has proved the phone (device secret)
 * and checked the code's shape. `{ ok: false }` covers every refusal alike:
 * the route answers them all with the same body in the same time. The
 * refusal carries counts only, for the log, never the digits.
 */
export async function exchangeCode(input: { callerDeviceId: string; code: string }): Promise<ExchangeResult> {
  return db.transaction(async (tx) => {
    if (codeHook) await codeHook();
    // 1. Count a try against every live, code-bearing row of this phone (it
    //    can't tell which one the person meant), atomically, before comparing.
    const counted = await tx.execute(sql`
      update mail_tokens set code_attempts = code_attempts + 1
       where purpose = 'restore' and device_id = ${input.callerDeviceId}
         and used_at is null and expires_at > now()
         and code_hash is not null
         and code_attempts < ${RESTORE_CODE_TRIES}
      returning token_hash, code_hash, code_attempts
    `);
    const rows = counted.rows as CodeRow[];

    // 2. Compare against only the rows just counted.
    const match = rows.find((row) => codeCheck.matches(row, input.code));

    // 4. Any other row now at its limit dies: its code and its link end together.
    const spent = rows
      .filter((row) => row !== match && row.code_attempts >= RESTORE_CODE_TRIES)
      .map((row) => row.token_hash);
    if (spent.length) {
      await tx.execute(sql`
        update mail_tokens set expires_at = now()
         where token_hash in (${sql.join(
           spent.map((h) => sql`${h}`),
           sql`, `,
         )})
      `);
    }

    if (!match) return { ok: false, live: rows.length, attempts: rows.map((r) => Number(r.code_attempts)) };

    // 3. A right code: undo its try and give the row a handle.
    const handle = newToken();
    await tx.execute(sql`
      update mail_tokens
         set code_attempts = code_attempts - 1, handle_hash = ${hashToken(handle)}
       where token_hash = ${match.token_hash}
    `);
    return { ok: true, handle, tokenLogId: match.token_hash.slice(0, 10) };
  });
}
