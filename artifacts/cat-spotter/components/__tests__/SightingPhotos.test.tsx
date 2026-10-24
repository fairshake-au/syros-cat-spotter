// @vitest-environment jsdom
/**
 * A sighting's photos on a cat's page (SYC-415 PR 3, spec §5.5): the cover as
 * before, and a face or body photo added to the same spot as a small
 * thumbnail that opens full size. A hidden photo (photoUrl null) shows
 * nothing, and a sighting with no extraPhotos key looks exactly as it did.
 */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'en' }),
}));

// react-native-web only arms its Escape key once a fade-in has played, which
// jsdom never does, so the Modal is stood in for by a plain one whose "back"
// button calls the onRequestClose the component passed it (Android back and
// Escape both end up there).
vi.mock('react-native', async () => {
  const rn = await vi.importActual<Record<string, unknown>>('react-native-web');
  return {
    ...rn,
    Modal: ({
      visible,
      onRequestClose,
      children,
    }: {
      visible?: boolean;
      onRequestClose?: () => void;
      children?: React.ReactNode;
    }) =>
      visible ? (
        <div data-testid="mock-modal">
          <button data-testid="android-back" onClick={onRequestClose} />
          {children}
        </div>
      ) : null,
  };
});

vi.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-image', () => ({
  // Every image "loads" at once, as one the phone already has: only a
  // loaded photo opens full size (SYC-44 PR 6.1).
  Image: ({
    source,
    testID,
    accessibilityLabel,
    onLoad,
  }: {
    source?: { uri?: string };
    testID?: string;
    accessibilityLabel?: string;
    onLoad?: () => void;
  }) => {
    React.useEffect(() => onLoad?.(), []);
    return (
      <span
        data-testid={testID ?? 'image'}
        data-uri={source?.uri ?? ''}
        aria-label={accessibilityLabel}
      />
    );
  },
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    foreground: '#111',
    mutedForeground: '#666',
    primary: '#c50',
    border: '#ddd',
    card: '#fff',
    background: '#fff',
  }),
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SightingPhotos } from '../SightingPhotos';
import { formatPublicDate } from '@/lib/catPageDates';

afterEach(cleanup);

const DAY = '2026-10-16';
const WHEN = formatPublicDate(DAY, 'en');
const COVER = '/api/photos/cover-face';
const FIRST = '/api/photos/extra-first';
const BODY = '/api/photos/extra-body';

describe('SightingPhotos', () => {
  it('shows the cover and exactly one thumbnail for the visible extra; nothing for the hidden one', () => {
    const { container, queryAllByTestId } = render(
      <SightingPhotos
        createdAt={DAY}
        byline="Maria"
        photoUrl={COVER}
        extraPhotos={[
          { role: 'first', photoUrl: null },
          { role: 'body', photoUrl: BODY },
        ]}
      />,
    );
    expect(container.querySelector('[data-testid="sighting-cover"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="extra-photo-"]')).toHaveLength(1);
    const thumb = container.querySelector('[data-testid="extra-photo-body"]') as HTMLElement;
    expect(thumb).not.toBeNull();
    expect(thumb.getAttribute('aria-label')).toBe(`extraPhotoBodyLabel, ${WHEN}`);
    expect(container.querySelector('[data-testid="extra-photo-first"]')).toBeNull();
    // Besides the cover, one image: the visible thumbnail.
    expect(queryAllByTestId('image')).toHaveLength(1);
  });

  it('labels a face photo and a first photo for a screen reader, in their own words', () => {
    const { container } = render(
      <SightingPhotos
        createdAt={DAY}
        byline="Maria"
        photoUrl={COVER}
        extraPhotos={[
          { role: 'first', photoUrl: FIRST },
          { role: 'body', photoUrl: BODY },
        ]}
      />,
    );
    expect(container.querySelector('[data-testid="extra-photo-first"]')!.getAttribute('aria-label')).toBe(
      `extraPhotoFirstLabel, ${WHEN}`,
    );
    expect(container.querySelector('[data-testid="extra-photo-body"]')!.getAttribute('aria-label')).toBe(
      `extraPhotoBodyLabel, ${WHEN}`,
    );
    const face = render(
      <SightingPhotos createdAt={DAY} byline="Maria" photoUrl={COVER} extraPhotos={[{ role: 'face', photoUrl: FIRST }]} />,
    );
    expect(face.container.querySelector('[data-testid="extra-photo-face"]')!.getAttribute('aria-label')).toBe(
      `extraPhotoFaceLabel, ${WHEN}`,
    );
  });

  it('a sighting with no extraPhotos key renders the cover only', () => {
    const { container } = render(<SightingPhotos createdAt={DAY} byline="Maria" photoUrl={COVER} />);
    expect(container.querySelector('[data-testid="sighting-cover"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="extra-photo-"]')).toHaveLength(0);
  });

  it('tapping a thumbnail opens that photo full size, and tapping again closes it', () => {
    const { container } = render(
      <SightingPhotos createdAt={DAY} byline="Maria" photoUrl={COVER} extraPhotos={[{ role: 'body', photoUrl: BODY }]} />,
    );
    expect(document.querySelector('[data-testid="sighting-photo-viewer"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-testid="extra-photo-body"]')!);
    const viewer = document.querySelector('[data-testid="sighting-photo-viewer"]');
    expect(viewer).not.toBeNull();
    expect(viewer!.querySelector('[data-uri$="extra-body"]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-testid="sighting-photo-viewer-close"]')!);
    expect(document.querySelector('[data-testid="sighting-photo-viewer"]')).toBeNull();
  });

  it('the full-size photo carries the same label, with the date', () => {
    const { container } = render(
      <SightingPhotos createdAt={DAY} byline="Maria" photoUrl={COVER} extraPhotos={[{ role: 'body', photoUrl: BODY }]} />,
    );
    fireEvent.click(container.querySelector('[data-testid="extra-photo-body"]')!);
    const img = document.querySelector('[data-testid="sighting-photo-viewer"] [data-uri$="extra-body"]');
    expect(img!.getAttribute('aria-label')).toBe(`extraPhotoBodyLabel, ${WHEN}`);
  });

  it('Android back / Escape closes the full-size photo (the Modal\'s onRequestClose)', async () => {
    const { container } = render(
      <SightingPhotos createdAt={DAY} byline="Maria" photoUrl={COVER} extraPhotos={[{ role: 'body', photoUrl: BODY }]} />,
    );
    fireEvent.click(container.querySelector('[data-testid="extra-photo-body"]')!);
    expect(document.querySelector('[data-testid="sighting-photo-viewer"]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-testid="android-back"]')!);
    expect(document.querySelector('[data-testid="sighting-photo-viewer"]')).toBeNull();
  });

  // Two 48pt thumbnails and a 6pt gap are 102pt: wider than a sighting tile
  // (about 30.5% of the screen) on a 320 or 360pt phone. They shrink to fit,
  // and keep a 44pt tap target through hitSlop.
  it('thumbnails shrink to fit the tile and keep a 44pt tap target', () => {
    const src = readFileSync(join(__dirname, '..', 'SightingPhotos.tsx'), 'utf8');
    const start = src.indexOf('thumb: {');
    const thumb = src.slice(start, src.indexOf('},', start));
    expect(thumb).toMatch(/flex:\s*1/);
    expect(thumb).toMatch(/maxWidth:\s*48/);
    expect(thumb).toMatch(/aspectRatio:\s*1/);
    expect(thumb).not.toMatch(/width:\s*48/);
    expect(src).toMatch(/hitSlop/);
  });
});
