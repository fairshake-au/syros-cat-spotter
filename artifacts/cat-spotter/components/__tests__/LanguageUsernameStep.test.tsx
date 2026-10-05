// @vitest-environment jsdom
/**
 * SYC-211: the Replit speed-up for username claiming (6f9dccf) locks
 * spotters out of onboarding on bad connections. These tests assert the
 * target behaviour Samuel approved, from the adversarial review at
 * docs/reviews/username-claim-adversarial-review.md (branch
 * review/username-claim-2026-10-05):
 *
 *   F1 — a claim never leaves the spotter stuck: Back always works, and a
 *        firm server "no" on retry clears the lock immediately even while
 *        an earlier request is still outstanding.
 *   F2 — the availability check never gates Continue.
 *   F3 — after an unclear failure, onboarding reconciles against the
 *        server before unlocking, and never opens the app under a
 *        different name than the one the spotter submitted.
 *   F5 — a double tap sends exactly one claim request.
 *
 * Mocking style follows the reviewer's component repro
 * (docs/reviews/username-claim-repro.test.tsx.txt) and this repo's existing
 * SafetyStep.test.tsx: mock every module boundary, render the real
 * component through react-native-web, drive it with fake timers.
 */
import React from 'react';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATIONS } from '@/lib/i18n';

const en = TRANSLATIONS.en;

const h = vi.hoisted(() => ({
  claim: vi.fn(),
  read: vi.fn(),
  setUsername: vi.fn(),
  availability: { data: { available: true } as any, isFetching: false, isError: false },
}));

vi.mock('@workspace/api-client-react', () => ({
  useCheckUsernameAvailability: () => h.availability,
  getCheckUsernameAvailabilityQueryKey: (p: unknown) => ['avail', p],
  useGetUsernameSuggestions: () => ({ data: { suggestions: [] }, isFetching: false, refetch: vi.fn() }),
  getGetUsernameSuggestionsQueryKey: () => ['sugg'],
  checkUsernameAvailability: vi.fn(),
  getClaimedUsername: (...a: unknown[]) => h.read(...a),
  claimUsername: (...a: unknown[]) => h.claim(...a),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t: (k: string) => (en as any)[k] ?? k }),
}));
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => ({ deviceId: 'dev-1', setUsername: h.setUsername }) }));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: true }) }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ background: '#fff', foreground: '#000', mutedForeground: '#666', card: '#fff', border: '#ddd', primary: '#123', primaryForeground: '#fff', destructive: '#f00' }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/components/KeyboardAwareScrollViewCompat', async () => {
  const { View } = await import('react-native');
  return { KeyboardAwareScrollViewCompat: ({ children }: any) => <View>{children}</View> };
});
// A native <button> (not react-native-web's Text) so the `disabled`
// property is directly and reliably queryable from the DOM.
vi.mock('@/components/purropolis', () => ({
  Button: ({ children, onPress, disabled }: any) => (
    <button type="button" disabled={!!disabled} onClick={disabled ? undefined : onPress}>{children}</button>
  ),
  Tag: ({ children }: any) => <span>{children}</span>,
}));

import { LanguageUsernameStep } from '../onboarding/LanguageUsernameStep';

const never = () => new Promise<never>(() => {});
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

function setup() {
  const view = render(<LanguageUsernameStep onBack={() => {}} />);
  const input = view.container.querySelector('input')!;
  const continueBtn = () =>
    view.getAllByRole('button').find((b) => /Continue|Retry|Saving/.test(b.textContent ?? '')) as HTMLButtonElement;
  const backBtn = () => view.getByRole('button', { name: en.back }) as HTMLButtonElement;
  return { view, input, continueBtn, backBtn };
}

beforeEach(() => {
  vi.useFakeTimers();
  h.claim.mockReset();
  h.read.mockReset();
  h.setUsername.mockReset();
  h.availability = { data: { available: true }, isFetching: false, isError: false };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('LanguageUsernameStep (SYC-211)', () => {
  it('F1: Back stays enabled through a pending and an uncertain claim', async () => {
    h.read.mockImplementation(() => Promise.resolve({ username: null }));
    h.claim.mockImplementationOnce(never);
    const { input, backBtn, continueBtn } = setup();
    await tick(0);
    fireEvent.change(input, { target: { value: 'SeaCat' } });
    await tick(500);
    await act(async () => { fireEvent.click(continueBtn()); });

    // Mid-flight: the claim is pending.
    expect(backBtn().disabled).toBe(false);

    // Now uncertain (the claim deadline plus the reconcile deadline passed).
    await tick(8000 + 4000 + 10);
    expect(backBtn().disabled).toBe(false);
  });

  it('F1: a firm rejection on retry clears the locked name and unlocks the input, even with the original request still outstanding', async () => {
    h.read.mockImplementation(() => Promise.resolve({ username: null }));
    h.claim.mockImplementationOnce(never); // first POST never settles
    const { view, input, continueBtn } = setup();
    await tick(0);
    fireEvent.change(input, { target: { value: 'SeaCat' } });
    await tick(500);
    await act(async () => { fireEvent.click(continueBtn()); });
    await tick(8000 + 4000 + 10);
    expect(view.container.textContent).toContain(en.usernameClaimUncertain);
    expect(continueBtn().textContent).toBe(en.usernameRetryClaim);

    // Meanwhile someone else took the name: retry is refused with a firm 409.
    h.claim.mockImplementationOnce(() => Promise.reject({ status: 409 }));
    await act(async () => { fireEvent.click(continueBtn()); });
    await tick(10);

    expect(view.container.textContent).toContain(en.landingTaken);
    expect(input.readOnly).toBe(false);
    fireEvent.change(input, { target: { value: 'OtherName' } });
    expect(input.value).toBe('OtherName');
    expect(h.setUsername).not.toHaveBeenCalled();
  });

  it('F2 (guard): a known-taken name still disables Continue', async () => {
    h.availability = { data: { available: false, reason: 'taken' }, isFetching: false, isError: false };
    const { input, continueBtn } = setup();
    await tick(0);
    fireEvent.change(input, { target: { value: 'TakenName' } });
    await tick(500);
    expect(continueBtn().disabled).toBe(true);
  });

  it('F2: Continue is not gated by a slow or failed availability check', async () => {
    h.availability = { data: undefined, isFetching: true, isError: false };
    const { input, continueBtn } = setup();
    await tick(0);
    fireEvent.change(input, { target: { value: 'SlowCheck' } });
    await tick(500);
    // The availability check is still pending (or has failed) past its own
    // deadline; Continue must not depend on it succeeding.
    expect(continueBtn().disabled).toBe(false);
  });

  it('F2: a late availability answer (after its own deadline) is still shown, not discarded', async () => {
    h.availability = { data: undefined, isFetching: true, isError: false };
    const { view, input } = setup();
    await tick(0);
    fireEvent.change(input, { target: { value: 'ColdStart' } });
    await tick(500);
    // Deadline (AVAILABILITY_WAIT_MS = 5000) passes with no answer yet.
    await tick(8000);
    // The real answer now arrives, 3s after the 5s deadline — not dropped.
    h.availability = { data: { available: true }, isFetching: false, isError: false };
    await act(async () => { view.rerender(<LanguageUsernameStep onBack={() => {}} />); });
    expect(view.container.textContent).toContain(en.landingAvailable);
  });

  it('F3: after a late network failure, onboarding never opens under a different name than the one submitted', async () => {
    let failA!: (e: unknown) => void;
    h.claim.mockImplementationOnce(() => new Promise((_resolve, reject) => { failA = reject; }));
    h.read.mockImplementationOnce(never); // first reconcile read also times out
    const { input, continueBtn } = setup();
    await tick(0);
    fireEvent.change(input, { target: { value: 'NameA' } });
    await tick(500);
    await act(async () => { fireEvent.click(continueBtn()); });
    await tick(12010);

    // Connection drops: fetch rejects with a network error. The POST to
    // claim NameA may already have committed server-side.
    h.read.mockReset();
    h.read.mockImplementationOnce(() => Promise.resolve({ username: 'NameA' }));
    await act(async () => { failA(new TypeError('Network request failed')); });
    await tick(10);

    // The spotter now picks NameB. Its POST is slow; the reconcile read
    // still reports NameA (committed earlier). Onboarding must not open
    // under NameA when the spotter asked for NameB.
    h.claim.mockImplementationOnce(never);
    h.read.mockImplementationOnce(() => Promise.resolve({ username: 'NameA' }));
    fireEvent.change(input, { target: { value: 'NameB' } });
    await tick(500);
    await act(async () => { fireEvent.click(continueBtn()); });
    await tick(8010);

    expect(h.setUsername).not.toHaveBeenCalledWith('NameA');
  });

  it('F5: a double tap on Continue sends exactly one claim request', async () => {
    h.read.mockImplementation(() => Promise.resolve({ username: null }));
    h.claim.mockImplementation(never);
    const { input, continueBtn } = setup();
    await tick(0);
    fireEvent.change(input, { target: { value: 'TapTap' } });
    await tick(500);
    const button = continueBtn();
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    expect(h.claim).toHaveBeenCalledTimes(1);
  });
});
