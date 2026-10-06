// @vitest-environment jsdom
/**
 * SYC-214: a spotter who goes Back mid-claim and picks another name must not
 * leave the server holding the old one.
 *
 * Back unmounts the name step. Before this fix the claim lock lived in the
 * screen, so it was lost on Back: on return a different name could be sent
 * while the first request was still open, and if the first one landed last
 * the server held it while the phone showed the second.
 *
 * Scaffolding copied from LanguageUsernameStep.reconcile.test.tsx. The fake
 * server below applies each claim when it "lands", in landing order, as the
 * real one does (last write wins).
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
import { resetUsernameClaimStateForTests } from '@/hooks/useUsernameClaim';

const never = () => new Promise<never>(() => {});
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

/** A server that holds one name per device: whichever claim lands last. */
type Sent = { name: string; land: () => Promise<void>; refuse: (status: number) => Promise<void> };
let serverName: string | null = null;
let sent: Sent[] = [];

function serverClaim(_deviceId: string, body: { username: string }) {
  return new Promise((resolve, reject) => {
    sent.push({
      name: body.username,
      land: async () => {
        serverName = body.username;
        await act(async () => { resolve({ username: body.username }); });
      },
      refuse: async (status: number) => {
        await act(async () => { reject(Object.assign(new Error('refused'), { status })); });
      },
    });
  });
}

function mount() {
  const view = render(<LanguageUsernameStep onBack={() => {}} />);
  const input = () => view.container.querySelector('input')!;
  const continueBtn = () =>
    view.getAllByRole('button').find((b) => /Continue|Retry|Saving/.test(b.textContent ?? '')) as HTMLButtonElement;
  return { view, input, continueBtn };
}

async function typeAndContinue(s: ReturnType<typeof mount>, name: string) {
  fireEvent.change(s.input(), { target: { value: name } });
  await tick(500);
  await act(async () => { fireEvent.click(s.continueBtn()); });
}

/** What the phone shows: the last name it accepted. */
const phoneName = () => h.setUsername.mock.calls.at(-1)?.[0] ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  resetUsernameClaimStateForTests();
  h.claim.mockReset();
  h.read.mockReset();
  h.setUsername.mockReset();
  h.availability = { data: { available: true }, isFetching: false, isError: false };
  serverName = null;
  sent = [];
  h.claim.mockImplementation(serverClaim);
  // Reads (start-up recovery, reconcile) time out unless a test says otherwise.
  h.read.mockImplementation(never);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Back mid-claim, then a different name (SYC-214)', () => {
  it('Back while the claim is still sending: the old claim lands late, and phone and server agree', async () => {
    const first = mount();
    await tick(0);
    await typeAndContinue(first, 'NameA');
    await tick(1000);
    first.view.unmount(); // Back

    const again = mount();
    await tick(0);
    expect(again.input().value).toBe('NameA');
    expect(again.input().readOnly).toBe(true);
    expect(again.continueBtn().textContent).toBe(en.usernameClaiming);
    await typeAndContinue(again, 'NameB');
    // Whatever was sent lands, the newest first, the old NameA claim last.
    for (const request of [...sent].reverse()) await request.land();
    await tick(10);

    expect(serverName).toBe('NameA');
    expect(phoneName()).toBe(serverName);
    expect(sent.map((r) => r.name)).toEqual(['NameA']);
  });

  it('Back after "not sure it saved": on return only the same name can be retried', async () => {
    const first = mount();
    await tick(0);
    await typeAndContinue(first, 'NameA');
    await tick(12010); // UI wait and reconcile read both time out
    expect(first.view.container.textContent).toContain(en.usernameClaimUncertain);
    first.view.unmount(); // Back

    const again = mount();
    await tick(0);
    expect(again.view.container.textContent).toContain(en.usernameClaimUncertain);
    expect(again.input().readOnly).toBe(true);
    expect(again.input().value).toBe('NameA');
    expect(again.continueBtn().textContent).toBe(en.usernameRetryClaim);

    await typeAndContinue(again, 'NameB'); // typing is ignored; this retries NameA
    for (const request of [...sent].reverse()) await request.land();
    await tick(10);

    expect(sent.map((r) => r.name)).toEqual(['NameA', 'NameA']);
    expect(serverName).toBe('NameA');
    expect(phoneName()).toBe(serverName);
  });

  it('the old claim is refused while away: on return a different name is free to claim', async () => {
    const first = mount();
    await tick(0);
    await typeAndContinue(first, 'NameA');
    await tick(1000);
    first.view.unmount(); // Back
    await sent[0].refuse(409);
    await tick(10);

    const again = mount();
    await tick(0);
    expect(again.input().readOnly).toBe(false);
    await typeAndContinue(again, 'NameB');
    await sent[1].land();
    await tick(10);

    expect(sent.map((r) => r.name)).toEqual(['NameA', 'NameB']);
    expect(serverName).toBe('NameB');
    expect(phoneName()).toBe('NameB');
  });

  it('a retry refused for a reason that is not about the name (403) keeps the lock while the first claim is still open', async () => {
    const s = mount();
    await tick(0);
    await typeAndContinue(s, 'NameA');
    await tick(12010); // not sure it saved; NameA locked
    await act(async () => { fireEvent.click(s.continueBtn()); }); // retry NameA
    await sent[1].refuse(403);
    await tick(10);

    expect(s.input().readOnly).toBe(true);
    expect(s.input().value).toBe('NameA');
    await typeAndContinue(s, 'NameB'); // still only the same-name retry
    for (const request of [...sent].slice(2).reverse()) await request.land();
    await sent[0].land(); // the first NameA claim lands last
    await tick(10);

    expect(sent.map((r) => r.name)).not.toContain('NameB');
    expect(serverName).toBe('NameA');
    expect(phoneName()).toBe(serverName);
  });
});
