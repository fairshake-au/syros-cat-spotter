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
}));

vi.mock('@expo/vector-icons', () => ({ Feather: Object.assign(() => null, { glyphMap: {} }) }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('expo-router', () => ({
  useRouter: () => ({ dismissTo: h.dismissTo, canGoBack: () => true, back: vi.fn(), push: vi.fn() }),
  useFocusEffect: () => {},
}));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
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
  }),
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetProfile: () => ({ data: h.profile }),
  getGetProfileQueryKey: (id: string) => [`/api/profile/${id}`],
}));

import NotificationsScreen from '../../app/notifications';

beforeEach(() => {
  h.dismissTo.mockReset();
  h.refetch.mockClear();
  h.notifications = [];
  h.isLoading = false;
  h.loadFailed = false;
  h.profile = undefined;
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
});
