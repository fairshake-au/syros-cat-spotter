// @vitest-environment jsdom
/**
 * SYC-3 plan, test 17: the app side of "keep my spots safe".
 * - The onboarding step's two buttons are equal in size, and Skip goes
 *   straight in without sending anything.
 * - `device_moved` shows the "moved" screen, and unsent sightings survive
 *   "Start again" (the queue side is in lib/__tests__/deviceMoved.test.ts).
 * - The /restore page removes `t` from the address bar, and only then moves
 *   the spotter, waiting for any open username claim.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATIONS } from '@/lib/i18n';

const h = vi.hoisted(() => ({
  online: true,
  device: {} as Record<string, unknown>,
  pending: [] as { status: string }[],
  buttons: [] as { label: string; size?: string; variant?: string }[],
  params: {} as { t?: string },
  calls: [] as string[],
  holds: 0,
  sync: [] as string[],
}));

vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return { useLanguage: () => ({ language: 'en', t: (key: string) => T.en[key] ?? key }) };
});
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ background: '#fff', foreground: '#000', mutedForeground: '#666', card: '#fff', border: '#ddd', primary: '#123' }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/components/KeyboardAwareScrollViewCompat', async () => {
  const { View } = await import('react-native');
  return { KeyboardAwareScrollViewCompat: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
vi.mock('@/components/purropolis', async () => {
  const { Text } = await import('react-native');
  return {
    Button: ({ children, onPress, size, variant, disabled }: { children: React.ReactNode; onPress?: () => void; size?: string; variant?: string; disabled?: boolean }) => {
      h.buttons.push({ label: String(children), size, variant });
      return (
        <Text role="button" aria-disabled={disabled} onPress={disabled ? undefined : onPress}>
          {children}
        </Text>
      );
    },
  };
});
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => h.device }));
vi.mock('@/context/DeleteMyDataContext', () => ({
  useDeleteMyData: () => ({
    holdIdentityDeleted: async <T,>(work: () => Promise<T>) => {
      h.holds += 1;
      try {
        return await work();
      } finally {
        h.holds -= 1;
      }
    },
  }),
}));
vi.mock('@/context/OfflineContext', () => ({
  useOffline: () => ({
    isOnline: h.online,
    pending: h.pending,
    pauseSync: async () => {
      h.sync.push('paused');
    },
    resumeSync: () => {
      h.sync.push('resumed');
    },
  }),
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => h.params,
  router: { replace: vi.fn(), back: vi.fn(), canGoBack: () => false, push: vi.fn(), setParams: vi.fn() },
}));
vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return { ApiError: actual.ApiError, getProfile: vi.fn(async () => ({ totalSightings: 2 })) };
});
vi.mock('@/hooks/useUsernameClaim', () => ({
  waitForUsernameClaimToSettle: vi.fn(async () => {
    h.calls.push('waited-for-claim');
  }),
}));
vi.mock('@/lib/keepSafe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/keepSafe')>();
  return {
    ...actual,
    addKeepSafe: vi.fn(async () => ({ status: 'pending', addressMask: 'p•••@example.org' })),
    peekRestore: vi.fn(async () => ({
      spotters: [{ choice: 'choice-lili', username: 'Lili' }],
      openedOnAskingPhone: true,
      alreadyHere: null,
    })),
    redeemRestore: vi.fn(async () => {
      h.calls.push('redeemed');
      return { deviceId: 'dev-lili', username: 'Lili' };
    }),
  };
});

import { KeepSafeScreen } from '../keepSafe/KeepSafeScreen';
import { MovedScreen } from '../keepSafe/MovedScreen';
import RestorePage, { __resetHeldRestoreTokenForTests } from '../../app/restore';
import * as keepSafe from '@/lib/keepSafe';
import { router } from 'expo-router';

const en = TRANSLATIONS.en;

beforeEach(() => {
  h.online = true;
  h.pending = [];
  h.buttons = [];
  h.calls = [];
  h.params = {};
  h.device = { deviceId: 'dev-new', username: null, isReady: true };
  vi.mocked(keepSafe.addKeepSafe).mockClear();
  vi.mocked(keepSafe.redeemRestore).mockClear();
  vi.mocked(keepSafe.peekRestore).mockClear();
});
afterEach(cleanup);

describe('"Don\'t lose your spots" (§3.0)', () => {
  it('shows the §3.0 copy, minus the news box', () => {
    const { container } = render(<KeepSafeScreen surface="onboarding" onSaved={() => {}} onSkip={() => {}} />);
    const text = container.textContent ?? '';
    for (const key of ['keepSafeTitle', 'keepSafeBody', 'keepSafeWarning', 'keepSafeUnder15', 'keepSafeOptional', 'keepSafeOptionalRest']) {
      expect(text).toContain(en[key]);
    }
    expect(en.keepSafeTitle).toBe('Don’t lose your spots');
    expect(en.keepSafeUnder15).toBe('Under 15? Ask a parent to add theirs.');
    expect(en.keepSafeWarning).toBe(
      'Use an email only you, or a parent, can read. Anyone who can open it can get your spots back.',
    );
    expect(text).not.toMatch(/collection/i);
    expect(text).not.toMatch(/news about cats/i);
  });

  it('Save my spots and Skip are the same size, side by side', () => {
    const { getByTestId } = render(<KeepSafeScreen surface="onboarding" onSaved={() => {}} onSkip={() => {}} />);
    const save = h.buttons.find((b) => b.label === en.keepSafeSave)!;
    const skip = h.buttons.find((b) => b.label === en.keepSafeSkip)!;
    expect(save.size).toBe('lg');
    expect(skip.size).toBe(save.size);
    const style = (id: string) => getComputedStyle(getByTestId(id));
    expect(style('keep-safe-save-wrap').flexGrow).toBe(style('keep-safe-skip-wrap').flexGrow);
    expect(style('keep-safe-save-wrap').flexGrow).toBe('1');
  });

  it('Skip goes straight on and sends nothing', () => {
    const onSkip = vi.fn();
    const { getByText } = render(<KeepSafeScreen surface="onboarding" onSaved={() => {}} onSkip={onSkip} />);
    fireEvent.click(getByText(en.keepSafeSkip));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(keepSafe.addKeepSafe).not.toHaveBeenCalled();
  });

  it('Save sends the address with where it was asked, then goes on', async () => {
    const onSaved = vi.fn();
    const { getByText, getByTestId } = render(<KeepSafeScreen surface="first_badge" onSaved={onSaved} onSkip={() => {}} />);
    fireEvent.change(getByTestId('keep-safe-email'), { target: { value: ' parent@example.org ' } });
    fireEvent.click(getByText(en.keepSafeSave));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(keepSafe.addKeepSafe).toHaveBeenCalledWith('dev-new', { email: 'parent@example.org', language: 'en', surface: 'first_badge' });
  });

  it('a typo is caught before anything is sent', () => {
    const { getByText, getByTestId } = render(<KeepSafeScreen surface="onboarding" onSaved={() => {}} onSkip={() => {}} />);
    fireEvent.change(getByTestId('keep-safe-email'), { target: { value: 'not an address' } });
    fireEvent.click(getByText(en.keepSafeSave));
    expect(getByText(en.keepSafeInvalidEmail)).toBeTruthy();
    expect(keepSafe.addKeepSafe).not.toHaveBeenCalled();
  });

  it('offline: says it can be added later, and lets them carry on', () => {
    h.online = false;
    const onSkip = vi.fn();
    const { getByText, queryByText, queryByTestId } = render(<KeepSafeScreen surface="onboarding" onSaved={() => {}} onSkip={onSkip} />);
    expect(getByText(en.keepSafeOffline)).toBeTruthy();
    expect(queryByText(en.keepSafeSave)).toBeNull();
    expect(queryByTestId('keep-safe-email')).toBeNull();
    fireEvent.click(getByText(en.continue));
    expect(onSkip).toHaveBeenCalled();
  });
});

describe('"Your spots moved to a new phone"', () => {
  it('names the spotter, counts the unsent sightings, and Start again keeps them', async () => {
    const startAgain = vi.fn(async () => {});
    h.device = { username: 'Lili', startAgain };
    h.pending = [{ status: 'queued' }, { status: 'queued' }, { status: 'queued' }, { status: 'review' }];
    const { getByText, container } = render(<MovedScreen />);
    expect(container.textContent).toContain('Your spots moved to a new phone.');
    expect(container.textContent).toContain('This phone isn’t signed in as Lili any more.');
    expect(container.textContent).toContain('3 spots saved on this phone will be sent when you start again.');
    await act(async () => {
      fireEvent.click(getByText(en.movedStartAgain));
    });
    expect(startAgain).toHaveBeenCalledTimes(1);
  });
});

describe('the /restore page', () => {
  const TOKEN = 'A'.repeat(43);
  let replace: ReturnType<typeof vi.fn>;

  const DEFAULT_PEEK = {
    spotters: [{ choice: 'choice-lili', username: 'Lili' }],
    openedOnAskingPhone: true,
    alreadyHere: null,
  };

  beforeEach(() => {
    vi.mocked(keepSafe.peekRestore).mockResolvedValue(DEFAULT_PEEK);
    __resetHeldRestoreTokenForTests();
    vi.mocked(router.replace).mockClear();
    window.history.replaceState(null, '', `/restore?t=${TOKEN}`);
    h.params = { t: TOKEN };
    replace = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, replace, search: `?t=${TOKEN}`, pathname: '/restore', origin: 'https://apptest.catspotters.com' },
    });
  });

  it('takes t out of the address bar, peeks, and moves the chosen spotter after any open claim settles', async () => {
    const spy = vi.spyOn(window.history, 'replaceState');
    const adopt = vi.fn(async () => {
      h.calls.push('adopted');
    });
    h.device = { deviceId: 'dev-new', username: null, isReady: true, adoptRestoredIdentity: adopt };
    const { findByText } = render(<RestorePage />);
    // Through the router (which owns the URL on web), and the history entry too.
    expect(router.replace).toHaveBeenCalledWith('/restore');
    expect(spy.mock.calls.some((c) => c[1] === '' && c[2] === '/restore')).toBe(true);
    const button = await findByText('Move Lili’s spots to this phone');
    expect(keepSafe.peekRestore).toHaveBeenCalledWith('dev-new', TOKEN);
    expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(keepSafe.redeemRestore).toHaveBeenCalledWith('dev-new', { token: TOKEN, choice: 'choice-lili', abandonCurrent: false });
    expect(h.calls).toEqual(['waited-for-claim', 'redeemed', 'adopted']);
    expect(adopt).toHaveBeenCalledWith('dev-lili', 'Lili');
  });

  it('on a phone with a spotter, warns first (Decision 7) and asks what happens to it, neither chosen (SYC-266)', async () => {
    h.device = { deviceId: 'dev-new', username: 'Nikos', isReady: true, adoptRestoredIdentity: vi.fn(async () => {}) };
    const { findByText, getByTestId } = render(<RestorePage />);
    const button = await findByText('Move Lili’s spots to this phone');
    expect(getByTestId('restore-warning').textContent).toBe(
      'This phone is spotting as Nikos. If you get your old spots back, this phone stops being Nikos.',
    );
    await waitFor(() =>
      expect(getByTestId('restore-choice-delete').textContent).toContain(
        'Nikos’s 2 spots stay on the map, without a name. This can’t be undone.',
      ),
    );
    expect(getByTestId('restore-choice-keep').textContent).toContain(
      'Nikos’s 2 spots stay on the map as “Discovered by Nikos”, but they won’t count towards your points. Nobody can use Nikos again, not even you, and you won’t be able to delete Nikos from the app later.',
    );
    expect(getByTestId('restore-choice-delete').getAttribute('aria-checked')).toBe('false');
    expect(getByTestId('restore-choice-keep').getAttribute('aria-checked')).toBe('false');
    // Nothing moves until the person has chosen.
    await act(async () => {
      fireEvent.click(button);
    });
    expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
  });

  it('"Keep Nikos" sends abandonCurrent only, as before', async () => {
    h.device = { deviceId: 'dev-new', username: 'Nikos', isReady: true, adoptRestoredIdentity: vi.fn(async () => {}) };
    const { findByText, getByTestId } = render(<RestorePage />);
    const button = await findByText('Move Lili’s spots to this phone');
    await act(async () => {
      fireEvent.click(getByTestId('restore-choice-keep'));
    });
    expect(getByTestId('restore-choice-keep').getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() =>
      expect(keepSafe.redeemRestore).toHaveBeenCalledWith('dev-new', {
        token: TOKEN,
        choice: 'choice-lili',
        abandonCurrent: true,
      }),
    );
  });

  it('"Delete Nikos" sends deleteCurrent, with 410 handling held until the phone is the restored spotter', async () => {
    let heldDuringAdopt = -1;
    const adopt = vi.fn(async () => {
      heldDuringAdopt = h.holds;
    });
    vi.mocked(keepSafe.redeemRestore).mockImplementationOnce(async () => {
      expect(h.holds).toBe(1);
      return { deviceId: 'dev-lili', username: 'Lili' };
    });
    h.device = { deviceId: 'dev-new', username: 'Nikos', isReady: true, adoptRestoredIdentity: adopt };
    const { findByText, getByTestId } = render(<RestorePage />);
    const button = await findByText('Move Lili’s spots to this phone');
    await act(async () => {
      fireEvent.click(getByTestId('restore-choice-delete'));
    });
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(adopt).toHaveBeenCalledWith('dev-lili', 'Lili'));
    expect(keepSafe.redeemRestore).toHaveBeenCalledWith('dev-new', {
      token: TOKEN,
      choice: 'choice-lili',
      abandonCurrent: true,
      deleteCurrent: true,
    });
    expect(heldDuringAdopt).toBe(1);
    expect(h.holds).toBe(0);
  });

  // #110 review, F1: no upload as Nikos may land after the deletion.
  it('"Delete Nikos" pauses the spot queue for the move and resumes it after', async () => {
    h.sync = [];
    vi.mocked(keepSafe.redeemRestore).mockImplementationOnce(async () => {
      h.sync.push('redeemed');
      return { deviceId: 'dev-lili', username: 'Lili' };
    });
    const adopt = vi.fn(async () => {
      h.sync.push('adopted');
    });
    h.device = { deviceId: 'dev-new', username: 'Nikos', isReady: true, adoptRestoredIdentity: adopt };
    const { findByText, getByTestId } = render(<RestorePage />);
    const button = await findByText('Move Lili’s spots to this phone');
    await act(async () => {
      fireEvent.click(getByTestId('restore-choice-delete'));
    });
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(h.sync).toEqual(['paused', 'redeemed', 'adopted', 'resumed']));
  });

  // F2: a lost answer after the Delete committed is asked for again (the
  // server's 60-second replay answers it), not left to the 410 wipe.
  it('"Delete Nikos" asks again once when the answer is lost, then becomes the spotter', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(keepSafe.redeemRestore)
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({ deviceId: 'dev-lili', username: 'Lili' });
      const adopt = vi.fn(async () => {});
      h.device = { deviceId: 'dev-new', username: 'Nikos', isReady: true, adoptRestoredIdentity: adopt };
      const { findByText, getByTestId } = render(<RestorePage />);
      const button = await findByText('Move Lili’s spots to this phone');
      await act(async () => {
        fireEvent.click(getByTestId('restore-choice-delete'));
      });
      await act(async () => {
        fireEvent.click(button);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await waitFor(() => expect(adopt).toHaveBeenCalledWith('dev-lili', 'Lili'));
      expect(keepSafe.redeemRestore).toHaveBeenCalledTimes(2);
      expect(h.holds).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a link that is no longer valid says so, and moves nothing', async () => {
    const { ApiError } = await import('@workspace/api-client-react');
    vi.mocked(keepSafe.peekRestore).mockRejectedValueOnce(
      new ApiError(new Response(null, { status: 401 }), { error: 'link_not_valid' }, { method: 'POST', url: '/api/restore/peek' }),
    );
    h.device = { deviceId: 'dev-other', username: null, isReady: true };
    const { findByTestId } = render(<RestorePage />);
    expect((await findByTestId('restore-not-valid')).textContent).toBe(en.restorePageNotValid);
    expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
  });

  // ── Decision 12 (Samuel, 11–12 Oct 2026) ────────────────────────────────

  it('Decision 12: on another phone or browser it asks first; "Yes" moves the spotter here', async () => {
    vi.mocked(keepSafe.peekRestore).mockResolvedValue({
      spotters: [{ choice: 'choice-lili', username: 'Lili' }],
      openedOnAskingPhone: false,
      alreadyHere: null,
    });
    const adopt = vi.fn(async () => {});
    h.device = { deviceId: 'dev-other', username: null, isReady: true, adoptRestoredIdentity: adopt };
    const { findByTestId, getByText } = render(<RestorePage />);
    expect((await findByTestId('restore-different')).textContent).toBe(en.restoreDifferentIntro);
    expect(getByText('Is this the app or browser Lili uses for Cat Spotters?')).toBeTruthy();
    expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(getByText('Yes, move Lili’s spots here'));
    });
    await waitFor(() => expect(adopt).toHaveBeenCalledWith('dev-lili', 'Lili'));
    expect(keepSafe.redeemRestore).toHaveBeenCalledWith('dev-other', { token: TOKEN, choice: 'choice-lili', abandonCurrent: false });
  });

  it('Decision 12: "No, copy the link" copies the fragment form and moves nothing (M)', async () => {
    vi.mocked(keepSafe.peekRestore).mockResolvedValue({
      spotters: [{ choice: 'choice-lili', username: 'Lili' }],
      openedOnAskingPhone: false,
      alreadyHere: null,
    });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    h.device = { deviceId: 'dev-other', username: null, isReady: true };
    const { findByText, findByTestId } = render(<RestorePage />);
    const no = await findByText(en.restoreDifferentNo, undefined, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(no);
    });
    expect(writeText).toHaveBeenCalledWith(`https://apptest.catspotters.com/restore#t=${TOKEN}`);
    expect((await findByTestId('restore-copied')).textContent).toBe('Link copied. Paste it into the browser Lili uses for Cat Spotters.');
    expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
  });

  it('Decision 12: the phone that asked gets no question, just the button', async () => {
    h.device = { deviceId: 'dev-new', username: null, isReady: true };
    const { findByText, queryByTestId } = render(<RestorePage />);
    await findByText('Move Lili’s spots to this phone');
    expect(queryByTestId('restore-different')).toBeNull();
  });

  it('Decision 12: inside another app\'s built-in browser, it advises first; "anyway" goes on', async () => {
    const ua = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0',
    });
    try {
      h.device = { deviceId: 'dev-new', username: null, isReady: true };
      const { findByTestId, getByText, findByText } = render(<RestorePage />);
      expect((await findByTestId('restore-in-app')).textContent).toBe(en.restoreInAppWarning);
      expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
      fireEvent.click(getByText(en.restoreInAppAnyway));
      await findByText('Move Lili’s spots to this phone');
    } finally {
      if (ua) Object.defineProperty(window.navigator, 'userAgent', ua);
      else delete (window.navigator as unknown as Record<string, unknown>).userAgent;
    }
  });

  it('Decision 12: on the phone that already is the spotter, it says so and offers only Open Cat Spotters', async () => {
    vi.mocked(keepSafe.peekRestore).mockResolvedValue({ spotters: [], openedOnAskingPhone: false, alreadyHere: { username: 'Lili' } });
    h.device = { deviceId: 'dev-lili', username: 'Lili', isReady: true };
    const { findByTestId, queryByText } = render(<RestorePage />);
    expect((await findByTestId('restore-already-here')).textContent).toBe('Lili’s spots are already on this phone.');
    expect(queryByText(/Move .* to this phone/)).toBeNull();
  });

  it('Decision 12: reads the token from the fragment and clears it from the address bar and history (M)', async () => {
    h.params = {};
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, replace, search: '', hash: `#t=${TOKEN}`, pathname: '/restore', origin: 'https://apptest.catspotters.com' },
    });
    const spy = vi.spyOn(window.history, 'replaceState');
    spy.mockClear(); // only this page load's calls count
    h.device = { deviceId: 'dev-new', username: null, isReady: true };
    const { findByText } = render(<RestorePage />);
    expect(spy.mock.calls.some((c) => c[1] === '' && c[2] === '/restore')).toBe(true);
    await findByText('Move Lili’s spots to this phone');
    expect(keepSafe.peekRestore).toHaveBeenCalledWith('dev-new', TOKEN);
  });

  it('Decision 12: if the router writes #t= back after starting, the page clears it again (M)', async () => {
    h.params = {};
    const loc = { ...window.location, replace, search: '', hash: `#t=${TOKEN}`, pathname: '/restore', origin: 'https://apptest.catspotters.com' };
    Object.defineProperty(window, 'location', { configurable: true, value: loc });
    const spy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      loc.hash = '';
    });
    spy.mockClear();
    h.device = { deviceId: 'dev-new', username: null, isReady: true };
    render(<RestorePage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // The router puts the first address back as it starts…
    loc.hash = `#t=${TOKEN}`;
    spy.mockClear();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    // …and the page takes it out again.
    expect(loc.hash).toBe('');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('Decision 12: "Yes" on a phone that already has a spotter goes on to the SYC-266 choice, never straight to a move', async () => {
    vi.mocked(keepSafe.peekRestore).mockResolvedValue({
      spotters: [{ choice: 'choice-lili', username: 'Lili' }],
      openedOnAskingPhone: false,
      alreadyHere: null,
    });
    h.device = { deviceId: 'dev-other', username: 'Nikos', isReady: true, adoptRestoredIdentity: vi.fn(async () => {}) };
    const { findByText, findByTestId } = render(<RestorePage />);
    const yes = await findByText('Yes, move Lili’s spots here', undefined, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(yes);
    });
    expect(await findByTestId('restore-warning')).toBeTruthy();
    expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
  });

  it('Decision 12: when copying fails, it says so and stays on the question (no false "Link copied")', async () => {
    vi.mocked(keepSafe.peekRestore).mockResolvedValue({
      spotters: [{ choice: 'choice-lili', username: 'Lili' }],
      openedOnAskingPhone: false,
      alreadyHere: null,
    });
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new Error('denied'); }) },
    });
    h.device = { deviceId: 'dev-other', username: null, isReady: true };
    const { findByText, findByTestId, queryByTestId } = render(<RestorePage />);
    const no = await findByText(en.restoreDifferentNo, undefined, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(no);
    });
    expect((await findByTestId('restore-copy-failed')).textContent).toBe(en.restoreCopyFailed);
    expect(queryByTestId('restore-copied')).toBeNull();
    expect(queryByTestId('restore-different')).toBeTruthy();
  });

  it('Decision 12: after a website sign-in, reads the token the password page kept, then deletes it', async () => {
    h.params = {};
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, replace, search: '', hash: '', pathname: '/restore', origin: 'https://apptest.catspotters.com' },
    });
    window.sessionStorage.setItem('cat-spotter/restore-token', TOKEN);
    h.device = { deviceId: 'dev-new', username: null, isReady: true };
    const { findByText } = render(<RestorePage />);
    await findByText('Move Lili’s spots to this phone');
    expect(keepSafe.peekRestore).toHaveBeenCalledWith('dev-new', TOKEN);
    expect(window.sessionStorage.getItem('cat-spotter/restore-token')).toBeNull();
  });
});
