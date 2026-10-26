// @vitest-environment jsdom
/**
 * SYC-628 §3.5 / §8.6–8.7: Settings on their own screen. Everything that used
 * to be on Profile is here, and "Change it" from Profile opens the name editor.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: true,
  params: {} as Record<string, string>,
  isOnline: true,
  heldUsername: null as string | null,
  setLanguage: vi.fn(),
  setAppearance: vi.fn(),
  getItem: vi.fn(),
  setItem: vi.fn(async () => {}),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-router', () => ({
  router: {
    push: h.push,
    back: h.back,
    replace: h.replace,
    canGoBack: () => h.canGoBack,
  },
  useLocalSearchParams: () => h.params,
}));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return {
    useLanguage: () => ({
      t: (k: string) => TRANSLATIONS.en[k] ?? k,
      language: 'en',
      setLanguage: h.setLanguage,
    }),
  };
});
vi.mock('@/context/AppearanceContext', () => ({
  useAppearance: () => ({ appearance: 'system', setAppearance: h.setAppearance }),
}));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({
    deviceId: 'dev-1',
    username: 'sam',
    heldUsername: h.heldUsername,
    nameNote: null,
    setNameNote: vi.fn(),
  }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: h.getItem, setItem: h.setItem },
}));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: h.isOnline }) }));
vi.mock('@/lib/bannerArea', () => ({ useBannerAreaReserve: () => 0 }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/UsernameEditor', () => ({
  UsernameEditor: (p: { editRequest?: number }) => (
    <div data-testid="username-editor" data-edit-request={String(p.editRequest ?? 0)} />
  ),
}));
vi.mock('@/components/keepSafe/KeepSafeSettings', () => ({
  KeepSafeSettings: () => <div data-testid="keep-safe-settings" />,
}));
vi.mock('@/components/purropolis', async () => {
  const { Button } = await import('@/components/purropolis/Button');
  return { Button };
});
vi.mock('@workspace/api-client-react', () => ({
  useGetProfile: () => ({ data: { username: 'sam' } }),
  getGetProfileQueryKey: (id: string) => [`/api/profiles/${id}`],
}));

import SettingsScreen from '../../app/settings';
import { CelebrationSettingsProvider } from '@/context/CelebrationSettingsContext';

const renderSettings = () =>
  render(
    <CelebrationSettingsProvider>
      <SettingsScreen />
    </CelebrationSettingsProvider>,
  );

beforeEach(() => {
  h.push.mockReset();
  h.back.mockReset();
  h.replace.mockReset();
  h.setLanguage.mockReset();
  h.setAppearance.mockReset();
  h.canGoBack = true;
  h.params = {};
  h.isOnline = true;
  h.heldUsername = null;
  h.getItem.mockReset().mockResolvedValue(null);
  h.setItem.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Settings screen (SYC-628)', () => {
  it('sounds switch defaults on and persists off', async () => {
    renderSettings();
    expect(screen.getByText('Celebrations')).toBeTruthy();
    const sw = screen.getByRole('switch', { name: 'Celebration sounds' }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    fireEvent.click(sw);
    await waitFor(() => expect(h.setItem).toHaveBeenCalledWith('cat-spotter/celebration-sounds', 'false'));
    expect((screen.getByRole('switch', { name: 'Celebration sounds' }) as HTMLInputElement).checked).toBe(false);
  });

  it('has the name, Keep my spots safe, language, appearance and Delete my data', () => {
    renderSettings();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByTestId('username-editor')).toBeTruthy();
    expect(screen.getByTestId('keep-safe-settings')).toBeTruthy();
    fireEvent.click(screen.getByTestId('language-el'));
    expect(h.setLanguage).toHaveBeenCalledWith('el');
    fireEvent.click(screen.getByTestId('appearance-dark'));
    expect(h.setAppearance).toHaveBeenCalledWith('dark');
    fireEvent.click(screen.getByTestId('delete-my-data-row'));
    expect(h.push).toHaveBeenCalledWith('/delete-my-data');
  });

  it('language and appearance buttons say which is selected (SYC-509)', () => {
    renderSettings();
    expect(screen.getByTestId('language-en').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('language-el').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('appearance-system').getAttribute('aria-checked')).toBe('true');
  });

  it('the name editor waits while a name held offline is unsaved, as before', () => {
    h.heldUsername = 'held';
    renderSettings();
    expect(screen.queryByTestId('username-editor')).toBeNull();
  });

  it('opened from "Change it" on Profile: asks the name editor to open', () => {
    h.params = { editName: '1' };
    renderSettings();
    expect(screen.getByTestId('username-editor').getAttribute('data-edit-request')).toBe('1');
  });

  it('opened normally: the name editor stays closed', () => {
    renderSettings();
    expect(screen.getByTestId('username-editor').getAttribute('data-edit-request')).toBe('0');
  });

  it('back goes back, or to Profile when there is nowhere to go back to', () => {
    renderSettings();
    fireEvent.click(screen.getByTestId('settings-back'));
    expect(h.back).toHaveBeenCalled();
    cleanup();

    h.canGoBack = false;
    renderSettings();
    fireEvent.click(screen.getByTestId('settings-back'));
    expect(h.replace).toHaveBeenCalledWith('/(tabs)/profile');
  });
});
