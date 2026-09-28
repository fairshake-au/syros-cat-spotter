/**
 * An in-memory fake of the web photo store's adapter interface
 * (lib/webPhotoStore.ts), so the store's callers can be tested without
 * IndexedDB and without a new dependency (spec §6).
 *
 * It behaves as the real adapter promises to — bytes are copied in and out,
 * `deletePhotoIfSavedBefore` checks `savedAt` at the moment of deletion — and
 * it can be told to fail in the ways real browsers do.
 */
import type {
  PhotoStoreAdapter,
  StoredBackup,
  StoredPhoto,
} from '../webPhotoStore';

export interface FakePhotoStoreFaults {
  /** putPhoto throws (a quota error) for these ids. */
  failPut?: (id: string) => boolean;
  /** putPhoto "succeeds" but keeps a byte short, so a read-back disagrees. */
  truncatePut?: (id: string) => boolean;
  /** getPhoto throws for these ids. */
  failGet?: (id: string) => boolean;
  /** putBackup throws. */
  failBackup?: boolean;
  /** Awaited inside putPhoto before anything is stored — holds a write open. */
  beforePut?: (id: string) => Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The bytes of a plain ASCII string, as an ArrayBuffer. */
export function textBytes(text: string): ArrayBuffer {
  return encoder.encode(text).buffer as ArrayBuffer;
}

/** base64 of a plain ASCII string — a stand-in for a photo's base64. */
export function b64(text: string): string {
  return btoa(text);
}

export function createFakePhotoStore(options: { strictDurability?: boolean } = {}) {
  const photos = new Map<string, StoredPhoto>();
  const backups = new Map<string, StoredBackup>();
  const faults: FakePhotoStoreFaults = {};
  const calls = {
    putPhoto: [] as string[],
    deletePhoto: [] as string[],
    putBackup: [] as string[],
  };

  const adapter: PhotoStoreAdapter = {
    strictDurability: options.strictDurability ?? true,
    async putPhoto(id, photo) {
      calls.putPhoto.push(id);
      if (faults.beforePut) await faults.beforePut(id);
      if (faults.failPut?.(id)) {
        const error = new Error('The quota has been exceeded.');
        error.name = 'QuotaExceededError';
        throw error;
      }
      const length = photo.bytes.byteLength;
      const bytes = faults.truncatePut?.(id)
        ? photo.bytes.slice(0, Math.max(0, length - 1))
        : photo.bytes.slice(0);
      photos.set(id, { ...photo, bytes });
    },
    async getPhoto(id) {
      if (faults.failGet?.(id)) {
        const error = new Error('An internal error was encountered.');
        error.name = 'UnknownError';
        throw error;
      }
      const photo = photos.get(id);
      return photo ? { ...photo, bytes: photo.bytes.slice(0) } : undefined;
    },
    async deletePhoto(id) {
      calls.deletePhoto.push(id);
      photos.delete(id);
    },
    async photoIds() {
      return [...photos.keys()];
    },
    async deletePhotoIfSavedBefore(id, cutoff) {
      const photo = photos.get(id);
      if (photo && photo.savedAt < cutoff) {
        photos.delete(id);
        return true;
      }
      return false;
    },
    async putBackup(id, backup) {
      calls.putBackup.push(id);
      if (faults.failBackup) {
        const error = new Error('The quota has been exceeded.');
        error.name = 'QuotaExceededError';
        throw error;
      }
      backups.set(id, { ...backup });
    },
    async getBackup(id) {
      const backup = backups.get(id);
      return backup ? { ...backup } : undefined;
    },
    async deleteBackupsSavedBefore(cutoff) {
      for (const [id, backup] of backups) {
        if (backup.savedAt < cutoff) backups.delete(id);
      }
    },
  };

  return {
    adapter,
    photos,
    backups,
    faults,
    calls,
    /** Put a photo straight into the store, as if saved earlier. */
    seed(id: string, text: string, savedAt = Date.now(), type = 'image/jpeg') {
      photos.set(id, { type, bytes: textBytes(text), savedAt });
    },
    /** The stored photo's bytes as text, or undefined if it is not there. */
    text(id: string): string | undefined {
      const photo = photos.get(id);
      return photo ? decoder.decode(photo.bytes) : undefined;
    },
  };
}

export type FakePhotoStore = ReturnType<typeof createFakePhotoStore>;

/**
 * A working localStorage. Under Node 26 the jsdom one is shadowed by Node's
 * own experimental global, which is unavailable without a flag — so web tests
 * install this. `broken: true` gives one that throws, like a WebView with DOM
 * storage switched off.
 */
export function memoryLocalStorage(options: { broken?: boolean } = {}): Storage {
  const values = new Map<string, string>();
  const refuse = () => {
    const error = new Error('Access is denied for this document.');
    error.name = 'SecurityError';
    throw error;
  };
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => (options.broken ? refuse() : (values.get(key) ?? null)),
    setItem: (key: string, value: string) => {
      if (options.broken) refuse();
      values.set(key, String(value));
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
