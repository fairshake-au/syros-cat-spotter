// @vitest-environment jsdom
/**
 * SYC-44 PR 6.1 (report-an-issue.md §3, §4.2, §4.3, D4, D8): a sighting's
 * photo opens full screen with its date, who spotted it and Close, and
 * "Report an issue with this photo" beneath once 6.2 gives it somewhere to
 * go. A hidden photo shows a calm tile instead (T6-1). Translation keys
 * render as themselves here.
 */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'en' }),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// The Modal is stood in for by a plain one (see SightingPhotos.test.tsx).
vi.mock('react-native', async () => {
  const rn = await vi.importActual<Record<string, unknown>>('react-native-web');
  return {
    ...rn,
    Modal: ({ visible, onRequestClose, children }: { visible?: boolean; onRequestClose?: () => void; children?: React.ReactNode }) =>
      visible ? (
        <div data-testid="mock-modal">
          <button data-testid="android-back" onClick={onRequestClose} />
          {children}
        </div>
      ) : null,
  };
});
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
// An image "loads" when the test fires `load` on it, as expo-image's onLoad.
vi.mock('expo-image', () => ({
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
  }) => (
    <img
      data-testid={testID ?? 'image'}
      data-uri={source?.uri ?? ''}
      aria-label={accessibilityLabel}
      onLoad={onLoad}
    />
  ),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));

import { SightingPhotos } from '../SightingPhotos';
import { PhotoViewer } from '../PhotoViewer';
import { formatPublicDate } from '@/lib/catPageDates';

afterEach(cleanup);

const DAY = '2026-10-16';
const WHEN = formatPublicDate(DAY, 'en');
const COVER = '/api/photos/cover-face';
const BODY = '/api/photos/extra-body';
const viewer = () => document.querySelector('[data-testid="sighting-photo-viewer"]');

function loadCover(container: HTMLElement) {
  fireEvent.load(container.querySelector('[data-testid="sighting-cover"]')!);
}

describe('T6-1: the hidden-photo tile', () => {
  it('shows "Photo hidden while Syros Cats take a look." in place of a hidden photo, and no photo', () => {
    const { container, getByTestId } = render(
      <SightingPhotos createdAt={DAY} byline="by Maria" photoUrl={null} photoHidden />,
    );
    expect(getByTestId('photo-hidden-tile').textContent).toBe('photoHiddenTile');
    expect(container.querySelector('[data-testid="sighting-cover"]')).toBeNull();
  });

  it('shows for photoHidden and nothing else: not for a missing photo, nor an older server', () => {
    for (const props of [
      { photoUrl: COVER, photoHidden: false },
      { photoUrl: null, photoHidden: false },
      { photoUrl: null }, // an older server sends no flag
      { photoUrl: COVER },
    ]) {
      const { queryByTestId, unmount } = render(<SightingPhotos createdAt={DAY} byline="by Maria" {...props} />);
      expect(queryByTestId('photo-hidden-tile')).toBeNull();
      unmount();
    }
  });

  it('the tile never opens the full-screen view', () => {
    const { getByTestId } = render(<SightingPhotos createdAt={DAY} byline="by Maria" photoUrl={null} photoHidden />);
    fireEvent.click(getByTestId('photo-hidden-tile'));
    expect(viewer()).toBeNull();
  });

  it('a hidden cover leaves the spot\'s visible extra photos as they are', () => {
    const { container, getByTestId } = render(
      <SightingPhotos
        createdAt={DAY}
        byline="by Maria"
        photoUrl={null}
        photoHidden
        extraPhotos={[{ role: 'body', photoUrl: BODY }]}
      />,
    );
    expect(getByTestId('photo-hidden-tile')).toBeTruthy();
    expect(container.querySelector('[data-testid="extra-photo-body"]')).not.toBeNull();
  });
});

describe('the full-screen photo (spec §3.2, D8)', () => {
  it('tapping a loaded cover opens it with the date, who spotted it and Close', () => {
    const { container, getByTestId } = render(<SightingPhotos createdAt={DAY} byline="by Maria" photoUrl={COVER} />);
    loadCover(container);
    fireEvent.click(getByTestId('sighting-cover-open'));
    const v = viewer()!;
    expect(v).not.toBeNull();
    expect(v.querySelector(`[data-uri$="${COVER}"]`)).not.toBeNull();
    expect(getByTestId('photo-viewer-date').textContent).toBe(WHEN);
    expect(getByTestId('photo-viewer-spotter').textContent).toBe('by Maria');
    expect(getByTestId('sighting-photo-viewer-close').textContent).toBe('extraPhotoClose');
    fireEvent.click(getByTestId('sighting-photo-viewer-close'));
    expect(viewer()).toBeNull();
  });

  it('the cover is a button labelled "Photo, <date>", unavailable until it has loaded', () => {
    const { container, getByTestId } = render(<SightingPhotos createdAt={DAY} byline="by Maria" photoUrl={COVER} />);
    const cover = () => getByTestId('sighting-cover-open');
    expect(cover().getAttribute('role')).toBe('button');
    expect(cover().getAttribute('aria-label')).toBe(`extraPhotoFirstLabel, ${WHEN}`);
    expect(cover().getAttribute('aria-disabled')).toBe('true');
    loadCover(container);
    expect(cover().getAttribute('aria-disabled')).toBeNull();
  });

  it('opens only for a photo already loaded, so nothing changes offline (spec §4.2)', () => {
    const { getByTestId } = render(<SightingPhotos createdAt={DAY} byline="by Maria" photoUrl={COVER} />);
    fireEvent.click(getByTestId('sighting-cover-open'));
    expect(viewer()).toBeNull();
  });

  it('an extra photo opens in the same view, with the same date and spotter', () => {
    const { container, getByTestId } = render(
      <SightingPhotos createdAt={DAY} byline="by Maria" photoUrl={COVER} extraPhotos={[{ role: 'body', photoUrl: BODY }]} />,
    );
    const thumb = container.querySelector('[data-testid="extra-photo-body"]')!;
    fireEvent.click(thumb);
    expect(viewer(), 'not before the thumbnail has loaded').toBeNull();
    fireEvent.load(thumb.querySelector('img')!);
    fireEvent.click(thumb);
    expect(viewer()!.querySelector(`[data-uri$="${BODY}"]`)).not.toBeNull();
    expect(getByTestId('photo-viewer-spotter').textContent).toContain('Maria');
  });

  it('Android back / Escape closes it', () => {
    const { container, getByTestId } = render(<SightingPhotos createdAt={DAY} byline="by Maria" photoUrl={COVER} />);
    loadCover(container);
    fireEvent.click(getByTestId('sighting-cover-open'));
    fireEvent.click(getByTestId('android-back'));
    expect(viewer()).toBeNull();
  });
});

describe('"Report an issue with this photo" (spec §3.2)', () => {
  it('is beneath the photo only when there is somewhere for it to go (PR 6.2\'s sheet)', () => {
    const quiet = render(<PhotoViewer url={COVER} label="x" date={WHEN} byline="by Maria" onClose={() => {}} />);
    expect(quiet.queryByTestId('photo-viewer-report')).toBeNull();
    quiet.unmount();

    const onReport = vi.fn();
    const onClose = vi.fn();
    const { getByTestId } = render(
      <PhotoViewer url={COVER} label="x" date={WHEN} byline="by Maria" onClose={onClose} onReport={onReport} />,
    );
    const link = getByTestId('photo-viewer-report');
    expect(link.textContent).toBe('reportIssuePhoto');
    fireEvent.click(link);
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it('a sighting passes its own photo to the report handler', () => {
    const onReportPhoto = vi.fn();
    const { container, getByTestId } = render(
      <SightingPhotos createdAt={DAY} byline="by Maria" photoUrl={COVER} onReportPhoto={onReportPhoto} />,
    );
    loadCover(container);
    fireEvent.click(getByTestId('sighting-cover-open'));
    fireEvent.click(getByTestId('photo-viewer-report'));
    expect(onReportPhoto).toHaveBeenCalledWith(COVER);
  });
});

describe('a refetch that hides the open photo closes the view (ship review, finding 2)', () => {
  it('an open extra photo closes when it is hidden, though the cover stays', () => {
    const view = render(
      <SightingPhotos createdAt={DAY} byline="by Maria" photoUrl={COVER} extraPhotos={[{ role: 'body', photoUrl: BODY }]} />,
    );
    const thumb = view.container.querySelector('[data-testid="extra-photo-body"]')!;
    fireEvent.load(thumb.querySelector('img')!);
    fireEvent.click(thumb);
    expect(viewer()).not.toBeNull();
    view.rerender(
      <SightingPhotos createdAt={DAY} byline="by Maria" photoUrl={COVER} extraPhotos={[{ role: 'body', photoUrl: null }]} />,
    );
    expect(viewer()).toBeNull();
  });

  it('an open cover closes when it is hidden', () => {
    const view = render(<SightingPhotos createdAt={DAY} byline="by Maria" photoUrl={COVER} />);
    loadCover(view.container);
    fireEvent.click(view.getByTestId('sighting-cover-open'));
    expect(viewer()).not.toBeNull();
    view.rerender(<SightingPhotos createdAt={DAY} byline="by Maria" photoUrl={null} photoHidden />);
    expect(viewer()).toBeNull();
  });
});
