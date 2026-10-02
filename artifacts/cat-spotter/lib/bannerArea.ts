import { useSyncExternalStore } from 'react';

/**
 * SYC-128: the banner area at the top of the app.
 *
 * BannerStack (mounted once, in app/_layout.tsx) floats the sign-in,
 * review-ready and ownership banners over whatever screen is showing, at
 * `insets.top + BANNER_AREA_TOP_GAP`. On a phone the notch pushes them clear
 * of most content, but on desktop web there's no safe-area inset and they
 * sat straight on top of the Home screen's "Hello, Spotter" greeting.
 *
 * So the stack measures itself and publishes its height here, and a screen
 * reserves that much room at the top of its own layout (see
 * `useBannerAreaReserve`). While no banner is showing the height is 0 and
 * nothing moves. This is a tiny module-level store rather than a React
 * context so BannerStack can own it without a provider in the root layout.
 */

/** Gap between the safe area and the first banner (and below the last). */
export const BANNER_AREA_TOP_GAP = 8;

let height = 0;
const listeners = new Set<() => void>();

export function getBannerAreaHeight(): number {
  return height;
}

/** Called by BannerStack whenever its measured height changes. */
export function setBannerAreaHeight(next: number): void {
  const rounded = Math.max(0, Math.round(next));
  if (rounded === height) return;
  height = rounded;
  listeners.forEach((listener) => listener());
}

export function subscribeBannerArea(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * How much room, below the safe-area top, a screen should leave for the
 * banners: the stack itself, the gap above it and the same gap below it.
 * Zero when no banner is showing.
 */
export function bannerAreaReserve(stackHeight: number): number {
  const rounded = Math.max(0, Math.round(stackHeight));
  return rounded > 0 ? rounded + 2 * BANNER_AREA_TOP_GAP : 0;
}

/** The current banner area height, re-rendering when it changes. */
export function useBannerAreaHeight(): number {
  return useSyncExternalStore(
    subscribeBannerArea,
    getBannerAreaHeight,
    getBannerAreaHeight,
  );
}

/** Extra top padding a screen should add so banners don't cover it. */
export function useBannerAreaReserve(): number {
  return bannerAreaReserve(useBannerAreaHeight());
}
