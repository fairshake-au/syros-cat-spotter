import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { objectUrlFromBase64, splitDataUrl } from '@/lib/cameraMode';
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

/**
 * A displayable URI for a photo still held inline as base64 (spec §3.4).
 *
 * On web, an object URL made from the bytes — never a data URL, and never the
 * item's own display URI, which for an item queued in an earlier session is a
 * dead object URL. Revoked on unmount or when the photo changes. Elsewhere, a
 * data URI. Tolerates a value that already carries a data-URL prefix.
 */
export function useInlinePhotoUri(base64: string | undefined): string | undefined {
  const useObjectUrl = Platform.OS === 'web' && canMakeObjectUrls();
  const [made, setMade] = useState<{ source: string; uri: string } | null>(null);

  useEffect(() => {
    if (!base64 || !useObjectUrl) return undefined;
    const { mediaType, base64: bare } = splitDataUrl(base64);
    const uri = objectUrlFromBase64(bare, mediaType ?? 'image/jpeg');
    if (!uri) return undefined;
    setMade({ source: base64, uri });
    return () => {
      try {
        URL.revokeObjectURL(uri);
      } catch {
        // nothing to release
      }
    };
  }, [base64, useObjectUrl]);

  if (!base64) return undefined;
  if (useObjectUrl) return made?.source === base64 ? made.uri : undefined;
  // Defensive: a stored value that already carries its own data-URL prefix
  // must not be prefixed again — a doubled prefix is a blank thumbnail
  // (SYC-73).
  return base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
}

function canMakeObjectUrls(): boolean {
  return (
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}
