// @vitest-environment jsdom
/**
 * SYC-120: the Help & info page (docs/specs/help-and-info.md §3, §6).
 */
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Linking } from 'react-native';
import { getGuidance } from '@workspace/welfare-guidance';
import { TRANSLATIONS } from '@/lib/i18n';
import { takeReportHandoff } from '@/lib/reportHandoff';

const push = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  online: true,
  donateHost: null as string | null,
  query: { data: undefined as unknown, isError: false },
  lang: 'en' as 'en' | 'el' | 'fr',
}));

vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '9.8.7' } } }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined), removeItem: vi.fn() },
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetCampaign: () => state.query,
  getGetCampaignQueryKey: () => ['campaign'],
  // The guidance refresh: no network.
  customFetch: vi.fn(() => Promise.reject(new Error('offline'))),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff', foreground: '#000', mutedForeground: '#666', card: '#fff', border: '#ddd',
    primary: '#123', primaryForeground: '#fff', accent: '#a00', accentForeground: '#fff',
    destructive: '#c00', secondary: '#eee', secondaryForeground: '#111',
  }),
}));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return {
    useLanguage: () => ({
      language: state.lang,
      t: (key: string) => T[state.lang][key] ?? key,
    }),
  };
});
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: state.online }) }));
vi.mock('@/context/AppSettingsContext', () => ({ useAppSettings: () => ({ donateHost: state.donateHost }) }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/lib/pendingPhotos', () => ({ readPendingPhotoBase64: vi.fn() }));
vi.mock('@/lib/urls', () => ({ apiOrigin: () => 'https://api.example' }));

import HelpScreen from '../../app/(tabs)/help';

const en = TRANSLATIONS.en;
const campaign = {
  id: 'c1', title: 'Spring round', blurb: '', currency: 'EUR', goalCents: 500000, raisedCents: 0,
  catsHelped: 3, donors: 0, endsAt: '2099-12-31', donateUrl: 'https://donate.example/give',
  suggestedAmountsCents: [1000, 2500],
};

let openURL: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  state.online = true;
  state.donateHost = null;
  state.query = { data: undefined, isError: false };
  state.lang = 'en';
  openURL = vi.spyOn(Linking, 'openURL').mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  push.mockClear();
  vi.restoreAllMocks();
});

describe('Help & info page', () => {
  it('shows the sections in order: urgent card, vets, how it works, contact, privacy, giving', () => {
    state.donateHost = 'syroscats.com';
    const { container } = render(<HelpScreen />);
    const text = container.textContent ?? '';
    const order = [
      en.helpInfoTitle, en.helpCatHeading, en.helpVetsHeading, en.helpHowHeading,
      en.helpContactHeading, en.helpPrivacyHeading, en.helpGiveHeading,
    ].map((s) => text.indexOf(s!));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the urgent button opens /report with nothing handed over', () => {
    takeReportHandoff();
    const { getByText } = render(<HelpScreen />);
    fireEvent.click(getByText(en.helpCatButton!));
    expect(push).toHaveBeenCalledWith('/report');
    expect(takeReportHandoff()).toBeNull();
  });

  it('vets render at once from the built-in guidance with no network', () => {
    state.online = false;
    const { container } = render(<HelpScreen />);
    const vets = getGuidance('en').vets;
    expect(vets.length).toBeGreaterThan(0);
    for (const v of vets) expect(container.textContent).toContain(v.name);
  });

  it('every control has an accessibility role', () => {
    state.donateHost = 'syroscats.com';
    const { getAllByRole } = render(<HelpScreen />);
    expect(getAllByRole('button').length).toBeGreaterThanOrEqual(4);
  });
});

describe('Help & info: giving', () => {
  it('A: an open campaign shows the campaign card, not the link card', () => {
    state.query = { data: campaign, isError: false };
    state.donateHost = 'syroscats.com';
    const { queryByTestId, getByText } = render(<HelpScreen />);
    expect(queryByTestId('help-giving-campaign')).not.toBeNull();
    expect(queryByTestId('help-giving-link')).toBeNull();
    expect(getByText('Spring round')).toBeTruthy();
  });

  it('"Be the first to chip in!" shows in state A (nothing raised yet)', () => {
    state.query = { data: campaign, isError: false };
    const { queryByText } = render(<HelpScreen />);
    expect(queryByText(en.campaignBeFirst!)).not.toBeNull();
  });

  it('"Be the first to chip in!" never shows in state B or C', () => {
    state.donateHost = 'syroscats.com';
    const b = render(<HelpScreen />);
    expect(b.queryByTestId('help-giving-link')).not.toBeNull();
    expect(b.queryByText(en.campaignBeFirst!)).toBeNull();
    b.unmount();
    state.donateHost = null;
    const c = render(<HelpScreen />);
    expect(c.queryByTestId('help-giving-link')).toBeNull();
    expect(c.queryByText(en.campaignBeFirst!)).toBeNull();
  });

  it('loading shows B with a saved host, with no spinner', () => {
    state.query = { data: undefined, isError: false };
    state.donateHost = 'syroscats.com';
    const { queryByTestId, queryByRole } = render(<HelpScreen />);
    expect(queryByTestId('help-giving-link')).not.toBeNull();
    expect(queryByRole('progressbar')).toBeNull();
  });

  it('loading with no saved host shows nothing (C)', () => {
    const { queryByTestId, queryByText } = render(<HelpScreen />);
    expect(queryByTestId('help-giving-link')).toBeNull();
    expect(queryByTestId('help-giving-campaign')).toBeNull();
    expect(queryByText(en.helpGiveHeading!)).toBeNull();
  });

  it('a 503 / error shows B or C, never an error message', () => {
    state.query = { data: undefined, isError: true };
    state.donateHost = 'syroscats.com';
    const b = render(<HelpScreen />);
    expect(b.queryByTestId('help-giving-link')).not.toBeNull();
    expect(b.container.textContent).not.toMatch(/couldn.t load/i);
    b.unmount();
    state.donateHost = null;
    const c = render(<HelpScreen />);
    expect(c.queryByTestId('help-giving-link')).toBeNull();
  });

  it('B opens /api/go/give from the API origin', () => {
    state.donateHost = 'syroscats.com';
    const { getByText } = render(<HelpScreen />);
    fireEvent.click(getByText('Give on syroscats.com'));
    expect(openURL).toHaveBeenCalledWith('https://api.example/api/go/give');
  });

  it('B shows the host line under the button', () => {
    state.donateHost = 'syroscats.com';
    const { getByText } = render(<HelpScreen />);
    expect(getByText('Opens syroscats.com in your browser')).toBeTruthy();
  });

  it('offline B shows "Needs an internet connection" instead of the button', () => {
    state.online = false;
    state.donateHost = 'syroscats.com';
    const { queryByTestId, queryByText } = render(<HelpScreen />);
    expect(queryByTestId('help-giving-link')).not.toBeNull();
    expect(queryByTestId('help-giving-offline')?.textContent).toBe(en.helpNeedsInternet);
    expect(queryByText('Give on syroscats.com')).toBeNull();
  });

  it('offline with a cached campaign is still B, not A', () => {
    state.online = false;
    state.query = { data: campaign, isError: false };
    state.donateHost = 'syroscats.com';
    const { queryByTestId } = render(<HelpScreen />);
    expect(queryByTestId('help-giving-campaign')).toBeNull();
    expect(queryByTestId('help-giving-link')).not.toBeNull();
  });
});

describe('Help & info: contact and privacy', () => {
  it('Email us opens the mailto with the version and platform line, and no device id', () => {
    const { getByText } = render(<HelpScreen />);
    fireEvent.click(getByText(en.helpContactButton!));
    expect(openURL).toHaveBeenCalledTimes(1);
    const url = openURL.mock.calls[0][0] as string;
    expect(url.startsWith('mailto:hello@catspotters.com?subject=Cat%20Spotters%20app&body=')).toBe(true);
    const body = decodeURIComponent(url.split('&body=')[1]);
    expect(body).toMatch(/^\n\nApp 9\.8\.7 · /);
    expect(url.toLowerCase()).not.toContain('device');
  });

  it('shows the address as selectable text', () => {
    const { getByText } = render(<HelpScreen />);
    expect(getByText('hello@catspotters.com')).toBeTruthy();
  });

  it('when openURL rejects, the copy line shows', async () => {
    openURL.mockRejectedValue(new Error('no mail app'));
    const { getByText, queryByText } = render(<HelpScreen />);
    expect(queryByText(en.helpContactFailed!)).toBeNull();
    fireEvent.click(getByText(en.helpContactButton!));
    await waitFor(() => expect(queryByText(en.helpContactFailed!)).not.toBeNull());
  });

  it('the privacy policy link opens https://catspotters.com/privacy', () => {
    const { getByText } = render(<HelpScreen />);
    fireEvent.click(getByText(en.helpPrivacyPolicy!));
    expect(openURL).toHaveBeenCalledWith('https://catspotters.com/privacy');
  });

  it('offline: the policy shows "Needs an internet connection" and is not a link', () => {
    state.online = false;
    const { queryByTestId, getByText, queryAllByRole } = render(<HelpScreen />);
    expect(queryByTestId('help-privacy-offline')?.textContent).toBe(en.helpNeedsInternet);
    fireEvent.click(getByText(en.helpPrivacyPolicy!));
    expect(openURL).not.toHaveBeenCalled();
    expect(queryAllByRole('link').map((l) => l.textContent)).not.toContain(en.helpPrivacyPolicy);
  });

  it('Delete my data opens /delete-my-data, offline too', () => {
    state.online = false;
    const { getByText } = render(<HelpScreen />);
    fireEvent.click(getByText(en.deleteMyDataRow!));
    expect(push).toHaveBeenCalledWith('/delete-my-data');
  });
});
