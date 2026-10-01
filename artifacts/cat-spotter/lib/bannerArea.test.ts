/**
 * SYC-128: the top banners (sign-in, review-ready, ownership notice) float
 * over every screen at `insets.top + 8`. On desktop web there's no safe-area
 * inset, so they sat straight on top of the Home screen's "Hello, Spotter"
 * greeting. BannerStack now reports how tall the visible banner area is, and
 * a screen reserves that much room at its top so its own header starts below
 * the banners instead of underneath them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BANNER_AREA_TOP_GAP,
  bannerAreaReserve,
  getBannerAreaHeight,
  setBannerAreaHeight,
  subscribeBannerArea,
} from './bannerArea';

afterEach(() => {
  setBannerAreaHeight(0);
});

describe('bannerAreaReserve', () => {
  it('reserves nothing when no banner is showing', () => {
    expect(bannerAreaReserve(0)).toBe(0);
  });

  it('reserves the banner height plus the gap above it and a matching gap below', () => {
    // The stack sits BANNER_AREA_TOP_GAP below the safe area; content needs
    // to clear the stack's bottom edge with the same gap again.
    expect(bannerAreaReserve(44)).toBe(44 + 2 * BANNER_AREA_TOP_GAP);
  });

  it('treats a negative or fractional measurement sensibly', () => {
    expect(bannerAreaReserve(-3)).toBe(0);
    expect(bannerAreaReserve(43.6)).toBe(44 + 2 * BANNER_AREA_TOP_GAP);
  });
});

describe('banner area height store', () => {
  it('starts at zero', () => {
    expect(getBannerAreaHeight()).toBe(0);
  });

  it('stores the rounded height and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBannerArea(listener);
    setBannerAreaHeight(95.7);
    expect(getBannerAreaHeight()).toBe(96);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not notify when the height has not changed', () => {
    setBannerAreaHeight(44);
    const listener = vi.fn();
    const unsubscribe = subscribeBannerArea(listener);
    setBannerAreaHeight(44.2);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBannerArea(listener);
    unsubscribe();
    setBannerAreaHeight(44);
    expect(listener).not.toHaveBeenCalled();
  });
});
