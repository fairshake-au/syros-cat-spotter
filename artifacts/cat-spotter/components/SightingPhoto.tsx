import React, { useEffect, useState } from 'react';
import { Image, type ImageProps } from 'expo-image';
import { useStoredPhotoUri } from '@/hooks/useStoredPhotoUri';

interface Props extends Omit<ImageProps, 'source'> {
  /**
   * The photo's stored reference: a local file URI (which may point at a
   * purged cache file), or an `idb:` reference to the web photo store.
   */
  uri?: string;
  /** Stored base64 JPEG used as a fallback when the file is gone. */
  base64?: string;
}

/**
 * Renders a sighting photo from its stored reference, falling back to the
 * inline base64 copy if the file has been purged by the OS (or the photo was
 * never moved out of the list).
 */
export function SightingPhoto({ uri, base64, ...rest }: Props) {
  const [failed, setFailed] = useState(false);
  const resolvedUri = useStoredPhotoUri(uri);

  // Reset when the target photo changes.
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  // Defensive: a stored base64 value that already carries its own data-URL
  // prefix must not be prefixed again. Doubling it yields an unrenderable
  // source and a blank thumbnail, which is what queued camera photos hit
  // before the capture output was normalised (SYC-73).
  const dataUri = base64
    ? base64.startsWith('data:')
      ? base64
      : `data:image/jpeg;base64,${base64}`
    : undefined;
  const source = !resolvedUri || failed ? dataUri : resolvedUri;

  return (
    <Image
      {...rest}
      source={source ? { uri: source } : undefined}
      onError={() => {
        if (!failed && dataUri) setFailed(true);
      }}
    />
  );
}
