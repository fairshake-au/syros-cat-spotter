// @vitest-environment jsdom
/**
 * SYC-706: the Badges tab. 22 badges under five headings, a "New" chip until the
 * server has been told the tab was seen, and a quiet replay on tapping an earned badge.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isOnline: true,
  deviceId: 'dev-1' as string | null,
  markSeen: vi.fn(async (_id: string) => {}),
  invalidate: vi.fn(async (_arg: unknown) => {}),
  celebration: vi.fn(),
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (k: string) => TRANSLATIONS.en[k] ?? k, language: 'en' }) };
});
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => ({ deviceId: h.deviceId }) }));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: h.isOnline }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }) }));
vi.mock('@workspace/api-client-react', () => ({
  markBadgesSeen: h.markSeen,
  getGetProfileQueryKey: (id: string) => [`/api/profiles/${id}`],
}));
vi.mock('@/components/purropolis', () => ({
  ProgressBar: () => <div data-testid="bar" />,
}));
vi.mock('@/components/celebration/BadgeCelebration', () => ({
  BadgeCelebration: (p: { quiet?: boolean; moment: { kind: string; badgeIds: string[] }; onDone: () => void }) => {
    h.celebration(p);
    return (
      <button data-testid="replay" data-quiet={String(!!p.quiet)} onClick={p.onDone}>
        {p.moment.kind}:{p.moment.badgeIds.join(',')}
      </button>
    );
  },
}));

import { BadgesTab } from '../profile/BadgesTab';
import { BADGE_GROUPS, BADGE_IDS } from '@/lib/i18n';
import type { BadgeView } from '@/lib/badgeProgress';

const views = (earned: string[], fresh: string[] = []): BadgeView[] =>
  (Object.entries(BADGE_GROUPS) as [string, readonly string[]][]).flatMap(([group, ids]) =>
    ids.map((id) => ({
      id,
      group,
      earned: earned.includes(id),
      isNew: fresh.includes(id),
      value: earned.includes(id) ? 1 : 0,
      goal: 1,
    })),
  );

beforeEach(() => {
  h.isOnline = true;
  h.deviceId = 'dev-1';
  h.markSeen.mockClear();
  h.invalidate.mockClear();
  h.celebration.mockClear();
});
afterEach(cleanup);

describe('BadgesTab (SYC-706)', () => {
  it('groups 22 badges under five headings', () => {
    render(<BadgesTab views={views(['first_sighting'])} state="ready" />);
    const headings = screen.getAllByRole('heading').map((n) => n.textContent);
    expect(headings).toEqual(['First steps', 'Coming back', 'The weekly board', 'Finding cats', 'Covering the island']);
    expect(BADGE_IDS).toHaveLength(22);
    for (const id of BADGE_IDS) expect(screen.getByTestId(`badge-row-${id}`)).toBeTruthy();
    expect(screen.getByTestId('badge-group-weekly').textContent).toContain('Podium');
  });

  it('new badge shows the New chip until the tab has been seen', async () => {
    const { rerender } = render(<BadgesTab views={views(['podium', 'first_sighting'], ['podium'])} state="ready" />);
    expect(screen.getByTestId('badge-new-podium').textContent).toBe('New');
    expect(screen.queryByTestId('badge-new-first_sighting')).toBeNull();
    await waitFor(() => expect(h.markSeen).toHaveBeenCalledWith('dev-1'));
    await waitFor(() => expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ['/api/profiles/dev-1'] }));
    // The refreshed profile no longer lists it as new; the chip goes and nothing is sent again.
    rerender(<BadgesTab views={views(['podium', 'first_sighting'])} state="ready" />);
    expect(screen.queryByTestId('badge-new-podium')).toBeNull();
    expect(h.markSeen).toHaveBeenCalledTimes(1);
  });

  it('only tells the server when online, signed in and something is new, once per visit', () => {
    h.isOnline = false;
    const { rerender } = render(<BadgesTab views={views(['podium'], ['podium'])} state="ready" />);
    expect(h.markSeen).not.toHaveBeenCalled();
    h.isOnline = true;
    rerender(<BadgesTab views={views(['podium'], ['podium'])} state="ready" />);
    rerender(<BadgesTab views={views(['podium'], ['podium'])} state="ready" />);
    expect(h.markSeen).toHaveBeenCalledTimes(1);
    cleanup();
    h.markSeen.mockClear();
    render(<BadgesTab views={views(['podium'])} state="ready" />);
    expect(h.markSeen).not.toHaveBeenCalled();
  });

  it('tapping an earned badge replays it quietly', () => {
    render(<BadgesTab views={views(['podium'])} state="ready" />);
    fireEvent.click(screen.getByTestId('badge-row-champion'));
    expect(screen.queryByTestId('replay')).toBeNull();
    fireEvent.click(screen.getByTestId('badge-row-podium'));
    const replay = screen.getByTestId('replay');
    expect(replay.getAttribute('data-quiet')).toBe('true');
    expect(replay.textContent).toBe('badges:podium');
    fireEvent.click(replay);
    expect(screen.queryByTestId('replay')).toBeNull();
  });
});
