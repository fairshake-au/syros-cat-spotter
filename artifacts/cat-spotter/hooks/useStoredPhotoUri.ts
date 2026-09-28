import { useEffect, useState } from 'react';
import { isStoredPhotoRef, openStoredPhoto } from '@/lib/pendingPhotos';

/**
 * A displayable URI for a stored photo reference (spec §3.2).
 *
 * Native file paths — and anything else that is not an `idb:` reference —
 * come back unchanged. An `idb:` reference becomes an object URL made from the
 * stored bytes, revoked on unmount or when the reference changes. Undefined
 * while loading, or if the photo is gone.
 */
export function useStoredPhotoUri(ref: string | undefined): string | undefined {
  const stored = isStoredPhotoRef(ref);
  const [opened, setOpened] = useState<{ ref: string; uri: string } | null>(
    null,
  );

  useEffect(() => {
    if (!ref || !isStoredPhotoRef(ref)) return undefined;
    let cancelled = false;
    let release: (() => void) | null = null;
    openStoredPhoto(ref)
      .then((photo) => {
        if (!photo) return;
        if (cancelled) {
          photo.release();
          return;
        }
        release = photo.release;
        setOpened({ ref, uri: photo.uri });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      release?.();
    };
  }, [ref]);

  if (!ref) return undefined;
  if (!stored) return ref;
  return opened?.ref === ref ? opened.uri : undefined;
}
