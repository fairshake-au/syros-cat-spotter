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

export function cameraCaptureToPhoto(
  capture: CameraCaptureLike,
): { uri: string; base64: string } | null {
  if (!capture.uri || !capture.base64) return null;
  return { uri: capture.uri, base64: capture.base64 };
}
