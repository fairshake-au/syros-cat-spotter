import type { Sighting } from '@workspace/api-client-react';

type ExtraPhoto = NonNullable<Sighting['extraPhotos']>[number];

/** How many extra photos a sighting's tile draws beside its cover. */
export const MAX_EXTRA_THUMBS = 2;

/**
 * The photos a sighting's tile actually draws, for people to see: the cover
 * unless it is hidden or removed, and the extras that have an address (at
 * most `MAX_EXTRA_THUMBS`). The grid draws from this and the Photos tab's
 * badge counts it, so the two can't drift.
 */
export function visiblePhotosOf(s: {
  photoUrl: string | null;
  photoHidden?: boolean;
  photoRemoved?: boolean;
  extraPhotos?: ExtraPhoto[];
}): { cover: string | null; extras: (ExtraPhoto & { photoUrl: string })[] } {
  const cover = s.photoUrl && !s.photoHidden && !s.photoRemoved ? s.photoUrl : null;
  const extras = (s.extraPhotos ?? [])
    .filter((e): e is ExtraPhoto & { photoUrl: string } => !!e.photoUrl)
    .slice(0, MAX_EXTRA_THUMBS);
  return { cover, extras };
}
