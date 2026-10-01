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
}

export interface ReportApi {
  submit(body: SubmitBody): Promise<{ publicId: string }>;
  uploadPhoto(publicId: string, deviceId: string, photoBase64: string): Promise<void>;
}

export const MAX_SERVER_FAILURES = 3;
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
function isPermanentRefusal(err: unknown): boolean {
  const s = statusOf(err);
  return s !== null && s >= 400 && s < 500 && s !== 401 && s !== 403 && s !== 408 && s !== 429;
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
  /** Called the moment the server accepts a report's text. */
  onTextAccepted?: (localId: string) => void;
}

/**
 * Send what's waiting: each report's text, then its photo. Stops at the first
 * network failure (no signal: nothing else will get through either).
 */
export async function syncReports(
  store: QueueStore<PendingReport>,
  deps: SyncDeps,
): Promise<void> {
  for (const item of [...store.items()]) {
    if (item.status === 'failed') continue;
    let current = item;

    if (current.status === 'queued') {
      try {
        const { publicId } = await deps.api.submit({
          deviceId: deps.deviceId,
          clientRef: current.clientRef,
          severity: current.severity,
          isLitter: current.isLitter,
          lat: current.lat,
          lng: current.lng,
          note: current.note.trim() ? current.note.trim() : null,
          language: current.language,
          hasPhoto: current.hasPhoto,
        });
        deps.onTextAccepted?.(current.localId);
        if (!current.hasPhoto) {
          await store.mutate(removeItem(current.localId), 'system');
          continue;
        }
        current = { ...current, status: 'photo', publicId, serverFailures: 0 };
        await store.mutate(
          update(current.localId, (r) => ({ ...r, status: 'photo', publicId, serverFailures: 0 })),
          'system',
        );
      } catch (err) {
        if (!isPermanentRefusal(err)) {
          if (statusOf(err) === null) return; // no signal
          continue;
        }
        await store.mutate(
          update(current.localId, (r) => {
            const serverFailures = r.serverFailures + 1;
            return {
              ...r,
              serverFailures,
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

export type ConfirmationState = 'sent' | 'sending' | 'queued' | 'failed';

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
  return syncing && item ? 'sending' : 'queued';
}

/** Reports still not sent 24 hours on, not yet reminded about (once each). */
export function dueReminders(items: PendingReport[], now: Date): PendingReport[] {
  return items.filter(
    (r) =>
      r.status === 'queued' &&
      !r.remindedAt &&
      now.getTime() - new Date(r.createdAt).getTime() >= REMINDER_AFTER_MS,
  );
}
