// @vitest-environment jsdom
/**
 * SYC-502: the first-badge "Don't lose your spots" offer never replaces the
 * app. The first sighting's well-done screen, with its questions, stays up
 * while the badge is new; the offer opens on top only once the spotter has
 * tapped through to the cat, and only once.
 */
import React from 'react';
import { Text } from 'react-native';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  pathname: '/review',
  badges: [] as string[] | undefined,
  keepSafeOffer: 'skipped-onboarding' as null | 'skipped-onboarding' | 'done',
  setKeepSafeOffer: vi.fn(),
  push: vi.fn(),
  profileEnabled: [] as boolean[],
}));

vi.mock('expo-router', () => ({
  usePathname: () => h.pathname,
  router: { push: h.push },
}));
vi.mock('@workspace/api-client-react', () => ({
  getGetProfileQueryKey: (id: string) => ['profile', id],
  useGetProfile: (_id: string, opts: { query: { enabled: boolean } }) => {
    h.profileEnabled.push(opts.query.enabled);
    return { data: h.badges ? { badges: h.badges } : undefined };
  },
}));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({
    deviceId: 'device-1',
    keepSafeOffer: h.keepSafeOffer,
    setKeepSafeOffer: h.setKeepSafeOffer,
  }),
}));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: true }) }));

import { FirstBadgeOffer, canOfferHere } from '@/components/keepSafe/FirstBadgeOffer';

/** Stands in for review.tsx's success state: points, badge and questions. */
function WellDone() {
  return (
    <>
      <Text>+10 points</Text>
      <Text>New badge unlocked: First spot</Text>
      <Text>Does Mia have a tipped ear?</Text>
    </>
  );
}

function App() {
  return (
    <>
      <WellDone />
      <FirstBadgeOffer />
    </>
  );
}

beforeEach(() => {
  h.pathname = '/review';
  h.badges = [];
  h.keepSafeOffer = 'skipped-onboarding';
  h.setKeepSafeOffer.mockReset();
  h.push.mockReset();
  h.profileEnabled = [];
});
afterEach(cleanup);

describe('FirstBadgeOffer (SYC-502)', () => {
  it('leaves the well-done screen and its questions up when the first badge arrives', () => {
    const view = render(<App />);
    h.badges = ['first_spot'];
    view.rerender(<App />);
    expect(view.getByText('+10 points')).toBeTruthy();
    expect(view.getByText('New badge unlocked: First spot')).toBeTruthy();
    expect(view.getByText('Does Mia have a tipped ear?')).toBeTruthy();
    expect(view.queryByText(/Don.t lose your spots/)).toBeNull();
    expect(h.push).not.toHaveBeenCalled();
    expect(h.setKeepSafeOffer).not.toHaveBeenCalled();
  });

  it('opens the offer on top once they tap through to the cat, and marks it asked', () => {
    h.badges = ['first_spot'];
    const view = render(<App />);
    expect(h.push).not.toHaveBeenCalled();
    h.pathname = '/cat/42';
    view.rerender(<App />);
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith({ pathname: '/keep-safe', params: { surface: 'first_badge' } });
    expect(h.setKeepSafeOffer).toHaveBeenCalledWith('done');
  });

  it('opens it only once, even if they move around before the offer state settles', () => {
    h.badges = ['first_spot'];
    h.pathname = '/cat/42';
    const view = render(<App />);
    h.pathname = '/';
    view.rerender(<App />);
    expect(h.push).toHaveBeenCalledTimes(1);
  });

  it('does nothing before the first badge', () => {
    h.pathname = '/cat/42';
    render(<App />);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('never asks a spotter who saved or declined already, and does not fetch the profile for them', () => {
    h.keepSafeOffer = 'done';
    h.badges = ['first_spot'];
    h.pathname = '/';
    render(<App />);
    expect(h.push).not.toHaveBeenCalled();
    expect(h.profileEnabled.every((e) => e === false)).toBe(true);
  });

  it('only opens on screens where the spotter is resting', () => {
    expect(canOfferHere('/')).toBe(true);
    expect(canOfferHere('/cats')).toBe(true);
    expect(canOfferHere('/profile')).toBe(true);
    expect(canOfferHere('/cat/42')).toBe(true);
    for (const busy of ['/review', '/spot', '/report', '/restore', '/keep-safe', '/get-spots-back', '/delete-my-data', '/help']) {
      expect(canOfferHere(busy)).toBe(false);
    }
  });
});
