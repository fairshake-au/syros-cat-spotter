export type AndroidCameraState =
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

export function getAndroidCameraState(
  platform: string,
  permission: CameraPermissionLike | null,
): AndroidCameraState {
  if (platform !== 'android' && platform !== 'web') return 'picker';
  if (!permission) return 'loading';
  if (permission.granted) return 'ready';
  return permission.canAskAgain ? 'request' : 'settings';
}

export function cameraCaptureToPhoto(
  capture: CameraCaptureLike,
): { uri: string; base64: string } | null {
  if (!capture.uri || !capture.base64) return null;
  return { uri: capture.uri, base64: capture.base64 };
}