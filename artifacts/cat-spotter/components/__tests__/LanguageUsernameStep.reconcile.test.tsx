// @vitest-environment jsdom
/**
 * SYC-211 companion to LanguageUsernameStep.test.tsx: the reconcile rules
 * after a late, unclear failure (approved behaviour 3), pinned separately.
 * Scaffolding copied from that file.
 *
 * Original header follows.
 *
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

describe('LanguageUsernameStep reconcile after a late failure (SYC-211 F3)', () => {
  async function claimThenLoseConnection(name: string) {
    let fail!: (e: unknown) => void;
    h.claim.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    h.read.mockImplementation(never); // mount read and first reconcile read time out
    const s = setup();
    await tick(0);
    fireEvent.change(s.input, { target: { value: name } });
    await tick(500);
    await act(async () => { fireEvent.click(s.continueBtn()); });
    await tick(12010);
    expect(s.view.container.textContent).toContain(en.usernameClaimUncertain);
    expect(s.input.readOnly).toBe(true);
    return { ...s, fail };
  }

  it('server confirms the name was not saved: unlocks; a later reconcile for NameB that reports NameA is not accepted', async () => {
    const s = await claimThenLoseConnection('NameA');
    h.read.mockReset();
    h.read.mockImplementationOnce(() => Promise.resolve({ username: null }));
    await act(async () => { s.fail(new TypeError('Network request failed')); });
    await tick(10);
    expect(s.input.readOnly).toBe(false);
    expect(s.view.container.textContent).toContain(en.error);

    h.claim.mockImplementationOnce(never);
    h.read.mockImplementationOnce(() => Promise.resolve({ username: 'NameA' }));
    fireEvent.change(s.input, { target: { value: 'NameB' } });
    await tick(500);
    await act(async () => { fireEvent.click(s.continueBtn()); });
    await tick(8010);

    expect(h.setUsername).not.toHaveBeenCalled();
    expect(s.continueBtn().textContent).toBe(en.usernameRetryClaim);
    expect(s.input.value).toBe('NameB');
  });

  it('server holds the submitted name (normalised): opens as that name', async () => {
    const s = await claimThenLoseConnection('Sea  Cat');
    h.read.mockReset();
    h.read.mockImplementationOnce(() => Promise.resolve({ username: 'sea cat' }));
    await act(async () => { s.fail(new TypeError('Network request failed')); });
    await tick(10);
    expect(h.setUsername).toHaveBeenCalledTimes(1);
    expect(h.setUsername).toHaveBeenCalledWith('sea cat');
  });

  it('server holds a different name: not accepted, and the screen unlocks', async () => {
    const s = await claimThenLoseConnection('NameA');
    h.read.mockReset();
    h.read.mockImplementationOnce(() => Promise.resolve({ username: 'SomeoneElse' }));
    await act(async () => { s.fail(new TypeError('Network request failed')); });
    await tick(10);
    expect(h.setUsername).not.toHaveBeenCalled();
    expect(s.input.readOnly).toBe(false);
  });

  it('the follow-up read also fails: stays locked, and only the same name can be retried', async () => {
    const s = await claimThenLoseConnection('NameA');
    h.read.mockReset();
    h.read.mockImplementation(() => Promise.reject(new TypeError('Network request failed')));
    await act(async () => { s.fail(new TypeError('Network request failed')); });
    await tick(10);
    expect(s.input.readOnly).toBe(true);
    expect(s.continueBtn().textContent).toBe(en.usernameRetryClaim);
    expect(s.continueBtn().disabled).toBe(false);
    expect(h.setUsername).not.toHaveBeenCalled();

    h.claim.mockImplementationOnce(() => Promise.resolve({ username: 'NameA' }));
    await act(async () => { fireEvent.click(s.continueBtn()); });
    await tick(10);
    expect(h.claim).toHaveBeenLastCalledWith('dev-1', { username: 'NameA' });
    expect(h.setUsername).toHaveBeenCalledWith('NameA');
  });

  it('a firm 409 disables Continue for that name until the spotter changes it', async () => {
    h.read.mockImplementation(() => Promise.resolve({ username: null }));
    h.claim.mockImplementationOnce(() => Promise.reject({ status: 409 }));
    const s = setup();
    await tick(0);
    fireEvent.change(s.input, { target: { value: 'Taken' } });
    await tick(500);
    await act(async () => { fireEvent.click(s.continueBtn()); });
    await tick(10);
    expect(s.view.container.textContent).toContain(en.landingTaken);
    expect(s.continueBtn().disabled).toBe(true);
    fireEvent.change(s.input, { target: { value: 'Taken2' } });
    await tick(500);
    expect(s.continueBtn().disabled).toBe(false);
  });

  it('a retry that fails unclearly does not unlock while the earlier same-name request is still open', async () => {
    h.read.mockImplementation(() => Promise.resolve({ username: null }));
    h.claim.mockImplementationOnce(never); // first POST stays open
    const s = setup();
    await tick(0);
    fireEvent.change(s.input, { target: { value: 'SeaCat' } });
    await tick(500);
    await act(async () => { fireEvent.click(s.continueBtn()); });
    await tick(8010);
    expect(s.input.readOnly).toBe(true);

    // The retry dies with a network error; the server does not hold the name
    // yet, but the first POST could still commit, so the lock must hold.
    h.claim.mockImplementationOnce(() => Promise.reject(new TypeError('Network request failed')));
    await act(async () => { fireEvent.click(s.continueBtn()); });
    await tick(10);
    expect(s.input.readOnly).toBe(true);
    expect(s.continueBtn().textContent).toBe(en.usernameRetryClaim);
  });

  it('the startup recovery read does not override a claim the spotter has already sent', async () => {
    h.read.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({ username: 'OtherName' }), 2000)));
    h.read.mockImplementation(() => Promise.resolve({ username: null }));
    h.claim.mockImplementationOnce(never);
    const s = setup();
    await tick(0);
    fireEvent.change(s.input, { target: { value: 'MyPick' } });
    await tick(500);
    await act(async () => { fireEvent.click(s.continueBtn()); });
    await tick(2000);
    expect(h.setUsername).not.toHaveBeenCalledWith('OtherName');
  });
});
