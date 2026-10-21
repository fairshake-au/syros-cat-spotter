// @vitest-environment jsdom
/**
 * SYC-506: a visitor without a connection can start. The name screen offers
 * names made on the phone, "Start spotting" keeps the chosen name on the
 * phone (held, not claimed), and nothing is sent to the server.
 * SYC-155: the language list is no longer on this screen.
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
  online: false,
}));

vi.mock('@workspace/api-client-react', () => ({
  useCheckUsernameAvailability: () => ({ data: undefined, isFetching: false, isError: false }),
  getCheckUsernameAvailabilityQueryKey: (p: unknown) => ['avail', p],
  useGetUsernameSuggestions: () => ({ data: undefined, isFetching: false, refetch: vi.fn() }),
  getGetUsernameSuggestionsQueryKey: () => ['sugg'],
  checkUsernameAvailability: vi.fn(),
  getClaimedUsername: (...a: unknown[]) => h.read(...a),
  claimUsername: (...a: unknown[]) => h.claim(...a),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t: (k: string) => (en as any)[k] ?? k }),
}));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({
    deviceId: 'dev-1',
    setUsername: h.setUsername,
    holdUsername: h.holdUsername,
    setKeepSafeOffer: h.setKeepSafeOffer,
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
  return { KeyboardAwareScrollViewCompat: ({ children }: any) => <View>{children}</View> };
});
vi.mock('@/components/purropolis', () => ({
  Button: ({ children, onPress, disabled }: any) => (
    <button type="button" disabled={!!disabled} onClick={disabled ? undefined : onPress}>{children}</button>
  ),
  Tag: ({ children }: any) => <span>{children}</span>,
}));

import { LanguageUsernameStep } from '../onboarding/LanguageUsernameStep';
import { resetUsernameClaimStateForTests } from '@/hooks/useUsernameClaim';

function setup() {
  const view = render(<LanguageUsernameStep onBack={() => {}} />);
  const input = view.container.querySelector('input')!;
  // The purropolis Button mock is the only element with type="button" text.
  const mainButton = () =>
    [...view.container.querySelectorAll('button[type="button"]')].at(-1) as HTMLButtonElement;
  return { view, input, mainButton };
}

beforeEach(() => {
  resetUsernameClaimStateForTests();
  vi.useFakeTimers();
  for (const fn of [h.claim, h.read, h.setUsername, h.holdUsername, h.setKeepSafeOffer]) fn.mockReset();
  h.online = false;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('LanguageUsernameStep offline (SYC-506)', () => {
  it('shows names made on the phone, the offline note and "Start spotting"', () => {
    const { view, mainButton } = setup();
    expect(view.container.textContent).toContain(en.offlineNameNote);
    expect(view.container.textContent).not.toContain(en.landingOffline);
    expect(mainButton().textContent).toBe(en.startSpotting);
    const chips = [...view.container.querySelectorAll('span')].filter((s) => s.textContent?.startsWith('@'));
    expect(chips.length).toBe(4);
  });

  it('a suggested name, then Start spotting, holds it on the phone and sends nothing', async () => {
    const { view, input, mainButton } = setup();
    const chip = [...view.container.querySelectorAll('span')].find((s) => s.textContent?.startsWith('@'))!;
    const name = chip.textContent!.slice(1);
    await act(async () => { fireEvent.click(chip); });
    expect(input.value).toBe(name);
    expect(mainButton().disabled).toBe(false);
    await act(async () => { fireEvent.click(mainButton()); });
    expect(h.holdUsername).toHaveBeenCalledWith(name);
    expect(h.setKeepSafeOffer).toHaveBeenCalledWith('skipped-onboarding');
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.setUsername).not.toHaveBeenCalled();
  });

  it('a typed name is tidied like the server would before it is held', async () => {
    const { input, mainButton } = setup();
    fireEvent.change(input, { target: { value: '  Sea   Cat ' } });
    await act(async () => { fireEvent.click(mainButton()); });
    expect(h.holdUsername).toHaveBeenCalledWith('Sea Cat');
  });

  it('a name the server would refuse is flagged and cannot be held', async () => {
    const { view, input, mainButton } = setup();
    fireEvent.change(input, { target: { value: 'cat@home' } });
    expect(view.container.textContent).toContain(en.landingInvalid);
    expect(mainButton().disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'ab' } });
    expect(mainButton().disabled).toBe(true);
    expect(h.holdUsername).not.toHaveBeenCalled();
  });

  it('online, the screen claims as before and never holds', async () => {
    h.online = true;
    h.read.mockResolvedValue({ username: null });
    h.claim.mockResolvedValue({ username: 'SeaCat' });
    const { input, mainButton } = setup();
    expect(mainButton().textContent).toBe(en.continue);
    fireEvent.change(input, { target: { value: 'SeaCat' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await act(async () => { fireEvent.click(mainButton()); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.setUsername).toHaveBeenCalledWith('SeaCat');
    expect(h.holdUsername).not.toHaveBeenCalled();
  });

  it('has no language list (SYC-155: it moved to Welcome)', () => {
    h.online = true;
    h.read.mockResolvedValue({ username: null });
    const { view } = setup();
    expect(view.queryAllByRole('radio')).toHaveLength(0);
    expect(view.container.textContent).not.toContain('Ελληνικά');
    expect(view.container.textContent).toContain(en.nameScreenSubtitle);
  });
});
