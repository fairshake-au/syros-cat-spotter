// @vitest-environment jsdom
/**
 * SYC-529: wifi with no internet behind it reports online. When a name claim
 * gets no server answer, the name screen offers "Start anyway, we'll save it
 * later", which holds the name for SYC-506's background save (it reads first).
 * A firm "taken" never offers it. Suggestions that never load fall back to
 * names made on the phone. Scaffolding copied from NameStep.reconcile.test.tsx.
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
  holdUsername: vi.fn(),
  setKeepSafeOffer: vi.fn(),
  suggestions: { data: { suggestions: [] } as any, isFetching: false, isError: false },
  availability: { data: { available: true } as any, isFetching: false, isError: false },
}));

vi.mock('@workspace/api-client-react', () => ({
  useCheckUsernameAvailability: () => h.availability,
  getCheckUsernameAvailabilityQueryKey: (p: unknown) => ['avail', p],
  useGetUsernameSuggestions: () => ({ ...h.suggestions, refetch: vi.fn() }),
  getGetUsernameSuggestionsQueryKey: () => ['sugg'],
  checkUsernameAvailability: vi.fn(),
  getClaimedUsername: (...a: unknown[]) => h.read(...a),
  claimUsername: (...a: unknown[]) => h.claim(...a),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t: (k: string) => (en as any)[k] ?? k }),
}));
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => ({ deviceId: 'dev-1', setUsername: h.setUsername, holdUsername: h.holdUsername, setKeepSafeOffer: h.setKeepSafeOffer, identityGeneration: () => 0 }) }));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: true }) }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ background: '#fff', foreground: '#000', mutedForeground: '#666', card: '#fff', border: '#ddd', primary: '#123', primaryForeground: '#fff', destructive: '#f00' }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/components/KeyboardAwareScrollViewCompat', async () => {
  const { View } = await import('react-native');
  return {
    KeyboardAwareScrollViewCompat: ({ children }: any) => <View>{children}</View>,
    KeyboardStickyViewCompat: ({ children }: any) => <View>{children}</View>,
  };
});
// A native <button> (not react-native-web's Text) so the `disabled`
// property is directly and reliably queryable from the DOM.
vi.mock('@/components/purropolis', () => ({
  Button: ({ children, onPress, disabled }: any) => (
    <button type="button" disabled={!!disabled} onClick={disabled ? undefined : onPress}>{children}</button>
  ),
  Tag: ({ children }: any) => <span>{children}</span>,
}));

import { NameStep, SUGGESTIONS_WAIT_MS } from '../onboarding/NameStep';
import { resetUsernameClaimStateForTests, runBackgroundClaim } from '@/hooks/useUsernameClaim';
import { saveHeldName } from '@/lib/heldNameSave';

const never = () => new Promise<never>(() => {});
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

function setup() {
  const view = render(<NameStep onBack={() => {}} />);
  const input = view.container.querySelector('input')!;
  const continueBtn = () =>
    view.getAllByRole('button').find((b) => /Start spotting|Retry|Saving/.test(b.textContent ?? '')) as HTMLButtonElement;
  const startAnyway = () => view.container.querySelector('[data-testid="start-anyway"]') as HTMLElement | null;
  return { view, input, continueBtn, startAnyway };
}

async function claim(s: ReturnType<typeof setup>, name: string) {
  await tick(0);
  fireEvent.change(s.input, { target: { value: name } });
  await tick(500);
  await act(async () => { fireEvent.click(s.continueBtn()); });
}

beforeEach(() => {
  resetUsernameClaimStateForTests();
  vi.useFakeTimers();
  for (const fn of [h.claim, h.read, h.setUsername, h.holdUsername, h.setKeepSafeOffer]) fn.mockReset();
  h.availability = { data: { available: true }, isFetching: false, isError: false };
  h.suggestions = { data: { suggestions: [] }, isFetching: false, isError: false };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Start anyway (SYC-529)', () => {
  it('a firm "taken" shows the taken message and never offers Start anyway', async () => {
    h.read.mockImplementation(never);
    h.claim.mockRejectedValueOnce({ status: 409 });
    const s = setup();
    await claim(s, 'TakenCat');
    await tick(10);
    expect(s.view.container.textContent).toContain(en.landingTaken);
    expect(s.startAnyway()).toBeNull();
    expect(h.holdUsername).not.toHaveBeenCalled();
  });

  it('no answer from the server: Start anyway holds the name, skips the keep-safe offer, sends nothing more', async () => {
    h.read.mockImplementation(never);
    h.claim.mockImplementationOnce(never);
    const s = setup();
    await claim(s, 'FerryCat');
    expect(s.startAnyway()).toBeNull(); // still waiting: not offered yet
    await tick(12010);
    expect(s.view.container.textContent).toContain(en.usernameClaimUncertain);
    expect(s.startAnyway()?.textContent).toBe(en.usernameStartAnyway);
    await act(async () => { fireEvent.click(s.startAnyway()!); });
    expect(h.holdUsername).toHaveBeenCalledWith('FerryCat');
    expect(h.setKeepSafeOffer).toHaveBeenCalledWith('skipped-onboarding');
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.setUsername).not.toHaveBeenCalled();
  });

  it('the claim had landed after all: the background save reads first and sends nothing', async () => {
    h.read.mockImplementation(never);
    h.claim.mockImplementationOnce(never);
    const s = setup();
    await claim(s, 'FerryCat');
    await tick(12010);
    await act(async () => { fireEvent.click(s.startAnyway()!); });

    // The lock is released, so the background save is allowed to run.
    const read = vi.fn().mockResolvedValue({ username: 'FerryCat' });
    const send = vi.fn();
    const result = await runBackgroundClaim(() =>
      saveHeldName('dev-1', 'FerryCat', { read, claim: send, numbered: (n) => n + '1', suggest: () => 'X' }),
    );
    expect(result).toEqual({ kind: 'saved', username: 'FerryCat', note: null });
    expect(send).not.toHaveBeenCalled();
  });

  it('the claim never landed: the background save sends it once, and a late first answer cannot rename the spotter', async () => {
    let land!: (v: unknown) => void;
    h.read.mockImplementation(never);
    h.claim.mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const s = setup();
    await claim(s, 'FerryCat');
    await tick(12010);
    await act(async () => { fireEvent.click(s.startAnyway()!); });

    const read = vi.fn().mockResolvedValue({ username: null });
    const send = vi.fn().mockResolvedValue({ username: 'FerryCat' });
    const result = await runBackgroundClaim(() =>
      saveHeldName('dev-1', 'FerryCat', { read, claim: send, numbered: (n) => n + '1', suggest: () => 'X' }),
    );
    expect(result).toMatchObject({ kind: 'saved', username: 'FerryCat' });
    expect(send).toHaveBeenCalledTimes(1);

    // The original request finally answers with the same name: same result.
    await act(async () => { land({ username: 'FerryCat' }); });
    for (const call of h.setUsername.mock.calls) expect(call[0]).toBe('FerryCat');
  });

  it('is not offered while a claim is still sending', async () => {
    h.read.mockImplementation(never);
    h.claim.mockImplementationOnce(never);
    const s = setup();
    await claim(s, 'FerryCat');
    await tick(3000);
    expect(s.startAnyway()).toBeNull();
  });
});

describe('suggestions that never load (SYC-529)', () => {
  it('spin at first, then names made on the phone appear after the wait', async () => {
    h.suggestions = { data: undefined, isFetching: true, isError: false };
    const s = setup();
    await tick(0);
    const chips = () => Array.from(s.view.container.querySelectorAll('span')).filter((x) => x.textContent?.startsWith('@'));
    expect(chips().length).toBe(0);
    await tick(SUGGESTIONS_WAIT_MS + 50);
    expect(chips().length).toBe(4);
  });

  it('server suggestions are used when they arrive in time', async () => {
    h.suggestions = { data: { suggestions: ['SunnyTabby', 'BlueKitten'] }, isFetching: false, isError: false };
    const s = setup();
    await tick(SUGGESTIONS_WAIT_MS + 50);
    expect(s.view.container.textContent).toContain('@SunnyTabby');
  });
});
