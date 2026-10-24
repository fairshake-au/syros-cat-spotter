// @vitest-environment jsdom
/** SYC-664 T6: the shared chooser. The link page's own behaviour is pinned in KeepSafe.test.tsx. */
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATIONS } from '@/lib/i18n';

vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return { useLanguage: () => ({ language: 'en', t: (key: string) => T.en[key] ?? key }) };
});
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ background: '#fff', foreground: '#000', mutedForeground: '#666', primary: '#123' }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/components/purropolis', async () => {
  const { Text } = await import('react-native');
  return { Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => <Text role="button" onPress={onPress}>{children}</Text> };
});
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({ deviceId: 'dev-new', username: null, isReady: true, adoptRestoredIdentity: vi.fn() }),
}));
vi.mock('@/context/DeleteMyDataContext', () => ({ useDeleteMyData: () => ({ holdIdentityDeleted: async (w: () => Promise<unknown>) => w() }) }));
vi.mock('@/context/OfflineContext', () => ({
  useOffline: () => ({ isOnline: true, pauseSync: async () => {}, resumeSync: () => {} }),
}));
vi.mock('expo-router', () => ({ router: { replace: vi.fn() } }));
vi.mock('@workspace/api-client-react', () => ({ getProfile: vi.fn(async () => ({ totalSightings: 0 })) }));
vi.mock('@/hooks/useUsernameClaim', () => ({ waitForUsernameClaimToSettle: vi.fn(async () => {}) }));
vi.mock('@/lib/keepSafe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/keepSafe')>();
  return {
    ...actual,
    peekRestore: vi.fn(async () => ({
      spotters: [{ choice: 'choice-lili', username: 'Lili' }],
      openedOnAskingPhone: true,
      alreadyHere: null,
    })),
  };
});

import { RestoreChooser } from '../keepSafe/RestoreChooser';

const en = TRANSLATIONS.en;
afterEach(cleanup);

describe('RestoreChooser', () => {
  it('fromCode skips the in-app-browser warning even in an in-app browser', async () => {
    const ua = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0',
    });
    try {
      const { findByText, queryByTestId } = render(<RestoreChooser secret="handle" fromCode />);
      await findByText('Move Lili’s spots to this phone');
      expect(queryByTestId('restore-in-app')).toBeNull();
    } finally {
      if (ua) Object.defineProperty(window.navigator, 'userAgent', ua);
      else delete (window.navigator as unknown as Record<string, unknown>).userAgent;
    }
  });
});
