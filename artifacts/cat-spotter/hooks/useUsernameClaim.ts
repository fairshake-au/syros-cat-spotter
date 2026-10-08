import { useCallback, useRef, useSyncExternalStore } from 'react';
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
 * SYC-214: the claim lock lives outside the screen, for the life of the app.
 * Back unmounts the name step; if the lock lived in the screen, a spotter
 * could come back and send a different name while the first claim was still
 * open, and the server would keep whichever landed last. Now, on return, the
 * screen shows the claim still sending, or offers only the same-name retry,
 * until the first claim settles (the transport timeout bounds this at 30 s).
 */
type SharedClaimState = {
  pending: boolean;
  /** The name being sent while `pending`. */
  claimingName: string | null;
  uncertainName: string | null;
  claimError: string | null;
  rejectedKey: string | null;
};

const IDLE: SharedClaimState = { pending: false, claimingName: null, uncertainName: null, claimError: null, rejectedKey: null };

const shared = {
  state: IDLE,
  /** One request per tap (F5): a synchronous guard, not render state. */
  inFlight: false,
  /** Open requests per normalised name. */
  open: new Map<string, number>(),
  /** Names whose last open request ended confirming they were not saved. */
  confirmedNotSaved: new Set<string>(),
  listeners: new Set<() => void>(),
};

function update(patch: Partial<SharedClaimState>) {
  shared.state = { ...shared.state, ...patch };
  shared.listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  shared.listeners.add(listener);
  return () => { shared.listeners.delete(listener); };
}

const snapshot = () => shared.state;

/** A claim this phone sent is still open, or may have been saved. */
function outstanding() {
  return shared.state.pending || shared.state.uncertainName !== null;
}

/** SYC-3: is a username claim still open on this phone? */
export function usernameClaimOpen(): boolean {
  return outstanding() || shared.inFlight;
}

/**
 * SYC-3: wait for an open username claim to settle before pressing "Get my
 * spots back", so a half-finished claim on this phone can't race the move.
 * Resolves at once when nothing is open; never waits longer than `maxMs`.
 */
export function waitForUsernameClaimToSettle(maxMs = 35_000): Promise<void> {
  if (!usernameClaimOpen()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, maxMs);
    const unsubscribe = subscribe(() => {
      if (!usernameClaimOpen()) done();
    });
  });
}

/** Tests only: forget every claim, as a fresh app start would. */
export function resetUsernameClaimStateForTests() {
  shared.state = IDLE;
  shared.inFlight = false;
  shared.open.clear();
  shared.confirmedNotSaved.clear();
}

/**
 * SYC-211: the claim state shared by onboarding and the Profile-tab editor.
 *
 * - One request per tap (F5).
 * - Never stuck (F1): every request settles (transport timeout); a firm
 *   server answer unlocks immediately, even with an older request still open.
 * - Phone and server agree (F3/F7): after an unclear failure the name stays
 *   locked (same-name retry only) until the server confirms it was not saved.
 *   This holds across leaving and returning to the screen (SYC-214).
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
  // A fresh screen starts without an earlier screen's error message, unless
  // that screen's claim is still outstanding (then its state carries over).
  const mounted = useRef(false);
  if (!mounted.current) {
    mounted.current = true;
    if (!outstanding()) shared.state = IDLE;
  }
  const { pending, claimingName, uncertainName, claimError, rejectedKey } = useSyncExternalStore(subscribe, snapshot, snapshot);

  const started = useRef(false);
  const finished = useRef(false);
  const onClaimedRef = useRef(onClaimed);
  onClaimedRef.current = onClaimed;
  const tRef = useRef(t);
  tRef.current = t;

  const setUncertainName = useCallback((name: string | null) => update({ uncertainName: name }), []);
  const setClaimError = useCallback((message: string | null) => update({ claimError: message }), []);

  const handleClaimed = useCallback((username: string) => {
    if (finished.current) return;
    if (finishOnClaim) finished.current = true;
    update({ uncertainName: null, claimError: null, rejectedKey: null });
    onClaimedRef.current(username);
  }, [finishOnClaim]);

  /** A request for `key` ended for good after the screen stopped waiting. */
  const handleSettled = useCallback((key: string, settlement: ClaimSettlement) => {
    const left = (shared.open.get(key) ?? 1) - 1;
    if (left > 0) {
      shared.open.set(key, left);
      return;
    }
    shared.open.delete(key);
    if (finished.current || settlement.kind === 'claimed' || settlement.kind === 'unknown') return;
    shared.confirmedNotSaved.add(key);
    const locked = shared.state.uncertainName;
    if (locked && usernameKey(locked) === key) {
      setUncertainName(null);
      setClaimError(settlement.kind === 'rejected' ? rejectionMessage(settlement.error, tRef.current) : tRef.current('error'));
    }
  }, [setUncertainName, setClaimError]);

  const submit = useCallback(async (typedName: string) => {
    if (!deviceId || shared.inFlight || finished.current) return;
    shared.inFlight = true;
    started.current = true;
    const name = shared.state.uncertainName ?? typedName;
    const key = usernameKey(name);
    shared.open.set(key, (shared.open.get(key) ?? 0) + 1);
    shared.confirmedNotSaved.delete(key);
    update({ claimError: null, pending: true, claimingName: name });
    let outcome;
    try {
      outcome = await claimAndReconcile(deviceId, name, handleClaimed, (s) => handleSettled(key, s));
    } finally {
      shared.inFlight = false;
      update({ pending: false, claimingName: null });
    }
    if (finished.current || outcome.kind === 'claimed') return;
    if (outcome.kind === 'rejected') {
      // 409/400 are about the name itself: an older request for it cannot
      // succeed either, so unlock now even if one is still open. Any other
      // firm "no" (401, 403) says nothing about an older request, so keep
      // the same-name lock until no request for it is open (SYC-214 review).
      if (rejectsTheName(outcome.error)) {
        setUncertainName(null);
        update({ rejectedKey: key });
      } else if (!shared.open.has(key)) {
        setUncertainName(null);
      } else {
        setUncertainName(name);
      }
      setClaimError(rejectionMessage(outcome.error, tRef.current));
      return;
    }
    // Unlock only when no request for this name is still open and the server
    // has confirmed it does not hold the name. (The settle callback may have
    // run before this point, hence the recorded confirmation.)
    const nothingOpen = !shared.open.has(key);
    if (nothingOpen && (outcome.kind === 'notSaved' || shared.confirmedNotSaved.has(key))) {
      setUncertainName(null);
      setClaimError(tRef.current('error'));
      return;
    }
    // Unknown whether the server saved it: only the same name may be retried.
    setUncertainName(name);
    setClaimError(tRef.current('usernameClaimUncertain'));
  }, [deviceId, handleClaimed, handleSettled, setUncertainName, setClaimError]);

  const hasStarted = useCallback(() => started.current, []);

  return {
    submit,
    pending,
    uncertainName,
    /** The name still being sent or awaiting confirmation, if any (SYC-214: also after leaving and returning). */
    outstandingName: pending ? claimingName : uncertainName,
    claimError,
    setClaimError,
    /** True once the server firmly refused this exact name (409/400). */
    isRejectedName: (name: string) => rejectedKey !== null && usernameKey(name) === rejectedKey,
    /** True once any claim has been sent from this screen (stable identity). */
    hasStarted,
  };
}

