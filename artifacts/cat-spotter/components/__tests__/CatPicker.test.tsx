// @vitest-environment jsdom
/**
 * SYC-119 Slice A2: the "Find the cat" screen (choose-a-different-cat.md §3.2,
 * §4.5, §6). Translation keys render as themselves here.
 */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nearbyOrder, squareCentre } from '@workspace/geo';
import type { Cat } from '@workspace/api-client-react';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));
const { useGetCat } = vi.hoisted(() => ({
  useGetCat: vi.fn(() => ({ data: undefined })),
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetCat,
  getGetCatQueryKey: (id: number) => [`/api/cats/${id}`],
}));

import { CatPicker } from '../CatPicker';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FROM = squareCentre({ lat: 37.4448, lng: 24.9425 });

function north(km: number) {
  return { lat: FROM.lat + km / 111.2, lng: FROM.lng };
}

function cat(id: number, name: string, at: { lat: number; lng: number }): Cat {
  return {
    id,
    name,
    description: '',
    photoUrl: `/api/photos/${id}`,
    sightingsCount: 1,
    lastSeenAt: '2026-09-01T00:00:00Z',
    hasHome: false,
    distanceKm: 0.123,
    ...at,
  };
}

const CATS = [
  cat(42, 'Agatha', north(0.6)),
  cat(7, 'Krispy', north(0.05)),
  cat(3, 'Savma', north(0.05)),
  cat(99, 'Far Away', north(4)),
  cat(12, 'Αγάθη', north(1.2)),
];

function renderPicker(overrides: Partial<React.ComponentProps<typeof CatPicker>> = {}) {
  const props = {
    from: FROM,
    cats: CATS,
    isOffline: false,
    busy: false,
    message: null,
    yourPhoto: null,
    onPick: vi.fn(),
    onAddNew: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CatPicker {...props} />) };
}

function listedNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="picker-cat-"]')).map(
    (el) => el.getAttribute('data-testid')!.replace('picker-cat-', ''),
  );
}

describe('CatPicker', () => {
  it('lists cats known around here, nearest first by published square, ties by SYR number', () => {
    const { container, getByText } = renderPicker();
    expect(getByText('pickerTitle')).toBeTruthy();
    expect(getByText('pickerListHeading')).toBeTruthy();
    expect(listedNames(container)).toEqual(
      nearbyOrder(FROM, CATS).map((c) => String(c.id)),
    );
    expect(listedNames(container)).toEqual(['3', '7', '42', '12']);
  });

  it('shows the name and SYR number, and never a distance', () => {
    const { container, getByText } = renderPicker();
    expect(getByText('Agatha')).toBeTruthy();
    expect(getByText('SYR-0042')).toBeTruthy();
    expect(container.textContent).not.toMatch(/km|0\.123|\bm\b/);
  });

  it('search narrows the nearby list and never reaches beyond it (tests 12, 28)', () => {
    const { container, getByPlaceholderText } = renderPicker();
    const box = getByPlaceholderText('pickerSearchPlaceholder');
    fireEvent.change(box, { target: { value: 'syr 42' } });
    expect(listedNames(container)).toEqual(['42']);
    fireEvent.change(box, { target: { value: 'Far Away' } });
    expect(listedNames(container)).toEqual([]);
    fireEvent.change(box, { target: { value: 'αγαθη' } });
    expect(listedNames(container)).toEqual(['12']);
  });

  it('says so when a search finds nothing', () => {
    const { getByPlaceholderText, getByText } = renderPicker();
    fireEvent.change(getByPlaceholderText('pickerSearchPlaceholder'), {
      target: { value: 'nobody' },
    });
    expect(getByText('pickerNoResults')).toBeTruthy();
  });

  it('a tap opens the side-by-side check; choosing needs the second step', () => {
    const { getByTestId, getByText, props } = renderPicker();
    fireEvent.click(getByTestId('picker-cat-42'));
    expect(props.onPick).not.toHaveBeenCalled();
    expect(getByText('yourPhoto')).toBeTruthy();
    fireEvent.click(getByText('pickerConfirm'));
    expect(props.onPick).toHaveBeenCalledWith(42, 'nearby');
  });

  it('a pick made after typing in search says it came from search', () => {
    const { getByTestId, getByText, getByPlaceholderText, props } = renderPicker();
    fireEvent.change(getByPlaceholderText('pickerSearchPlaceholder'), {
      target: { value: 'Agatha' },
    });
    fireEvent.click(getByTestId('picker-cat-42'));
    fireEvent.click(getByText('pickerConfirm'));
    expect(props.onPick).toHaveBeenCalledWith(42, 'search');
  });

  it('the side-by-side check shows no match score', () => {
    const { getByTestId, container } = renderPicker();
    fireEvent.click(getByTestId('picker-cat-7'));
    expect(container.textContent).not.toMatch(/%|matchPill/);
  });

  it('never fetches more photos without signal', () => {
    const { getByTestId } = renderPicker({ isOffline: true });
    fireEvent.click(getByTestId('picker-cat-7'));
    for (const call of useGetCat.mock.calls as unknown as unknown[][]) {
      const opts = call[1] as { query?: { enabled?: boolean } } | undefined;
      expect(opts?.query?.enabled).toBe(false);
    }
  });

  it('always offers "Add it as a new cat", and not "Ask Syros Cats" yet (Decision 4)', () => {
    const { getByText, container, props } = renderPicker();
    fireEvent.click(getByText('pickerAddNewAction'));
    expect(props.onAddNew).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/AskSyros|askSyros/);
  });

  it('test 10: offline, it still lists and searches the saved cat-alogue, and says it may be missing cats', () => {
    const { container, getByText, getByPlaceholderText } = renderPicker({
      isOffline: true,
    });
    expect(getByText('pickerOfflineStale')).toBeTruthy();
    fireEvent.change(getByPlaceholderText('pickerSearchPlaceholder'), {
      target: { value: 'krispy' },
    });
    expect(listedNames(container)).toEqual(['7']);
  });

  it('online, it does not show the saved-cat-alogue line', () => {
    const { queryByText } = renderPicker();
    expect(queryByText('pickerOfflineStale')).toBeNull();
  });

  it('shows a message from the screen (a refusal or no signal)', () => {
    const { getByText } = renderPicker({ message: 'pickerNotNearby' });
    expect(getByText('pickerNotNearby')).toBeTruthy();
  });

  it('with no saved location, it lists nothing and still offers a new cat', () => {
    const { container, getByText } = renderPicker({ from: null });
    expect(listedNames(container)).toEqual([]);
    expect(getByText('pickerAddNewAction')).toBeTruthy();
  });
});
