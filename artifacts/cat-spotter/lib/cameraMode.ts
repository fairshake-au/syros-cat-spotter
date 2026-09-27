export type CameraMode =
  | 'picker'
  | 'loading'
  | 'request'
  | 'settings'
  | 'ready';

export interface CameraPermissionLike {
  granted: boolean;
  canAskAgain: boolean;
}

export interface CameraCaptureLike {
  uri: string;
  base64?: string | null;
}

export function getCameraMode(
  platform: string,
  permission: CameraPermissionLike | null,
  permissionLookupFailed = false,
): CameraMode {
  if (platform !== 'android' && platform !== 'web') return 'picker';
  // The browser could not tell us the permission state at all (no
  // navigator.permissions, or the query rejected). Fall back to the system
  // picker, which opens the phone's own camera app and needs no permission
  // lookup — never strand the screen on 'loading'.
  if (permissionLookupFailed) return 'picker';
  if (!permission) return 'loading';
  if (permission.granted) return 'ready';
  return permission.canAskAgain ? 'request' : 'settings';
}

/**
 * Which shutter the capture screen shows. Deliberately total: there is no
 * "no shutter" result, because leaving the user with no way to photograph a cat
 * is the bug this whole flow exists to fix (SYC-72). The live preview is used
 * when it is genuinely up; every other situation falls back to the system
 * camera app, which needs no in-page permission and always works.
 */
export type ShutterKind = 'live' | 'picker';

export function shutterKindFor(
  state: CameraMode,
  cameraFailed: boolean,
  cameraActive: boolean,
): ShutterKind {
  return state === 'ready' && !cameraFailed && cameraActive
    ? 'live'
    : 'picker';
}

const DATA_URL_HEAD = /^data:([^;,]+);base64,/;

/**
 * Splits a `data:<type>;base64,<payload>` string into its parts. Anything that
 * is not a data URL comes back unchanged with a null media type.
 */
export function splitDataUrl(value: string): {
  mediaType: string | null;
  base64: string;
} {
  const match = DATA_URL_HEAD.exec(value);
  if (!match) return { mediaType: null, base64: value };
  return { mediaType: match[1], base64: value.slice(match[0].length) };
}

/**
 * Turns base64 image bytes into a short-lived object URL. Returns null when the
 * runtime has no object-URL support (native, or a test environment), so callers
 * can fall back.
 */
export function objectUrlFromBase64(
  base64: string,
  mediaType: string,
): string | null {
  if (
    typeof atob !== 'function' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return null;
  }
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return URL.createObjectURL(new Blob([bytes], { type: mediaType }));
  } catch {
    return null;
  }
}

/**
 * Normalises a camera capture into the shape the rest of the app expects: a
 * SHORT `uri` for display, and BARE base64 (no data-URL prefix) for upload.
 *
 * On web, expo-camera returns the entire image as a data URL in *both* fields.
 * Passing that through unchanged broke three things at once (SYC-73):
 *
 *  - `submit()` puts `photo.uri` in a router param, and expo-router carries
 *    params in the browser URL — so the whole photograph went into the address.
 *    On a real Android phone that exceeds Chrome's URL limit and kills the tab,
 *    which is what two testers hit the moment they pressed "check for matches".
 *  - `SightingPhoto` builds `data:image/jpeg;base64,{base64}`, producing a
 *    doubled prefix and a blank thumbnail for every queued sighting.
 *  - Queued photos go to web storage, capped around 5 MB per site — a couple of
 *    data URLs and the offline queue stops accepting sightings.
 *
 * The photo library path already returned a short uri and bare base64, so this
 * restores the contract the app was written against rather than inventing one.
 */
export function cameraCaptureToPhoto(
  capture: CameraCaptureLike,
  toObjectUrl: (
    base64: string,
    mediaType: string,
  ) => string | null = objectUrlFromBase64,
): { uri: string; base64: string } | null {
  if (!capture.uri || !capture.base64) return null;
  const { mediaType, base64 } = splitDataUrl(capture.base64);
  if (!base64) return null;
  if (mediaType === null) {
    // Native: uri is already a file path and base64 is already bare.
    return { uri: capture.uri, base64 };
  }
  // Fall back to the data URL only if the runtime cannot make an object URL;
  // that is no worse than before, and never happens in a browser.
  const uri = toObjectUrl(base64, mediaType) ?? capture.uri;
  return { uri, base64 };
}
