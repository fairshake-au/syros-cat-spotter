// @vitest-environment jsdom
/**
 * SYC-42: the quiet "This cat needs help" link. On the review screen it
 * prepares the handoff (reading the sighting's photo) before opening the
 * report, so the report opens on screen 2 with that photo and place.
 */
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());
vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ mutedForeground: '#666' }) }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (key: string) => T.en[key] ?? key }) };
});
vi.mock('@/lib/pendingPhotos', () => ({ readPendingPhotoBase64: vi.fn() }));

import { TRANSLATIONS } from '@/lib/i18n';
import { takeReportHandoff } from '@/lib/reportHandoff';
import { NeedsHelpLink } from '../report/NeedsHelpLink';

afterEach(() => {
  cleanup();
  push.mockClear();
  takeReportHandoff();
});

describe('NeedsHelpLink', () => {
  it('with a ready handoff, leaves it for the report and opens it', () => {
    const { getByText } = render(<NeedsHelpLink handoff={{ coords: { latitude: 1, longitude: 2 } }} />);
    fireEvent.click(getByText(TRANSLATIONS.en.reportNeedsHelp));
    expect(takeReportHandoff()).toEqual({ coords: { latitude: 1, longitude: 2 } });
    expect(push).toHaveBeenCalledWith('/report');
  });

  it('review screen: prepares the handoff first (photo and place), then opens the report', async () => {
    const prepared = {
      photo: { uri: 'data:image/jpeg;base64,QQ==', base64: 'QQ==' },
      coords: { latitude: 37.4, longitude: 24.9 },
    };
    const prepare = vi.fn(async () => prepared);
    const { getByText } = render(<NeedsHelpLink prepare={prepare} />);
    fireEvent.click(getByText(TRANSLATIONS.en.reportNeedsHelp));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/report'));
    expect(takeReportHandoff()).toEqual(prepared);
  });

  it('if preparing fails, the report still opens (nothing blocks a report)', async () => {
    const { getByText } = render(<NeedsHelpLink prepare={async () => { throw new Error('gone'); }} />);
    fireEvent.click(getByText(TRANSLATIONS.en.reportNeedsHelp));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/report'));
    expect(takeReportHandoff()).toBeNull();
  });
});
