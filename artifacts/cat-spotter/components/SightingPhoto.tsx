import React, { useEffect, useState } from 'react';
import { Image, type ImageProps } from 'expo-image';

interface Props extends Omit<ImageProps, 'source'> {
  /** Local file URI (may point at a purged cache file). */
  uri?: string;
  /** Stored base64 JPEG used as a fallback when the file is gone. */
  base64?: string;
}

/**
 * Renders a sighting photo from its local file URI, falling back to the
 * stored base64 copy if the cache file has been purged by the OS.
 */
export function SightingPhoto({ uri, base64, ...rest }: Props) {
  const [failed, setFailed] = useState(false);

  // Reset when the target photo changes.
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const dataUri = base64 ? `data:image/jpeg;base64,${base64}` : undefined;
  const source = !uri || failed ? dataUri : uri;

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
