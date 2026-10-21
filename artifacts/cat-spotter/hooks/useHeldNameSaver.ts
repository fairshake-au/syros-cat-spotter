import { useEffect, useRef, useState } from 'react';
import { claimUsername, getClaimedUsername } from '@workspace/api-client-react';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { saveHeldName, type HeldNameDeps } from '@/lib/heldNameSave';
import { numberedUsername, suggestLocalUsernames } from '@/lib/usernameSuggestions';
import { ifLockFree } from '@/lib/webLocks';
import { runBackgroundClaim } from '@/hooks/useUsernameClaim';

/** One open tab saves the held name at a time (the others then read it first). */
export const NAME_SAVE_LOCK = 'cat-spotter-name-save';
/** Waits before trying again while online and still unsaved (review F7: backs off). */
export const HELD_NAME_RETRY_MS = [60_000, 120_000, 300_000, 600_000] as const;

const DEPS: HeldNameDeps = {
  read: (deviceId) => getClaimedUsername(deviceId),
  claim: (deviceId, body) => claimUsername(deviceId, body),
  numbered: (name) => numberedUsername(name),
  suggest: () => suggestLocalUsernames(1)[0] ?? 'CatSpotter',
};

/**
 * SYC-506: while this phone holds a name chosen offline, save it whenever
 * there's a connection: at start, on reconnect, and every minute after a try
 * that couldn't finish (backing off to every ten minutes).
 *
 * Review F1/F2: the run captures which spotter this phone is
 * (`identityGeneration`, live from DeviceContext) and stops before any
 * request, and applies nothing, once that changes ("Delete my data", "Start
 * again", restore). The check is live, not from a render, because this
 * component unmounts as soon as the identity changes.
 */
export function useHeldNameSaver(deps: HeldNameDeps = DEPS) {
  const { deviceId, username, heldUsername, moved, setUsername, setNameNote, identityGeneration } =
    useDevice();
  const { isOnline } = useOffline();
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);

  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    if (!deviceId || !heldUsername || username || moved || !isOnline) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const generation = identityGeneration();
    const stillCurrent = () => identityGeneration() === generation;
    // Ship review F3: only a try that failed backs off. A run skipped because
    // another tab or claim held the lock retries at the current pace.
    const retry = (failed: boolean) => {
      if (!active) return;
      const wait = HELD_NAME_RETRY_MS[Math.min(failures.current, HELD_NAME_RETRY_MS.length - 1)];
      if (failed) failures.current++;
      timer = setTimeout(() => setAttempt((n) => n + 1), wait);
    };

    void (async () => {
      let saved = false;
      let failed = true;
      try {
        await ifLockFree(NAME_SAVE_LOCK, async () => {
          const result = await runBackgroundClaim(() =>
            saveHeldName(deviceId, heldUsername, { ...depsRef.current, stillCurrent }),
          );
          if (result === undefined) failed = false; // another claim held the lock
          if (result?.kind !== 'saved' || !stillCurrent()) return;
          saved = true;
          failures.current = 0;
          if (result.note) setNameNote(result.note);
          setUsername(result.username);
        });
      } catch {
        // retried below
      }
      if (!saved) retry(failed);
    })();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [deviceId, heldUsername, username, moved, isOnline, attempt, setUsername, setNameNote, identityGeneration]);
}

/** Mounted once, beside the app, while a held name waits to be saved. */
export function HeldNameSaver() {
  useHeldNameSaver();
  return null;
}
