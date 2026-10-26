import { useCallback, useRef, useState } from 'react';
import { useDevice } from '@/context/DeviceContext';
import type { Language } from '@/lib/i18n';
import { addKeepSafe, isInvalidEmail, looksLikeEmail } from '@/lib/keepSafe';

export type OnboardingEmailResult =
  | 'none'
  | 'saved'
  | 'failed'
  /** SYC-715: the request got no server answer (network error or timeout); the screen holds the address and goes on. */
  | 'unreachable'
  | 'invalid'
  | 'stale'
  | 'busy';
/** The i18n key of the line shown under the email box. */
export type OnboardingEmailError = 'keepSafeInvalidEmail' | 'keepSafeSaveFailed';

/**
 * Review I1: the email request gives up after this long (Android's fetch has
 * no timeout of its own), so a bad connection can't lock the screen. A
 * timeout is "That didn't save"; a retry may send it again.
 */
export const ONBOARDING_EMAIL_TIMEOUT_MS = 15_000;

/**
 * What this phone typed and saved on the name screen, kept across Back and
 * return (spec "Screen state"): an address already added here is not sent
 * again. Tied to the identity (generation and device id), so "Delete my
 * data" or a restore starts empty, even if a restore later brings the same
 * device id back (review I2).
 */
type Memory = { generation: number; deviceId: string | null; email: string; savedFor: string | null };
const EMPTY: Memory = { generation: -1, deviceId: null, email: '', savedFor: null };
let memory: Memory = EMPTY;

function remembered(generation: number, deviceId: string | null) {
  if (memory.generation === generation && memory.deviceId === deviceId) return memory;
  memory = EMPTY; // another identity's address is never kept
  return memory;
}

function remember(generation: number, deviceId: string | null, email: string, savedFor: string | null) {
  memory = { generation, deviceId, email, savedFor };
}

/** Tests only: forget the screen's email, as a fresh app start would. */
export function resetOnboardingEmailForTests() {
  memory = EMPTY;
}

/**
 * SYC-524: "Don't lose your spots" on the onboarding name screen. The email
 * is optional and is added before the name is claimed, because a saved name
 * opens the app by itself (spec "Order of saves").
 *
 * `saveIfNeeded(beforeSend)`:
 * - `'invalid'`: the box holds something that isn't an email (or the server
 *   said so). Nothing is sent and `beforeSend` is not called.
 * - otherwise `beforeSend` runs first (the screen writes the offer there),
 *   then: `'none'` for an empty box; `'saved'` when the address is added, or
 *   was already added on this screen; `'failed'` when it didn't save
 *   (including the test site's `not_configured`); `'unreachable'` when the
 *   request got no server answer at all (SYC-715; no error line, the caller
 *   holds the address); `'stale'` when the phone's
 *   identity changed while the request was out ("Delete my data", "Get your
 *   spots back", a restore link), in which case the result is ignored.
 *
 * The email text lives here, not in the box, so it survives the box being
 * hidden offline and shown again.
 */
export function useOnboardingEmail({
  deviceId,
  language,
}: {
  deviceId: string | null;
  language: Language;
}) {
  const { identityGeneration } = useDevice();
  const [email, setEmailState] = useState(() => remembered(identityGeneration(), deviceId).email);
  const [savedFor, setSavedForState] = useState<string | null>(
    () => remembered(identityGeneration(), deviceId).savedFor,
  );
  const [error, setError] = useState<OnboardingEmailError | null>(null);
  const [saving, setSaving] = useState(false);

  // Live values for the async save (a tap can follow a keystroke before re-render).
  const emailRef = useRef(email);
  const savedForRef = useRef(savedFor);
  const busy = useRef(false);

  const setEmail = useCallback((value: string) => {
    emailRef.current = value;
    setEmailState(value);
    setError(null);
    // A changed address is a new one: it is sent on the next tap.
    if (savedForRef.current !== null && savedForRef.current !== value.trim()) {
      savedForRef.current = null;
      setSavedForState(null);
    }
    remember(identityGeneration(), deviceId, value, savedForRef.current);
  }, [deviceId, identityGeneration]);

  const saveIfNeeded = useCallback(async (beforeSend?: () => void): Promise<OnboardingEmailResult> => {
    // A save is already running: a no-op, not a failure (no error line is shown).
    if (busy.current) return 'busy';
    const typed = emailRef.current.trim();
    if (typed && !looksLikeEmail(typed)) {
      setError('keepSafeInvalidEmail');
      return 'invalid';
    }
    setError(null);
    beforeSend?.();
    if (!typed) return 'none';
    if (savedForRef.current === typed) return 'saved';
    if (!deviceId) return 'failed';

    const generation = identityGeneration();
    busy.current = true;
    setSaving(true);
    try {
      await addKeepSafe(
        deviceId,
        { email: typed, language, surface: 'onboarding' },
        { timeoutMs: ONBOARDING_EMAIL_TIMEOUT_MS },
      );
      if (identityGeneration() !== generation) {
        memory = EMPTY;
        return 'stale';
      }
      savedForRef.current = typed;
      setSavedForState(typed);
      remember(generation, deviceId, emailRef.current, typed);
      return 'saved';
    } catch (err) {
      if (identityGeneration() !== generation) {
        memory = EMPTY;
        return 'stale';
      }
      // Spec "Server answers": anything but a refused address, including
      // not_configured and a timeout, is "That didn't save"; emptying the box
      // gets past it.
      if (isInvalidEmail(err)) {
        setError('keepSafeInvalidEmail');
        return 'invalid';
      }
      // SYC-715: no HTTP status means no server answer (wifi with no internet
      // behind it): hold the address for the background save instead of
      // stopping the spotter here. A server answer of any kind is still
      // "That didn't save".
      if (typeof (err as { status?: unknown } | null)?.status !== 'number') return 'unreachable';
      setError('keepSafeSaveFailed');
      return 'failed';
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [deviceId, language, identityGeneration]);

  return { email, setEmail, savedFor, error, saving, saveIfNeeded };
}
