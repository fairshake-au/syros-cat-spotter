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

/** Forgets the waiting note and any pending move (a new identity makes both useless). */
export function clearWaiting(): void {
  try { store()?.removeItem(RESTORE_WAITING_KEY); } catch { /* blocked storage */ }
  clearPendingMove();
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
    // Only the note: a pending move keeps its own 60-second life.
    try { store()?.removeItem(RESTORE_WAITING_KEY); } catch { /* blocked storage */ }
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

// With nothing stored this starts a note on purpose: the app needs the count for the
// "after five wrong tries, send another" message, even when this run never asked for an email.
export function noteWrongTry(now: number = Date.now()): RestoreWaiting {
  const prev = readWaiting(now);
  const next: RestoreWaiting = prev
    ? { ...prev, wrongTries: prev.wrongTries + 1 }
    : { askedAt: now, requests: 0, wrongTries: 1 };
  write(next);
  return next;
}

/** With no live note, a handle starts one (the "I already have a code" path never asked for an email). */
export function setMovingHandle(handle: string | null, now: number = Date.now()): void {
  const prev = readWaiting(now);
  if (!prev) {
    if (handle) write({ askedAt: now, requests: 0, wrongTries: 0, movingHandle: handle });
    return;
  }
  const { movingHandle: _drop, ...rest } = prev;
  write(handle ? { ...rest, movingHandle: handle } : rest);
}

/**
 * SYC-664 final review I1, "A reload mid-move": what the code screen was about
 * to redeem, stored just before the request goes out. If the app opens again
 * within 60 seconds (the server's replay window), DeviceContext asks again with
 * these values before anything is sent as this phone's old id. Its own key, so
 * it outlives a waiting note that expires mid-move.
 */
export const RESTORE_PENDING_MOVE_KEY = 'cat-spotter/restore-pending-move';
export const PENDING_MOVE_MS = 60_000;

export type PendingMove = {
  handle: string;
  choice: string;
  abandonCurrent: boolean;
  deleteCurrent?: boolean;
  at: number;
};

export function notePendingMove(move: Omit<PendingMove, 'at'>, now: number = Date.now()): void {
  const value: PendingMove = {
    handle: move.handle,
    choice: move.choice,
    abandonCurrent: move.abandonCurrent,
    ...(move.deleteCurrent ? { deleteCurrent: true } : {}),
    at: now,
  };
  try { store()?.setItem(RESTORE_PENDING_MOVE_KEY, JSON.stringify(value)); } catch { /* blocked storage */ }
}

export function clearPendingMove(): void {
  try { store()?.removeItem(RESTORE_PENDING_MOVE_KEY); } catch { /* blocked storage */ }
}

/** The pending move, or null (and cleared) once 60 s have passed or if it is stamped in the future. */
export function readPendingMove(now: number = Date.now()): PendingMove | null {
  let raw: string | null = null;
  try { raw = store()?.getItem(RESTORE_PENDING_MOVE_KEY) ?? null; } catch { return null; }
  if (!raw) return null;
  let v: Partial<PendingMove> | null = null;
  try { v = JSON.parse(raw) as Partial<PendingMove> | null; } catch { v = null; }
  const valid =
    !!v &&
    typeof v.handle === 'string' &&
    typeof v.choice === 'string' &&
    typeof v.abandonCurrent === 'boolean' &&
    typeof v.at === 'number' &&
    now - v.at <= PENDING_MOVE_MS &&
    v.at <= now + PENDING_MOVE_MS;
  if (!valid) {
    clearPendingMove();
    return null;
  }
  return {
    handle: v!.handle!,
    choice: v!.choice!,
    abandonCurrent: v!.abandonCurrent!,
    ...(v!.deleteCurrent === true ? { deleteCurrent: true } : {}),
    at: v!.at!,
  };
}
