import type { CareEvent, Cat, Sighting } from '@workspace/api-client-react';

type T = (key: string) => string;

/** A sighting's spotter as the cat page names them. */
export function spotterName(
  s: Pick<Sighting, 'spotterUsername' | 'spotterNickname' | 'spotterCode'>,
  t: T,
): string {
  return (
    s.spotterUsername ??
    s.spotterNickname ??
    (s.spotterCode ? `${t('spotter')} ${s.spotterCode}` : t('aSpotter'))
  );
}

/**
 * The line under a photo in its full-screen view (SYC-44 PR 6.1). "Spotted by
 * Eleni" when the spotter has a name; otherwise the same words the sighting
 * tile uses ("Spotter AB12", "A spotter"), so no language has to bend a
 * fallback into "Spotted by …" (review finding 4).
 */
export function bylineFor(
  s: Pick<Sighting, 'spotterUsername' | 'spotterNickname' | 'spotterCode'>,
  t: T,
): string {
  const name = s.spotterUsername ?? s.spotterNickname;
  if (name) return t('photoViewerSpottedBy').split('{name}').join(name);
  const label = spotterName(s, t);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * When a cat's main photo was taken and by whom, for its full-screen view
 * (SYC-44 PR 6.1, spec §3.2). The main photo is always a sighting's photo (a
 * new cat's is its first sighting's; a hidden one's stand-in is the newest
 * visible one), so that sighting answers. Failing a match (an imported cat,
 * say), the discovery does. Null when there's no photo or no date at all.
 */
export function mainPhotoCaption(
  cat: Pick<Cat, 'photoUrl' | 'discovererUsername' | 'discovererNickname' | 'discovererSpotterCode'>,
  sightings: readonly Sighting[],
  careTimeline: readonly CareEvent[] | undefined,
  t: T,
): { day: string; byline: string } | null {
  const url = cat.photoUrl;
  if (!url) return null;
  const from = sightings.find(
    (s) => s.photoUrl === url || (s.extraPhotos ?? []).some((e) => e.photoUrl === url),
  );
  if (from) return { day: from.createdAt, byline: bylineFor(from, t) };
  const discovered = careTimeline?.find((e) => e.type === 'discovered');
  if (!discovered) return null;
  return {
    day: discovered.at,
    byline: bylineFor(
      {
        spotterUsername: cat.discovererUsername ?? null,
        spotterNickname: cat.discovererNickname ?? null,
        spotterCode: cat.discovererSpotterCode ?? null,
      },
      t,
    ),
  };
}
