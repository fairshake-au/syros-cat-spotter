// @vitest-environment jsdom
/**
 * SYC-502: the /keep-safe route serves both Settings and the one-time
 * first-badge offer. Settings keeps its back arrow and returns to Profile; the
 * offer records its own surface, has no back arrow and falls back to Home.
 * Opening the screen at all counts as being asked.
 */
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Props = { surface: string; onBack?: () => void; onSkip: () => void; onSaved: () => void };

const h = vi.hoisted(() => ({
  params: {} as { surface?: string },
  keepSafeOffer: null as null | 'skipped-onboarding' | 'done',
  setKeepSafeOffer: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  canGoBack: false,
  props: null as Props | null,
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => h.params,
  router: { replace: h.replace, back: h.back, canGoBack: () => h.canGoBack },
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({ keepSafeOffer: h.keepSafeOffer, setKeepSafeOffer: h.setKeepSafeOffer }),
}));
vi.mock('@/components/keepSafe/KeepSafeSettings', () => ({ KEEP_SAFE_QUERY_ROOT: ['keep-safe'] }));
vi.mock('@/components/keepSafe/KeepSafeScreen', () => ({
  KeepSafeScreen: (props: Props) => {
    h.props = props;
    return null;
  },
}));

import KeepSafeRoute from '@/app/keep-safe';

beforeEach(() => {
  h.params = {};
  h.keepSafeOffer = 'done';
  h.setKeepSafeOffer.mockReset();
  h.replace.mockReset();
  h.back.mockReset();
  h.canGoBack = false;
  h.props = null;
});
afterEach(cleanup);

describe('/keep-safe route (SYC-502)', () => {
  it('Settings: settings surface, a back arrow, and Skip returns to Profile', () => {
    render(<KeepSafeRoute />);
    expect(h.props?.surface).toBe('settings');
    expect(h.props?.onBack).toBeTypeOf('function');
    h.props?.onSkip();
    expect(h.replace).toHaveBeenCalledWith('/profile');
  });

  it('first-badge offer: its own surface, no back arrow, and Skip falls back to Home', () => {
    h.params = { surface: 'first_badge' };
    render(<KeepSafeRoute />);
    expect(h.props?.surface).toBe('first_badge');
    expect(h.props?.onBack).toBeUndefined();
    h.props?.onSkip();
    expect(h.replace).toHaveBeenCalledWith('/');
  });

  it('Skip goes back to where the spotter was when it can', () => {
    h.params = { surface: 'first_badge' };
    h.canGoBack = true;
    render(<KeepSafeRoute />);
    h.props?.onSkip();
    expect(h.back).toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it('a spotter who skipped at onboarding and opens it from Settings is not offered it again', () => {
    h.keepSafeOffer = 'skipped-onboarding';
    render(<KeepSafeRoute />);
    expect(h.setKeepSafeOffer).toHaveBeenCalledWith('done');
  });

  it('leaves the offer state alone otherwise', () => {
    render(<KeepSafeRoute />);
    expect(h.setKeepSafeOffer).not.toHaveBeenCalled();
  });
});
