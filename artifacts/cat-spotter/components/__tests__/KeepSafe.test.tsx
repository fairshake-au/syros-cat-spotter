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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
    requestRestore: vi.fn(async () => undefined),
    exchangeRestoreCode: vi.fn(async () => ({ handle: 'handle-1' })),
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
import { RestoreRequestScreen } from '../keepSafe/RestoreRequestScreen';
import { notePendingMove, readPendingMove, readWaiting, setMovingHandle, noteRequest, RESTORE_WAITING_KEY } from '@/lib/restoreWaiting';
import { ApiError } from '@workspace/api-client-react';
import RestorePage, { __resetHeldRestoreTokenForTests } from '../../app/restore';
import { finishPendingMove } from '@/lib/pendingMove';
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
    expect(container.textContent).toContain('Your spots have moved to another phone, so this phone has stopped being Lili.');
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

  it('the link page is unchanged by I2: no Back control, and "ask again" still replaces the route', async () => {
    vi.mocked(keepSafe.peekRestore).mockRejectedValueOnce(
      new ApiError(new Response(null, { status: 401 }), { error: 'link_not_valid' }, { method: 'POST', url: '/api/restore/peek' }),
    );
    const utils = render(<RestorePage />);
    await utils.findByTestId('restore-not-valid');
    expect(utils.queryByTestId('restore-chooser-back')).toBeNull();
    expect(utils.getByText(en.restorePageNotValid)).toBeTruthy();
    await act(async () => {
      fireEvent.click(utils.getByTestId('restore-ask-again').querySelector('[role="button"]')!);
    });
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('SYC-664 ship F1: a 429 at peek is a plain failure, never "this link has expired"', async () => {
    vi.mocked(keepSafe.peekRestore).mockRejectedValueOnce(
      new ApiError(new Response(null, { status: 429 }), { error: 'link_not_valid' }, { method: 'POST', url: '/api/restore/peek' }),
    );
    const utils = render(<RestorePage />);
    await utils.findByTestId('restore-not-valid');
    expect(utils.queryByText(en.restorePageNotValid)).toBeNull();
    expect(utils.getByText(en.restorePageFailed)).toBeTruthy();
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
      'Nikos’s 2 spots stay on the map under that name and won’t count towards your points. Nobody can use Nikos again, not even you, and you can’t delete it from the app later.',
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
  // server's same-phone replay answers it), not left to the 410 wipe.
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

  it('SYC-664 ship F2: the "not confirmed" words show only while a pending move exists: a failed link-page move says "Nothing has moved"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // The link page stores no pending move.
      vi.mocked(keepSafe.redeemRestore)
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'));
      h.device = { deviceId: 'dev-new', username: null, isReady: true, adoptRestoredIdentity: vi.fn(async () => {}), finishPendingMove: vi.fn(async () => null) };
      const utils = render(<RestorePage />);
      const button = await utils.findByText('Move Lili’s spots to this phone');
      await act(async () => {
        fireEvent.click(button);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await utils.findByText(en.restorePageFailed);
      expect(readPendingMove()).toBeNull();
      expect(utils.queryByText(en.restoreMoveUnconfirmed)).toBeNull();
      expect(utils.queryByTestId('restore-try-again')).toBeNull();
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
    expect((await findByTestId('restore-copied')).textContent).toBe('Link copied. Paste it into the browser Lili uses for Cat Spotters, or type the code from the email into Cat Spotters.');
    expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
  });

  it('SYC-664 T9: "I use the Cat Spotters icon on my home screen" shows the advice, does not peek again, and redeems nothing', async () => {
    vi.mocked(keepSafe.peekRestore).mockResolvedValue({
      spotters: [{ choice: 'choice-lili', username: 'Lili' }],
      openedOnAskingPhone: false,
      alreadyHere: null,
    });
    h.device = { deviceId: 'dev-other', username: null, isReady: true };
    const { findByText, findByTestId, getByText, queryByText } = render(<RestorePage />);
    const icon = await findByText(en.restoreUseIcon, undefined, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(icon);
    });
    expect((await findByTestId('restore-use-icon')).textContent).toBe(en.restoreUseIconAdvice);
    expect(en.restoreUseIconAdvice).toBe('Go back to Cat Spotters from your home screen and type the code from this email there.');
    expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
    expect(keepSafe.peekRestore).toHaveBeenCalledTimes(1);
    // Back returns to the question, which still has its three answers.
    await act(async () => {
      fireEvent.click(getByText(en.back));
    });
    expect(queryByText(en.restoreUseIconAdvice)).toBeNull();
    expect(getByText(en.restoreUseIcon)).toBeTruthy();
    expect(getByText(en.restoreDifferentNo)).toBeTruthy();
    expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
  });

  it('T9: the three answers to "is this the app or browser…" carry equal weight, all secondary', async () => {
    vi.mocked(keepSafe.peekRestore).mockResolvedValue({
      spotters: [{ choice: 'choice-lili', username: 'Lili' }],
      openedOnAskingPhone: false,
      alreadyHere: null,
    });
    h.device = { deviceId: 'dev-other', username: null, isReady: true };
    const { findByText } = render(<RestorePage />);
    await findByText(en.restoreUseIcon, undefined, { timeout: 3000 });
    const labels = [en.restoreDifferentYes.replace('{name}', 'Lili'), en.restoreDifferentNo, en.restoreUseIcon];
    const last = (label: string) => [...h.buttons].reverse().find((b) => b.label === label);
    for (const label of labels) {
      expect(last(label), label).toBeTruthy();
      expect(last(label)!.variant, label).toBe('secondary');
      expect(last(label)!.size, label).toBe('lg');
    }
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

const beforeCodeBlock: { storage?: PropertyDescriptor; location?: PropertyDescriptor } = {};

describe('code screen', () => {
  const refusal = (status: number, error: string) =>
    new ApiError(new Response(null, { status }), { error }, { method: 'POST', url: '/api/restore/code' });
  const typeCode = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });

  // T7 hygiene: what this block replaces on window, put back after each test.
  let savedStorage: PropertyDescriptor | undefined;
  let savedLocation: PropertyDescriptor | undefined;
  beforeEach(() => {
    savedStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    savedLocation = Object.getOwnPropertyDescriptor(window, 'location');
    const mem = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
        clear: () => mem.clear(),
      },
    });
    vi.mocked(router.replace).mockClear();
    vi.mocked(keepSafe.requestRestore).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(keepSafe.exchangeRestoreCode).mockReset().mockResolvedValue({ handle: 'handle-1' });
    vi.mocked(keepSafe.peekRestore).mockResolvedValue({
      spotters: [{ choice: 'choice-lili', username: 'Lili' }],
      openedOnAskingPhone: true,
      alreadyHere: null,
    });
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, replace: vi.fn() } });
  });
  afterEach(() => {
    cleanup();
    for (const [key, saved] of [['localStorage', savedStorage], ['location', savedLocation]] as const) {
      if (saved) Object.defineProperty(window, key, saved);
      else delete (window as unknown as Record<string, unknown>)[key];
    }
  });
  beforeAll(() => {
    beforeCodeBlock.storage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    beforeCodeBlock.location = Object.getOwnPropertyDescriptor(window, 'location');
  });

  const toCodeState = async (utils: ReturnType<typeof render>) => {
    typeCode(utils.getByTestId('restore-email'), 'a@b.co');
    await act(async () => {
      fireEvent.click(utils.getByText(en.restoreAskSend));
    });
    return utils.findByTestId('restore-code-input');
  };

  it('address then code: asks for a code, notes the request, and shows the code box', async () => {
    const utils = render(<RestoreRequestScreen onBack={() => {}} />);
    await toCodeState(utils);
    expect(keepSafe.requestRestore).toHaveBeenCalledWith('dev-new', 'a@b.co');
    expect(readWaiting()?.requests).toBe(1);
    expect(utils.getByText(en.restoreCodeTitle)).toBeTruthy();
    expect(utils.queryByText(en.restoreHaveCodeNote)).toBeNull();
  });

  it('a pasted "4829 1376" auto-submits once as 48291376', async () => {
    const utils = render(<RestoreRequestScreen onBack={() => {}} />);
    const input = await toCodeState(utils);
    await act(async () => {
      typeCode(input, '4829 1376');
    });
    await utils.findByText('Move Lili’s spots to this phone');
    expect(keepSafe.exchangeRestoreCode).toHaveBeenCalledTimes(1);
    expect(keepSafe.exchangeRestoreCode).toHaveBeenCalledWith('dev-new', '48291376');
    expect(readWaiting()?.movingHandle).toBe('handle-1');
    expect(keepSafe.peekRestore).toHaveBeenCalledWith('dev-new', 'handle-1');
  });

  it('is disabled while a check is running and never re-sends an unchanged code', async () => {
    let release!: (v: { handle: string }) => void;
    vi.mocked(keepSafe.exchangeRestoreCode).mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    const input = utils.getByTestId('restore-code-input');
    await act(async () => {
      typeCode(input, '48291376');
    });
    expect(utils.getByText(en.restoreCodeSubmit).getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      fireEvent.click(utils.getByText(en.restoreCodeSubmit));
    });
    expect(keepSafe.exchangeRestoreCode).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ handle: 'h' });
    });
  });

  it('two different 8-digit values in the same tick make one network call', async () => {
    let release!: (v: { handle: string }) => void;
    vi.mocked(keepSafe.exchangeRestoreCode).mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    const input = utils.getByTestId('restore-code-input');
    await act(async () => {
      typeCode(input, '11111111');
      typeCode(input, '22222222');
    });
    expect(keepSafe.exchangeRestoreCode).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ handle: 'h' });
    });
  });

  it('after a 429 the same code can be sent again', async () => {
    vi.mocked(keepSafe.exchangeRestoreCode).mockRejectedValueOnce(refusal(429, 'too_many_tries'));
    const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    await act(async () => {
      typeCode(utils.getByTestId('restore-code-input'), '48291376');
    });
    await utils.findByTestId('restore-too-many');
    await act(async () => {
      fireEvent.click(utils.getByText(en.restoreCodeSubmit));
    });
    expect(keepSafe.exchangeRestoreCode).toHaveBeenCalledTimes(2);
  });

  it('a network failure shows restoreCodeFailed', async () => {
    vi.mocked(keepSafe.exchangeRestoreCode).mockRejectedValueOnce(new Error('network'));
    const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    await act(async () => {
      typeCode(utils.getByTestId('restore-code-input'), '48291376');
    });
    expect((await utils.findByTestId('restore-code-failed')).textContent).toBe(en.restoreCodeFailed);
  });

  it('shows the have-a-code note only when opened with "I already have a code"', async () => {
    const utils = render(<RestoreRequestScreen onBack={() => {}} />);
    await act(async () => {
      fireEvent.click(utils.getByTestId('restore-have-code'));
    });
    expect(utils.getByTestId('restore-code-input')).toBeTruthy();
    expect(utils.getByText(en.restoreHaveCodeNote)).toBeTruthy();
    expect(keepSafe.requestRestore).not.toHaveBeenCalled();
  });

  it('five refusals end in "won\'t work any more" with a way to ask again', async () => {
    vi.mocked(keepSafe.exchangeRestoreCode).mockRejectedValue(refusal(401, 'code_not_valid'));
    const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    for (let i = 0; i < 5; i++) {
      const input = utils.getByTestId('restore-code-input');
      await act(async () => {
        typeCode(input, `1234567${i}`);
      });
      if (i < 4) {
        expect((await utils.findByTestId('restore-code-refused')).textContent).toBe(en.restoreCodeRefused);
      }
    }
    expect((await utils.findByTestId('restore-code-dead')).textContent).toContain(en.restoreCodeDead);
    expect(readWaiting()?.wrongTries).toBe(5);
    await act(async () => {
      fireEvent.click(utils.getByText(en.restoreCodeNewEmail));
    });
    expect(utils.getByTestId('restore-email')).toBeTruthy();
  });

  it('a 429 shows too-many-tries and is not a wrong try', async () => {
    vi.mocked(keepSafe.exchangeRestoreCode).mockRejectedValue(refusal(429, 'too_many_tries'));
    const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    await act(async () => {
      typeCode(utils.getByTestId('restore-code-input'), '48291376');
    });
    expect((await utils.findByTestId('restore-too-many')).textContent).toBe(en.restoreTooManyTries);
    expect(readWaiting()?.wrongTries ?? 0).toBe(0);
  });

  it('the fourth request in 15 minutes sends nothing and says so', async () => {
    window.localStorage.setItem(RESTORE_WAITING_KEY, JSON.stringify({ askedAt: Date.now(), requests: 3, wrongTries: 0 }));
    const utils = render(<RestoreRequestScreen onBack={() => {}} />);
    typeCode(utils.getByTestId('restore-email'), 'a@b.co');
    await act(async () => {
      fireEvent.click(utils.getByText(en.restoreAskSend));
    });
    expect((await utils.findByTestId('restore-asked-thrice')).textContent).toBe(en.restoreAskedThrice);
    expect(keepSafe.requestRestore).not.toHaveBeenCalled();
  });

  it('resend is disabled for a minute after asking, then goes back to the address box', async () => {
    noteRequest();
    const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    expect(utils.getByTestId('restore-code-resend').getAttribute('aria-disabled')).toBe('true');
    window.localStorage.setItem(RESTORE_WAITING_KEY, JSON.stringify({ askedAt: Date.now() - 61_000, requests: 1, wrongTries: 0 }));
    cleanup();
    const again = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    expect(again.getByTestId('restore-code-resend').getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => {
      fireEvent.click(again.getByTestId('restore-code-resend'));
    });
    expect(again.getByTestId('restore-email')).toBeTruthy();
  });

  it('after a reload with a committed move, the stored handle is spent: peek refuses, nothing is redeemed, the handle is dropped (I1 c)', async () => {
    // The move committed before the reload; start-up's resume (DeviceContext) has had
    // its go. What is left on the code screen is a spent handle.
    setMovingHandle('handle-stored');
    vi.mocked(keepSafe.peekRestore).mockRejectedValueOnce(
      new ApiError(new Response(null, { status: 401 }), { error: 'link_not_valid' }, { method: 'POST', url: '/api/restore/peek' }),
    );
    h.device = { deviceId: 'dev-new', username: null, isReady: true, adoptRestoredIdentity: vi.fn(async () => {}) };
    const utils = render(<RestoreRequestScreen onBack={() => {}} />);
    await utils.findByTestId('restore-not-valid');
    expect(keepSafe.peekRestore).toHaveBeenCalledWith('dev-new', 'handle-stored');
    expect(keepSafe.exchangeRestoreCode).not.toHaveBeenCalled();
    expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
  });

  it('after a reload before the move was sent, the stored handle reopens the chooser and moves', async () => {
    setMovingHandle('handle-stored');
    h.device = { deviceId: 'dev-new', username: null, isReady: true, adoptRestoredIdentity: vi.fn(async () => {}) };
    const utils = render(<RestoreRequestScreen onBack={() => {}} />);
    const button = await utils.findByText('Move Lili’s spots to this phone');
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() =>
      expect(keepSafe.redeemRestore).toHaveBeenCalledWith('dev-new', expect.objectContaining({ token: 'handle-stored' })),
    );
    await waitFor(() => expect(readWaiting()).toBeNull());
  });

  it('stores the pending move just before redeem, and clears it once moved (I1)', async () => {
    let atRedeem: unknown = 'not called';
    vi.mocked(keepSafe.redeemRestore).mockImplementationOnce(async () => {
      atRedeem = readPendingMove();
      return { deviceId: 'dev-lili', username: 'Lili' };
    });
    h.device = { deviceId: 'dev-nikos', username: 'Nikos', isReady: true, adoptRestoredIdentity: vi.fn(async () => {}) };
    const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    await act(async () => {
      typeCode(utils.getByTestId('restore-code-input'), '48291376');
    });
    await utils.findByText('Move Lili’s spots to this phone');
    expect(readPendingMove()).toBeNull(); // nothing stored until the person presses move
    await act(async () => {
      fireEvent.click(utils.getByTestId('restore-choice-delete'));
    });
    await act(async () => {
      fireEvent.click(utils.getByText('Move Lili’s spots to this phone'));
    });
    await waitFor(() => expect(keepSafe.redeemRestore).toHaveBeenCalled());
    expect(atRedeem).toEqual({ handle: 'handle-1', choice: 'choice-lili', abandonCurrent: true, deleteCurrent: true, at: expect.any(Number) });
    await waitFor(() => expect(readPendingMove()).toBeNull());
  });

  it('SYC-664 ship F1 (b): a 429 on the Delete retry is not "link not valid": the pending move is kept', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(keepSafe.redeemRestore)
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(
          new ApiError(new Response(null, { status: 429 }), { error: 'link_not_valid' }, { method: 'POST', url: '/api/restore/redeem' }),
        );
      h.device = { deviceId: 'dev-nikos', username: 'Nikos', isReady: true, adoptRestoredIdentity: vi.fn(async () => {}) };
      const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
      await act(async () => {
        typeCode(utils.getByTestId('restore-code-input'), '48291376');
      });
      await utils.findByText('Move Lili’s spots to this phone');
      await act(async () => {
        fireEvent.click(utils.getByTestId('restore-choice-delete'));
      });
      await act(async () => {
        fireEvent.click(utils.getByText('Move Lili’s spots to this phone'));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await utils.findByTestId('restore-not-valid');
      expect(keepSafe.redeemRestore).toHaveBeenCalledTimes(2);
      expect(readPendingMove()).not.toBeNull();
      expect(utils.queryByText(en.restoreCodeNotValid)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('SYC-664 ship F2: a move whose answer was lost', () => {
    const lost = () => new TypeError('Failed to fetch');
    /** The real single-flight finisher, as DeviceContext wires it, adopting via the test's spy. */
    const withFinisher = (device: Record<string, unknown>) => ({
      ...device,
      finishPendingMove: (opts?: { fullRedeem?: boolean }) =>
        finishPendingMove(
          device.deviceId as string,
          device.adoptRestoredIdentity as (id: string, name: string | null) => Promise<void>,
          1,
          { replayOnly: !opts?.fullRedeem },
        ),
    });
    const moveKeep = async (utils: ReturnType<typeof render>) => {
      await act(async () => {
        typeCode(utils.getByTestId('restore-code-input'), '48291376');
      });
      await utils.findByText('Move Lili’s spots to this phone');
      await act(async () => {
        fireEvent.click(utils.getByTestId('restore-choice-keep'));
      });
      await act(async () => {
        fireEvent.click(utils.getByText('Move Lili’s spots to this phone'));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
    };

    it('a Keep move is asked for again once, like a Delete move, and then becomes the spotter', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        vi.mocked(keepSafe.redeemRestore).mockRejectedValueOnce(lost()).mockResolvedValueOnce({ deviceId: 'dev-lili', username: 'Lili' });
        const adopt = vi.fn(async () => {});
        h.device = withFinisher({ deviceId: 'dev-nikos', username: 'Nikos', isReady: true, adoptRestoredIdentity: adopt });
        const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
        await moveKeep(utils);
        await waitFor(() => expect(adopt).toHaveBeenCalledWith('dev-lili', 'Lili'));
        expect(keepSafe.redeemRestore).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('still unanswered: says the move is not confirmed yet (never "Nothing has moved"); "Try again" finishes it and adopts', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        vi.mocked(keepSafe.redeemRestore)
          .mockRejectedValueOnce(lost())
          .mockRejectedValueOnce(lost())
          .mockResolvedValueOnce({ deviceId: 'dev-lili', username: 'Lili' });
        const adopt = vi.fn(async () => {});
        h.device = withFinisher({ deviceId: 'dev-nikos', username: 'Nikos', isReady: true, adoptRestoredIdentity: adopt });
        const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
        await moveKeep(utils);
        await utils.findByText(en.restoreMoveUnconfirmed);
        expect(utils.queryByText(en.restorePageFailed)).toBeNull();
        expect(readPendingMove()).not.toBeNull();
        expect(adopt).not.toHaveBeenCalled();
        // Back stays.
        expect(utils.getByTestId('restore-chooser-back')).toBeTruthy();
        await act(async () => {
          fireEvent.click(utils.getByTestId('restore-try-again').querySelector('[role="button"]')!);
        });
        await waitFor(() => expect(adopt).toHaveBeenCalledWith('dev-lili', 'Lili'));
        expect(keepSafe.redeemRestore).toHaveBeenCalledTimes(3);
        expect(keepSafe.redeemRestore).toHaveBeenLastCalledWith(
          'dev-nikos',
          { token: 'handle-1', choice: 'choice-lili', abandonCurrent: true },
          expect.anything(),
        );
        await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('back online on the "not confirmed" screen: finishes the move instead of peeking at a spent code', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        vi.mocked(keepSafe.redeemRestore)
          .mockRejectedValueOnce(lost())
          .mockRejectedValueOnce(lost())
          .mockResolvedValueOnce({ deviceId: 'dev-lili', username: 'Lili' });
        const adopt = vi.fn(async () => {});
        h.device = withFinisher({ deviceId: 'dev-nikos', username: 'Nikos', isReady: true, adoptRestoredIdentity: adopt });
        const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
        await moveKeep(utils);
        await utils.findByText(en.restoreMoveUnconfirmed);
        const peeks = vi.mocked(keepSafe.peekRestore).mock.calls.length;
        h.online = false;
        utils.rerender(<RestoreRequestScreen onBack={() => {}} startOnCode />);
        h.online = true;
        await act(async () => {
          utils.rerender(<RestoreRequestScreen onBack={() => {}} startOnCode />);
        });
        await waitFor(() => expect(adopt).toHaveBeenCalledWith('dev-lili', 'Lili'));
        expect(vi.mocked(keepSafe.peekRestore).mock.calls.length).toBe(peeks);
        // N-1: nobody tapped anything, so it only asks for the replay.
        expect(vi.mocked(keepSafe.redeemRestore).mock.calls.at(-1)![1]).toMatchObject({ replayOnly: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it('N-1: a pending move for another code (H1) is cleared on opening the chooser for H2, which peeks H2 and never redeems H1', async () => {
      notePendingMove({ handle: 'handle-old-H1', choice: 'choice-lili', abandonCurrent: true, deleteCurrent: true });
      const adopt = vi.fn(async () => {});
      h.device = withFinisher({ deviceId: 'dev-nikos', username: 'Nikos', isReady: true, adoptRestoredIdentity: adopt });
      const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
      await act(async () => {
        typeCode(utils.getByTestId('restore-code-input'), '48291376');
      });
      await utils.findByTestId('restore-warning');
      expect(keepSafe.peekRestore).toHaveBeenLastCalledWith('dev-nikos', 'handle-1');
      expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
      expect(readPendingMove()).toBeNull();
      expect(adopt).not.toHaveBeenCalled();
    });

    it('N-1: opening the chooser with a pending move for the same code asks only for the replay; refused (nothing moved), it peeks as normal', async () => {
      setMovingHandle('handle-same');
      notePendingMove({ handle: 'handle-same', choice: 'choice-lili', abandonCurrent: true, deleteCurrent: true });
      vi.mocked(keepSafe.redeemRestore).mockRejectedValueOnce(
        new ApiError(new Response(null, { status: 401 }), { error: 'link_not_valid' }, { method: 'POST', url: '/api/restore/redeem' }),
      );
      const adopt = vi.fn(async () => {});
      h.device = withFinisher({ deviceId: 'dev-nikos', username: 'Nikos', isReady: true, adoptRestoredIdentity: adopt });
      const utils = render(<RestoreRequestScreen onBack={() => {}} />);
      await utils.findByTestId('restore-warning');
      expect(keepSafe.redeemRestore).toHaveBeenCalledTimes(1);
      expect(vi.mocked(keepSafe.redeemRestore).mock.calls[0]![1]).toMatchObject({ replayOnly: true });
      expect(keepSafe.peekRestore).toHaveBeenLastCalledWith('dev-nikos', 'handle-same');
      expect(readPendingMove()).toBeNull();
      expect(adopt).not.toHaveBeenCalled();
    });

    it('restoreMoveUnconfirmed exists in en, el and fr, with the ruled English', () => {
      expect(en.restoreMoveUnconfirmed).toBe('We couldn’t confirm the move yet. Check your connection and try again. Your spots are safe.');
      expect(TRANSLATIONS.el.restoreMoveUnconfirmed).toBeTruthy();
      expect(TRANSLATIONS.fr.restoreMoveUnconfirmed).toBeTruthy();
    });
  });

  it('a refused redeem clears the pending move (I1)', async () => {
    vi.mocked(keepSafe.redeemRestore).mockRejectedValueOnce(
      new ApiError(new Response(null, { status: 401 }), { error: 'link_not_valid' }, { method: 'POST', url: '/api/restore/redeem' }),
    );
    const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    await act(async () => {
      typeCode(utils.getByTestId('restore-code-input'), '48291376');
    });
    await act(async () => {
      fireEvent.click(await utils.findByText('Move Lili’s spots to this phone'));
    });
    await utils.findByTestId('restore-not-valid');
    expect(readPendingMove()).toBeNull();
  });

  it('M7: the box stays editable while a check runs, and after a refusal its contents are selected', async () => {
    let refuse!: (e: unknown) => void;
    vi.mocked(keepSafe.exchangeRestoreCode).mockImplementationOnce(() => new Promise((_, rej) => { refuse = rej; }));
    const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    const input = utils.getByTestId('restore-code-input') as HTMLInputElement;
    await act(async () => {
      typeCode(input, '48291376');
    });
    expect(input.readOnly).toBe(false);
    await act(async () => {
      refuse(refusal(401, 'code_not_valid'));
    });
    await utils.findByTestId('restore-code-refused');
    const box = utils.getByTestId('restore-code-input') as HTMLInputElement;
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe('48291376'.length);
  });

  it('M8: "send another" is greyed only after a real request in the last minute', async () => {
    // A wrong try with no request makes a note, but nothing was sent: send another is open.
    window.localStorage.setItem(RESTORE_WAITING_KEY, JSON.stringify({ askedAt: Date.now(), requests: 0, wrongTries: 1 }));
    const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    expect(utils.getByTestId('restore-code-resend').getAttribute('aria-disabled')).not.toBe('true');
    cleanup();
    noteRequest();
    const again = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
    expect(again.getByTestId('restore-code-resend').getAttribute('aria-disabled')).toBe('true');
  });

  describe('leaving the chooser on the code path (I2)', () => {
    const linkRefusal = (url: string) =>
      new ApiError(new Response(null, { status: 401 }), { error: 'link_not_valid' }, { method: 'POST', url });
    const toChooser = async (utils: ReturnType<typeof render>) => {
      await act(async () => {
        typeCode(utils.getByTestId('restore-code-input'), '48291376');
      });
    };

    it('Back from the chooser drops the handle and returns to the code box', async () => {
      const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
      await toChooser(utils);
      await utils.findByText('Move Lili’s spots to this phone');
      expect(readWaiting()?.movingHandle).toBe('handle-1');
      await act(async () => {
        fireEvent.click(utils.getByTestId('restore-chooser-back'));
      });
      expect(utils.getByTestId('restore-code-input')).toBeTruthy();
      expect((utils.getByTestId('restore-code-input') as HTMLInputElement).value).toBe('');
      expect(readWaiting()?.movingHandle).toBeUndefined();
      expect(keepSafe.redeemRestore).not.toHaveBeenCalled();
    });

    it('a person at the Keep or Delete warning can back out', async () => {
      h.device = { deviceId: 'dev-nikos', username: 'Nikos', isReady: true, adoptRestoredIdentity: vi.fn(async () => {}) };
      const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
      await toChooser(utils);
      await utils.findByTestId('restore-warning');
      await act(async () => {
        fireEvent.click(utils.getByTestId('restore-chooser-back'));
      });
      expect(utils.getByTestId('restore-code-input')).toBeTruthy();
      expect(utils.queryByTestId('restore-warning')).toBeNull();
    });

    it('no Back while the move is being made', async () => {
      let release!: (v: { deviceId: string; username: string | null }) => void;
      vi.mocked(keepSafe.redeemRestore).mockImplementationOnce(() => new Promise((r) => { release = r; }));
      h.device = { deviceId: 'dev-new', username: null, isReady: true, adoptRestoredIdentity: vi.fn(async () => {}) };
      const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
      await toChooser(utils);
      await act(async () => {
        fireEvent.click(await utils.findByText('Move Lili’s spots to this phone'));
      });
      expect(utils.queryByTestId('restore-chooser-back')).toBeNull();
      await act(async () => {
        release({ deviceId: 'dev-lili', username: 'Lili' });
      });
    });

    it('a superseded handle at peek: not valid, the handle is dropped, and "ask again" goes to the address box', async () => {
      // A newer code exchange replaced this handle on the server (only the newest works).
      setMovingHandle('handle-superseded');
      vi.mocked(keepSafe.peekRestore).mockRejectedValueOnce(linkRefusal('/api/restore/peek'));
      const utils = render(<RestoreRequestScreen onBack={() => {}} />);
      await utils.findByTestId('restore-not-valid');
      expect(readWaiting()?.movingHandle).toBeUndefined();
      await act(async () => {
        fireEvent.click(utils.getByTestId('restore-ask-again').querySelector('[role="button"]')!);
      });
      expect(utils.getByTestId('restore-email')).toBeTruthy();
      expect(router.replace).not.toHaveBeenCalled();
      // A remount now opens the address box, not the dead chooser: no loop.
      cleanup();
      const again = render(<RestoreRequestScreen onBack={() => {}} />);
      expect(again.getByTestId('restore-email')).toBeTruthy();
    });

    it('a spent handle at peek: the same, and the named phone is not sent round the same route', async () => {
      h.device = { deviceId: 'dev-nikos', username: 'Nikos', isReady: true, adoptRestoredIdentity: vi.fn(async () => {}) };
      setMovingHandle('handle-spent');
      vi.mocked(keepSafe.peekRestore).mockRejectedValueOnce(linkRefusal('/api/restore/peek'));
      const utils = render(<RestoreRequestScreen onBack={() => {}} />);
      await utils.findByTestId('restore-not-valid');
      expect(readWaiting()?.movingHandle).toBeUndefined();
      await act(async () => {
        fireEvent.click(utils.getByTestId('restore-ask-again').querySelector('[role="button"]')!);
      });
      expect(router.replace).not.toHaveBeenCalledWith('/get-spots-back');
      expect(utils.getByTestId('restore-email')).toBeTruthy();
    });

    it('a failed peek drops the handle too', async () => {
      setMovingHandle('handle-x');
      vi.mocked(keepSafe.peekRestore).mockRejectedValueOnce(new Error('network'));
      const utils = render(<RestoreRequestScreen onBack={() => {}} />);
      await utils.findByTestId('restore-not-valid');
      expect(readWaiting()?.movingHandle).toBeUndefined();
    });

    it('a refused move drops the handle', async () => {
      vi.mocked(keepSafe.redeemRestore).mockRejectedValueOnce(linkRefusal('/api/restore/redeem'));
      const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
      await toChooser(utils);
      await act(async () => {
        fireEvent.click(await utils.findByText('Move Lili’s spots to this phone'));
      });
      await utils.findByTestId('restore-not-valid');
      expect(readWaiting()?.movingHandle).toBeUndefined();
    });

    it('"already on this phone" forgets the whole note', async () => {
      noteRequest();
      vi.mocked(keepSafe.peekRestore).mockResolvedValueOnce({
        spotters: [{ choice: 'choice-lili', username: 'Lili' }],
        openedOnAskingPhone: true,
        alreadyHere: { username: 'Lili' },
      });
      const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
      await toChooser(utils);
      await utils.findByTestId('restore-already-here');
      expect(readWaiting()).toBeNull();
    });
  });

  describe('code words on the code path (I3, I4)', () => {
    it('says "checking your code" and, refused, "that code" with "Email me a new code" (I3)', async () => {
      let refuse!: (e: unknown) => void;
      vi.mocked(keepSafe.peekRestore).mockImplementationOnce(() => new Promise((_, rej) => { refuse = rej; }));
      const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
      await act(async () => {
        typeCode(utils.getByTestId('restore-code-input'), '48291376');
      });
      expect(utils.getByText(en.restoreCodeChecking)).toBeTruthy();
      expect(utils.queryByText(en.restorePageChecking)).toBeNull();
      await act(async () => {
        refuse(new ApiError(new Response(null, { status: 401 }), { error: 'link_not_valid' }, { method: 'POST', url: '/api/restore/peek' }));
      });
      expect((await utils.findByTestId('restore-not-valid')).textContent).toBe(en.restoreCodeNotValid);
      expect(utils.getByTestId('restore-ask-again').textContent).toBe(en.restoreCodeNewEmail);
      expect(utils.queryByText(en.restorePageAskAgain)).toBeNull();
    });

    it('the placeholder has no digits (I4)', () => {
      const utils = render(<RestoreRequestScreen onBack={() => {}} startOnCode />);
      const placeholder = utils.getByTestId('restore-code-input').getAttribute('placeholder');
      expect(placeholder).toBe(en.restoreCodePlaceholder);
      expect(placeholder).not.toMatch(/[0-9]{2,}/);
    });

    it('the code-path strings exist in en, el and fr, with the ruled wording', () => {
      expect(en.restoreCodeChecking).toBe('Checking your code…');
      expect(en.restoreCodeNotValid).toBe('That code has expired or has already been used. Nothing has moved.');
      expect(en.restoreCodeNewEmail).toBe('Email me a new code');
      expect(en.restoreCodePlaceholder).toBe('8-digit code');
      expect(TRANSLATIONS.el.restoreCodePlaceholder).toBe('8ψήφιος κωδικός');
      expect(TRANSLATIONS.fr.restoreCodePlaceholder).toBe('Code à 8 chiffres');
      for (const lang of ['el', 'fr'] as const) {
        for (const k of ['restoreCodeChecking', 'restoreCodeNotValid']) {
          expect(TRANSLATIONS[lang][k], `${lang}.${k}`).toBeTruthy();
          expect(TRANSLATIONS[lang][k]).not.toBe(TRANSLATIONS.en[k]);
        }
      }
    });
  });

  it('every new string exists in en, el and fr, and restoreAskSent is gone', () => {
    const keys = ['restoreAskBody', 'restoreAskSend', 'restoreCodeTitle', 'restoreCodeBody', 'restoreCodeSubmit', 'restoreCodeResend', 'restoreHaveCode', 'restoreHaveCodeNote', 'restoreCodeRefused', 'restoreCodeDead', 'restoreCodeNewEmail', 'restoreTooManyTries', 'restoreAskedThrice', 'restoreCodeFailed'];
    for (const lang of ['en', 'el', 'fr'] as const) {
      for (const k of keys) expect(TRANSLATIONS[lang][k], `${lang}.${k}`).toBeTruthy();
      expect(TRANSLATIONS[lang].restoreAskSent).toBeUndefined();
    }
  });
});

describe('T7 hygiene', () => {
  it('the code screen tests put window.localStorage and window.location back as they found them', () => {
    expect(Object.getOwnPropertyDescriptor(window, 'localStorage')).toEqual(beforeCodeBlock.storage);
    expect(Object.getOwnPropertyDescriptor(window, 'location')).toEqual(beforeCodeBlock.location);
  });
});
