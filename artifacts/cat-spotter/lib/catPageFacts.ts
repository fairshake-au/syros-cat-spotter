import type { Sighting } from '@workspace/api-client-react';

type T = (key: string) => string;

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);

const isCount = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * SYC-624: the quiet second line of the facts card's Seen row, e.g.
 * "Spotted 14 times by 6 spotters · 9 fans". Each "Spotted" sentence is a
 * whole template per language. A count the server did not send (an older
 * server or cache) leaves its part out; it is never shown as a false 0.
 */
export function seenQuietLine(
  t: T,
  counts: { sightingsCount?: number; spottersCount?: number; followersCount?: number },
): string | null {
  const n = counts.sightingsCount;
  const s = counts.spottersCount;
  const f = counts.followersCount;
  const parts: string[] = [];

  if (isCount(n) && n >= 1) {
    if (n === 1) parts.push(t('catSpottedOnce'));
    else if (isCount(s) && s >= 2) parts.push(fill(t('catSpottedTimesBy'), { n, s }));
    else if (isCount(s) && s === 1) parts.push(fill(t('catSpottedTimesByOne'), { n }));
    else parts.push(fill(t('catSpottedTimes'), { n }));
  }
  if (isCount(f) && f >= 1) {
    parts.push(f === 1 ? t('catFansOne') : fill(t('catFans'), { n: f }));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The number on the Photos tab: each sighting's cover (unless hidden or
 * removed) plus its extra photos that have an address. The same visibility
 * rule SightingPhotos draws by.
 */
export function visiblePhotoCount(sightings: Sighting[]): number {
  let total = 0;
  for (const s of sightings) {
    if (s.photoUrl && !s.photoHidden && !s.photoRemoved) total += 1;
    total += (s.extraPhotos ?? []).filter((e) => !!e.photoUrl).length;
  }
  return total;
}

export type HomeAction = 'claim' | 'askStreet' | 'askHomed' | null;

/** Which sheet the 🏠 "{name} lives with me" card opens, or none (no card). */
export function homeActionFor(input: {
  isOwner: boolean;
  canClaim: boolean;
  claimCooldown: boolean;
  lifeStatus: string;
  hasHome: boolean;
}): HomeAction {
  if (input.isOwner) return null;
  if (input.lifeStatus === 'in_care' || input.lifeStatus === 'deceased') return null;
  if (input.canClaim) return 'claim';
  if (input.claimCooldown) return null;
  if (input.hasHome) return 'askHomed';
  return 'askStreet';
}
