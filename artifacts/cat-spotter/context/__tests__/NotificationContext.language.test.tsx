// @vitest-environment jsdom
/**
 * SYC-706: the app sends its language with the push token, and again when the
 * language changes (only once a token exists), so the weekly push is worded
 * in it.
 */
import React from 'react';
import { Platform } from 'react-native';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  language: 'el' as 'en' | 'el' | 'fr',
  deviceId: 'dev-1' as string | null,
  mutate: vi.fn(),
  tokenData: 'ExponentPushToken[abc]' as string | null,
}));

vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  getPermissionsAsync: async () => ({ status: 'granted' }),
  requestPermissionsAsync: async () => ({ status: 'granted' }),
  setNotificationChannelAsync: vi.fn(),
  AndroidImportance: { DEFAULT: 3 },
  getExpoPushTokenAsync: async () => (h.tokenData ? { data: h.tokenData } : null),
  addNotificationResponseReceivedListener: () => ({ remove: vi.fn() }),
  getLastNotificationResponseAsync: async () => null,
  setBadgeCountAsync: async () => {},
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} }, easConfig: {} } }));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('@/lib/celebrationBus', () => ({ openWeeklyResult: vi.fn() }));
vi.mock('@/hooks/useStickyFailure', () => ({ useStickyFailure: () => false }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: true }) }));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({ deviceId: h.deviceId, isReady: true }),
}));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ language: h.language }) }));
vi.mock('@workspace/api-client-react', () => ({
  useListNotifications: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  getListNotificationsQueryKey: (id: string) => ['n', id],
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn() }),
  useMarkNotificationRead: () => ({ mutate: vi.fn() }),
  useRegisterPushToken: () => ({ mutate: h.mutate }),
  getCat: vi.fn(),
}));

import { NotificationProvider } from '../NotificationContext';

const originalOS = Platform.OS;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  h.language = 'el';
  h.deviceId = 'dev-1';
  h.tokenData = 'ExponentPushToken[abc]';
  h.mutate.mockReset();
});
afterEach(() => {
  cleanup();
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

describe('NotificationProvider push language', () => {
  it('registers the token with the app language', async () => {
    render(<NotificationProvider>{null}</NotificationProvider>);
    await flush();
    expect(h.mutate).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      data: { token: 'ExponentPushToken[abc]', language: 'el' },
    });
  });

  it('sends the language again when it changes', async () => {
    const view = render(<NotificationProvider>{null}</NotificationProvider>);
    await flush();
    h.mutate.mockClear();
    h.language = 'fr';
    view.rerender(<NotificationProvider>{null}</NotificationProvider>);
    await flush();
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      data: { token: 'ExponentPushToken[abc]', language: 'fr' },
    });
  });

  it('does not send a language change when there is no token', async () => {
    h.tokenData = null;
    const view = render(<NotificationProvider>{null}</NotificationProvider>);
    await flush();
    h.language = 'fr';
    view.rerender(<NotificationProvider>{null}</NotificationProvider>);
    await flush();
    expect(h.mutate).not.toHaveBeenCalled();
  });
});
