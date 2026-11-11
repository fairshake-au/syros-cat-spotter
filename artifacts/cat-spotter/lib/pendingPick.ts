/**
 * SYC-864: Android can close the app while the phone's camera (or photo
 * library) is open, when memory runs short. The picker keeps the photo, and
 * `ImagePicker.getPendingResultAsync()` hands it over once the app is back.
 *
 * The picker doesn't say which button started the pick, so the Spot screen
 * notes it here before opening the camera or library. A recovered library
 * photo then still gets the library's checks (too old, already logged).
 * A pending photo with no note didn't start from the Spot buttons (the
 * "replace a refused photo" path, say) and is left alone.
 */
export const PENDING_PICK_KEY = 'cat-spotter/pending-pick';

export type PickKind = 'camera' | 'library';

interface PickStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** The picker's answer, narrowed to what this file reads. */
type PendingAnswer =
  | { canceled: boolean; assets: readonly unknown[] | null }
  | { code: string; message: string }
  | null;

export async function markPickStarted(storage: PickStorage, kind: PickKind): Promise<void> {
  try {
    await storage.setItem(PENDING_PICK_KEY, kind);
  } catch {
    // Without the note a lost photo just can't be recovered; the pick goes on.
  }
}

export async function clearPickMark(storage: PickStorage): Promise<void> {
  try {
    await storage.removeItem(PENDING_PICK_KEY);
  } catch {
    // A stale note is harmless: it is only read alongside a pending photo.
  }
}

/**
 * The photo Android kept while the app was closed, with which button started
 * it, or null. With no note the picker isn't asked at all.
 */
export async function takePendingPick<A>(
  storage: PickStorage,
  getPending: () => Promise<PendingAnswer>,
): Promise<{ kind: PickKind; asset: A } | null> {
  try {
    // Read the note first: collecting the photo takes it from the picker, so
    // a photo started elsewhere (a face or body photo) is left alone.
    const kind = await storage.getItem(PENDING_PICK_KEY);
    if (kind !== 'camera' && kind !== 'library') return null;
    await clearPickMark(storage);
    const answer = await getPending();
    if (!answer || !('canceled' in answer) || answer.canceled) return null;
    const asset = answer.assets?.[0];
    return asset ? { kind, asset: asset as A } : null;
  } catch {
    return null;
  }
}
