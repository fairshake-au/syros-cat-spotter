/**
 * The photos this device has recently logged (SYC-166 slice 2, Decision 2 B).
 *
 * The server treats a second sighting from the same device at the same
 * instant as a repeat: it returns the first and never stores the second
 * photo. Once a library photo carries its own time, two different photos
 * from one second would collide, so the second is moved on by a millisecond
 * (`uniqueCaptureTime`). The same photo picked twice is stopped on the phone
 * instead ("You've already logged this photo").
 *
 * A small capped list in its own storage key: capture times, a cheap
 * fingerprint of the photo, and where the sighting went. Never a position
 * (plan P12). It is deliberately not built on queueStore.ts, and Delete my
 * data clears it.
 *
 * An entry is written only once a send or a save-for-later has succeeded, so
 * the retry of a send that half-arrived recomputes the same time and the
 * server's own repeat protection still catches it.
 */

export const RECENT_PHOTOS_KEY = 'cat-spotter/recent-photos-v1';
export const RECENT_PHOTOS_MAX = 200;
const RECENT_PHOTOS_MAX_AGE_MS = 30 * 86_400_000;

/** The first 64 KB of the photo, as base64 characters. */
const FINGERPRINT_CHARS = Math.ceil((64 * 1024) / 3) * 4;

export interface RecentPhoto {
  capturedAtMs: number;
  /** Absent for a camera photo, or one the server said is not a cat. */
  fingerprint?: string;
  /** A saved-for-later card. */
  localId?: string;
  sightingId?: number;
  /** Set once the sighting is matched to a cat (Decision C2). */
  catId?: number;
}

export interface RecentPhotoStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** File size plus an FNV-1a hash of the first 64 KB, from the picker's base64. */
export function photoFingerprint(base64: string): string {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((base64.length * 3) / 4) - padding;
  let hash = 0x811c9dc5;
  const end = Math.min(base64.length, FINGERPRINT_CHARS);
  for (let i = 0; i < end; i++) {
    hash ^= base64.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${bytes}:${hash.toString(16).padStart(8, '0')}`;
}

/** Only the known fields, each only if well-formed. */
function clean(value: unknown): RecentPhoto | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.capturedAtMs !== 'number' || !Number.isFinite(v.capturedAtMs)) return null;
  const out: RecentPhoto = { capturedAtMs: v.capturedAtMs };
  if (typeof v.fingerprint === 'string') out.fingerprint = v.fingerprint;
  if (typeof v.localId === 'string') out.localId = v.localId;
  if (typeof v.sightingId === 'number' && Number.isInteger(v.sightingId)) out.sightingId = v.sightingId;
  if (typeof v.catId === 'number' && Number.isInteger(v.catId)) out.catId = v.catId;
  return out;
}

function prune(list: RecentPhoto[], now: number): RecentPhoto[] {
  return list
    .filter((e) => now - e.capturedAtMs <= RECENT_PHOTOS_MAX_AGE_MS)
    .sort((a, b) => a.capturedAtMs - b.capturedAtMs)
    .slice(-RECENT_PHOTOS_MAX);
}

/** The list as stored, pruned. Never throws: anything unreadable is empty. */
export async function loadRecentPhotos(
  storage: RecentPhotoStorage,
  now: number,
): Promise<RecentPhoto[]> {
  try {
    const raw = await storage.getItem(RECENT_PHOTOS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return prune(
      parsed.map(clean).filter((e): e is RecentPhoto => e !== null),
      now,
    );
  } catch {
    return [];
  }
}

async function save(storage: RecentPhotoStorage, list: RecentPhoto[]): Promise<void> {
  try {
    await storage.setItem(RECENT_PHOTOS_KEY, JSON.stringify(list));
  } catch {
    // Losing this list only loses the same-second fix; never block a sighting.
  }
}

/** Adds an entry. Never throws. */
export async function recordRecentPhoto(
  storage: RecentPhotoStorage,
  entry: RecentPhoto,
  now: number,
): Promise<void> {
  const cleaned = clean(entry);
  if (!cleaned) return;
  const list = await loadRecentPhotos(storage, now);
  await save(storage, prune([...list, cleaned], now));
}

/** Records which cat a sighting was matched to. Never throws. */
export async function linkRecentPhotoToCat(
  storage: RecentPhotoStorage,
  sighting: { sightingId: number; localId?: string },
  catId: number,
  now: number,
): Promise<void> {
  const list = await loadRecentPhotos(storage, now);
  let changed = false;
  const next = list.map((e) => {
    const same =
      e.sightingId === sighting.sightingId ||
      (sighting.localId !== undefined && e.localId === sighting.localId);
    if (!same) return e;
    changed = true;
    return { ...e, sightingId: sighting.sightingId, catId };
  });
  if (changed) await save(storage, next);
}

/** Delete my data. */
export async function clearRecentPhotos(storage: RecentPhotoStorage): Promise<void> {
  await storage.removeItem(RECENT_PHOTOS_KEY);
}

/**
 * The capture time to send: unchanged unless a recent sighting from this
 * device has that exact instant, in which case one millisecond later, and so
 * on. Same input, same list, same answer, so a retry sends the same value.
 */
export function uniqueCaptureTime(instantMs: number, list: RecentPhoto[]): number {
  const taken = new Set(list.map((e) => e.capturedAtMs));
  let t = instantMs;
  while (taken.has(t)) t += 1;
  return t;
}

/**
 * What to record after a submit, or nothing. A photo the server said is not a
 * cat keeps its time (the server stored a sighting at it) but not its
 * fingerprint, so the spotter can pick it again (review M5).
 */
export function entryForOutcome(
  kind: 'sent' | 'saved' | 'rejected' | 'send-failed' | 'save-failed' | 'not-saved',
  capturedAtMs: number,
  fingerprint: string | undefined,
  info: { sightingId?: number; isCatPhoto?: boolean; localId?: string },
): RecentPhoto | null {
  if (kind === 'sent') {
    const entry: RecentPhoto = { capturedAtMs };
    if (info.sightingId !== undefined) entry.sightingId = info.sightingId;
    if (fingerprint && info.isCatPhoto !== false) entry.fingerprint = fingerprint;
    return entry;
  }
  if (kind === 'saved') {
    const entry: RecentPhoto = { capturedAtMs };
    if (fingerprint) entry.fingerprint = fingerprint;
    if (info.localId !== undefined) entry.localId = info.localId;
    return entry;
  }
  return null;
}

/**
 * The entry for this photo if it has been logged and is still somewhere: sent
 * (it has a sighting), or a saved-for-later card that is still waiting. A
 * card that was discarded no longer counts.
 */
export function findAlreadyLogged(
  fingerprint: string,
  list: RecentPhoto[],
  pendingLocalIds: Set<string>,
): RecentPhoto | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.fingerprint !== fingerprint) continue;
    if (e.sightingId !== undefined || e.catId !== undefined) return e;
    if (e.localId !== undefined && pendingLocalIds.has(e.localId)) return e;
  }
  return null;
}

export type AlreadyLoggedDestination =
  | { kind: 'cat'; catId: number }
  | { kind: 'review'; localId: string };

/**
 * Where "Open that sighting" goes (Decision C2): the cat's page once matched,
 * or the waiting card's review. A card still waiting to be sent is on the
 * same screen, and a sent sighting not yet matched has nowhere to open, so
 * neither gets a button.
 */
export function alreadyLoggedDestination(
  entry: RecentPhoto,
  pending: { localId: string; status: string }[],
): AlreadyLoggedDestination | null {
  if (entry.catId !== undefined) return { kind: 'cat', catId: entry.catId };
  const card = entry.localId !== undefined
    ? pending.find((p) => p.localId === entry.localId)
    : undefined;
  if (card?.status === 'review') return { kind: 'review', localId: card.localId };
  return null;
}
