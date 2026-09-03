import * as ImageManipulator from 'expo-image-manipulator';

/**
 * The network fields used for deciding whether a photo should be optimized.
 * Keeping this narrower than NetInfoState also makes the decision testable and
 * tolerant of platforms that do not provide every detail.
 */
export interface UploadNetworkState {
  type?: string | null;
  isConnected?: boolean | null;
  details?: {
    isConnectionExpensive?: boolean | null;
    cellularGeneration?: string | null;
    strength?: number | null;
  } | null;
}

/**
 * Cellular data and weak/expensive Wi-Fi can make a native camera photo feel
 * stuck while uploading. Optimize only those paths; a normal Wi-Fi upload
 * remains the original asset.
 */
export function shouldOptimizePhoto(
  network: UploadNetworkState | null | undefined,
): boolean {
  if (!network || network.isConnected === false) return false;

  const details = network.details;
  return (
    network.type === 'cellular' ||
    details?.isConnectionExpensive === true ||
    (network.type === 'wifi' &&
      typeof details?.strength === 'number' &&
      details.strength <= 25)
  );
}

/**
 * Create a temporary upload representation. The source URI is not replaced,
 * so the app can still display and queue the original full-quality photo.
 */
export async function optimizePhotoForUpload(
  uri: string,
): Promise<string | null> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1280 } }],
      {
        compress: 0.72,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );
    return result.base64 ?? null;
  } catch {
    // If a platform cannot read the source URI, callers can explicitly fall
    // back to the original base64 rather than losing the sighting.
    return null;
  }
}