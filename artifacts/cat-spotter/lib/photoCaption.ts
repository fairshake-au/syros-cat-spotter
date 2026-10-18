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
): { day: string; spotter: string } | null {
  const url = cat.photoUrl;
  if (!url) return null;
  const from = sightings.find(
    (s) => s.photoUrl === url || (s.extraPhotos ?? []).some((e) => e.photoUrl === url),
  );
  if (from) return { day: from.createdAt, spotter: spotterName(from, t) };
  const discovered = careTimeline?.find((e) => e.type === 'discovered');
  if (!discovered) return null;
  return {
    day: discovered.at,
    spotter: spotterName(
      {
        spotterUsername: cat.discovererUsername ?? null,
        spotterNickname: cat.discovererNickname ?? null,
        spotterCode: cat.discovererSpotterCode ?? null,
      },
      t,
    ),
  };
}
