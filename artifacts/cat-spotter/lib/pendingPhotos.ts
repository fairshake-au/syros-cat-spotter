import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Persistent storage for queued sighting photos.
 *
 * Queue items used to embed the full photo as base64 inside AsyncStorage,
 * which balloons the queue JSON and slows every read/write once several
 * photos are waiting. Instead, each photo is copied into the app's document
 * directory (purge-safe, unlike the image-picker cache) and the queue only
 * stores the file path.
 *
 * On web there is no persistent file system, so callers fall back to
 * keeping base64 in the queue (web is a dev-preview surface only).
 */

const PHOTOS_DIR = `${FileSystem.documentDirectory ?? ''}pending-photos`;

export const supportsPhotoFiles = Platform.OS !== 'web';

async function ensureDir(): Promise<void> {
  await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true }).catch(
    () => {},
  );
}

function photoPath(localId: string): string {
  return `${PHOTOS_DIR}/${localId}.jpg`;
}

/**
 * Persist a queued photo and return its durable file URI.
 * Prefers copying the picker's cache file; falls back to writing the base64.
 */
export async function savePendingPhoto(
  localId: string,
  sourceUri: string | undefined,
  base64: string | undefined,
): Promise<string | null> {
  if (!supportsPhotoFiles) return null;
  await ensureDir();
  const dest = photoPath(localId);
  if (sourceUri) {
    try {
      await FileSystem.copyAsync({ from: sourceUri, to: dest });
      return dest;
    } catch {
      // cache file already purged — fall through to base64
    }
  }
  if (base64) {
    try {
      await FileSystem.writeAsStringAsync(dest, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return dest;
    } catch {
      return null;
    }
  }
  return null;
}

/** Read a persisted photo back as base64 (needed for upload). */
export async function readPendingPhotoBase64(
  fileUri: string,
): Promise<string | null> {
  if (!supportsPhotoFiles) return null;
  try {
    return await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    return null;
  }
}

/** Delete a persisted photo; safe to call for missing files. */
export async function deletePendingPhoto(fileUri: string): Promise<void> {
  if (!supportsPhotoFiles) return;
  await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
}

/** Remove photo files that no longer belong to any queue item. */
export async function cleanupOrphanPhotos(keepUris: string[]): Promise<void> {
  if (!supportsPhotoFiles) return;
  try {
    const names = await FileSystem.readDirectoryAsync(PHOTOS_DIR);
    const keep = new Set(
      keepUris.map((u) => u.slice(u.lastIndexOf('/') + 1)),
    );
    await Promise.all(
      names
        .filter((n) => !keep.has(n))
        .map((n) =>
          FileSystem.deleteAsync(`${PHOTOS_DIR}/${n}`, { idempotent: true }).catch(
            () => {},
          ),
        ),
    );
  } catch {
    // directory may not exist yet
  }
}
