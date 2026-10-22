/**
 * "I've spotted {name}" (SYC-574, docs/specs/design-review-fixes-oct22.md
 * Part 2): the cat-page button opens the Spot tab with that cat as a HINT.
 *
 * The hint lives only on the phone. It is never sent with POST /sightings,
 * and it never changes what the matcher's answer shows: it only adds the
 * "Is this {name}?" question in front of the review screens.
 */
import type { Cat } from '@workspace/api-client-react';

/**
 * Whether a cat's page offers "I've spotted {name}" (§2.1). Hidden for a cat
 * in care or one that has died: the server refuses to resolve a sighting to
 * a dead cat, and has no such guard for "in care", so the app hides it.
 */
export function canSpotFromPage(lifeStatus: Cat['lifeStatus'] | undefined | null): boolean {
  return lifeStatus === 'street' || lifeStatus === 'homed';
}

/** The one route the cat page (and the claim sheet) opens the Spot tab with. */
export function spotRouteFor(catId: number): { pathname: '/spot'; params: { for: string } } {
  return { pathname: '/spot', params: { for: String(catId) } };
}

/**
 * The `for` route param, read once by the Spot screen: a positive whole cat
 * id, or null. A crafted or garbled value is simply no hint.
 */
export function readHintParam(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * What can happen to the hint on the Spot screen. Spec §2.2's table, row by row:
 * - `arrive`: arriving from a cat's page. With no photo staged the banner shows
 *   and the next photo carries it; with a photo staged, the hint applies to it.
 * - `leaveTab`: leaving the tab drops it unless a photo is staged, which keeps
 *   it (as the staged photo itself is kept).
 * - `stop`: the banner's ✕.
 * - `startAgain`: "Start again" (the back arrow), which discards the photo.
 * - `sent`: the spot was sent or saved; the hint went with it, so it is cleared.
 * - `notSpottable`: the hinted cat turned out to be in care or to have died.
 *
 * "Retake photo" is not an event: it keeps the spot (and its extra photos), so
 * it keeps the hint too.
 */
export type HintEvent =
  | { kind: 'arrive'; catId: number }
  | { kind: 'leaveTab'; hasPhoto: boolean }
  | { kind: 'stop' }
  | { kind: 'startAgain' }
  | { kind: 'sent' }
  | { kind: 'notSpottable' };

export function nextHint(current: number | null, event: HintEvent): number | null {
  switch (event.kind) {
    case 'arrive':
      return event.catId;
    case 'leaveTab':
      return event.hasPhoto ? current : null;
    case 'stop':
    case 'startAgain':
    case 'sent':
    case 'notSpottable':
      return null;
  }
}
