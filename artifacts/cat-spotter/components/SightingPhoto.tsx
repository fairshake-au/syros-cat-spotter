import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Image, type ImageProps } from 'expo-image';
import { useInlinePhotoUri, useStoredPhotoUri } from '@/hooks/useStoredPhotoUri';

interface Props extends Omit<ImageProps, 'source'> {
  /**
   * The photo's stored reference: a local file URI (which may point at a
   * purged cache file), or an `idb:` reference to the web photo store.
   */
  uri?: string;
  /** Stored base64 copy, for a photo still held inline in the queue. */
  base64?: string;
}

/**
 * Renders a sighting photo from its stored reference, falling back to the
 * inline base64 copy if the file has been purged by the OS (or the photo was
 * never moved out of the list).
 *
 * On web an inline photo is shown from its own bytes straight away: its
 * display URI is, at best, an object URL from an earlier session that no
 * longer resolves.
 */
export function SightingPhoto({ uri, base64, ...rest }: Props) {
  const [failed, setFailed] = useState(false);
  const storedUri = useStoredPhotoUri(uri);
  const inlineUri = useInlinePhotoUri(base64);

  // Reset when the target photo changes.
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const preferInline = Platform.OS === 'web' && !!base64;
  const source = preferInline || !storedUri || failed ? inlineUri : storedUri;

  return (
    <Image
      {...rest}
      source={source ? { uri: source } : undefined}
      onError={() => {
        if (!failed && inlineUri) setFailed(true);
      }}
    />
  );
}
