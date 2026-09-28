import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { objectUrlFromBase64, splitDataUrl } from './cameraMode';
import {
  base64ToBytes,
  bytesToBase64,
  createIndexedDbPhotoStore,
  withTimeout,
  type PhotoStoreAdapter,
} from './webPhotoStore';

/**
 * Persistent storage for queued sighting photos.
 *
 * Queue items used to embed the full photo as base64 inside AsyncStorage,
 * which balloons the queue JSON and slows every read/write once several
 * photos are waiting. Instead each photo is kept outside the list and the
 * list stores only a reference to it, in `photoUri`:
 *
 *  - native: a file in the app's document directory (purge-safe, unlike the
 *    image-picker cache) — the reference is the file path;
 *  - web: a record in IndexedDB (lib/webPhotoStore.ts) — the reference is
 *    `idb:<id>`.
 *
 * On web there is no persistent file system, so callers fall back to
 * keeping base64 in the queue (web is a dev-preview surface only).
 */

const PHOTOS_DIR = `${FileSystem.documentDirectory ?? ''}pending-photos`;

export const supportsPhotoFiles = Platform.OS !== 'web';

/**
 * The web store is built but not switched on yet: saves on web report
 * `unavailable` and callers keep today's inline behaviour. The move of
 * existing queues (spec §3.3) switches it on.
 */
const WEB_PHOTO_STORE_ON = false;

const IDB_PREFIX = 'idb:';

export type SavePhotoResult =
  | { ok: true; ref: string }
  | { ok: false; reason: 'unavailable' | 'failed' };

const UNAVAILABLE: SavePhotoResult = { ok: false, reason: 'unavailable' };
const FAILED: SavePhotoResult = { ok: false, reason: 'failed' };

// ---- The web adapter ---------------------------------------------------------

let adapterOverride: PhotoStoreAdapter | null | undefined;
let defaultAdapter: PhotoStoreAdapter | null | undefined;
let probe: Promise<boolean> | null = null;
let persistenceRequested = false;

function photoStore(): PhotoStoreAdapter | null {
  if (adapterOverride !== undefined) return adapterOverride;
  if (defaultAdapter === undefined) {
    defaultAdapter =
      typeof indexedDB !== 'undefined' && indexedDB
        ? createIndexedDbPhotoStore(indexedDB)
        : null;
  }
  return defaultAdapter;
}

/**
 * Swap the web adapter (tests use an in-memory fake). `undefined` restores
 * the real one. Also forgets the availability probe and the persistence flag.
 */
export function setPhotoStoreAdapterForTests(
  adapter: PhotoStoreAdapter | null | undefined,
): void {
  adapterOverride = adapter;
  probe = null;
  persistenceRequested = false;
}

export function isStoredPhotoRef(ref: string | undefined | null): boolean {
  return !!ref && ref.startsWith(IDB_PREFIX);
}

function idbId(ref: string): string {
  return ref.slice(IDB_PREFIX.length);
}

function localStorageWorks(): boolean {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return false;
    const key = 'cat-spotter/storage-probe';
    storage.setItem(key, '1');
    const ok = storage.getItem(key) === '1';
    storage.removeItem(key);
    return ok;
  } catch {
    return false;
  }
}

const PROBE_TIMEOUT_MS = 5_000;

async function runProbe(): Promise<boolean> {
  // The list lives in localStorage and the photos in IndexedDB; a browser
  // with one and not the other (an Android WebView with DOM storage off) would
  // save a photo, fail on the list, and hold nothing.
  if (!localStorageWorks()) return false;
  const store = photoStore();
  if (!store) return false;
  const id = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const bytes = new Uint8Array([0x63, 0x61, 0x74, 0x73]).buffer;
  await store.putPhoto(id, {
    type: 'application/octet-stream',
    bytes,
    savedAt: Date.now(),
  });
  const back = await store.getPhoto(id);
  await store.deletePhoto(id);
  return !!back && back.bytes.byteLength === bytes.byteLength;
}

/**
 * Can this browser keep photos durably? Opens the database, writes, reads and
 * deletes a probe record, and checks localStorage too — availability is
 * tested, not assumed (an open that succeeds says nothing about writes).
 * Answered once per session. Native always can (files).
 */
export function durablePhotos(): Promise<boolean> {
  if (Platform.OS !== 'web') return Promise.resolve(supportsPhotoFiles);
  probe ??= withTimeout(runProbe(), PROBE_TIMEOUT_MS, 'Photo store probe').catch(
    () => false,
  );
  return probe;
}

/** Whether the web photo store is in use (switched on AND the probe passed). */
async function webStoreInUse(): Promise<boolean> {
  return WEB_PHOTO_STORE_ON && (await durablePhotos());
}

/**
 * Save base64 photo bytes to the web store under `id`. Strips any data-URL
 * prefix, stores an ArrayBuffer with strict durability, then READS IT BACK
 * and checks the length — only a verified write counts as saved.
 */
export async function saveWebPhoto(
  id: string,
  base64: string | undefined,
): Promise<SavePhotoResult> {
  const store = photoStore();
  if (!store) return UNAVAILABLE;
  if (!base64) return FAILED;
  let bytes: Uint8Array;
  let type: string;
  try {
    const split = splitDataUrl(base64);
    type = split.mediaType ?? 'image/jpeg';
    // "data:," (an empty canvas from the old camera) and anything else that
    // is not base64 throws here.
    bytes = base64ToBytes(split.base64);
  } catch {
    return FAILED;
  }
  if (bytes.byteLength === 0) return FAILED;
  try {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    await store.putPhoto(id, { type, bytes: buffer, savedAt: Date.now() });
    const back = await store.getPhoto(id);
    if (!back || back.bytes.byteLength !== bytes.byteLength) return FAILED;
    return { ok: true, ref: `${IDB_PREFIX}${id}` };
  } catch {
    return FAILED;
  }
}

// ---- Native files -------------------------------------------------------------

async function ensureDir(): Promise<void> {
  await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true }).catch(
    () => {},
  );
}

function photoPath(key: string): string {
  return `${PHOTOS_DIR}/${key}.jpg`;
}

async function saveNativePhoto(
  key: string,
  sourceUri: string | undefined,
  base64: string | undefined,
): Promise<SavePhotoResult> {
  await ensureDir();
  const dest = photoPath(key);
  if (sourceUri) {
    try {
      await FileSystem.copyAsync({ from: sourceUri, to: dest });
      return { ok: true, ref: dest };
    } catch {
      // cache file already purged — fall through to base64
    }
  }
  if (base64) {
    try {
      await FileSystem.writeAsStringAsync(dest, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return { ok: true, ref: dest };
    } catch {
      return FAILED;
    }
  }
  return FAILED;
}

// ---- The seam -----------------------------------------------------------------

/**
 * Persist a photo under `key` and return its reference — or why it could not.
 *
 * - `unavailable`: this platform or browser cannot keep photos outside the
 *   list; the caller keeps the photo inline, as before.
 * - `failed`: it can, but this save did not work. The caller decides what that
 *   means (a save the user asked for fails honestly; the move leaves the item
 *   inline).
 */
export async function savePendingPhoto(
  key: string,
  sourceUri: string | undefined,
  base64: string | undefined,
): Promise<SavePhotoResult> {
  try {
    if (supportsPhotoFiles) return await saveNativePhoto(key, sourceUri, base64);
    if (!(await webStoreInUse())) return UNAVAILABLE;
    return await saveWebPhoto(key, base64);
  } catch {
    return FAILED;
  }
}

/**
 * The key for a replacement photo: `<localId>-r<n>`, never the key of the
 * photo it replaces — so a failed replacement cannot touch the original, and
 * the reference visibly changes.
 */
export function replacementPhotoKey(
  localId: string,
  currentRef: string | undefined,
): string {
  const current = currentRef
    ? isStoredPhotoRef(currentRef)
      ? idbId(currentRef)
      : currentRef.slice(currentRef.lastIndexOf('/') + 1).replace(/\.jpg$/, '')
    : '';
  const prefix = `${localId}-r`;
  const n = current.startsWith(prefix) ? Number(current.slice(prefix.length)) : 0;
  return `${prefix}${Number.isFinite(n) && n > 0 ? n + 1 : 1}`;
}

export type StoredPhotoRead =
  | { status: 'ok'; base64: string }
  /** The photo is not there any more (a native file purged, or a browser that cleared its storage). */
  | { status: 'missing' }
  /** Could not be read this time; try again later. */
  | { status: 'error' };

/** Read a persisted photo back as base64 (needed for upload). */
export async function readPendingPhoto(ref: string): Promise<StoredPhotoRead> {
  if (isStoredPhotoRef(ref)) {
    const store = photoStore();
    if (!store) return { status: 'error' };
    try {
      const photo = await store.getPhoto(idbId(ref));
      if (!photo) return { status: 'missing' };
      return { status: 'ok', base64: bytesToBase64(photo.bytes) };
    } catch {
      return { status: 'error' };
    }
  }
  if (!supportsPhotoFiles) return { status: 'missing' };
  try {
    return {
      status: 'ok',
      base64: await FileSystem.readAsStringAsync(ref, {
        encoding: FileSystem.EncodingType.Base64,
      }),
    };
  } catch {
    return { status: 'missing' };
  }
}

/** Read a persisted photo back as base64, or null if it cannot be read. */
export async function readPendingPhotoBase64(ref: string): Promise<string | null> {
  const read = await readPendingPhoto(ref);
  return read.status === 'ok' ? read.base64 : null;
}

/** Delete a persisted photo; safe to call for missing ones. */
export async function deletePendingPhoto(ref: string): Promise<void> {
  if (isStoredPhotoRef(ref)) {
    await photoStore()
      ?.deletePhoto(idbId(ref))
      .catch(() => {});
    return;
  }
  if (!supportsPhotoFiles) return;
  await FileSystem.deleteAsync(ref, { idempotent: true }).catch(() => {});
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Remove photos that no longer belong to any queue item.
 *
 * On web, never deletes anything saved in the last 24 hours, and reads
 * `savedAt` in the same transaction as the delete: another tab may have saved
 * a photo it has not listed yet.
 */
export async function cleanupOrphanPhotos(keepRefs: string[]): Promise<void> {
  if (!supportsPhotoFiles) {
    if (!(await webStoreInUse())) return;
    const store = photoStore();
    if (!store) return;
    const keep = new Set(keepRefs.filter(isStoredPhotoRef).map(idbId));
    const cutoff = Date.now() - DAY_MS;
    for (const id of await store.photoIds()) {
      if (keep.has(id)) continue;
      await store.deletePhotoIfSavedBefore(id, cutoff).catch(() => false);
    }
    return;
  }
  try {
    const names = await FileSystem.readDirectoryAsync(PHOTOS_DIR);
    const keep = new Set(
      keepRefs.map((u) => u.slice(u.lastIndexOf('/') + 1)),
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

// ---- Showing and shrinking stored photos -------------------------------------

export interface OpenedPhoto {
  /** Something an <Image> or the image manipulator can load. */
  uri: string;
  /** Let go of it (revokes an object URL; a no-op for a file path). */
  release: () => void;
}

const noop = () => {};

function objectUrlFromBytes(bytes: ArrayBuffer, type: string): string | null {
  if (
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return null;
  }
  try {
    return URL.createObjectURL(new Blob([bytes], { type }));
  } catch {
    return null;
  }
}

function revoke(uri: string) {
  try {
    URL.revokeObjectURL(uri);
  } catch {
    // nothing to release
  }
}

/**
 * Turn a stored reference into something displayable: native file paths (and
 * any non-`idb:` reference) come back unchanged; an `idb:` reference becomes
 * an object URL made from the stored bytes. Null if the photo is gone.
 */
export async function openStoredPhoto(ref: string): Promise<OpenedPhoto | null> {
  if (!isStoredPhotoRef(ref)) return { uri: ref, release: noop };
  const store = photoStore();
  if (!store) return null;
  try {
    const photo = await store.getPhoto(idbId(ref));
    if (!photo) return null;
    const uri = objectUrlFromBytes(photo.bytes, photo.type || 'image/jpeg');
    return uri ? { uri, release: () => revoke(uri) } : null;
  } catch {
    return null;
  }
}

/**
 * The source the upload shrink step should read (spec §3.2, review F9). The
 * image manipulator on web loads its input into an <img>: an `idb:` reference
 * or a dead object URL fails there silently and the full photo is sent. So on
 * web an inline photo is opened from its base64, and an `idb:` photo from its
 * stored bytes. The caller must `release()` it afterwards.
 */
export async function openPhotoForUpload(
  photoUri: string,
  inlineBase64: string | undefined,
): Promise<OpenedPhoto | null> {
  if (Platform.OS === 'web' && inlineBase64) {
    const { mediaType, base64 } = splitDataUrl(inlineBase64);
    const uri = objectUrlFromBase64(base64, mediaType ?? 'image/jpeg');
    return uri ? { uri, release: () => revoke(uri) } : null;
  }
  return openStoredPhoto(photoUri);
}

/**
 * Ask the browser not to clear this site's storage under pressure. Only ever
 * from a tap on the queue screen — never in the middle of a save, since
 * Firefox shows a prompt — and once per session. Chrome refuses it for a new
 * site, so nothing relies on it.
 */
export function requestPersistentStorage(): void {
  if (Platform.OS !== 'web' || persistenceRequested) return;
  persistenceRequested = true;
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage || typeof storage.persist !== 'function') return;
    storage.persist().catch(() => false);
  } catch {
    // not supported here
  }
}
