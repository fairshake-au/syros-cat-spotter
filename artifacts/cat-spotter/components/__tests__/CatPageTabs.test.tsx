// @vitest-environment jsdom
/**
 * SYC-624 C3: the cat page in four tabs (docs/superpowers/specs/
 * 2026-10-23-cat-page-tabs-design.md). Harness as CatPagePhotos.test.tsx.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cat, Sighting } from '@workspace/api-client-react';

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name, ...rest }: { name: string; 'aria-hidden'?: boolean }) => (
    <i data-feather={name} aria-hidden={rest['aria-hidden'] ? 'true' : undefined} />
  ),
}));
vi.mock('expo-image', () => ({
  Image: ({ source, testID, onLoad }: { source?: { uri?: string }; testID?: string; onLoad?: () => void }) => (
    <img data-testid={testID ?? 'image'} data-uri={source?.uri ?? ''} onLoad={onLoad} />
  ),
}));
vi.mock('react-native', async () => {
  const rn = await vi.importActual<Record<string, unknown>>('react-native-web');
  return {
    ...rn,
    ScrollView: React.forwardRef(
      (
        p: { children?: React.ReactNode; onScroll?: (e: unknown) => void },
        ref: React.Ref<unknown>,
      ) => {
        React.useImperativeHandle(ref, () => ({ scrollTo: h.scrollTo }));
        h.onScroll = p.onScroll;
        return <div>{p.children}</div>;
      },
    ),
    Modal: ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
      visible ? <div data-testid="mock-modal">{children}</div> : null,
  };
});
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => h.params,
  useRouter: () => ({ canGoBack: () => false, back: () => {}, replace: () => {}, push: () => {} }),
}));
vi.mock('@/components/AppMap', () => ({ AppMap: () => <div data-testid="app-map" /> }));
vi.mock('@/components/MoreToAdd', () => ({ MoreToAdd: () => null }));
vi.mock('@/components/report/NeedsHelpLink', () => ({
  NeedsHelpLink: () => null,
  useOpenNeedsHelp: () => () => {},
}));
vi.mock('@/lib/modalVisibility', () => ({ registerModalOpen: () => () => {} }));
vi.mock('@/components/report/ReportIssueSheet', () => ({
  ReportIssueSheet: (p: { initialReason?: string }) => (
    <div data-testid="issue-sheet" data-reason={p.initialReason ?? ''} />
  ),
}));
vi.mock('@/components/ClaimCatSheet', () => ({
  ClaimCatSheet: (p: { mode: string }) => <div data-testid="sheet">{p.mode}</div>,
}));
vi.mock('@/components/purropolis', async () => {
  const { Button } = await import('@/components/purropolis/Button');
  return {
    Button,
    IconButton: ({ label, onPress }: { label: string; onPress?: () => void }) => (
      <button type="button" aria-label={label} onClick={onPress} />
    ),
  };
});
vi.mock('@/lib/urls', () => ({ photoSource: (p: string) => ({ uri: p }) }));

const h = vi.hoisted(() => ({
  params: { id: '7' } as Record<string, string>,
  isOnline: true,
  notifications: [] as unknown[],
  data: undefined as unknown,
  scrollTo: vi.fn(),
  onScroll: undefined as undefined | ((e: unknown) => void),
}));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({ deviceId: 'dev-1', ownedCatIds: [], isReady: true, startupError: null }),
}));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: h.isOnline }) }));
vi.mock('@/context/NotificationContext', () => ({
  useNotifications: () => ({ notifications: h.notifications, markRead: () => {} }),
}));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (k: string) => TRANSLATIONS.en[k] ?? k, language: 'en' }) };
});
vi.mock('@workspace/api-client-react', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    useGetCat: () => ({ isLoading: false, data: h.data }),
    getGetCatQueryKey: (id: number) => [`/api/cats/${id}`],
  };
});

import CatDetailScreen from '../../app/cat/[id]';
import { TRANSLATIONS } from '@/lib/i18n';

const en = TRANSLATIONS.en;

function cat(over: Partial<Cat> = {}): Cat {
  return {
    id: 7,
    name: 'Agatha',
    description: 'By the harbour',
    photoUrl: '/api/photos/7',
    sightingsCount: 14,
    lastSeenAt: '2026-09-01',
    locationPrecision: 'approximate',
    locationCellM: 250,
    lat: 37.4448,
    lng: 24.9425,
    hasHome: false,
    lifeStatus: 'street',
    notSeenSince: null,
    sterilised: { value: null, confidence: 'unknown', clippedTipSightings: 0 },
    ...over,
  } as Cat;
}

const sighting = (over: Partial<Sighting> = {}): Sighting =>
  ({
    catId: 7,
    spotterCode: 'CD34',
    spotterUsername: 'maria',
    spotterNickname: null,
    photoUrl: '/api/photos/7',
    photoHidden: false,
    createdAt: '2026-09-01',
    ...over,
  }) as Sighting;

const STORY = [{ type: 'discovered', message: 'maria', at: '2026-03-01' }];

function setData(over: Record<string, unknown> = {}, c: Cat = cat()) {
  h.data = {
    cat: c,
    sightings: [sighting()],
    spottersCount: 6,
    followersCount: 9,
    careTimeline: STORY,
    canClaim: false,
    claimCooldown: false,
    ...over,
  };
}
function page(over: Record<string, unknown> = {}, c: Cat = cat()) {
  setData(over, c);
  return render(<CatDetailScreen />);
}

const tabs = () => Array.from(document.querySelectorAll('[role="tab"]')) as HTMLElement[];
const tabNamed = (name: string) => tabs().find((e) => e.textContent?.includes(name))!;
const switchTab = (name: string) => fireEvent.click(tabNamed(name));
const panel = () => document.querySelector('[role="tabpanel"]') as HTMLElement;
const reportLinks = () => screen.queryAllByTestId('report-issue-link');

beforeEach(() => {
  h.params = { id: '7' };
  h.isOnline = true;
  h.notifications = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the four tabs', () => {
  it('opens on About, with only its panel in the page', () => {
    page();
    expect(tabs().map((e) => e.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    expect(panel().getAttribute('aria-labelledby')).toBe(tabNamed('About').id);
    expect(tabNamed('About').getAttribute('aria-controls')).toBe(panel().id);
    expect(screen.getByTestId('spotted-cat-button')).toBeTruthy();
    expect(screen.queryByTestId('sighting-cover')).toBeNull();
    expect(screen.queryByTestId('app-map')).toBeNull();
    expect(screen.queryByText('Agatha’s story')).toBeNull();
  });

  it('the tabs form a tab list; only the selected one is in the Tab-key order', () => {
    page();
    expect(document.querySelector('[role="tablist"]')).toBeTruthy();
    expect(tabs().map((e) => e.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    expect(tabs().every((e) => getComputedStyle(e).minHeight === '48px')).toBe(true);
  });

  it('the emoji are hidden from screen readers and each tab is spoken by its words', () => {
    page();
    for (const e of tabs()) {
      const emoji = e.querySelector('[aria-hidden="true"]');
      expect(emoji).toBeTruthy();
      expect(e.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('Photos shows the grid, Story the timeline, Map the map (created only when opened)', () => {
    page();
    switchTab('Photos');
    expect(screen.getByTestId('sighting-cover')).toBeTruthy();
    expect(screen.queryByTestId('spotted-cat-button')).toBeNull();
    switchTab('Story');
    expect(screen.getByText('Agatha’s story')).toBeTruthy();
    expect(screen.queryByTestId('sighting-cover')).toBeNull();
    expect(screen.queryByTestId('app-map')).toBeNull();
    switchTab('Map');
    expect(screen.getByTestId('app-map')).toBeTruthy();
    expect(screen.getByText(en.firstSpottedAroundHere!)).toBeTruthy();
    switchTab('About');
    expect(screen.queryByTestId('app-map')).toBeNull();
  });

  it('the arrow keys move between tabs on the web', () => {
    page();
    fireEvent.keyDown(tabNamed('About'), { key: 'ArrowRight' });
    expect(tabNamed('Photos').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabNamed('Photos'), { key: 'ArrowLeft' });
    expect(tabNamed('About').getAttribute('aria-selected')).toBe('true');
  });

  it('the Photos badge counts the photos the grid shows, and is absent at 0', () => {
    page({
      sightings: [
        sighting({ extraPhotos: [{ role: 'face', photoUrl: '/p/2' }, { role: 'ears', photoUrl: '/p/3' }] } as Partial<Sighting>),
        sighting({ photoUrl: '/p/4', photoHidden: true }),
        sighting({ photoUrl: '/p/5', photoRemoved: true } as Partial<Sighting>),
      ],
    });
    expect(tabNamed('Photos').textContent).toContain('3');
    expect(tabNamed('Photos').getAttribute('aria-label')).toBe('Photos, 3');
    cleanup();
    page({ sightings: [sighting({ photoUrl: '/p/4', photoHidden: true })] });
    expect(tabNamed('Photos').textContent).toBe('📷Photos');
    expect(tabNamed('Photos').getAttribute('aria-label')).toBe('Photos');
  });

  it('there is no Story tab without a care timeline (older server or cache)', () => {
    page({ careTimeline: undefined });
    expect(tabs().map((e) => e.textContent)).toEqual(['🐱About', '📷1Photos', '🗺️Map']);
  });

  it('a Story tab that goes away on a refetch falls back to About', () => {
    const view = page();
    switchTab('Story');
    setData({ careTimeline: undefined });
    view.rerender(<CatDetailScreen />);
    expect(tabNamed('About').getAttribute('aria-selected')).toBe('true');
  });

  it('the chosen tab survives a refetch of the cat', () => {
    const view = page();
    switchTab('Photos');
    setData({ sightings: [sighting(), sighting({ photoUrl: '/p/9' })] });
    view.rerender(<CatDetailScreen />);
    expect(tabNamed('Photos').getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByTestId('sighting-cover')).toHaveLength(2);
  });

  it('the SYR number is nowhere on the page', () => {
    page();
    for (const name of ['About', 'Photos', 'Story', 'Map']) {
      switchTab(name);
      expect(document.body.textContent).not.toMatch(/SYR-/);
    }
  });

  it('the back button says "Back"', () => {
    page();
    expect(screen.getByLabelText('Back')).toBeTruthy();
    expect(screen.queryByLabelText(en.tabCatalog!)).toBeNull();
  });
});

describe('switching tabs while scrolled', () => {
  const scrollTo = (y: number) => act(() => h.onScroll!({ nativeEvent: { contentOffset: { y } } }));

  it('scrolls the new tab to the pinned row only when the photo has scrolled away', () => {
    page();
    scrollTo(100);
    switchTab('Photos');
    expect(h.scrollTo).not.toHaveBeenCalled();
    scrollTo(600);
    switchTab('Map');
    expect(h.scrollTo).toHaveBeenCalledTimes(1);
    expect(h.scrollTo).toHaveBeenCalledWith({ y: 250, animated: false });
  });
});

describe('the report link and the report sheet', () => {
  it('"Something wrong on this page?" is the last thing in each of the four panels', () => {
    page();
    for (const name of ['About', 'Photos', 'Story', 'Map']) {
      switchTab(name);
      expect(reportLinks()).toHaveLength(1);
      const link = reportLinks()[0]!;
      expect(panel().lastElementChild!.contains(link) || panel().lastElementChild === link).toBe(true);
      // Nothing after it inside the panel's content.
      const content = panel().firstElementChild!;
      expect(content.lastElementChild === link || content.lastElementChild!.contains(link)).toBe(true);
    }
  });

  it('?report=wrong_info opens the sheet, and it stays open when the tab changes', () => {
    h.params = { id: '7', report: 'wrong_info' };
    page();
    expect(screen.getByTestId('issue-sheet').getAttribute('data-reason')).toBe('wrong_info');
    switchTab('Photos');
    expect(screen.getByTestId('issue-sheet')).toBeTruthy();
    switchTab('Map');
    expect(screen.getByTestId('issue-sheet')).toBeTruthy();
  });
});

describe('the update banner from a notification', () => {
  const note = (updateType: string) => ({
    id: 1,
    catId: 7,
    catUpdateId: 5,
    updateType,
    read: true,
    createdAt: '2026-10-20T10:00:00.000Z',
    message: 'Agatha was seen',
  });

  it('shows at the top of About; for a sighting its link selects Photos', () => {
    h.params = { id: '7', updateId: '5' };
    h.notifications = [note('sighting')];
    page();
    const banner = screen.getByTestId('update-banner');
    expect(within(banner).getByText('Agatha was seen')).toBeTruthy();
    const link = within(banner).getByText(en.catBannerSeePhotos!);
    fireEvent.click(link);
    expect(tabNamed('Photos').getAttribute('aria-selected')).toBe('true');
  });

  it('for a sterilised, adopted or general update its link selects Story', () => {
    for (const type of ['desexed', 'adopted', 'general']) {
      cleanup();
      h.params = { id: '7', updateId: '5' };
      h.notifications = [note(type)];
      page();
      fireEvent.click(screen.getByText('See Agatha’s story'));
      expect(tabNamed('Story').getAttribute('aria-selected')).toBe('true');
    }
  });

  it('has no Story link when there is no Story tab', () => {
    h.params = { id: '7', updateId: '5' };
    h.notifications = [note('general')];
    page({ careTimeline: undefined });
    expect(screen.queryByTestId('update-banner-link')).toBeNull();
  });

  it('a notification that loads after the page opened shows without switching tabs', () => {
    h.params = { id: '7', updateId: '5' };
    const view = page();
    switchTab('Map');
    expect(screen.queryByTestId('update-banner')).toBeNull();
    h.notifications = [note('sighting')];
    view.rerender(<CatDetailScreen />);
    expect(tabNamed('Map').getAttribute('aria-selected')).toBe('true');
    switchTab('About');
    expect(screen.getByTestId('update-banner')).toBeTruthy();
  });
});

describe('the facts card and the cards under the main button', () => {
  it('shows the Seen line from the new counts', () => {
    page();
    expect(screen.getByTestId('fact-seen').textContent).toContain('Last seen');
    expect(screen.getByTestId('fact-seen').textContent).toContain('Spotted 14 times by 6 spotters · 9 fans');
  });

  it('an older payload with only fansCount shows "Spotted 14 times" and no fans phrase', () => {
    page({ spottersCount: undefined, followersCount: undefined, fansCount: 6 });
    const seen = screen.getByTestId('fact-seen').textContent!;
    expect(seen).toContain('Spotted 14 times');
    expect(seen).not.toMatch(/fan/);
    expect(seen).not.toMatch(/ by /);
  });

  it('has no tags row, stat tiles or "Discovered by" line', () => {
    page();
    expect(screen.queryByText(en.timesSpottedStat!)).toBeNull();
    expect(screen.queryByText(en.fansStat!)).toBeNull();
    expect(screen.queryByText(new RegExp(en.discoveredBy!))).toBeNull();
  });

  it('shows the 🏠 card for each of the three answers that have one, side by side with help', () => {
    page({ canClaim: true });
    expect(screen.getByTestId('lives-with-me-card')).toBeTruthy();
    expect(screen.getByTestId('needs-help-card')).toBeTruthy();
    cleanup();
    page({}, cat());
    expect(screen.getByTestId('lives-with-me-card')).toBeTruthy();
    cleanup();
    page({}, cat({ hasHome: true, lifeStatus: 'homed' }));
    expect(screen.getByTestId('lives-with-me-card')).toBeTruthy();
  });

  it('does not repeat "Has a home" for a homed cat the public sees (no owner details)', () => {
    page({}, cat({ hasHome: true, lifeStatus: 'homed' }));
    expect(screen.getAllByText('Has a home')).toHaveLength(1);
  });

  it('shows the ownership banner when the owner name or home description is there', () => {
    page({}, cat({ hasHome: true, lifeStatus: 'homed', ownerName: 'Eleni', homeDescription: 'Near the blue door' }));
    expect(screen.getByText(/Lives with Eleni/)).toBeTruthy();
    expect(screen.getByText(/Near the blue door/)).toBeTruthy();
  });

  it('shows only the help card, full width, when the 🏠 card does not apply', () => {
    page({ claimCooldown: true });
    expect(screen.queryByTestId('lives-with-me-card')).toBeNull();
    const help = screen.getByTestId('needs-help-card');
    expect(help.parentElement!.children).toHaveLength(1);
  });

  it('the spot button is there, with an icon hidden from screen readers', () => {
    page();
    const button = screen.getByTestId('spotted-cat-button');
    const icon = button.querySelector('[data-feather="camera"]')!;
    expect(icon).toBeTruthy();
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the "Where" row: place bold, appearance quiet', () => {
    page();
    expect(screen.getByTestId('fact-where').textContent).toContain('By the harbour');
  });
});
