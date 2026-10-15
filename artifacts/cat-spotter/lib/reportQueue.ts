/**
 * The cat-report queue (SYC-42 plan, Slice 1 items 1.11–1.13; spec §4.3).
 *
 * A report is SAVED FIRST, on this phone (or in this browser), then its text
 * is sent, then its photo. The text is small, so on a weak signal it gets
 * through even when the photo struggles; and the server writes the report
 * (and queues the alert to Syros Cats) as soon as the text arrives.
 *
 * It uses the same generic store as sightings (lib/queueStore.ts): one
 * serialised write path, the cross-tab lock, and a saved list that can't be
 * read is never overwritten. Retries are counted separately from sightings.
 *
 * "Sent" means the server accepted the text, and nothing else
 * (`confirmationState`). A report saved on the phone is never called sent.
 *
 * Framework-free so the ordering rules are unit-testable.
 */
import type { QueueStore } from './queueStore';
import { isChallengeUnavailable, type ChallengeAction } from './challengeUnavailable';

export type ReportSeverity = 'attention' | 'urgent';
export type ReportLanguage = 'en' | 'el' | 'fr';

export interface PendingReport {
  localId: string;
  /** Sent with the text, so a resend after a lost reply makes one report. */
  clientRef: string;
  createdAt: string;
  severity: ReportSeverity;
  isLitter: boolean;
  lat: number;
  lng: number;
  note: string;
  language: ReportLanguage;
  hasPhoto: boolean;
  /** Where the photo is kept (a file, or `idb:<id>` on the web). */
  photoRef?: string;
  /** A browser that can't keep photos outside the list keeps it inline. */
  photoBase64?: string;
  /**
   * queued: the text hasn't been accepted yet.
   * photo: the text is in (Syros Cats have the report); the photo is still to go.
   * failed: the server refused the text three times.
   */
  status: 'queued' | 'photo' | 'failed';
  publicId?: string;
  serverFailures: number;
  /** When the one "hasn't sent yet" reminder was shown (spec §4.3). */
  remindedAt?: string;
  /** Phone apps: the local notification scheduled for 24 hours on. */
  nativeReminderId?: string;
  /** The last try met a 429 (too many reports from this connection). */
  busy?: boolean;
  /**
   * The last try couldn't run the safety check (SYC-170): the report is still
   * saved and will be tried again, with no strike. The check's token itself is
   * never stored: it is single-use and fetched fresh for every send.
   */
  checkUnavailable?: boolean;
  /**
   * When someone was asked to tap for this report's check and didn't (SYC-170).
   * The report is skipped for CHECK_DECLINED_SKIP_MS, so the sheet doesn't pop
   * every minute. Never a strike.
   */
  checkDeclinedAt?: string;
  /**
   * Consecutive passes that ended in a 428 (SYC-170), and when to try again.
   * Each 428 costs one of the connection's ten reports an hour, so a report
   * the server keeps asking to re-check backs off (BACKOFF_428_MS). Never a strike.
   */
  checks428?: number;
  nextTryAt?: string;
  /**
   * The last 428 followed a tokenless send because Cloudflare's script failed
   * to load (likely a content blocker): the screen says what to allow.
   */
  checkBlocked?: boolean;
}

export interface SubmitBody {
  deviceId: string;
  clientRef: string;
  severity: ReportSeverity;
  isLitter: boolean;
  lat: number;
  lng: number;
  note: string | null;
  language: ReportLanguage;
  hasPhoto: boolean;
  /** Cloudflare Turnstile token, fresh for this send (SYC-170); absent on the phone apps until PR 1.3. */
  turnstileToken?: string;
}

export interface ReportApi {
  submit(body: SubmitBody): Promise<{ publicId: string }>;
  uploadPhoto(publicId: string, deviceId: string, photoBase64: string): Promise<void>;
}

export const MAX_SERVER_FAILURES = 3;
/** After an unanswered tap, leave that report alone for a few minutes. */
export const CHECK_DECLINED_SKIP_MS = 3 * 60 * 1000;
/** Wait after the 1st, 2nd, 3rd... consecutive 428 on one report; the last repeats. */
export const BACKOFF_428_MS = [1, 5, 15, 30].map((m) => m * 60 * 1000);
export const REMINDER_AFTER_MS = 24 * 60 * 60 * 1000;

function randomId(): string {
  const bytes = new Uint8Array(12);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The id a report carries from its draft to its submit, and across resends. */
export function newClientRef(): string {
  return `r-${randomId()}`;
}

export function newPendingReport(input: {
  severity: ReportSeverity;
  isLitter: boolean;
  lat: number;
  lng: number;
  note: string;
  language: ReportLanguage;
  hasPhoto: boolean;
  clientRef?: string;
  now?: Date;
}): PendingReport {
  const now = input.now ?? new Date();
  return {
    localId: `${now.getTime()}-${randomId().slice(0, 8)}`,
    clientRef: input.clientRef ?? newClientRef(),
    createdAt: now.toISOString(),
    severity: input.severity,
    isLitter: input.isLitter,
    lat: input.lat,
    lng: input.lng,
    note: input.note,
    language: input.language,
    hasPhoto: input.hasPhoto,
    status: 'queued',
    serverFailures: 0,
  };
}

/** The photo store key for a report's photo; the sighting sweep leaves `report-*` alone. */
export function reportPhotoKey(localId: string): string {
  return `report-${localId}`;
}

export function isPendingReport(value: unknown): value is PendingReport {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<PendingReport>;
  return (
    typeof r.localId === 'string' &&
    typeof r.clientRef === 'string' &&
    (r.severity === 'urgent' || r.severity === 'attention') &&
    typeof r.lat === 'number' &&
    typeof r.lng === 'number' &&
    (r.status === 'queued' || r.status === 'photo' || r.status === 'failed')
  );
}

function statusOf(err: unknown): number | null {
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

function update(localId: string, patch: (r: PendingReport) => PendingReport) {
  return (list: PendingReport[]) => {
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
  return (list: PendingReport[]) => {
    const next = list.filter((r) => r.localId !== localId);
    return next.length === list.length ? list : next;
  };
}

export interface SyncDeps {
  api: ReportApi;
  deviceId: string;
  readPhoto(ref: string): Promise<string | null>;
  deletePhoto(ref: string): Promise<void>;
  /**
   * A fresh Turnstile token for one send (SYC-170), or null where this build
   * can't run the check yet. Rejects with ChallengeUnavailable if the check
   * can't run or finish.
   */
  getToken(action: ChallengeAction, cdata: string): Promise<string | null>;
  /** Called the moment the server accepts a report's text. */
  onTextAccepted?: (localId: string) => void;
  /** Whether Cloudflare's script failed to load on the last try (a content blocker, likely). */
  scriptBlocked?: () => boolean;
  /** The clock, for the waits below (tests). */
  now?: () => number;
}

/**
 * Send what's waiting. Photos of reports the server already has go first
 * (nothing about someone else's safety check may hold them back), then each
 * waiting report's text and photo, oldest first. A report whose check
 * couldn't be done is passed over, never allowed to stop the rest. Stops at
 * the first network failure (no signal: nothing else will get through either).
 */
export async function syncReports(
  store: QueueStore<PendingReport>,
  deps: SyncDeps,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const all = [...store.items()];
  const ordered = [...all.filter((r) => r.status === 'photo'), ...all.filter((r) => r.status === 'queued')];
  for (const item of ordered) {
    let current = item;
    // Someone just declined to tap for this one: leave it for a few minutes.
    if (
      current.status === 'queued' &&
      current.checkDeclinedAt &&
      now() - new Date(current.checkDeclinedAt).getTime() < CHECK_DECLINED_SKIP_MS
    ) {
      continue;
    }
    // Backing off after a 428.
    if (current.status === 'queued' && current.nextTryAt && now() < new Date(current.nextTryAt).getTime()) {
      continue;
    }

    if (current.status === 'queued') {
      let sentToken = false;
      try {
        const sendText = async () => {
          // A fresh token for every send, never reused and never stored.
          const token = await deps.getToken('welfare_report', current.clientRef);
          sentToken = Boolean(token);
          return deps.api.submit({
            deviceId: deps.deviceId,
            clientRef: current.clientRef,
            severity: current.severity,
            isLitter: current.isLitter,
            lat: current.lat,
            lng: current.lng,
            note: current.note.trim() ? current.note.trim() : null,
            language: current.language,
            hasPhoto: current.hasPhoto,
            ...(token ? { turnstileToken: token } : {}),
          });
        };
        let accepted: { publicId: string };
        try {
          accepted = await sendText();
        } catch (first) {
          // 428: the check wasn't good. If the first send carried a token (so a
          // fresh one may well pass), run it once more and resend straight
          // away, but only the first time round. With no token a resend can
          // only meet the same 428 and spend one of the connection's ten
          // reports an hour, so it waits for the back-off instead.
          if (statusOf(first) !== 428 || !sentToken || (current.checks428 ?? 0) > 0) throw first;
          accepted = await sendText();
        }
        const { publicId } = accepted;
        deps.onTextAccepted?.(current.localId);
        if (!current.hasPhoto) {
          await store.mutate(removeItem(current.localId), 'system');
          continue;
        }
        current = { ...current, status: 'photo', publicId, serverFailures: 0 };
        await store.mutate(
          update(current.localId, (r) => ({
            ...r,
            status: 'photo',
            publicId,
            serverFailures: 0,
            checkUnavailable: undefined,
            checkDeclinedAt: undefined,
            checks428: undefined,
            nextTryAt: undefined,
            checkBlocked: undefined,
          })),
          'system',
        );
      } catch (err) {
        if (isChallengeUnavailable(err) || statusOf(err) === 428) {
          // The safety check didn't pass (a tap not made in time, or the
          // server still answers 428 after a resend, e.g. when no token could
          // be made): keep the report, no strike, and say so on the
          // confirmation, and move on to the rest. An unanswered tap is
          // remembered, so it isn't asked again for a few minutes.
          const declinedAt = isChallengeUnavailable(err) ? new Date(now()).toISOString() : undefined;
          await store
            .mutate(
              update(current.localId, (r) => {
                if (declinedAt) {
                  return { ...r, checkUnavailable: true, checkBlocked: undefined, checkDeclinedAt: declinedAt };
                }
                // A 428: back off (1, 5, 15, 30 minutes, then 30 again), no strike.
                const checks428 = (r.checks428 ?? 0) + 1;
                const wait = BACKOFF_428_MS[Math.min(checks428, BACKOFF_428_MS.length) - 1]!;
                return {
                  ...r,
                  checkUnavailable: true,
                  // Only after a tokenless send that followed a failed script load.
                  checkBlocked: !sentToken && Boolean(deps.scriptBlocked?.()),
                  checks428,
                  nextTryAt: new Date(now() + wait).toISOString(),
                };
              }),
              'system',
            )
            .catch(() => undefined);
          continue;
        }
        if (!isPermanentRefusal(err)) {
          // Remember a 429, so the screen says "too many just now", not "no signal".
          const busy = statusOf(err) === 429;
          if (busy !== Boolean(current.busy)) {
            await store
              .mutate(update(current.localId, (r) => ({ ...r, busy })), 'system')
              .catch(() => undefined);
          }
          if (current.checkUnavailable) {
            await store
              .mutate(update(current.localId, (r) => ({ ...r, checkUnavailable: false, checkBlocked: undefined })), 'system')
              .catch(() => undefined);
          }
          if (statusOf(err) === null) return; // no signal
          continue;
        }
        await store.mutate(
          update(current.localId, (r) => {
            const serverFailures = r.serverFailures + 1;
            return {
              ...r,
              serverFailures,
              checkUnavailable: undefined,
              status: serverFailures >= MAX_SERVER_FAILURES ? 'failed' : r.status,
            };
          }),
          'system',
        );
        continue;
      }
    }

    if (current.status === 'photo' && current.publicId) {
      const photo = current.photoBase64 ?? (current.photoRef ? await deps.readPhoto(current.photoRef) : null);
      const forget = async () => {
        if (current.photoRef) await deps.deletePhoto(current.photoRef).catch(() => undefined);
        await store.mutate(removeItem(current.localId), 'system');
      };
      if (!photo) {
        // The browser cleared it. The report itself already reached Syros Cats.
        await forget();
        continue;
      }
      try {
        await deps.api.uploadPhoto(current.publicId, deps.deviceId, photo);
        await forget();
      } catch (err) {
        if (!isPermanentRefusal(err)) {
          if (statusOf(err) === null) return;
          continue;
        }
        const failures = current.serverFailures + 1;
        if (failures >= MAX_SERVER_FAILURES) {
          await forget();
        } else {
          await store.mutate(update(current.localId, (r) => ({ ...r, serverFailures: failures })), 'system');
        }
      }
    }
  }
}

export type ConfirmationState = 'sent' | 'sending' | 'queued' | 'busy' | 'failed' | 'check' | 'blocked';

/** What the confirmation screen may say about one report (spec §5.3(e)). */
export function confirmationState(
  localId: string,
  items: PendingReport[],
  acceptedIds: ReadonlySet<string>,
  syncing: boolean,
): ConfirmationState {
  const item = items.find((r) => r.localId === localId);
  if (acceptedIds.has(localId) || item?.status === 'photo') return 'sent';
  if (item?.status === 'failed') return 'failed';
  if (syncing && item) return 'sending';
  if (item?.checkUnavailable) return item.checkBlocked ? 'blocked' : 'check';
  return item?.busy ? 'busy' : 'queued';
}

/**
 * Reports still not sent 24 hours on, not yet reminded about (once each).
 * A report the server refused (failed) counts too: it is stranded on the
 * phone until the person taps Try again (review of #55, S3).
 */
export function dueReminders(items: PendingReport[], now: Date): PendingReport[] {
  return items.filter(
    (r) =>
      (r.status === 'queued' || r.status === 'failed') &&
      !r.remindedAt &&
      now.getTime() - new Date(r.createdAt).getTime() >= REMINDER_AFTER_MS,
  );
}

/**
 * "Send everything now" (delete-my-data): forget every wait, so a report
 * resting after an unanswered tap or a 428 goes out this time too.
 */
export function clearWaits(list: PendingReport[]): PendingReport[] {
  if (!list.some((r) => r.checkDeclinedAt || r.nextTryAt)) return list;
  return list.map((r) => ({ ...r, checkDeclinedAt: undefined, nextTryAt: undefined }));
}

/** Try again: refused reports go back in the queue with a fresh count. */
export function requeueFailed(list: PendingReport[]): PendingReport[] {
  if (!list.some((r) => r.status === 'failed')) return list;
  return list.map((r) => (r.status === 'failed' ? { ...r, status: 'queued' as const, serverFailures: 0 } : r));
}
