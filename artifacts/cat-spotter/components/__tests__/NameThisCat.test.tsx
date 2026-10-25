// @vitest-environment jsdom
/**
 * SYC-677 D: a spotter names a cat Syros Cats left unnamed. English strings
 * render as themselves so these also pin the wording.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Cat } from '@workspace/api-client-react';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/lib/modalVisibility', () => ({ registerModalOpen: () => () => {} }));

const h = vi.hoisted(() => ({
  isOnline: true,
  deviceId: 'dev-1' as string | null,
  mutate: vi.fn(),
  opts: undefined as any,
  invalidate: vi.fn(),
  setQueries: vi.fn(),
  suggest: vi.fn(async () => ({ suggestions: ['Tigger', 'Maki'] })),
}));

vi.mock('@/context/DeviceContext', () => ({ useDevice: () => ({ deviceId: h.deviceId }) }));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: h.isOnline }) }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return { useLanguage: () => ({ language: 'en', t: (k: string) => TRANSLATIONS.en[k] ?? k }) };
});
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidate, setQueriesData: h.setQueries }),
}));
vi.mock('@workspace/api-client-react', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    useNameCat: (o: unknown) => {
      h.opts = o;
      return { mutate: h.mutate, isPending: false };
    },
    suggestCatNames: h.suggest,
    getGetCatQueryKey: (id: number) => [`/api/cats/${id}`],
  };
});

import { NameThisCatCard } from '../NameThisCat';
import { TRANSLATIONS } from '@/lib/i18n';

const en = TRANSLATIONS.en;

const PENDING = { id: 7, name: 'SYR-0007', namePending: true } as unknown as Cat;
const NAMED = { id: 7, name: 'Agatha', namePending: false } as unknown as Cat;

const find = (label: string) => {
  const el = Array.from(document.querySelectorAll('[role="button"], button')).find(
    (e) => e.textContent?.trim() === label,
  );
  if (!el) throw new Error(`No button labelled ${label}`);
  return el as HTMLElement;
};
const disabled = (el: HTMLElement) =>
  el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled;

function refusal(status: number, code: string) {
  return new ApiError(new Response(null, { status }), { error: 'x', code }, {
    method: 'POST',
    url: '/api/cats/7/name',
  });
}

function openSheet(cat: Cat = PENDING) {
  render(<NameThisCatCard cat={cat} canName />);
  fireEvent.click(find(en.nameThisCat!));
}
const typeName = (v: string) =>
  fireEvent.change(screen.getByPlaceholderText(en.nameYourCat!), { target: { value: v } });

beforeEach(() => {
  h.isOnline = true;
  h.deviceId = 'dev-1';
  h.mutate.mockReset();
  h.invalidate.mockReset();
  h.setQueries.mockReset();
  h.suggest.mockClear();
});
afterEach(cleanup);

describe('Name this cat', () => {
  it('shows the button only while the name is pending', () => {
    render(<NameThisCatCard cat={NAMED} />);
    expect(document.body.textContent).not.toContain(en.nameThisCat);
    cleanup();
    render(<NameThisCatCard cat={PENDING} canName />);
    expect(find(en.nameThisCat!)).toBeTruthy();
    expect(document.body.textContent).toContain('SYR-0007');
  });

  it('saving sends the name and puts the named cat on the page', () => {
    openSheet();
    typeName('  Agatha ');
    fireEvent.click(find(en.nameThisCatSave!));
    expect(h.mutate).toHaveBeenCalledWith({ catId: 7, data: { deviceId: 'dev-1', name: 'Agatha' } });
    h.opts.mutation.onSuccess({ id: 7, name: 'Agatha', namePending: false });
    const [filter, updater] = h.setQueries.mock.calls[0]!;
    expect(filter).toEqual({ queryKey: ['/api/cats/7'] });
    const next = updater({ cat: { id: 7, name: 'SYR-0007', namePending: true }, sightings: [] });
    expect(next.cat).toMatchObject({ name: 'Agatha', namePending: false });
    expect(h.invalidate).toHaveBeenCalled();
  });

  it('cannot save a blank name', () => {
    openSheet();
    typeName('   ');
    expect(disabled(find(en.nameThisCatSave!))).toBe(true);
  });

  it('ALREADY_NAMED says someone just named the cat, and refreshes it', async () => {
    openSheet();
    typeName('Agatha');
    fireEvent.click(find(en.nameThisCatSave!));
    h.opts.mutation.onError(refusal(409, 'ALREADY_NAMED'));
    await waitFor(() => expect(document.body.textContent).toContain('Someone has just named this cat'));
    expect(h.invalidate).toHaveBeenCalled();
  });

  it.each([
    ['OFFENSIVE_NAME', 400, 'catNameRejected'],
    ['NAME_TAKEN', 409, 'nameTaken'],
    ['SYR_SHAPED_NAME', 400, 'syrShapedName'],
    ['NAME_HAS_LINK', 400, 'nameHasLink'],
  ])('%s shows the same words as the new-cat name step', async (code, status, key) => {
    openSheet();
    typeName('Agatha');
    fireEvent.click(find(en.nameThisCatSave!));
    h.opts.mutation.onError(refusal(status as number, code as string));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(en[key as string]));
    expect(en.syrShapedName).toBe('That looks like a cat’s SYR number. Choose a name.');
  });

  it.each([
    ['429', () => refusal(429, 'RATE_LIMITED'), 'claimRefusedLater'],
    ['404', () => refusal(404, 'NOT_FOUND'), 'nameThisCatGone'],
    ['EMPTY_NAME', () => refusal(400, 'EMPTY_NAME'), 'nameYourCat'],
    ['NAME_DAILY_LIMIT', () => refusal(429, 'NAME_DAILY_LIMIT'), 'nameThisCatDailyLimit'],
    ['NEEDS_SIGHTING', () => refusal(403, 'NEEDS_SIGHTING'), 'nameThisCatNeedsSighting'],
  ])('%s gets its own words, not "check your connection"', async (_n, make, key) => {
    openSheet();
    typeName('Agatha');
    fireEvent.click(find(en.nameThisCatSave!));
    h.opts.mutation.onError(make());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(en[key as string]));
    expect(screen.getByRole('alert').textContent).not.toBe(en.claimNetworkError);
  });

  it('a 404 also refreshes the cat, so the page can drop it', async () => {
    openSheet();
    typeName('Agatha');
    fireEvent.click(find(en.nameThisCatSave!));
    h.opts.mutation.onError(refusal(404, 'NOT_FOUND'));
    await waitFor(() => expect(h.invalidate).toHaveBeenCalled());
  });

  it('after the spotter\'s own naming, a short thank-you names the cat', async () => {
    openSheet();
    typeName('Agatha');
    fireEvent.click(find(en.nameThisCatSave!));
    act(() => h.opts.mutation.onSuccess({ id: 7, name: 'Agatha', namePending: false }));
    await waitFor(() =>
      expect(screen.getByTestId('name-this-cat-saved').textContent).toBe('Thanks — Agatha is this cat’s name now.'),
    );
  });

  it('the someone-else-named-it line ends with a full stop in every language', () => {
    for (const lang of ['en', 'el', 'fr'] as const) {
      expect(TRANSLATIONS[lang].nameThisCatJustNamed, lang).toMatch(/\.$/);
      expect(TRANSLATIONS[lang].nameThisCatSaved, lang).toContain('{name}');
      expect(TRANSLATIONS[lang].nameThisCatGone, lang).toBeTruthy();
    }
  });

  it('Suggest names fills in ideas that can be tapped', async () => {
    openSheet();
    fireEvent.click(find(en.nameThisCatSuggest!));
    await waitFor(() => expect(find('Tigger')).toBeTruthy());
    fireEvent.click(find('Tigger'));
    expect((screen.getByPlaceholderText(en.nameYourCat!) as HTMLInputElement).value).toBe('Tigger');
  });

  it('offline, the button explains that naming needs a connection', () => {
    h.isOnline = false;
    render(<NameThisCatCard cat={PENDING} canName />);
    expect(document.body.textContent).toContain(en.nameThisCatNeedsConnection);
    expect(disabled(find(en.nameThisCat!))).toBe(true);
  });

  // SYC-709: only a phone that has met the cat gets the button.
  it.each([[false], [undefined]])('canName %s: no button, and the spotter is told to spot the cat first', (canName) => {
    render(<NameThisCatCard cat={PENDING} canName={canName} />);
    expect(document.body.textContent).toContain('SYR-0007');
    expect(screen.getByTestId('name-this-cat-spot-first').textContent).toBe(en.nameThisCatNeedsSighting);
    expect(() => find(en.nameThisCat!)).toThrow();
  });

  it('NEEDS_SIGHTING also refreshes the cat, so the button goes', async () => {
    openSheet();
    typeName('Agatha');
    fireEvent.click(find(en.nameThisCatSave!));
    h.opts.mutation.onError(refusal(403, 'NEEDS_SIGHTING'));
    await waitFor(() => expect(h.invalidate).toHaveBeenCalled());
  });

  it('closing the sheet hands focus back to the Name this cat button', async () => {
    openSheet();
    fireEvent.click(find(en.cancel!));
    await waitFor(() => expect(document.activeElement).toBe(find(en.nameThisCat!)));
  });

  it('the new naming words exist in every language', () => {
    for (const lang of ['en', 'el', 'fr'] as const) {
      for (const k of ['nameHasLink', 'nameThisCatDailyLimit', 'nameThisCatNeedsSighting']) {
        expect(TRANSLATIONS[lang][k], `${lang} ${k}`).toMatch(/\.$/);
      }
    }
  });
});
