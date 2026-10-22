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
