/**
 * The safety-check rules every saved list shares (SYC-170 PR 1.2; spec §9.5,
 * D11). Written once and used by the cat-report queue (lib/reportQueue.ts) and
 * the "Report an issue" queue (lib/issueQueue.ts, SYC-44 PR 6.2), so the two
 * can never drift apart:
 *
 * - **a fresh token for every send**, never reused and never stored;
 * - **a 428 is "run the check again", never a refusal**: no strike. The first
 *   428 after a send that carried a token gets one fresh check and an
 *   immediate resend; after that the item backs off (BACKOFF_428_MS);
 * - **ChallengeUnavailable** (the check couldn't run or finish) keeps the item
 *   saved, with no strike, and remembers an unanswered tap so the sheet isn't
 *   asked for again for a few minutes.
 *
 * Framework-free so the rules are unit-testable.
 */
import { isChallengeUnavailable } from './challengeUnavailable';

/** What a saved item remembers about its last safety check. Never the token. */
export interface CheckFields {
  /** The last try couldn't run or pass the check: still saved, tried again, no strike. */
  checkUnavailable?: boolean;
  /** When someone was asked to tap for this item's check and didn't. */
  checkDeclinedAt?: string;
  /** Consecutive passes that ended in a 428. */
  checks428?: number;
  /** Backing off after a 428 until then. */
  nextTryAt?: string;
  /** The last 428 followed a tokenless send because Cloudflare's script failed to load. */
  checkBlocked?: boolean;
}

/** After an unanswered tap, leave that item alone for a few minutes. */
export const CHECK_DECLINED_SKIP_MS = 3 * 60 * 1000;
/** Wait after the 1st, 2nd, 3rd... consecutive 428 on one item; the last repeats. */
export const BACKOFF_428_MS = [1, 5, 15, 30].map((m) => m * 60 * 1000);

export function statusOf(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}

/**
 * A refusal that won't change on retry (the server read the request and said
 * no). Busy, gated or unreachable servers are retried for ever.
 */
export function isPermanentRefusal(err: unknown): boolean {
  const s = statusOf(err);
  // 428 is "run the safety check again", never a refusal: no strike (SYC-170).
  return (
    s !== null && s >= 400 && s < 500 && s !== 401 && s !== 403 && s !== 408 && s !== 428 && s !== 429
  );
}

/** The check didn't pass this time: a 428, or ChallengeUnavailable. Never a strike. */
export function isCheckFailure(err: unknown): boolean {
  return isChallengeUnavailable(err) || statusOf(err) === 428;
}

/** Resting after an unanswered tap, or backing off after a 428. */
export function restingFromCheck(item: CheckFields, now: number): boolean {
  if (item.checkDeclinedAt && now - new Date(item.checkDeclinedAt).getTime() < CHECK_DECLINED_SKIP_MS) {
    return true;
  }
  return Boolean(item.nextTryAt && now < new Date(item.nextTryAt).getTime());
}

/** Whether the last send carried a token (read after a failure). */
export interface SendAttempt {
  sentToken: boolean;
}

/**
 * Send once with a fresh token. On a 428, if that send carried a token (so a
 * fresh one may well pass), run the check once more and resend straight away,
 * but only the first time round. With no token a resend can only meet the
 * same 428 and spend one of the connection's reports an hour, so it waits for
 * the back-off instead.
 */
export async function sendWithFreshCheck<R>(
  item: CheckFields,
  getToken: () => Promise<string | null>,
  send: (token: string | null) => Promise<R>,
  attempt: SendAttempt,
): Promise<R> {
  const once = async () => {
    // A fresh token for every send, never reused and never stored.
    const token = await getToken();
    attempt.sentToken = Boolean(token);
    return send(token);
  };
  try {
    return await once();
  } catch (first) {
    if (statusOf(first) !== 428 || !attempt.sentToken || (item.checks428 ?? 0) > 0) throw first;
    return once();
  }
}

/**
 * What a saved item becomes after a check failure (`isCheckFailure`): an
 * unanswered tap is remembered; a 428 backs off (1, 5, 15, 30 minutes, then
 * 30 again). Either way it stays saved, with no strike.
 */
export function afterCheckFailure<T extends CheckFields>(
  r: T,
  err: unknown,
  ctx: { now: number; sentToken: boolean; scriptBlocked?: () => boolean },
): T {
  if (isChallengeUnavailable(err)) {
    return {
      ...r,
      checkUnavailable: true,
      checkBlocked: undefined,
      checkDeclinedAt: new Date(ctx.now).toISOString(),
    };
  }
  const checks428 = (r.checks428 ?? 0) + 1;
  const wait = BACKOFF_428_MS[Math.min(checks428, BACKOFF_428_MS.length) - 1]!;
  return {
    ...r,
    checkUnavailable: true,
    // Only after a tokenless send that followed a failed script load.
    checkBlocked: !ctx.sentToken && Boolean(ctx.scriptBlocked?.()),
    checks428,
    nextTryAt: new Date(ctx.now + wait).toISOString(),
  };
}

/** The check passed and the server has the item: forget every check field. */
export function clearCheck<T extends CheckFields>(r: T): T {
  return {
    ...r,
    checkUnavailable: undefined,
    checkDeclinedAt: undefined,
    checks428: undefined,
    nextTryAt: undefined,
    checkBlocked: undefined,
  };
}

/** What the screen may say about an item's check: 'blocked', 'check', or nothing. */
export function checkMessage(item: CheckFields | undefined): 'check' | 'blocked' | null {
  if (!item?.checkUnavailable) return null;
  return item.checkBlocked ? 'blocked' : 'check';
}

/** "Send everything now": forget every wait. */
export function clearCheckWaits<T extends CheckFields>(list: T[]): T[] {
  if (!list.some((r) => r.checkDeclinedAt || r.nextTryAt)) return list;
  return list.map((r) => ({ ...r, checkDeclinedAt: undefined, nextTryAt: undefined }));
}
