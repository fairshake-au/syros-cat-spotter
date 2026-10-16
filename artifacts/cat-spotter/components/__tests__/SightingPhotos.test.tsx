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
  useLanguage: () => ({ t: (k: string) => k }),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

vi.mock('expo-image', () => ({
  Image: ({ source, testID }: { source?: { uri?: string }; testID?: string }) => (
    <span data-testid={testID ?? 'image'} data-uri={source?.uri ?? ''} />
  ),
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

import { SightingPhotos } from '../SightingPhotos';

afterEach(cleanup);

const COVER = '/api/photos/cover-face';
const FIRST = '/api/photos/extra-first';
const BODY = '/api/photos/extra-body';

describe('SightingPhotos', () => {
  it('shows the cover and exactly one thumbnail for the visible extra; nothing for the hidden one', () => {
    const { container, queryAllByTestId } = render(
      <SightingPhotos
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
    expect(thumb.getAttribute('aria-label')).toBe('extraPhotoBodyLabel');
    expect(container.querySelector('[data-testid="extra-photo-first"]')).toBeNull();
    // Besides the cover, one image: the visible thumbnail.
    expect(queryAllByTestId('image')).toHaveLength(1);
  });

  it('labels a face photo and a first photo for a screen reader, in their own words', () => {
    const { container } = render(
      <SightingPhotos
        photoUrl={COVER}
        extraPhotos={[
          { role: 'first', photoUrl: FIRST },
          { role: 'body', photoUrl: BODY },
        ]}
      />,
    );
    expect(container.querySelector('[data-testid="extra-photo-first"]')!.getAttribute('aria-label')).toBe(
      'extraPhotoFirstLabel',
    );
    expect(container.querySelector('[data-testid="extra-photo-body"]')!.getAttribute('aria-label')).toBe(
      'extraPhotoBodyLabel',
    );
    const face = render(
      <SightingPhotos photoUrl={COVER} extraPhotos={[{ role: 'face', photoUrl: FIRST }]} />,
    );
    expect(face.container.querySelector('[data-testid="extra-photo-face"]')!.getAttribute('aria-label')).toBe(
      'extraPhotoFaceLabel',
    );
  });

  it('a sighting with no extraPhotos key renders the cover only', () => {
    const { container } = render(<SightingPhotos photoUrl={COVER} />);
    expect(container.querySelector('[data-testid="sighting-cover"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="extra-photo-"]')).toHaveLength(0);
  });

  it('tapping a thumbnail opens that photo full size, and tapping again closes it', () => {
    const { container } = render(
      <SightingPhotos photoUrl={COVER} extraPhotos={[{ role: 'body', photoUrl: BODY }]} />,
    );
    expect(document.querySelector('[data-testid="sighting-photo-viewer"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-testid="extra-photo-body"]')!);
    const viewer = document.querySelector('[data-testid="sighting-photo-viewer"]');
    expect(viewer).not.toBeNull();
    expect(viewer!.querySelector('[data-uri$="extra-body"]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-testid="sighting-photo-viewer-close"]')!);
    expect(document.querySelector('[data-testid="sighting-photo-viewer"]')).toBeNull();
  });
});
