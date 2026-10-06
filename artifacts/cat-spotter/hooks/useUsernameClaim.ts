import { useCallback, useRef, useState } from 'react';
import { claimAndReconcile, type ClaimSettlement } from '@/lib/usernameClaim';
import { usernameKey } from '@/lib/usernameNormalize';

type Translate = (key: string) => string;

function rejectionMessage(error: unknown, t: Translate): string {
  const e = error as { status?: number; data?: { code?: string } | null } | null;
  if (e?.data?.code === 'offensive_username') return t('usernameRejected');
  if (e?.status === 409) return t('landingTaken');
  if (e?.status === 400) return t('landingInvalid');
  return t('error');
}

/** 409 and 400 are about the name itself, so retrying the same name is pointless. */
function rejectsTheName(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === 409 || status === 400;
}

/**
 * SYC-211: the claim state shared by onboarding and the Profile-tab editor.
 *
 * - One request per tap (F5): a synchronous ref guard, not render state.
 * - Never stuck (F1): every request settles (transport timeout); a firm
 *   server answer unlocks immediately, even with an older request still open.
 * - Phone and server agree (F3/F7): after an unclear failure the name stays
 *   locked (same-name retry only) until the server confirms it was not saved.
 *
 * `finishOnClaim` (onboarding): after the first success, ignore everything else.
 */
export function useUsernameClaim({
  deviceId,
  onClaimed,
  t,
  finishOnClaim = false,
}: {
  deviceId: string | null | undefined;
  onClaimed: (username: string) => void;
  t: Translate;
  finishOnClaim?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [uncertainName, setUncertainNameState] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [rejectedKey, setRejectedKey] = useState<string | null>(null);

  const inFlight = useRef(false);
  const started = useRef(false);
  const finished = useRef(false);
  const uncertainRef = useRef<string | null>(null);
  /** Open requests per normalised name. */
  const open = useRef(new Map<string, number>());
  /** Names whose last open request ended confirming they were not saved. */
  const confirmedNotSaved = useRef(new Set<string>());
  const onClaimedRef = useRef(onClaimed);
  onClaimedRef.current = onClaimed;
  const tRef = useRef(t);
  tRef.current = t;

  const setUncertainName = useCallback((name: string | null) => {
    uncertainRef.current = name;
    setUncertainNameState(name);
  }, []);

  const handleClaimed = useCallback((username: string) => {
    if (finished.current) return;
    if (finishOnClaim) finished.current = true;
    setUncertainName(null);
    setClaimError(null);
    onClaimedRef.current(username);
  }, [finishOnClaim, setUncertainName]);

  /** A request for `key` ended for good after the screen stopped waiting. */
  const handleSettled = useCallback((key: string, settlement: ClaimSettlement) => {
    const left = (open.current.get(key) ?? 1) - 1;
    if (left > 0) {
      open.current.set(key, left);
      return;
    }
    open.current.delete(key);
    if (finished.current || settlement.kind === 'claimed' || settlement.kind === 'unknown') return;
    confirmedNotSaved.current.add(key);
    const locked = uncertainRef.current;
    if (locked && usernameKey(locked) === key) {
      setUncertainName(null);
      setClaimError(settlement.kind === 'rejected' ? rejectionMessage(settlement.error, tRef.current) : tRef.current('error'));
    }
  }, [setUncertainName]);

  const submit = useCallback(async (typedName: string) => {
    if (!deviceId || inFlight.current || finished.current) return;
    inFlight.current = true;
    started.current = true;
    const name = uncertainRef.current ?? typedName;
    const key = usernameKey(name);
    open.current.set(key, (open.current.get(key) ?? 0) + 1);
    confirmedNotSaved.current.delete(key);
    setClaimError(null);
    setPending(true);
    let outcome;
    try {
      outcome = await claimAndReconcile(deviceId, name, handleClaimed, (s) => handleSettled(key, s));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
    if (finished.current || outcome.kind === 'claimed') return;
    if (outcome.kind === 'rejected') {
      // A firm answer: this name was not saved. Unlock now, even if an older
      // request is still open (it can only succeed for this same name).
      setUncertainName(null);
      if (rejectsTheName(outcome.error)) setRejectedKey(key);
      setClaimError(rejectionMessage(outcome.error, tRef.current));
      return;
    }
    // Unlock only when no request for this name is still open and the server
    // has confirmed it does not hold the name. (The settle callback may have
    // run before this point, hence the recorded confirmation.)
    const nothingOpen = !open.current.has(key);
    if (nothingOpen && (outcome.kind === 'notSaved' || confirmedNotSaved.current.has(key))) {
      setUncertainName(null);
      setClaimError(tRef.current('error'));
      return;
    }
    // Unknown whether the server saved it: only the same name may be retried.
    setUncertainName(name);
    setClaimError(tRef.current('usernameClaimUncertain'));
  }, [deviceId, handleClaimed, handleSettled, setUncertainName]);

  const hasStarted = useCallback(() => started.current, []);

  return {
    submit,
    pending,
    uncertainName,
    claimError,
    setClaimError,
    /** True once the server firmly refused this exact name (409/400). */
    isRejectedName: (name: string) => rejectedKey !== null && usernameKey(name) === rejectedKey,
    /** True once any claim has been sent from this screen (stable identity). */
    hasStarted,
  };
}

/** SYC-214 test hook (stub until the fix lands). */
export function resetUsernameClaimStateForTests() {}
