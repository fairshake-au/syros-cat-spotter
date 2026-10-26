import { useEffect, useRef, useState } from 'react';
import { useDevice } from '@/context/DeviceContext';
import { useLanguage } from '@/context/LanguageContext';
import { useOffline } from '@/context/OfflineContext';
import { clearHeldEmail, useHeldEmail } from '@/lib/heldEmail';
import {
  addKeepSafe,
  getKeepSafe,
  isDefiniteRefusal,
  type KeepSafeState,
} from '@/lib/keepSafe';
import { ifLockFree } from '@/lib/webLocks';

/** One open tab saves the held email at a time (the others then read it first). */
export const EMAIL_SAVE_LOCK = 'cat-spotter-email-save';
/** Waits before trying again while online and still unsaved (backs off, as the name's does). */
export const HELD_EMAIL_RETRY_MS = [60_000, 120_000, 300_000, 600_000] as const;
/** Each request gives up after this long, so a bad connection can't hang the run. */
export const HELD_EMAIL_TIMEOUT_MS = 15_000;

export interface HeldEmailDeps {
  read: (deviceId: string, options?: { timeoutMs?: number }) => Promise<KeepSafeState>;
  add: typeof addKeepSafe;
}

const DEPS: HeldEmailDeps = { read: getKeepSafe, add: addKeepSafe };

/**
 * SYC-715: while this phone holds an email typed when the server gave no
 * answer, add it whenever there's a connection: at start, on reconnect, and
 * every minute after a try that couldn't finish (backing off to ten minutes).
 *
 * - One run at a time in this app (`running`), so a connection that flaps
 *   while a request is out does not start a second read-then-add. A run that
 *   can't finish schedules the next try itself, with backoff.
 * - Reads first: if the server already has an address for this phone (the
 *   first request did land, or one was added in Settings), nothing is sent, so
 *   no second confirmation email goes out. Both requests have a timeout.
 * - A definite refusal (a 4xx other than 429, such as "invalid_email") drops
 *   the address, since asking again can't change the answer, and the
 *   first-badge offer comes back. No answer, 429 and 5xx keep it and retry.
 * - Like the name's save, it checks the phone is still the same spotter
 *   (`identityGeneration`) before it changes anything.
 */
export function useHeldEmailSaver(deps: HeldEmailDeps = DEPS) {
  const { deviceId, setKeepSafeOffer, identityGeneration } = useDevice();
  const { isOnline } = useOffline();
  const { language } = useLanguage();
  const heldEmail = useHeldEmail();
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const depsRef = useRef(deps);
  depsRef.current = deps;
  const languageRef = useRef(language);
  languageRef.current = language;

  // The retry timer outlives a connection change (the run it belongs to may
  // still be finishing), and ends only with the saver.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!deviceId || !heldEmail || !isOnline || running.current) return;
    running.current = true;
    const generation = identityGeneration();
    const stillCurrent = () => identityGeneration() === generation;

    void (async () => {
      /** Nothing more to try: saved, adopted, dropped, or the phone is another spotter now. */
      let finished = false;
      /** Whether this app held the lock and ran (only those back off). */
      let attempted = false;
      try {
        await ifLockFree(EMAIL_SAVE_LOCK, async () => {
          attempted = true;
          const settle = async () => {
            finished = true;
            failures.current = 0;
            await clearHeldEmail();
            setKeepSafeOffer('done');
          };
          try {
            const state = await depsRef.current.read(deviceId, { timeoutMs: HELD_EMAIL_TIMEOUT_MS });
            if (!stillCurrent()) { finished = true; return; }
            if (state.status !== 'none') { await settle(); return; }
            await depsRef.current.add(
              deviceId,
              { email: heldEmail, language: languageRef.current, surface: 'onboarding' },
              { timeoutMs: HELD_EMAIL_TIMEOUT_MS },
            );
            if (!stillCurrent()) { finished = true; return; }
            await settle();
          } catch (error) {
            if (!stillCurrent()) { finished = true; return; }
            if (isDefiniteRefusal(error)) {
              finished = true;
              await clearHeldEmail();
            }
          }
        });
      } catch {
        // retried below
      }
      running.current = false;
      if (finished) return;
      const wait = HELD_EMAIL_RETRY_MS[Math.min(failures.current, HELD_EMAIL_RETRY_MS.length - 1)];
      if (attempted) failures.current++;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setAttempt((n) => n + 1), wait);
    })();
  }, [deviceId, heldEmail, isOnline, attempt, setKeepSafeOffer, identityGeneration]);
}

/** Mounted once, beside the app, while a held email waits to be saved. */
export function HeldEmailSaver() {
  useHeldEmailSaver();
  return null;
}
