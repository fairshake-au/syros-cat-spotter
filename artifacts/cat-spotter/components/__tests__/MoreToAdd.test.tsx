// @vitest-environment jsdom
/**
 * The "Anything to add?" card on a cat's page (SYC-117 part 2,
 * docs/specs/add-details-later.md §3).
 */
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    foreground: '#111',
    mutedForeground: '#666',
    primary: '#c50',
    primaryForeground: '#fff',
    border: '#ddd',
    card: '#fff',
    muted: '#eee',
    background: '#fff',
    destructive: '#c00',
  }),
}));
vi.mock('@/lib/modalVisibility', () => ({ registerModalOpen: () => () => {} }));
vi.mock('@/lib/urls', () => ({ photoSource: (p: string) => ({ uri: p }) }));

const state = vi.hoisted(() => ({
  deviceId: 'device-1' as string | null,
  isOnline: true,
  data: undefined as unknown,
  answer: vi.fn(async () => ({ recorded: ['ear_tip'] })),
}));
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => ({ deviceId: state.deviceId }) }));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: state.isOnline }) }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (k: string) => TRANSLATIONS.en[k] ?? k }) };
});
vi.mock('@workspace/api-client-react', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    useGetMyOpenSightings: (_d: string, _c: number, opts: { query: { enabled: boolean } }) => ({
      data: opts.query.enabled ? state.data : undefined,
    }),
    answerSightingQuestions: state.answer,
  };
});

import { MoreToAdd } from '../MoreToAdd';
import { TRANSLATIONS } from '@/lib/i18n';
import { expectEarTipOrder } from './earTipOrder';

const en = TRANSLATIONS.en;

function renderCard() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MoreToAdd catId={7} catName="Agatha" />
    </QueryClientProvider>,
  );
}

const byText = (label: string) => {
  const el = Array.from(document.querySelectorAll('[role="button"], button')).find(
    (e) => e.textContent?.trim() === label,
  );
  if (!el) throw new Error(`No button labelled ${label}`);
  return el as HTMLElement;
};

beforeEach(() => {
  state.deviceId = 'device-1';
  state.isOnline = true;
  state.answer.mockClear();
  state.data = {
    earTip: { state: 'answered', current: 'looks_whole' },
    sightings: [
      {
        sightingId: 41,
        takenAt: '2026-10-03T09:00:00.000Z',
        photoUrl: '/api/photos/abc',
        open: { foodAndWater: true, note: true },
      },
    ],
  };
});
afterEach(cleanup);

describe('MoreToAdd', () => {
  it('invites the spotter to add to their own recent sighting', () => {
    const { container } = renderCard();
    expect(container.textContent).toContain('You spotted Agatha on');
    expect(container.textContent).toContain(en.moreToAddAsk);
  });

  it('shows nothing when nothing is open', () => {
    state.data = { earTip: { state: 'checked' }, sightings: [] };
    const { container } = renderCard();
    expect(container.querySelector('[data-testid="more-to-add"]')).toBeNull();
  });

  it('shows nothing offline', () => {
    state.isOnline = false;
    const { container } = renderCard();
    expect(container.querySelector('[data-testid="more-to-add"]')).toBeNull();
  });

  it('the ear-tip question explains itself in the same order here as on the review screen', () => {
    state.data = {
      earTip: { state: 'open' },
      sightings: [
        {
          sightingId: 41,
          takenAt: '2026-10-03T09:00:00.000Z',
          photoUrl: '/api/photos/abc',
          open: { earTip: true, foodAndWater: true, note: true },
        },
      ],
    };
    renderCard();
    fireEvent.click(byText(en.moreToAddButton!));
    expectEarTipOrder(document.body);
  });

  it('changing an earlier ear-tip answer is sent as a change, for that sighting', async () => {
    renderCard();
    fireEvent.click(byText(en.moreToAddButton!));
    expect(document.body.textContent).toContain(
      en.earTipYouSaid!.replace('{answer}', en.earTipNo!),
    );
    fireEvent.click(byText(en.earTipChange!));
    fireEvent.click(byText(en.earTipYes!));
    fireEvent.click(byText(en.earLeft!));
    fireEvent.click(byText(en.answersSend!));
    await waitFor(() => expect(state.answer).toHaveBeenCalled());
    expect(state.answer).toHaveBeenCalledWith(41, {
      deviceId: 'device-1',
      earTip: 'clipped_left',
      changeEarTip: true,
    });
  });
});
