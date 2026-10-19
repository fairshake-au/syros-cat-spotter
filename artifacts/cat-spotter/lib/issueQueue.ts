/**
 * The "Report an issue" saved list (SYC-44 PR 6.2; spec report-an-issue.md
 * §4.1, §4.2, §9.5; plan PR 6.2).
 *
 * A report is SAVED FIRST, on this phone (or in this browser), then sent. It
 * uses the same generic store as cat reports and sightings
 * (lib/queueStore.ts: one write path, the cross-tab lock, an unreadable list
 * never overwritten) and the same safety-check rules as cat reports
 * (lib/checkedSend.ts: a fresh token for every send, a 428 never a strike,
 * ChallengeUnavailable keeps the report). There is no photo to upload, so a
 * report leaves the list the moment the server accepts it.
 *
 * **What the screen says is chosen from the server's `hidden`, never from the
 * reason** (`issueConfirmation`). Nothing is hidden until the server has the
 * report, so a report still on the phone is never called hidden.
 *
 * Framework-free so the rules are unit-testable.
 */
import type { QueueStore } from './queueStore';
import type { ChallengeAction } from './challengeUnavailable';
import {
  afterCheckFailure,
  checkMessage,
  clearCheckWaits,
  isCheckFailure,
  isPermanentRefusal,
  restingFromCheck,
  sendWithFreshCheck,
  statusOf,
  type CheckFields,
  type SendAttempt,
} from './checkedSend';
import { MAX_SERVER_FAILURES, newClientRef, type ReportLanguage } from './reportQueue';

/** The nine reasons (spec §2), as the server knows them. */
export type IssueReason =
  | 'photo_private'
  | 'photo_inappropriate'
  | 'photo_not_cat'
  | 'wrong_cat'
  | 'wrong_name'
  | 'wrong_info'
  | 'location_revealing'
  | 'cat_died'
  | 'other';

/** Offered on a cat's page (spec §3.1), in this order. */
export const CAT_REASONS: readonly IssueReason[] = [
  'wrong_name',
  'wrong_info',
  'location_revealing',
  'cat_died',
  'wrong_cat',
  'other',
];

/** Offered under a photo (spec §3.2): the photo reasons first, then `other`. */
export const PHOTO_REASONS: readonly IssueReason[] = [
  'photo_private',
  'photo_inappropriate',
  'photo_not_cat',
  'wrong_cat',
  'other',
];

/** The two reasons that can hide a photo on one confirmed report (D2). */
export const HIDING_REASONS: ReadonlySet<IssueReason> = new Set(['photo_private', 'photo_inappropriate']);

/**
 * The reasons that may name a photo. The server refuses a photo id with any
 * other reason (a 400), so `other` sent from a photo goes without it.
 */
const PHOTO_ID_REASONS: ReadonlySet<IssueReason> = new Set([
  'photo_private',
  'photo_inappropriate',
  'photo_not_cat',
  'wrong_cat',
]);

export function isHidingReason(reason: IssueReason): boolean {
  return HIDING_REASONS.has(reason);
}

const ALL_REASONS: ReadonlySet<string> = new Set([...CAT_REASONS, ...PHOTO_REASONS]);

export interface PendingIssue extends CheckFields {
  localId: string;
  /** Sent with the report, so a resend after a lost reply makes one report. */
  clientRef: string;
  createdAt: string;
  reason: IssueReason;
  catId: number;
  /** Only for a reason that may name a photo. */
  photoPublicId?: string;
  note: string;
  language: ReportLanguage;
  /** queued: not accepted yet. failed: the server refused it three times. */
  status: 'queued' | 'failed';
  serverFailures: number;
  /** When the one "hasn't sent yet" reminder was shown. */
  remindedAt?: string;
  /** Phone apps: the local notification scheduled for 24 hours on. */
  nativeReminderId?: string;
  /** The last try met a 429. */
  busy?: boolean;
}

export interface IssueBody {
  deviceId: string;
  clientRef: string;
  reason: IssueReason;
  catId: number;
  photoPublicId?: string;
  note?: string;
  language: ReportLanguage;
  /** Cloudflare Turnstile token, fresh for this send (action report_issue, cdata = clientRef). */
  turnstileToken?: string;
}

export interface IssueReply {
  publicId: string;
  hidden: boolean;
}

export interface IssueApi {
  submit(body: IssueBody): Promise<IssueReply>;
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `/api/photos/<publicId>` (built only by the server's publicPhotoUrl) → its public id. */
export function photoPublicIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /\/api\/photos\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function newPendingIssue(input: {
  reason: IssueReason;
  catId: number;
  photoPublicId?: string | null;
  note: string;
  language: ReportLanguage;
  now?: Date;
}): PendingIssue {
  const now = input.now ?? new Date();
  const photo = PHOTO_ID_REASONS.has(input.reason) ? input.photoPublicId ?? null : null;
  return {
    localId: `${now.getTime()}-${randomId()}`,
    clientRef: newClientRef(),
    createdAt: now.toISOString(),
    reason: input.reason,
    catId: input.catId,
    ...(photo ? { photoPublicId: photo } : {}),
    note: input.note,
    language: input.language,
    status: 'queued',
    serverFailures: 0,
  };
}

export function isPendingIssue(value: unknown): value is PendingIssue {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<PendingIssue>;
  return (
    typeof r.localId === 'string' &&
    typeof r.clientRef === 'string' &&
    typeof r.reason === 'string' &&
    ALL_REASONS.has(r.reason) &&
    typeof r.catId === 'number' &&
    (r.status === 'queued' || r.status === 'failed')
  );
}

function update(localId: string, patch: (r: PendingIssue) => PendingIssue) {
  return (list: PendingIssue[]) => {
    let changed = false;
    const next = list.map((r) => {
      if (r.localId !== localId) return r;
      changed = true;
      return patch(r);
    });
    return changed ? next : list;
  };
}

function removeItem(localId: string) {
  return (list: PendingIssue[]) => {
    const next = list.filter((r) => r.localId !== localId);
    return next.length === list.length ? list : next;
  };
}

export interface IssueSyncDeps {
  api: IssueApi;
  deviceId: string;
  /** A fresh Turnstile token for one send; rejects with ChallengeUnavailable. */
  getToken(action: ChallengeAction, cdata: string): Promise<string | null>;
  /** The server accepted the report: what it did (`hidden`). */
  onAccepted?: (localId: string, reply: IssueReply) => void;
  scriptBlocked?: () => boolean;
  now?: () => number;
}

/**
 * Send what's waiting, oldest first. A report whose check couldn't be done
 * is passed over, never allowed to stop the rest. Stops at the first network
 * failure (no signal: nothing else will get through either).
 */
export async function syncIssues(store: QueueStore<PendingIssue>, deps: IssueSyncDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  for (const snapshot of [...store.items()]) {
    // Re-read: another tab, or "Delete my data", may have taken it off the
    // list while an earlier one was sending (review finding 6).
    const item = store.items().find((r) => r.localId === snapshot.localId);
    if (!item || item.status !== 'queued' || restingFromCheck(item, now())) continue;
    const attempt: SendAttempt = { sentToken: false };
    try {
      const note = item.note.trim();
      const reply = await sendWithFreshCheck(
        item,
        () => deps.getToken('report_issue', item.clientRef),
        (token) =>
          deps.api.submit({
            deviceId: deps.deviceId,
            clientRef: item.clientRef,
            reason: item.reason,
            catId: item.catId,
            ...(item.photoPublicId ? { photoPublicId: item.photoPublicId } : {}),
            ...(note ? { note } : {}),
            language: item.language,
            ...(token ? { turnstileToken: token } : {}),
          }),
        attempt,
      );
      deps.onAccepted?.(item.localId, { publicId: reply.publicId, hidden: reply.hidden === true });
      // Nothing left to send: the report (and its note) leaves the phone.
      await store.mutate(removeItem(item.localId), 'system');
    } catch (err) {
      if (isCheckFailure(err)) {
        const at = now();
        await store
          .mutate(
            update(item.localId, (r) =>
              afterCheckFailure(r, err, { now: at, sentToken: attempt.sentToken, scriptBlocked: deps.scriptBlocked }),
            ),
            'system',
          )
          .catch(() => undefined);
        continue;
      }
      if (!isPermanentRefusal(err)) {
        const busy = statusOf(err) === 429;
        if (busy !== Boolean(item.busy) || item.checkUnavailable) {
          await store
            .mutate(update(item.localId, (r) => ({ ...r, busy, checkUnavailable: false, checkBlocked: undefined })), 'system')
            .catch(() => undefined);
        }
        if (statusOf(err) === null) return; // no signal
        continue;
      }
      await store
        .mutate(
          update(item.localId, (r) => {
            const serverFailures = r.serverFailures + 1;
            return {
              ...r,
              serverFailures,
              checkUnavailable: undefined,
              status: serverFailures >= MAX_SERVER_FAILURES ? 'failed' : r.status,
            };
          }),
          'system',
        )
        .catch(() => undefined);
    }
  }
}

/**
 * What the screen may say about one report (spec §4.1, §4.2).
 *
 * - hidden: the server said `hidden: true`. "The photo is hidden…"
 * - notHidden: the server said `hidden: false` on a reason that would hide.
 *   "…The photo is not hidden yet."
 * - died / thanks: any other reason, once the server has it.
 * - sending, queued, busy, check, blocked, failed: still on this phone. None
 *   of them ever says "hidden".
 *
 * A report that left the list without an answer here (another tab sent it)
 * gets the plain thank-you, which claims nothing about the photo.
 */
export type IssueConfirmation =
  | 'hidden'
  | 'notHidden'
  | 'thanks'
  | 'died'
  | 'sending'
  | 'queued'
  | 'busy'
  | 'check'
  | 'blocked'
  | 'failed';

export function issueConfirmation(
  localId: string,
  reason: IssueReason,
  items: readonly PendingIssue[],
  replies: ReadonlyMap<string, { hidden: boolean }>,
  syncing: boolean,
): IssueConfirmation {
  const reply = replies.get(localId);
  const plain = reason === 'cat_died' ? 'died' : 'thanks';
  if (reply) {
    // From the server's answer, never from the reason (spec §4.1; plan T6-5).
    if (reply.hidden) return 'hidden';
    return isHidingReason(reason) ? 'notHidden' : plain;
  }
  const item = items.find((r) => r.localId === localId);
  if (!item) return plain;
  if (item.status === 'failed') return 'failed';
  if (syncing) return 'sending';
  const check = checkMessage(item);
  if (check) return check;
  return item.busy ? 'busy' : 'queued';
}

/** "Send everything now" (delete-my-data): forget every wait. */
export function clearIssueWaits(list: PendingIssue[]): PendingIssue[] {
  return clearCheckWaits(list);
}
