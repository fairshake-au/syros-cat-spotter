import { useCallback, useRef, useState } from 'react';
import { useDevice } from '@/context/DeviceContext';
import type { Language } from '@/lib/i18n';
import { addKeepSafe, isInvalidEmail, looksLikeEmail } from '@/lib/keepSafe';

export type OnboardingEmailResult = 'none' | 'saved' | 'failed' | 'invalid' | 'stale';
/** The i18n key of the line shown under the email box. */
export type OnboardingEmailError = 'keepSafeInvalidEmail' | 'keepSafeSaveFailed';

/**
 * What this phone typed and saved on the name screen, kept across Back and
 * return (spec "Screen state"): an address already added here is not sent
 * again. Tied to the device id, so a new identity starts empty.
 */
const memory = { deviceId: null as string | null, email: '', savedFor: null as string | null };

function remembered(deviceId: string | null) {
  return memory.deviceId === deviceId ? memory : { email: '', savedFor: null };
}

function remember(deviceId: string | null, email: string, savedFor: string | null) {
  memory.deviceId = deviceId;
  memory.email = email;
  memory.savedFor = savedFor;
}

/** Tests only: forget the screen's email, as a fresh app start would. */
export function resetOnboardingEmailForTests() {
  remember(null, '', null);
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
 *   (including the test site's `not_configured`); `'stale'` when the phone's
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
  const [email, setEmailState] = useState(() => remembered(deviceId).email);
  const [savedFor, setSavedForState] = useState<string | null>(() => remembered(deviceId).savedFor);
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
    remember(deviceId, value, savedForRef.current);
  }, [deviceId]);

  const saveIfNeeded = useCallback(async (beforeSend?: () => void): Promise<OnboardingEmailResult> => {
    if (busy.current) return 'failed';
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
      await addKeepSafe(deviceId, { email: typed, language, surface: 'onboarding' });
      if (identityGeneration() !== generation) return 'stale';
      savedForRef.current = typed;
      setSavedForState(typed);
      remember(deviceId, emailRef.current, typed);
      return 'saved';
    } catch (err) {
      if (identityGeneration() !== generation) return 'stale';
      // Spec "Server answers": anything but a refused address, including
      // not_configured, is "That didn't save"; emptying the box gets past it.
      if (isInvalidEmail(err)) {
        setError('keepSafeInvalidEmail');
        return 'invalid';
      }
      setError('keepSafeSaveFailed');
      return 'failed';
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [deviceId, language, identityGeneration]);

  return { email, setEmail, savedFor, error, saving, saveIfNeeded };
}
