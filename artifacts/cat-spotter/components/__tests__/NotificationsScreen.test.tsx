// @vitest-environment jsdom
/**
 * SYC-508 (couldnt-load-try-again.md §3.3, §4.1): Notifications tells a
 * failed load from an empty inbox, and the empty inbox has a way forward.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  dismissTo: vi.fn(),
  notifications: [] as unknown[],
  isLoading: false,
  loadFailed: false,
  refetch: vi.fn(async () => {}),
  profile: undefined as unknown,
  push: vi.fn(),
  markRead: vi.fn(),
  openWeekly: vi.fn(),
  language: 'en' as 'en' | 'el' | 'fr',
  // Most tests read the key itself in English; the merge lines read the real words.
  realEnglish: false,
}));

vi.mock('@expo/vector-icons', () => ({ Feather: Object.assign(() => null, { glyphMap: {} }) }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('expo-router', () => ({
  useRouter: () => ({ dismissTo: h.dismissTo, canGoBack: () => true, back: vi.fn(), push: h.push }),
  useFocusEffect: () => {},
}));
vi.mock('@/lib/celebrationBus', () => ({ openWeeklyResult: h.openWeekly }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return {
    useLanguage: () => ({
      t: (k: string) => (h.language === 'en' && !h.realEnglish ? k : ((TRANSLATIONS as Record<string, Record<string, string>>)[h.language]?.[k] ?? k)),
      language: h.language,
    }),
  };
});
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => ({ deviceId: 'dev-1' }) }));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: true }) }));
vi.mock('@/context/NotificationContext', () => ({
  useNotifications: () => ({
    notifications: h.notifications,
    unreadCount: 0,
    isLoading: h.isLoading,
    loadFailed: h.loadFailed,
    refetch: h.refetch,
    markAllRead: vi.fn(),
    markRead: h.markRead,
  }),
}));
// #301 imports IconButton from the purropolis index, which pulls in native
// modules; the real Button and IconButton render fine on their own.
vi.mock('@/components/purropolis', async () => {
  const { Button } = await import('@/components/purropolis/Button');
  const { IconButton } = await import('@/components/purropolis/IconButton');
  return { Button, IconButton };
});
vi.mock('@workspace/api-client-react', () => ({
  useGetProfile: () => ({ data: h.profile }),
  getGetProfileQueryKey: (id: string) => [`/api/profile/${id}`],
}));

import NotificationsScreen from '../../app/notifications';
import { TRANSLATIONS } from '@/lib/i18n';

const mergeLine = (lang: 'el' | 'fr', key: string) =>
  (TRANSLATIONS[lang][key] ?? '').split('{from}').join('Mimi').split('{to}').join('Agatha');

beforeEach(() => {
  h.dismissTo.mockReset();
  h.refetch.mockClear();
  h.notifications = [];
  h.isLoading = false;
  h.loadFailed = false;
  h.profile = undefined;
  h.language = 'en';
  h.realEnglish = false;
});
afterEach(cleanup);

describe('Notifications screen (SYC-508)', () => {
  it('failed with nothing loaded: "Couldn\'t load", Try again reloads, no empty line', () => {
    h.loadFailed = true;
    render(<NotificationsScreen />);
    expect(screen.getByText('loadFailedTitle')).toBeTruthy();
    expect(screen.queryByText('noNotifications')).toBeNull();
    expect(screen.queryByText('noNotificationsYet')).toBeNull();
    fireEvent.click(screen.getByTestId('notifications-load-failed-retry'));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('empty, no spots yet: the original line and Spot a cat, which opens the Spot tab', () => {
    h.profile = { catsSpotted: 0 };
    render(<NotificationsScreen />);
    expect(screen.getByText('noNotifications')).toBeTruthy();
    fireEvent.click(screen.getByText('spotTitle'));
    expect(h.dismissTo).toHaveBeenCalledWith('/spot');
  });

  it('empty, has spotted cats: the "news will show here" line, still Spot a cat', () => {
    h.profile = { catsSpotted: 4 };
    render(<NotificationsScreen />);
    expect(screen.getByText('noNotificationsHasSpots')).toBeTruthy();
    expect(screen.queryByText('noNotifications')).toBeNull();
    expect(screen.getByText('spotTitle')).toBeTruthy();
  });

  it('empty, profile unknown: the plain line', () => {
    render(<NotificationsScreen />);
    expect(screen.getByText('noNotificationsYet')).toBeTruthy();
  });

  it('still loading: neither message', () => {
    h.isLoading = true;
    render(<NotificationsScreen />);
    expect(screen.queryByText('loadFailedTitle')).toBeNull();
    expect(screen.queryByText('noNotificationsYet')).toBeNull();
  });

  it('a weekly-result row has no cat: it asks for the celebration, never opens a cat', () => {
    h.notifications = [
      { id: 5, catId: null, catUpdateId: null, updateType: 'general', message: 'You came 2nd', read: false, createdAt: new Date().toISOString() },
    ];
    render(<NotificationsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /You came 2nd/ }));
    expect(h.openWeekly).toHaveBeenCalledTimes(1);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('a weekly-result row is worded in the app language from its place and points', () => {
    h.language = 'el';
    h.notifications = [
      { id: 6, catId: null, catUpdateId: null, updateType: 'general', message: 'You came 2nd on Syros last week', place: 2, weekPoints: 140, read: true, createdAt: new Date().toISOString() },
    ];
    render(<NotificationsScreen />);
    expect(screen.getByText('Την περασμένη εβδομάδα ήρθες στη θέση 2 με 140 πόντους')).toBeTruthy();
    expect(screen.queryByText(/You came/)).toBeNull();
  });

  it('a weekly-result row without place and points keeps its stored message', () => {
    h.notifications = [
      { id: 7, catId: null, catUpdateId: null, updateType: 'general', message: 'You came 2nd on Syros last week', place: null, weekPoints: null, read: true, createdAt: new Date().toISOString() },
    ];
    render(<NotificationsScreen />);
    expect(screen.getByText('You came 2nd on Syros last week')).toBeTruthy();
  });

  it('a weekly-result row with the place and points keys absent keeps its stored message', () => {
    h.notifications = [
      { id: 8, catId: null, catUpdateId: null, updateType: 'general', message: 'You came 2nd on Syros last week', read: true, createdAt: new Date().toISOString() },
    ];
    render(<NotificationsScreen />);
    expect(screen.getByText('You came 2nd on Syros last week')).toBeTruthy();
  });
  describe('SYC-59: merge lines', () => {
    beforeEach(() => {
      h.realEnglish = true;
    });

    const merged = (over: Record<string, unknown> = {}) => ({
      id: 21,
      catId: null,
      catUpdateId: null,
      catName: null,
      catPhotoUrl: null,
      updateType: 'general',
      message: 'Mimi and Agatha turned out to be the same cat. You now follow Agatha.',
      place: null,
      weekPoints: null,
      kind: 'merged',
      survivorCatId: 12,
      survivorCatName: 'Agatha',
      mergedCatName: 'Mimi',
      read: false,
      createdAt: new Date().toISOString(),
      ...over,
    });

    it('a merged line is shown, and tapping it opens Agatha, not the Spotters board', () => {
      h.notifications = [merged()];
      h.push.mockClear();
      h.openWeekly.mockClear();
      render(<NotificationsScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Mimi and Agatha turned out to be the same cat/ }));
      expect(h.push).toHaveBeenCalledWith({ pathname: '/cat/[id]', params: { id: '12' } });
      expect(h.openWeekly).not.toHaveBeenCalled();
    });

    it('tapping a merge line marks it read; an already-read one is left alone', () => {
      h.markRead.mockClear();
      h.notifications = [merged(), merged({ id: 23, read: true })];
      render(<NotificationsScreen />);
      const lines = screen.getAllByRole('button', { name: /turned out to be the same cat/ });
      fireEvent.click(lines[0]!);
      fireEvent.click(lines[1]!);
      expect(h.markRead).toHaveBeenCalledTimes(1);
      expect(h.markRead).toHaveBeenCalledWith(21);
    });

    it('a merge line whose surviving cat is gone (no name) does not open a missing cat: it takes the old weekly path', () => {
      h.notifications = [merged({ survivorCatName: null })];
      h.push.mockClear();
      h.openWeekly.mockClear();
      render(<NotificationsScreen />);
      fireEvent.click(screen.getByRole('button', { name: /turned out to be the same cat/ }));
      expect(h.push).not.toHaveBeenCalled();
      expect(h.openWeekly).toHaveBeenCalledTimes(1);
    });

    it('a duplicate-points line is shown like a week-result row (no cat of its own) and opens the cat that stays', () => {
      h.notifications = [
        merged({
          id: 22,
          kind: 'duplicate_points',
          message: 'You spotted that Mimi and Agatha are the same cat. Syros Cats agreed. +10 points.',
        }),
      ];
      h.push.mockClear();
      render(<NotificationsScreen />);
      expect(screen.getByText('You spotted that Mimi and Agatha are the same cat. Syros Cats agreed. +10 points.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Syros Cats agreed/ }));
      expect(h.push).toHaveBeenCalledWith({ pathname: '/cat/[id]', params: { id: '12' } });
    });

    it.each(['el', 'fr'] as const)('the line is worded in %s from the names, not the server\'s English', (lang) => {
      h.language = lang;
      h.notifications = [merged()];
      render(<NotificationsScreen />);
      expect(screen.queryByText(/turned out to be/)).toBeNull();
      expect(screen.getByText(mergeLine(lang, 'mergedLine'))).toBeTruthy();
    });

    it('a merge line from before the names were stored keeps the server\'s words and still goes to the weekly result', () => {
      h.notifications = [merged({ survivorCatId: undefined, survivorCatName: undefined, mergedCatName: undefined })];
      h.openWeekly.mockClear();
      render(<NotificationsScreen />);
      fireEvent.click(screen.getByRole('button', { name: /turned out to be the same cat/ }));
      expect(h.openWeekly).toHaveBeenCalledTimes(1);
    });

    it('a kind this build does not know keeps the server\'s message', () => {
      h.notifications = [merged({ kind: 'something_new', message: 'Brand new words' })];
      render(<NotificationsScreen />);
      expect(screen.getByText('Brand new words')).toBeTruthy();
    });
  });
});
