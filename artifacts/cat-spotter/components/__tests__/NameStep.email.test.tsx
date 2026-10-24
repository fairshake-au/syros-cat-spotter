// @vitest-environment jsdom
/**
 * SYC-524: the last onboarding screen asks for the name and, optionally, an
 * email ("Don't lose your spots"). Spec: docs/specs/onboarding-fewer-screens.md,
 * "Screen 3" and "The rules underneath" (Offer state, Order of saves,
 * Identity changes mid-save, Screen state, Server answers).
 *
 * The order matters because the failures are silent: a saved name opens the
 * app by itself, so the email is added first; the offer is written as
 * `skipped-onboarding` before anything is saved, so the root gate never shows
 * the old keep-safe screen to a new spotter.
 *
 * Scaffolding follows NameStep.test.tsx (every module boundary mocked, the
 * real component rendered through react-native-web, fake timers).
 */
import React from 'react';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATIONS } from '@/lib/i18n';

const en = TRANSLATIONS.en;

const h = vi.hoisted(() => ({
  claim: vi.fn(),
  read: vi.fn(),
  add: vi.fn(),
  setUsername: vi.fn(),
  holdUsername: vi.fn(),
  setKeepSafeOffer: vi.fn(),
  /** Every call in order, so the tests can check what came before what. */
  log: [] as string[],
  offer: null as null | 'skipped-onboarding' | 'done',
  /** The stored offer at the moment each name was set. */
  offerWhenNamed: [] as (null | string)[],
  gen: 0,
  online: true,
  availability: { data: { available: true } as any, isFetching: false, isError: false },
}));

vi.mock('@workspace/api-client-react', () => ({
  // Just enough of the real class for lib/keepSafe's isInvalidEmail.
  ApiError: class ApiError extends Error {
    constructor(public status: number, public data: unknown) { super(`HTTP ${status}`); }
  },
  useCheckUsernameAvailability: () => h.availability,
  getCheckUsernameAvailabilityQueryKey: (p: unknown) => ['avail', p],
  useGetUsernameSuggestions: () => ({ data: { suggestions: [] }, isFetching: false, refetch: vi.fn() }),
  getGetUsernameSuggestionsQueryKey: () => ['sugg'],
  checkUsernameAvailability: vi.fn(),
  getClaimedUsername: (...a: unknown[]) => h.read(...a),
  claimUsername: (...a: unknown[]) => {
    h.log.push('claim');
    return h.claim(...a);
  },
}));
vi.mock('@/lib/keepSafe', async () => {
  const actual = await vi.importActual<typeof import('@/lib/keepSafe')>('@/lib/keepSafe');
  return {
    ...actual,
    addKeepSafe: (...a: unknown[]) => {
      h.log.push('addKeepSafe');
      return h.add(...a);
    },
  };
});
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t: (k: string) => (en as any)[k] ?? k }),
}));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({
    deviceId: 'dev-1',
    keepSafeOffer: h.offer,
    identityGeneration: () => h.gen,
    setUsername: (name: string) => {
      h.log.push(`setUsername:${name}`);
      h.offerWhenNamed.push(h.offer);
      h.setUsername(name);
    },
    holdUsername: (name: string) => {
      h.log.push(`holdUsername:${name}`);
      h.holdUsername(name);
    },
    setKeepSafeOffer: (value: 'skipped-onboarding' | 'done') => {
      h.log.push(`offer:${value}`);
      h.offer = value;
      h.setKeepSafeOffer(value);
    },
  }),
}));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: h.online }) }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ background: '#fff', foreground: '#000', mutedForeground: '#666', card: '#fff', border: '#ddd', primary: '#123', primaryForeground: '#fff', destructive: '#f00' }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/components/KeyboardAwareScrollViewCompat', async () => {
  const { View } = await import('react-native');
  return {
    KeyboardAwareScrollViewCompat: ({ children }: any) => <View testID="scroll">{children}</View>,
    KeyboardStickyViewCompat: ({ children }: any) => <View testID="sticky-footer">{children}</View>,
  };
});
vi.mock('@/components/purropolis', () => ({
  Button: ({ children, onPress, disabled }: any) => (
    <button type="button" disabled={!!disabled} onClick={disabled ? undefined : onPress}>{children}</button>
  ),
  Tag: ({ children }: any) => <span>{children}</span>,
}));

import { ApiError } from '@workspace/api-client-react';
import { NameStep } from '../onboarding/NameStep';
import { resetUsernameClaimStateForTests } from '@/hooks/useUsernameClaim';
import { resetOnboardingEmailForTests } from '../onboarding/useOnboardingEmail';

const never = () => new Promise<never>(() => {});
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup() {
  const view = render(<NameStep onBack={() => {}} />);
  const nameInput = () => view.container.querySelector('input:not([data-testid="onboarding-email"])') as HTMLInputElement;
  const emailInput = () => view.container.querySelector('[data-testid="onboarding-email"]') as HTMLInputElement | null;
  const startBtn = () =>
    view.getAllByRole('button').find((b) =>
      [en.startSpotting, en.usernameClaiming, en.usernameRetryClaim].includes(b.textContent ?? ''),
    ) as HTMLButtonElement;
  const backBtn = () => view.getByRole('button', { name: en.back }) as HTMLElement;
  const typeName = async (name: string) => {
    fireEvent.change(nameInput(), { target: { value: name } });
    await tick(500);
  };
  const typeEmail = (email: string) => fireEvent.change(emailInput()!, { target: { value: email } });
  const tap = async () => {
    await act(async () => { fireEvent.click(startBtn()); });
    await tick(10);
  };
  return { view, nameInput, emailInput, startBtn, backBtn, typeName, typeEmail, tap };
}

beforeEach(() => {
  resetUsernameClaimStateForTests();
  resetOnboardingEmailForTests();
  vi.useFakeTimers();
  for (const fn of [h.claim, h.read, h.add, h.setUsername, h.holdUsername, h.setKeepSafeOffer]) fn.mockReset();
  h.read.mockImplementation(() => Promise.resolve({ username: null }));
  h.log = [];
  h.offer = null;
  h.offerWhenNamed = [];
  h.gen = 0;
  h.online = true;
  h.availability = { data: { available: true }, isFetching: false, isError: false };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('NameStep: "Don\'t lose your spots" on the name screen (SYC-524)', () => {
  it('shows the email block under the name, and one Start spotting button in a footer outside the scroll', () => {
    const s = setup();
    const text = s.view.container.textContent ?? '';
    for (const key of ['makeItYours', 'keepSafeTitle', 'keepSafeOptional', 'keepSafeBody', 'keepSafeWarning', 'keepSafeUnder15'] as const) {
      expect(text).toContain(en[key]);
    }
    expect(text).not.toContain(en.keepSafeOptionalRest);
    expect(s.emailInput()).not.toBeNull();
    const scroll = s.view.getByTestId('scroll');
    const footer = s.view.getByTestId('sticky-footer');
    expect(footer.contains(s.startBtn())).toBe(true);
    expect(scroll.contains(s.startBtn())).toBe(false);
    expect(s.startBtn().textContent).toBe(en.startSpotting);
  });

  it('empty email: nothing is added, the offer is skipped-onboarding before the claim, then the claim runs', async () => {
    h.claim.mockResolvedValue({ username: 'SeaCat' });
    const s = setup();
    await tick(0);
    await s.typeName('SeaCat');
    await s.tap();
    expect(h.add).not.toHaveBeenCalled();
    expect(h.log).toEqual(['offer:skipped-onboarding', 'claim', 'setUsername:SeaCat']);
    expect(h.offer).toBe('skipped-onboarding');
  });

  it('invalid email: neither the email nor the name is sent, and the email error shows', async () => {
    const s = setup();
    await tick(0);
    await s.typeName('SeaCat');
    s.typeEmail('not-an-email');
    await s.tap();
    expect(h.add).not.toHaveBeenCalled();
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.setKeepSafeOffer).not.toHaveBeenCalled();
    expect(s.view.container.textContent).toContain(en.keepSafeInvalidEmail);
  });

  it('valid email: added (from onboarding) before the claim, the offer becomes done, then the claim runs', async () => {
    h.add.mockResolvedValue({ status: 'pending', addressMask: 's***@example.com' });
    h.claim.mockResolvedValue({ username: 'SeaCat' });
    const s = setup();
    await tick(0);
    await s.typeName('SeaCat');
    s.typeEmail('  sea@example.com ');
    await s.tap();
    expect(h.add).toHaveBeenCalledWith('dev-1', { email: 'sea@example.com', language: 'en', surface: 'onboarding' });
    expect(h.log).toEqual(['offer:skipped-onboarding', 'addKeepSafe', 'offer:done', 'claim', 'setUsername:SeaCat']);
    expect(h.offerWhenNamed).toEqual(['done']);
  });

  it('email fails: no claim, the error shows, a second tap retries; emptying the box then claims as skipped', async () => {
    h.add.mockRejectedValue(new TypeError('Network request failed'));
    h.claim.mockResolvedValue({ username: 'SeaCat' });
    const s = setup();
    await tick(0);
    await s.typeName('SeaCat');
    s.typeEmail('sea@example.com');
    await s.tap();
    expect(h.add).toHaveBeenCalledTimes(1);
    expect(h.claim).not.toHaveBeenCalled();
    expect(s.view.container.textContent).toContain(en.keepSafeSaveFailed);

    await s.tap();
    expect(h.add).toHaveBeenCalledTimes(2);
    expect(h.claim).not.toHaveBeenCalled();

    s.typeEmail('');
    await s.tap();
    expect(h.add).toHaveBeenCalledTimes(2);
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.setUsername).toHaveBeenCalledWith('SeaCat');
    expect(h.offer).toBe('skipped-onboarding');
    expect(h.setKeepSafeOffer).not.toHaveBeenCalledWith('done');
  });

  it('a not_configured answer (test site without mail) shows the save-failed line', async () => {
    h.add.mockRejectedValue(new (ApiError as any)(503, { error: 'not_configured' }));
    const s = setup();
    await tick(0);
    await s.typeName('SeaCat');
    s.typeEmail('sea@example.com');
    await s.tap();
    expect(s.view.container.textContent).toContain(en.keepSafeSaveFailed);
    expect(h.claim).not.toHaveBeenCalled();
  });

  it('the server refusing the address shows the invalid-email line, and nothing else is saved', async () => {
    h.add.mockRejectedValue(new (ApiError as any)(400, { error: 'invalid_email' }));
    const s = setup();
    await tick(0);
    await s.typeName('SeaCat');
    s.typeEmail('sea@example.com');
    await s.tap();
    expect(s.view.container.textContent).toContain(en.keepSafeInvalidEmail);
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.setKeepSafeOffer).not.toHaveBeenCalledWith('done');
  });

  it('email saved, name taken: the box shows Saved, and after a new name the email is not sent again', async () => {
    h.add.mockResolvedValue({ status: 'pending', addressMask: 's***@example.com' });
    h.claim.mockImplementationOnce(() => Promise.reject({ status: 409 }));
    const s = setup();
    await tick(0);
    await s.typeName('TakenName');
    s.typeEmail('sea@example.com');
    await s.tap();
    expect(h.add).toHaveBeenCalledTimes(1);
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(s.view.container.textContent).toContain(en.landingTaken);
    expect(s.view.container.textContent).toContain(en.saved);
    expect(h.setUsername).not.toHaveBeenCalled();

    h.claim.mockResolvedValueOnce({ username: 'OtherName' });
    await s.typeName('OtherName');
    await s.tap();
    expect(h.add).toHaveBeenCalledTimes(1);
    expect(h.claim).toHaveBeenCalledTimes(2);
    expect(h.setUsername).toHaveBeenCalledWith('OtherName');
    expect(h.offerWhenNamed).toEqual(['done']);
  });

  it('a changed address after saving clears Saved and is sent', async () => {
    h.add.mockResolvedValue({ status: 'pending', addressMask: 's***@example.com' });
    h.claim.mockImplementationOnce(() => Promise.reject({ status: 409 }));
    const s = setup();
    await tick(0);
    await s.typeName('TakenName');
    s.typeEmail('sea@example.com');
    await s.tap();
    expect(s.view.container.textContent).toContain(en.saved);
    s.typeEmail('cat@example.com');
    expect(s.view.container.textContent).not.toContain(en.saved);
    h.claim.mockResolvedValueOnce({ username: 'OtherName' });
    await s.typeName('OtherName');
    await s.tap();
    expect(h.add).toHaveBeenCalledTimes(2);
    expect(h.add).toHaveBeenLastCalledWith('dev-1', { email: 'cat@example.com', language: 'en', surface: 'onboarding' });
  });

  it('an email saved here is not sent again after Back and return', async () => {
    h.add.mockResolvedValue({ status: 'pending', addressMask: 's***@example.com' });
    h.claim.mockImplementationOnce(() => Promise.reject({ status: 409 }));
    const first = setup();
    await tick(0);
    await first.typeName('TakenName');
    first.typeEmail('sea@example.com');
    await first.tap();
    first.view.unmount();

    h.claim.mockResolvedValueOnce({ username: 'OtherName' });
    const again = setup();
    await tick(0);
    expect(again.emailInput()!.value).toBe('sea@example.com');
    expect(again.view.container.textContent).toContain(en.saved);
    await again.typeName('OtherName');
    await again.tap();
    expect(h.add).toHaveBeenCalledTimes(1);
    expect(h.setUsername).toHaveBeenCalledWith('OtherName');
    expect(h.offer).toBe('done');
  });

  it('offline: the offline line replaces the box, the offer is skipped-onboarding, the name is held; online again keeps the typed email', async () => {
    const s = setup();
    await tick(0);
    s.typeEmail('sea@exam');

    h.online = false;
    s.view.rerender(<NameStep onBack={() => {}} />);
    expect(s.emailInput()).toBeNull();
    expect(s.view.container.textContent).toContain(en.keepSafeOffline);

    h.online = true;
    s.view.rerender(<NameStep onBack={() => {}} />);
    expect(s.emailInput()!.value).toBe('sea@exam');
    expect(s.view.container.textContent).not.toContain(en.keepSafeOffline);

    h.online = false;
    s.view.rerender(<NameStep onBack={() => {}} />);
    fireEvent.change(s.nameInput(), { target: { value: 'SeaCat' } });
    await s.tap();
    expect(h.add).not.toHaveBeenCalled();
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.log).toEqual(['offer:skipped-onboarding', 'holdUsername:SeaCat']);
  });

  it('identity changes mid-save: the email result is ignored, no claim, and nothing is written after the change', async () => {
    const pendingAdd = deferred<unknown>();
    h.add.mockImplementation(() => pendingAdd.promise);
    const s = setup();
    await tick(0);
    await s.typeName('SeaCat');
    s.typeEmail('sea@example.com');
    await s.tap();
    expect(h.add).toHaveBeenCalledTimes(1);

    h.gen += 1; // "Delete my data", "Get your spots back" or a restore link
    const writesBefore = h.setKeepSafeOffer.mock.calls.length;
    await act(async () => { pendingAdd.resolve({ status: 'pending', addressMask: 's***@example.com' }); });
    await tick(10);

    expect(h.claim).not.toHaveBeenCalled();
    expect(h.setKeepSafeOffer.mock.calls.length).toBe(writesBefore);
    expect(h.setUsername).not.toHaveBeenCalled();
  });

  it('identity changes while the claim is in flight: the claimed name is not set', async () => {
    const pendingClaim = deferred<unknown>();
    h.claim.mockImplementation(() => pendingClaim.promise);
    const s = setup();
    await tick(0);
    await s.typeName('SeaCat');
    await s.tap();
    expect(h.claim).toHaveBeenCalledTimes(1);
    h.gen += 1;
    await act(async () => { pendingClaim.resolve({ username: 'SeaCat' }); });
    await tick(10);
    expect(h.setUsername).not.toHaveBeenCalled();
  });

  it('Back is disabled while the email is saving, and enabled again after', async () => {
    const pendingAdd = deferred<unknown>();
    h.add.mockImplementation(() => pendingAdd.promise);
    const onBack = vi.fn();
    const view = render(<NameStep onBack={onBack} />);
    await tick(0);
    fireEvent.change(view.container.querySelector('input')!, { target: { value: 'SeaCat' } });
    await tick(500);
    fireEvent.change(view.container.querySelector('[data-testid="onboarding-email"]')!, { target: { value: 'sea@example.com' } });
    const start = view.getAllByRole('button').find((b) => b.textContent === en.startSpotting)!;
    await act(async () => { fireEvent.click(start); });

    const back = view.getByRole('button', { name: en.back });
    expect(back.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(back);
    expect(onBack).not.toHaveBeenCalled();

    await act(async () => { pendingAdd.reject(new TypeError('Network request failed')); });
    await tick(10);
    expect(back.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('a double tap while the email saves sends it once', async () => {
    const pendingAdd = deferred<unknown>();
    h.add.mockImplementation(() => pendingAdd.promise);
    const s = setup();
    await tick(0);
    await s.typeName('SeaCat');
    s.typeEmail('sea@example.com');
    const button = s.startBtn();
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    expect(h.add).toHaveBeenCalledTimes(1);
  });

  it('late reconcile: with the email failed and the screen open, a recovered name finds the offer already skipped-onboarding', async () => {
    const recovered = deferred<{ username: string | null }>();
    h.read.mockImplementation(() => recovered.promise);
    h.add.mockRejectedValue(new TypeError('Network request failed'));
    const s = setup();
    await tick(0);
    await s.typeName('SeaCat');
    s.typeEmail('sea@example.com');
    await s.tap();
    expect(s.view.container.textContent).toContain(en.keepSafeSaveFailed);
    expect(h.claim).not.toHaveBeenCalled();

    // An earlier claim (before a relaunch) landed on the server; the
    // recover-on-mount read now reports it and the app opens.
    await act(async () => { recovered.resolve({ username: 'EarlierName' }); });
    await tick(10);
    expect(h.setUsername).toHaveBeenCalledWith('EarlierName');
    expect(h.offerWhenNamed).toEqual(['skipped-onboarding']);
  });
});
