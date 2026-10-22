// @vitest-environment jsdom
/**
 * T6-3 (SYC-44 PR 6.1; report-an-issue.md §3.3): the full-screen photo and
 * its report link are not offered on the cat list cards or the "is this the
 * cat?" picker. Each leads to the cat page in one tap, where they are.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { squareCentre } from '@workspace/geo';
import type { Cat } from '@workspace/api-client-react';

const push = vi.hoisted(() => vi.fn());
vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('expo-haptics', () => ({ selectionAsync: vi.fn() }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({
  Image: ({ testID }: { testID?: string }) => <img data-testid={testID ?? 'image'} />,
}));
vi.mock('react-native-svg', () => {
  const make = (name: string) => ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', { 'data-el': name }, children);
  const names = ['Svg', 'G', 'Rect', 'Circle', 'Ellipse', 'Path', 'Polygon', 'Defs', 'ClipPath'];
  return { __esModule: true, default: make('Svg'), ...Object.fromEntries(names.map((n) => [n, make(n)])) };
});
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetCat: vi.fn(() => ({ data: undefined })),
  getGetCatQueryKey: (id: number) => [`/api/cats/${id}`],
}));

import { CatCard } from '../CatCard';
import { CatPicker } from '../CatPicker';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FROM = squareCentre({ lat: 37.4448, lng: 24.9425 });
const CAT: Cat = {
  id: 42,
  name: 'Agatha',
  description: '',
  photoUrl: '/api/photos/42',
  sightingsCount: 1,
  lastSeenAt: '2026-09-01',
  locationPrecision: 'approximate',
  locationCellM: 250,
  hasHome: false,
  distanceKm: 0.1,
  lifeStatus: 'street',
  notSeenSince: null,
  sterilised: { value: null, confidence: 'unknown', clippedTipSightings: 0 },
  lat: FROM.lat,
  lng: FROM.lng,
};

const noViewer = () => {
  expect(document.querySelector('[data-testid="sighting-photo-viewer"]')).toBeNull();
  expect(document.body.textContent).not.toContain('reportIssuePhoto');
  expect(document.body.textContent).not.toContain('reportIssue');
};

describe('T6-3: no full-screen photo on the excluded surfaces', () => {
  it('a cat list card goes to the cat page, and opens no photo view', () => {
    const { container } = render(<CatCard cat={CAT} />);
    fireEvent.click(container.firstElementChild!);
    expect(push).toHaveBeenCalledWith({ pathname: '/cat/[id]', params: { id: '42' } });
    noViewer();
  });

  it('the "is this the cat?" picker picks the cat, and opens no photo view', () => {
    const onPick = vi.fn();
    const { getByTestId } = render(
      <CatPicker
        from={FROM}
        cats={[CAT]}
        isOffline={false}
        busy={false}
        message={null}
        yourPhoto={null}
        onPick={onPick}
        onAddNew={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(getByTestId('picker-cat-42'));
    noViewer();
  });

  it('neither component, nor the map or notifications, imports the viewer', () => {
    for (const file of [
      'components/CatCard.tsx',
      'components/CatPicker.tsx',
      'components/AppMap.tsx',
      'components/AppMap.web.tsx',
      'app/notifications.tsx',
    ]) {
      const src = readFileSync(join(__dirname, '..', '..', file), 'utf8');
      expect({ file, imports: /PhotoViewer|SightingPhotos/.test(src) }).toEqual({ file, imports: false });
    }
  });
});
