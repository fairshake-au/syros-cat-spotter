// @vitest-environment jsdom
/** SYC-137: "Open in Cat Spotters" on the website's restore page. */
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  return {
    Button: ({ children, onPress, testID }: { children: React.ReactNode; onPress?: () => void; testID?: string }) => (
      <Text role="button" data-testid={testID} onPress={onPress}>{children}</Text>
    ),
  };
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

import { Linking } from 'react-native';
import { RestoreChooser } from '../keepSafe/RestoreChooser';

const TOKEN = 'A'.repeat(43);
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

function setUa(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value });
}

let openURL: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  openURL = vi.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  process.env.EXPO_PUBLIC_OPEN_IN_APP = 'on';
  setUa(IPHONE);
});
afterEach(() => {
  cleanup();
  openURL.mockRestore();
  delete process.env.EXPO_PUBLIC_OPEN_IN_APP;
  delete (window.navigator as unknown as Record<string, unknown>).userAgent;
});

describe('Open in Cat Spotters', () => {
  it('on a phone browser with the switch on, hands the link to the app', async () => {
    const { findByText } = render(<RestoreChooser secret={TOKEN} />);
    const button = await findByText('Open in Cat Spotters');
    await act(async () => {
      fireEvent.click(button);
    });
    expect(openURL).toHaveBeenCalledWith(`syroscatspotters://restore?t=${TOKEN}`);
  });

  it('is not shown with the switch off', async () => {
    delete process.env.EXPO_PUBLIC_OPEN_IN_APP;
    const { findByText, queryByText } = render(<RestoreChooser secret={TOKEN} />);
    await findByText('Move Lili’s spots to this phone');
    expect(queryByText('Open in Cat Spotters')).toBeNull();
  });

  it('is not shown on a desktop browser', async () => {
    setUa(DESKTOP);
    const { findByText, queryByText } = render(<RestoreChooser secret={TOKEN} />);
    await findByText('Move Lili’s spots to this phone');
    expect(queryByText('Open in Cat Spotters')).toBeNull();
  });

  it('is not shown on the code path, where the secret is a handle and the person is already in the app', async () => {
    const { findByText, queryByText } = render(<RestoreChooser secret="handle" fromCode />);
    await findByText('Move Lili’s spots to this phone');
    expect(queryByText('Open in Cat Spotters')).toBeNull();
  });
});

describe('opened inside the app from that button', () => {
  it('asks the different-browser question without a copy-link answer, and "no" leaves with nothing moved', async () => {
    const { Platform } = await import('react-native');
    const { peekRestore } = await import('@/lib/keepSafe');
    const { router } = await import('expo-router');
    vi.mocked(peekRestore).mockResolvedValueOnce({
      spotters: [{ choice: 'choice-lili', username: 'Lili' }],
      openedOnAskingPhone: false,
      alreadyHere: null,
    });
    const was = Platform.OS;
    (Platform as { OS: string }).OS = 'ios';
    try {
      const { findByText, queryByText } = render(<RestoreChooser secret={TOKEN} />);
      const no = await findByText('No, don’t move anything');
      expect(queryByText('No, copy the link')).toBeNull();
      await act(async () => {
        fireEvent.click(no);
      });
      expect(router.replace).toHaveBeenCalledWith('/');
    } finally {
      (Platform as { OS: string }).OS = was;
    }
  });
});
