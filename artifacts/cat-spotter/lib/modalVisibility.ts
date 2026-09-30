import { useEffect, useState } from 'react';

/**
 * SYC-134 review round 2, item 2: a tiny global "is any modal/bottom sheet
 * open" flag, so the floating Home Screen nudge card can hide itself rather
 * than overlap something like ClaimCatSheet.
 *
 * A module-scoped counter + subscriber list, not React Context: the nudge
 * mounts at the root (via BannerStack in app/_layout.tsx) while a sheet
 * like ClaimCatSheet mounts deep inside a screen — wiring a Context
 * provider between them would mean threading it through app/_layout.tsx
 * for a single boolean. Every other cross-cutting flag in this app
 * (offline, device, language, ...) already has real multi-consumer state to
 * carry; this one doesn't, so it stays a plain module singleton.
 *
 * A counter (not a boolean) so two overlapping modals don't have the first
 * one's close prematurely clear the flag while the second is still open.
 */
let openCount = 0;
const listeners = new Set<(open: boolean) => void>();

function notify() {
  const isOpen = openCount > 0;
  for (const listener of listeners) listener(isOpen);
}

/**
 * Call when a modal/sheet becomes visible; call the returned function when
 * it closes (or unmounts while still visible). Typical usage inside the
 * modal component itself:
 *
 *   useEffect(() => {
 *     if (!visible) return;
 *     return registerModalOpen();
 *   }, [visible]);
 */
export function registerModalOpen(): () => void {
  openCount += 1;
  notify();
  let released = false;
  return () => {
    if (released) return; // guard against a double-invoked cleanup
    released = true;
    openCount = Math.max(0, openCount - 1);
    notify();
  };
}

export function useAnyModalOpen(): boolean {
  const [open, setOpen] = useState(() => openCount > 0);
  useEffect(() => {
    setOpen(openCount > 0); // may have changed between render and this effect
    listeners.add(setOpen);
    return () => {
      listeners.delete(setOpen);
    };
  }, []);
  return open;
}

/** Test-only: resets the counter between tests that import the real module. */
export function __resetModalVisibilityForTests(): void {
  openCount = 0;
  listeners.clear();
}
