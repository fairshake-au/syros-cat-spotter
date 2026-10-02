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
 *    `idb:<id>`. The web build is what every tester uses, so this is a
 *    primary channel, not a preview.
 *
 * A browser that cannot keep photos durably (durablePhotos() is false: some
 * in-app browsers) keeps the photo inline in the list, as before.
 */

const PHOTOS_DIR = `${FileSystem.documentDirectory ?? ''}pending-photos`;

export const supportsPhotoFiles = Platform.OS !== 'web';

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

/** Whether the web photo store is in use here (the probe passed). */
async function webStoreInUse(): Promise<boolean> {
  return durablePhotos();
}

/**
 * Decode a photo held as base64, with or without a data-URL prefix. Throws on
 * anything that is not base64 — including "data:,", which the old camera
 * produced from an empty canvas.
 */
function decodePhoto(value: string): { bytes: Uint8Array; type: string } {
  const split = splitDataUrl(value);
  return {
    bytes: base64ToBytes(split.base64),
    type: split.mediaType ?? 'image/jpeg',
  };
}

/** Store bytes under `id`, then READ THEM BACK and check the length. */
async function saveWebPhotoBytes(
  store: PhotoStoreAdapter,
  id: string,
  bytes: Uint8Array,
  type: string,
): Promise<SavePhotoResult> {
  if (bytes.byteLength === 0) return FAILED;
  try {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    await store.putPhoto(id, { type, bytes: buffer, savedAt: Date.now() });
    const back = await store.getPhoto(id);
    // Only a verified write counts as saved.
    if (!back || back.bytes.byteLength !== bytes.byteLength) return FAILED;
    return { ok: true, ref: `${IDB_PREFIX}${id}` };
  } catch {
    return FAILED;
  }
}

/**
 * Save base64 photo bytes to the web store under `id`. Strips any data-URL
 * prefix, stores an ArrayBuffer with strict durability, then reads it back
 * and checks the length — only a verified write counts as saved.
 */
export async function saveWebPhoto(
  id: string,
  base64: string | undefined,
): Promise<SavePhotoResult> {
  const store = photoStore();
  if (!store) return UNAVAILABLE;
  if (!base64) return FAILED;
  let decoded: { bytes: Uint8Array; type: string };
  try {
    decoded = decodePhoto(base64);
  } catch {
    return FAILED;
  }
  return saveWebPhotoBytes(store, id, decoded.bytes, decoded.type);
}

// ---- The one-off move of photos already queued inline (spec §3.3) -------------

const BACKUP_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** FNV-1a, so an unchanged list is backed up once, not on every load. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Keep the saved queue text, exactly as stored, in the backups store (strict
 * durability, read back to check). True only once it is verifiably there.
 * Restoring from it is a developer action: the backup is readable from the
 * browser's storage.
 */
export async function backupQueueText(
  raw: string,
  reason: 'move' | 'unparseable',
): Promise<boolean> {
  const store = photoStore();
  if (!store) return false;
  try {
    const id = `queue-${raw.length}-${fingerprint(raw)}`;
    const existing = await store.getBackup(id);
    if (existing && existing.raw === raw) return true;
    await store.putBackup(id, { raw, savedAt: Date.now(), reason });
    const back = await store.getBackup(id);
    return !!back && back.raw === raw;
  } catch {
    return false;
  }
}

/** Backups are kept for 30 days — the queue's own stale limit. */
export async function pruneQueueBackups(): Promise<void> {
  await photoStore()
    ?.deleteBackupsSavedBefore(Date.now() - BACKUP_KEEP_MS)
    .catch(() => {});
}

/**
 * Move one inline photo into the web store, for the one-off move. Returns the
 * reference the list may now point at, or null if the item must stay inline
 * this load. THROWS if the inline value cannot be decoded — the move contains
 * that per item, so one bad photo never stops the others.
 *
 * Where strict durability is not supported, a committed write may not be on
 * disk yet: the photo is written and read back now, but the list points at it
 * only on a later load, after a second read-back finds it intact.
 */
export async function moveInlinePhotoToStore(
  localId: string,
  inlineBase64: string,
): Promise<string | null> {
  const store = photoStore();
  if (!store) return null;
  const { bytes, type } = decodePhoto(inlineBase64);
  if (bytes.byteLength === 0) return null;
  if (!store.strictDurability) {
    const earlier = await store.getPhoto(localId);
    if (earlier && earlier.bytes.byteLength === bytes.byteLength) {
      return `${IDB_PREFIX}${localId}`;
    }
    await saveWebPhotoBytes(store, localId, bytes, type);
    return null;
  }
  const saved = await saveWebPhotoBytes(store, localId, bytes, type);
  return saved.ok ? saved.ref : null;
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

/**
 * Delete a persisted photo; safe to call for missing ones.
 *
 * On native, only a file inside the app's own photos folder is ever deleted.
 * `FileSystem.deleteAsync` accepts any path — a folder is removed with its
 * contents — so a ref that arrived from anywhere else (a crafted link, a stale
 * picker-cache path) must never reach it (final review of PR #9, finding 5).
 */
export async function deletePendingPhoto(ref: string): Promise<void> {
  if (isStoredPhotoRef(ref)) {
    await photoStore()
      ?.deletePhoto(idbId(ref))
      .catch(() => {});
    return;
  }
  if (!supportsPhotoFiles) return;
  if (!isInsidePhotosDir(ref)) return;
  await FileSystem.deleteAsync(ref, { idempotent: true }).catch(() => {});
}

/**
 * Every photo this module saves is named `<key>.jpg`, and every key is made of
 * letters, digits and dashes (`<ms>-<random>`, `<localId>-r<n>`,
 * `review-<id>`). Allow only that shape. Checking for `/` and `..` was not
 * enough: the native file layer decodes the ref as a URI before deleting, so
 * `%2E%2E`, `..%2F…` or a trailing `?`/`#` would pass a text check and then
 * point outside the folder.
 */
const PHOTO_FILE_NAME = /^[A-Za-z0-9-]+\.jpg$/;

function isInsidePhotosDir(ref: string): boolean {
  const prefix = `${PHOTOS_DIR}/`;
  if (!ref.startsWith(prefix)) return false;
  return PHOTO_FILE_NAME.test(ref.slice(prefix.length));
}

/**
 * Delete the review photo kept for an online submission. The target is derived
 * from the sighting's own id — never taken from a route, which anyone can
 * craft — so resolving a review can only ever delete that review's photo.
 */
export async function deleteReviewPhoto(sightingId: number): Promise<void> {
  if (!Number.isInteger(sightingId) || sightingId <= 0) return;
  const key = reviewPhotoKey(sightingId);
  await deletePendingPhoto(
    supportsPhotoFiles ? photoPath(key) : `${IDB_PREFIX}${key}`,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Nothing unreferenced is deleted until it is at least this old. */
const ORPHAN_GRACE_MS = DAY_MS;
/** How long a review photo (`review-<sightingId>`) is kept if never resolved. */
const REVIEW_PHOTO_KEEP_MS = 7 * DAY_MS;

/** Photos kept for the review screen of an online submission (spec §3.4). */
export function reviewPhotoKey(sightingId: number): string {
  return `review-${sightingId}`;
}

function isReviewPhoto(name: string): boolean {
  return name.startsWith('review-');
}

/**
 * A cat report's photo (`report-<localId>`, SYC-42). The report queue owns
 * it and deletes it once it has been sent; this sweep, which only knows the
 * sighting queue, never touches it.
 */
function isReportPhoto(name: string): boolean {
  return name.startsWith('report-');
}

/** Before this, an unreferenced photo may be deleted. */
function deleteCutoff(name: string, now: number): number {
  return now - (isReviewPhoto(name) ? REVIEW_PHOTO_KEEP_MS : ORPHAN_GRACE_MS);
}

/**
 * Remove photos that no longer belong to any queue item.
 *
 * Never deletes anything saved in the last 24 hours — another tab, or a save
 * in flight, may have written a photo it has not listed yet — and keeps a
 * review photo (`review-*`) for seven days, unless its review is resolved
 * first. On web the age is read in the same transaction as the delete; on
 * native it is the file's modification time, read just before the delete.
 */
export async function cleanupOrphanPhotos(keepRefs: string[]): Promise<void> {
  const now = Date.now();
  if (!supportsPhotoFiles) {
    if (!(await webStoreInUse())) return;
    const store = photoStore();
    if (!store) return;
    const keep = new Set(keepRefs.filter(isStoredPhotoRef).map(idbId));
    for (const id of await store.photoIds()) {
      if (keep.has(id) || isReportPhoto(id)) continue;
      await store
        .deletePhotoIfSavedBefore(id, deleteCutoff(id, now))
        .catch(() => false);
    }
    return;
  }
  try {
    const names = await FileSystem.readDirectoryAsync(PHOTOS_DIR);
    const keep = new Set(
      keepRefs.map((u) => u.slice(u.lastIndexOf('/') + 1)),
    );
    for (const name of names) {
      if (keep.has(name) || isReportPhoto(name)) continue;
      const uri = `${PHOTOS_DIR}/${name}`;
      try {
        const info = await FileSystem.getInfoAsync(uri);
        // An age that cannot be read is never old enough to delete.
        if (!info.exists || typeof info.modificationTime !== 'number') continue;
        if (info.modificationTime * 1000 >= deleteCutoff(name, now)) continue;
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {
        // keep it
      }
    }
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
