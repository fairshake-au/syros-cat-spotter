// @vitest-environment jsdom
/**
 * SYC-211: same bugs as NameStep.test.tsx, for the Profile-tab
 * editor. See docs/reviews/username-claim-adversarial-review.md (branch
 * review/username-claim-2026-10-05) for F1/F5/F7.
 *
 * UsernameEditor's Save/Cancel are plain `Pressable`s with no
 * `accessibilityRole`, so they render as `<div>` with `aria-disabled`/
 * `tabindex` rather than a real `<button>` (unlike NameStep's
 * Back, which sets `accessibilityRole="button"`). Query by text and check
 * the Pressable's own attributes, not `getByRole('button')`.
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
  invalidate: vi.fn(),
  availability: { data: { available: true } as any, isFetching: false, isError: false },
}));

vi.mock('@workspace/api-client-react', () => ({
  useCheckUsernameAvailability: () => h.availability,
  getCheckUsernameAvailabilityQueryKey: (p: unknown) => ['avail', p],
  checkUsernameAvailability: vi.fn(),
  getClaimedUsername: (...a: unknown[]) => h.read(...a),
  claimUsername: (...a: unknown[]) => h.claim(...a),
  getGetProfileQueryKey: (id: string) => ['profile', id],
  getGetLeaderboardQueryKey: () => ['leaderboard'],
  getGetLeaderboardWeekQueryKey: () => ['leaderboard-week'],
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: h.invalidate }),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => (en as any)[k] ?? k }),
}));
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => ({ deviceId: 'dev-1', setUsername: h.setUsername }) }));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: true }) }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ background: '#fff', foreground: '#000', mutedForeground: '#666', card: '#fff', border: '#ddd', primary: '#123', primaryForeground: '#fff', destructive: '#f00' }),
}));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));

import { UsernameEditor } from '../UsernameEditor';
import { resetUsernameClaimStateForTests } from '@/hooks/useUsernameClaim';

const never = () => new Promise<never>(() => {});
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

function setup(currentUsername: string | null = 'OldName') {
  const view = render(<UsernameEditor currentUsername={currentUsername} />);
  fireEvent.click(view.getByText(en.usernameEdit));
  const input = view.container.querySelector('input')!;
  // Save is the Pressable immediately after the input in the edit row.
  const saveContainer = () => input.nextElementSibling as HTMLElement;
  const cancelContainer = () => view.getByText(en.usernameCancel).parentElement as HTMLElement;
  return { view, input, saveContainer, cancelContainer };
}

beforeEach(() => {
  resetUsernameClaimStateForTests();
  vi.useFakeTimers();
  h.claim.mockReset();
  h.read.mockReset();
  h.setUsername.mockReset();
  h.invalidate.mockReset();
  h.availability = { data: { available: true }, isFetching: false, isError: false };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('UsernameEditor (SYC-211)', () => {
  it('SYC-706: a rename refreshes the all-time and the weekly board', async () => {
    h.read.mockImplementation(() => Promise.resolve({ username: null }));
    h.claim.mockImplementationOnce(() => Promise.resolve({ username: 'SeaCat' }));
    const { input, saveContainer } = setup();
    fireEvent.change(input, { target: { value: 'SeaCat' } });
    await tick(500);
    await act(async () => { fireEvent.click(saveContainer()); });
    await tick(10);
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ['leaderboard'] });
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ['leaderboard-week'] });
  });

  it('F1: Cancel stays enabled through a pending and an uncertain claim', async () => {
    h.read.mockImplementation(() => Promise.resolve({ username: null }));
    h.claim.mockImplementationOnce(never);
    const { input, saveContainer, cancelContainer } = setup();
    fireEvent.change(input, { target: { value: 'SeaCat' } });
    await tick(500);
    await act(async () => { fireEvent.click(saveContainer()); });

    // Mid-flight: the claim is pending.
    expect(cancelContainer().getAttribute('aria-disabled')).not.toBe('true');

    await tick(8000 + 4000 + 10);
    // Now uncertain.
    expect(cancelContainer().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('F1: a firm rejection on retry clears the locked name and unlocks the input, even with the original request still outstanding', async () => {
    h.read.mockImplementation(() => Promise.resolve({ username: null }));
    h.claim.mockImplementationOnce(never);
    const { view, input, saveContainer } = setup();
    fireEvent.change(input, { target: { value: 'SeaCat' } });
    await tick(500);
    await act(async () => { fireEvent.click(saveContainer()); });
    await tick(8000 + 4000 + 10);
    expect(view.container.textContent).toContain(en.usernameClaimUncertain);

    h.claim.mockImplementationOnce(() => Promise.reject({ status: 409 }));
    await act(async () => { fireEvent.click(saveContainer()); });
    await tick(10);

    expect(view.container.textContent).toContain(en.landingTaken);
    expect(input.readOnly).toBe(false);
    fireEvent.change(input, { target: { value: 'OtherName' } });
    expect(input.value).toBe('OtherName');
  });

  it('F5: a double tap on Save sends exactly one claim request', async () => {
    h.read.mockImplementation(() => Promise.resolve({ username: null }));
    h.claim.mockImplementation(never);
    const { input, saveContainer } = setup();
    fireEvent.change(input, { target: { value: 'TapTap' } });
    await tick(500);
    const save = saveContainer();
    await act(async () => { fireEvent.click(save); fireEvent.click(save); });
    expect(h.claim).toHaveBeenCalledTimes(1);
  });

  it('F7: a rename with doubled internal spaces is accepted once the server reports its collapsed form', async () => {
    // The spotter renames to "Cat  Lover" (two spaces). The POST is slow
    // and the UI deadline passes; the reconcile read reports the server's
    // normalised "Cat Lover" (single space). This must count as the same
    // name, the way the server's own `normalizeUsername` would compare
    // them (collapse internal whitespace, case-insensitive) — not a
    // strict `toLowerCase()`-only match.
    h.claim.mockImplementationOnce(never);
    h.read.mockImplementationOnce(() => Promise.resolve({ username: 'Cat Lover' }));
    const { view, input, saveContainer } = setup();
    fireEvent.change(input, { target: { value: 'Cat  Lover' } });
    await tick(500);
    await act(async () => { fireEvent.click(saveContainer()); });
    await tick(8000 + 4000 + 10);

    expect(h.setUsername).toHaveBeenCalledWith('Cat Lover');
    expect(view.container.textContent).not.toContain(en.usernameClaimUncertain);
  });
});

describe('UsernameEditor after leaving the Profile tab mid-rename (SYC-214)', () => {
  it('on return, Edit reopens on the name still being saved, and a different name cannot be sent', async () => {
    h.read.mockImplementation(never);
    h.claim.mockImplementation(never);
    const first = setup();
    fireEvent.change(first.input, { target: { value: 'NameA' } });
    await tick(500);
    await act(async () => { fireEvent.click(first.saveContainer()); });
    await tick(1000);
    first.view.unmount(); // left the Profile tab

    const again = setup();
    expect(again.input.value).toBe('NameA');
    expect(again.input.readOnly).toBe(true);
    fireEvent.change(again.input, { target: { value: 'NameB' } });
    await tick(500);
    await act(async () => { fireEvent.click(again.saveContainer()); });

    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.claim).toHaveBeenCalledWith('dev-1', { username: 'NameA' });
  });
});
