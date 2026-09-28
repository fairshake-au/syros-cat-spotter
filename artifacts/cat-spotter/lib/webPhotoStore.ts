/**
 * Where the web build keeps queued photos (spec §3.2): IndexedDB, which holds
 * hundreds of megabytes, instead of inline base64 in localStorage, which holds
 * about 5 MB — one full-size phone photo.
 *
 * The raw IndexedDB API behind a small adapter interface, so that tests (and
 * anything else) can use an in-memory fake. No dependency.
 *
 * Database `cat-spotter`, version 1:
 *  - `photos`, keyed by photo id: `{ type, bytes: ArrayBuffer, savedAt }`.
 *    Plain bytes, not base64 (a third larger) and not Blobs (a history of
 *    storage failures in Safari and in-app browsers).
 *  - `backups`, keyed by backup id: `{ raw, savedAt, reason }` — the saved
 *    queue text exactly as it was, kept before anything is moved (§3.3).
 */

export interface StoredPhoto {
  type: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

export interface StoredBackup {
  raw: string;
  savedAt: number;
  /** Why it was taken: before a move, or because the list could not be parsed. */
  reason: 'move' | 'unparseable';
}

export interface PhotoStoreAdapter {
  /**
   * Whether writes can ask for `{ durability: 'strict' }` — flushed to disk
   * before `complete`, not merely committed.
   */
  readonly strictDurability: boolean;
  /** Resolves only once the write transaction has completed. */
  putPhoto(id: string, photo: StoredPhoto): Promise<void>;
  getPhoto(id: string): Promise<StoredPhoto | undefined>;
  deletePhoto(id: string): Promise<void>;
  photoIds(): Promise<string[]>;
  /**
   * Delete the photo only if it was saved before `cutoff`, reading `savedAt`
   * in the SAME transaction as the delete — so a photo re-saved a moment ago
   * is never deleted on the strength of an older reading.
   */
  deletePhotoIfSavedBefore(id: string, cutoff: number): Promise<boolean>;
  putBackup(id: string, backup: StoredBackup): Promise<void>;
  getBackup(id: string): Promise<StoredBackup | undefined>;
  deleteBackupsSavedBefore(cutoff: number): Promise<void>;
}

const DB_NAME = 'cat-spotter';
const DB_VERSION = 1;
const PHOTOS = 'photos';
const BACKUPS = 'backups';

/** An IndexedDB call that never settles must not hold the app hostage. */
const OPEN_TIMEOUT_MS = 5_000;
const OPERATION_TIMEOUT_MS = 15_000;

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms} ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Decode base64 to bytes. Throws on anything that is not base64. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function supportsStrictDurability(): boolean {
  return (
    typeof IDBTransaction !== 'undefined' &&
    'durability' in IDBTransaction.prototype
  );
}

export function createIndexedDbPhotoStore(
  factory: IDBFactory,
): PhotoStoreAdapter {
  const strictDurability = supportsStrictDurability();
  let dbPromise: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    if (!dbPromise) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(PHOTOS)) db.createObjectStore(PHOTOS);
          if (!db.objectStoreNames.contains(BACKUPS)) db.createObjectStore(BACKUPS);
        };
        request.onsuccess = () => {
          const db = request.result;
          // A future version in another tab must not be blocked by this one.
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          db.onclose = () => {
            dbPromise = null;
          };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
      });
      dbPromise = withTimeout(opening, OPEN_TIMEOUT_MS, 'Opening IndexedDB');
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  }

  async function write(
    storeName: string,
    body: (store: IDBObjectStore) => void,
  ): Promise<void> {
    const db = await open();
    const transaction = strictDurability
      ? db.transaction(storeName, 'readwrite', { durability: 'strict' })
      : db.transaction(storeName, 'readwrite');
    const done = transactionDone(transaction);
    body(transaction.objectStore(storeName));
    await withTimeout(done, OPERATION_TIMEOUT_MS, 'IndexedDB write');
  }

  async function read<T>(
    storeName: string,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await open();
    const transaction = db.transaction(storeName, 'readonly');
    return withTimeout(
      requestResult(body(transaction.objectStore(storeName))),
      OPERATION_TIMEOUT_MS,
      'IndexedDB read',
    );
  }

  return {
    strictDurability,
    putPhoto: (id, photo) => write(PHOTOS, (store) => store.put(photo, id)),
    getPhoto: async (id) =>
      (await read<StoredPhoto | undefined>(PHOTOS, (store) => store.get(id))) ??
      undefined,
    deletePhoto: (id) => write(PHOTOS, (store) => store.delete(id)),
    photoIds: async () =>
      (await read<IDBValidKey[]>(PHOTOS, (store) => store.getAllKeys())).map(
        String,
      ),
    async deletePhotoIfSavedBefore(id, cutoff) {
      let deleted = false;
      await write(PHOTOS, (store) => {
        const request = store.get(id);
        request.onsuccess = () => {
          const photo = request.result as StoredPhoto | undefined;
          if (photo && typeof photo.savedAt === 'number' && photo.savedAt < cutoff) {
            store.delete(id);
            deleted = true;
          }
        };
      });
      return deleted;
    },
    putBackup: (id, backup) => write(BACKUPS, (store) => store.put(backup, id)),
    getBackup: async (id) =>
      (await read<StoredBackup | undefined>(BACKUPS, (store) => store.get(id))) ??
      undefined,
    deleteBackupsSavedBefore: (cutoff) =>
      write(BACKUPS, (store) => {
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const backup = cursor.value as StoredBackup | undefined;
          if (backup && typeof backup.savedAt === 'number' && backup.savedAt < cutoff) {
            cursor.delete();
          }
          cursor.continue();
        };
      }),
  };
}
