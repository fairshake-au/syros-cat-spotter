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
/** How long to wait before trying again while online and still unsaved. */
export const HELD_NAME_RETRY_MS = 60_000;

const DEPS: HeldNameDeps = {
  read: (deviceId) => getClaimedUsername(deviceId),
  claim: (deviceId, body) => claimUsername(deviceId, body),
  numbered: (name) => numberedUsername(name),
  suggest: () => suggestLocalUsernames(1)[0] ?? 'CatSpotter',
};

/**
 * SYC-506: while this phone holds a name chosen offline, save it whenever
 * there's a connection: at start, on reconnect, and every minute after a try
 * that couldn't finish. A result is applied only if the phone is still the
 * same spotter holding the same name (a restore or "Delete my data" may have
 * happened meanwhile).
 */
export function useHeldNameSaver(deps: HeldNameDeps = DEPS) {
  const { deviceId, username, heldUsername, moved, setUsername, setNameNote } = useDevice();
  const { isOnline } = useOffline();
  const [attempt, setAttempt] = useState(0);

  const latest = useRef({ deviceId, username, heldUsername });
  latest.current = { deviceId, username, heldUsername };
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    if (!deviceId || !heldUsername || username || moved || !isOnline) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const retry = () => {
      if (active) timer = setTimeout(() => setAttempt((n) => n + 1), HELD_NAME_RETRY_MS);
    };

    void (async () => {
      let saved = false;
      try {
        await ifLockFree(NAME_SAVE_LOCK, async () => {
          const result = await runBackgroundClaim(() =>
            saveHeldName(deviceId, heldUsername, depsRef.current),
          );
          if (result?.kind !== 'saved') return;
          const now = latest.current;
          if (now.deviceId !== deviceId || now.heldUsername !== heldUsername || now.username) return;
          saved = true;
          if (result.note) setNameNote(result.note);
          setUsername(result.username);
        });
      } catch {
        // retried below
      }
      if (!saved) retry();
    })();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [deviceId, heldUsername, username, moved, isOnline, attempt, setUsername, setNameNote]);
}

/** Mounted once, beside the app, while a held name waits to be saved. */
export function HeldNameSaver() {
  useHeldNameSaver();
  return null;
}
