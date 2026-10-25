// @vitest-environment jsdom
/**
 * SYC-706: the queued badge celebrations play one at a time, oldest first, only
 * on a resting screen, and are marked celebrated when closed. The first-badge
 * "keep my spots safe" offer waits until they are done.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  pathname: '/',
  online: true,
  moments: [] as Array<Record<string, unknown>>,
  list: vi.fn(),
  mark: vi.fn(),
  push: vi.fn(),
  setKeepSafeOffer: vi.fn(),
  keepSafeOffer: null as null | string,
  profileBadges: [] as string[],
  views: true,
}));

vi.mock('expo-router', () => ({
  usePathname: () => h.pathname,
  router: { push: h.push },
}));
vi.mock('@workspace/api-client-react', () => ({
  listBadgeMoments: h.list,
  markMomentCelebrated: h.mark,
  getGetProfileQueryKey: (id: string) => ['profile', id],
  useGetProfile: () => ({
    isFetching: false,
    data: h.views
      ? {
          badges: h.profileBadges,
          badgeProgress: [{ id: 'first_sighting', group: 'first_steps', earned: true, value: 1, goal: 1 }],
        }
      : { badges: h.profileBadges },
  }),
}));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({
    deviceId: 'device-1',
    keepSafeOffer: h.keepSafeOffer,
    setKeepSafeOffer: h.setKeepSafeOffer,
  }),
}));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: h.online }) }));
vi.mock('@/components/celebration/BadgeCelebration', () => ({
  BadgeCelebration: (p: { moment: { kind: string; badgeIds: string[] }; onDone: () => void }) =>
    React.createElement(
      'button',
      { 'data-testid': 'celebration', onClick: p.onDone },
      `${p.moment.kind}:${p.moment.badgeIds.join(',')}`,
    ),
}));

import { CelebrationProvider, useCelebration } from '@/context/CelebrationContext';
import { FirstBadgeOffer } from '@/components/keepSafe/FirstBadgeOffer';
import { openWeeklyResult } from '@/lib/celebrationBus';

const moment = (id: number, kind: string, badgeIds: string[]) => ({
  id,
  kind,
  badgeIds,
  weekStart: null,
  place: null,
  weekPoints: null,
});

function App({ children }: { children?: React.ReactNode }) {
  return (
    <CelebrationProvider>
      {children}
      <FirstBadgeOffer />
    </CelebrationProvider>
  );
}

function Claimer({ id }: { id: number }) {
  const { claimMoment } = useCelebration();
  React.useEffect(() => claimMoment(id), [claimMoment, id]);
  return null;
}

beforeEach(() => {
  h.pathname = '/';
  h.online = true;
  h.views = true;
  h.keepSafeOffer = null;
  h.profileBadges = [];
  h.moments = [];
  h.list.mockReset().mockImplementation(async () => ({ moments: h.moments }));
  h.mark.mockReset().mockResolvedValue(undefined);
  h.push.mockReset();
  h.setKeepSafeOffer.mockReset();
});
afterEach(cleanup);

describe('CelebrationContext', () => {
  it('plays queued moments oldest first and marks each celebrated', async () => {
    h.moments = [moment(1, 'week_result', ['podium']), moment(2, 'badges', ['areas_3'])];
    render(<App />);
    expect((await screen.findByTestId('celebration')).textContent).toBe('week_result:podium');
    fireEvent.click(screen.getByTestId('celebration'));
    expect(h.mark).toHaveBeenCalledWith('device-1', 1);
    await waitFor(() => expect(screen.getByTestId('celebration').textContent).toBe('badges:areas_3'));
    fireEvent.click(screen.getByTestId('celebration'));
    expect(h.mark).toHaveBeenCalledWith('device-1', 2);
    expect(h.mark).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByTestId('celebration')).toBeNull());
  });

  it('does not play on the camera route, or over a report', async () => {
    h.moments = [moment(1, 'badges', ['areas_3'])];
    h.pathname = '/spot';
    const view = render(<App />);
    await waitFor(() => expect(h.list).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('celebration')).toBeNull();
    h.pathname = '/report';
    view.rerender(<App />);
    expect(screen.queryByTestId('celebration')).toBeNull();
    h.pathname = '/cats';
    view.rerender(<App />);
    expect(await screen.findByTestId('celebration')).toBeTruthy();
  });

  it('skips the moment the review screen plays itself', async () => {
    h.moments = [moment(7, 'badges', ['areas_3']), moment(8, 'week_result', ['podium'])];
    render(
      <App>
        <Claimer id={7} />
      </App>,
    );
    expect((await screen.findByTestId('celebration')).textContent).toBe('week_result:podium');
  });

  it('does not fetch while offline', async () => {
    h.online = false;
    h.moments = [moment(1, 'badges', ['areas_3'])];
    render(<App />);
    await act(async () => {});
    expect(h.list).not.toHaveBeenCalled();
    expect(screen.queryByTestId('celebration')).toBeNull();
  });

  it('keep-safe offer waits until the celebration closes', async () => {
    h.moments = [moment(1, 'badges', ['first_sighting'])];
    h.keepSafeOffer = 'skipped-onboarding';
    h.profileBadges = ['first_sighting'];
    render(<App />);
    expect(await screen.findByTestId('celebration')).toBeTruthy();
    expect(h.push).not.toHaveBeenCalled();
    expect(h.setKeepSafeOffer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('celebration'));
    await waitFor(() =>
      expect(h.push).toHaveBeenCalledWith({ pathname: '/keep-safe', params: { surface: 'first_badge' } }),
    );
    expect(h.setKeepSafeOffer).toHaveBeenCalledWith('done');
  });

  it('a tapped weekly result plays its celebration even from the bell screen', async () => {
    h.pathname = '/notifications';
    h.moments = [moment(3, 'week_result', ['podium'])];
    render(<App />);
    await waitFor(() => expect(h.list).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('celebration')).toBeNull();
    const nav = { push: vi.fn() };
    await act(async () => {
      await openWeeklyResult(nav);
    });
    expect(screen.getByTestId('celebration').textContent).toBe('week_result:podium');
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('a tapped weekly result with nothing queued opens the Spotters board', async () => {
    render(<App />);
    await waitFor(() => expect(h.list).toHaveBeenCalled());
    const nav = { push: vi.fn() };
    await act(async () => {
      await openWeeklyResult(nav);
    });
    expect(nav.push).toHaveBeenCalledWith({ pathname: '/profile', params: { tab: 'spotters' } });
    expect(screen.queryByTestId('celebration')).toBeNull();
  });
});
