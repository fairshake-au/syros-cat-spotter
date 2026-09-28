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
  // expo-camera's web permission request always reports canAskAgain: true —
  // an upstream bug — so once a web user has explicitly declined, the
  // "Allow camera" pill would otherwise ask forever and do nothing. The
  // caller sets this after a request() resolves not-granted on web, and it
  // stays set for the rest of the session.
  webDeclined = false,
): CameraMode {
  if (platform !== 'android' && platform !== 'web') return 'picker';
  if (platform === 'web' && webDeclined) return 'picker';
  // A known grant always wins, even if a later permission lookup on some
  // other call failed — a stale failure must never unmount a working live
  // preview (Cursor Bugbot finding). Only consult the failure flag once we
  // have no permission reading to go on at all.
  if (permission?.granted) return 'ready';
  if (!permission) {
    // The browser could not tell us the permission state at all (no
    // navigator.permissions, or the query rejected). Fall back to the system
    // picker, which opens the phone's own camera app and needs no permission
    // lookup — never strand the screen on 'loading'.
    return permissionLookupFailed ? 'picker' : 'loading';
  }
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
  if (!capture.base64.startsWith('data:')) {
    // Native: uri is already a file path and base64 is already bare.
    return { uri: capture.uri, base64: capture.base64 };
  }
  const { mediaType, base64 } = splitDataUrl(capture.base64);
  // A `data:` string that DATA_URL_HEAD does not match is not a usable data
  // URL — e.g. `data:,`, which `canvas.toDataURL` returns for a zero-size
  // (not-yet-ready) canvas. Treating it as bare native base64 would upload
  // that literal string as image bytes.
  if (mediaType === null || !base64) return null;
  // Fall back to the data URL only if the runtime cannot make an object URL;
  // that is no worse than before, and never happens in a browser.
  const uri = toObjectUrl(base64, mediaType) ?? capture.uri;
  return { uri, base64 };
}

const CAMERA_NOT_READY = 'ERR_CAMERA_NOT_READY';

/**
 * True for expo-camera's web `takePicture` failure while the `<video>`
 * element has not yet produced a frame — a `CodedError` (`expo-modules-core`)
 * whose `.code` is `ERR_CAMERA_NOT_READY`. Worth one retry; every other
 * failure is not.
 */
export function isCameraNotReadyError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === CAMERA_NOT_READY,
  );
}

export type LiveCaptureOutcome<T> =
  | { kind: 'captured'; capture: T }
  | { kind: 'fallback' };

/**
 * Takes a live-preview photo, retrying once on the specific "video has no
 * frames yet" failure before giving up. Deliberately narrow: this is worth
 * retrying because it is a known, common race on page load — every other
 * failure (including a second `ERR_CAMERA_NOT_READY`) falls back immediately
 * rather than retrying forever.
 *
 * Pure orchestration — `takePicture` and `wait` are injected so this is
 * testable without a real camera or real timers, and so it can live in
 * `lib/` (spot.tsx, where the real camera ref lives, is outside vitest's
 * component test coverage).
 */
export async function captureLiveWithRetry<T>(
  takePicture: () => Promise<T | null | undefined>,
  wait: (ms: number) => Promise<void>,
  retryDelayMs = 300,
): Promise<LiveCaptureOutcome<T>> {
  const attempt = async (): Promise<
    { ok: true; capture: T } | { ok: false; notReady: boolean }
  > => {
    try {
      const capture = await takePicture();
      if (!capture) return { ok: false, notReady: false };
      return { ok: true, capture };
    } catch (err) {
      return { ok: false, notReady: isCameraNotReadyError(err) };
    }
  };

  const first = await attempt();
  if (first.ok) return { kind: 'captured', capture: first.capture };
  if (!first.notReady) return { kind: 'fallback' };

  await wait(retryDelayMs);
  const second = await attempt();
  return second.ok ? { kind: 'captured', capture: second.capture } : { kind: 'fallback' };
}
