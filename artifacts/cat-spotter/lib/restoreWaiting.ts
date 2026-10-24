import { Platform } from 'react-native';

/**
 * SYC-664: "this phone is waiting for a restore code", remembered on the web
 * for 15 minutes (the same lifetime as the emailed link and code). Web only:
 * anywhere else, or if storage is blocked, it behaves as "nothing stored".
 */
export const RESTORE_WAITING_KEY = 'cat-spotter/restore-waiting';
export const RESTORE_WAITING_MINUTES = 15;
const WINDOW_MS = RESTORE_WAITING_MINUTES * 60_000;

export type RestoreWaiting = {
  askedAt: number;
  requests: number;
  wrongTries: number;
  movingHandle?: string;
};

function store(): Storage | null {
  try {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function write(value: RestoreWaiting): void {
  try { store()?.setItem(RESTORE_WAITING_KEY, JSON.stringify(value)); } catch { /* blocked storage: nothing remembered */ }
}

export function clearWaiting(): void {
  try { store()?.removeItem(RESTORE_WAITING_KEY); } catch { /* blocked storage */ }
}

function parse(raw: string | null | undefined): RestoreWaiting | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<RestoreWaiting> | null;
    if (!v || typeof v.askedAt !== 'number' || typeof v.requests !== 'number' || typeof v.wrongTries !== 'number') return null;
    return {
      askedAt: v.askedAt,
      requests: v.requests,
      wrongTries: v.wrongTries,
      ...(typeof v.movingHandle === 'string' ? { movingHandle: v.movingHandle } : {}),
    };
  } catch {
    return null;
  }
}

/** The waiting note, or null once 15 minutes have passed (the key is cleared then). */
export function readWaiting(now: number = Date.now()): RestoreWaiting | null {
  let raw: string | null = null;
  try { raw = store()?.getItem(RESTORE_WAITING_KEY) ?? null; } catch { return null; }
  const v = parse(raw);
  if (!v) return null;
  if (now - v.askedAt > WINDOW_MS) {
    clearWaiting();
    return null;
  }
  return v;
}

/** A new email was asked for: fresh `askedAt`, request count up (or 1 after the window), wrong tries reset. */
export function noteRequest(now: number = Date.now()): RestoreWaiting {
  const prev = readWaiting(now);
  const next: RestoreWaiting = { askedAt: now, requests: (prev?.requests ?? 0) + 1, wrongTries: 0 };
  write(next);
  return next;
}

export function noteWrongTry(): RestoreWaiting {
  const prev = readWaiting();
  const next: RestoreWaiting = prev
    ? { ...prev, wrongTries: prev.wrongTries + 1 }
    : { askedAt: Date.now(), requests: 0, wrongTries: 1 };
  write(next);
  return next;
}

export function setMovingHandle(handle: string | null): void {
  const prev = readWaiting();
  if (!prev) return;
  const { movingHandle: _drop, ...rest } = prev;
  write(handle ? { ...rest, movingHandle: handle } : rest);
}
