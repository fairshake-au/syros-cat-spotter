import { emptyRecord, type WaitingRecord } from './waitingCard';

/**
 * The waiting card's record on the phone (or in this browser on the website):
 * one per device id, under its own versioned key (starter-facts.md §3.4, plan
 * PR 1). Never sent to the server. Best effort: every read and write is in
 * try/catch, and an unreadable record is reported as `null`, so the card shows
 * a fact (never the nudge) and saves nothing for that wait.
 */

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

export const WAITING_CARD_KEY_PREFIX = 'catSpotters.waitingCard.v1:';

export function waitingCardKey(deviceId: string): string {
  return `${WAITING_CARD_KEY_PREFIX}${deviceId}`;
}

function isRecord(value: unknown): value is WaitingRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  return (
    r.v === 1 &&
    typeof r.nudgeCounted === 'boolean' &&
    typeof r.tapped === 'boolean' &&
    strings(r.seenFacts) &&
    strings(r.everSeen) &&
    strings(r.order)
  );
}

/** The record; a fresh one if there's none yet; null if it can't be read. */
export async function loadWaitingRecord(store: KeyValueStore, deviceId: string): Promise<WaitingRecord | null> {
  try {
    const raw = await store.getItem(waitingCardKey(deviceId));
    if (raw === null) return emptyRecord();
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? { ...emptyRecord(), ...parsed } : null;
  } catch {
    return null;
  }
}

/** Saves the record; a failure is swallowed (the card is a bonus). */
export async function saveWaitingRecord(store: KeyValueStore, deviceId: string, record: WaitingRecord): Promise<void> {
  try {
    await store.setItem(waitingCardKey(deviceId), JSON.stringify(record));
  } catch {
    // Best effort.
  }
}

/** "Delete my data": every waiting-card record on this phone. */
export async function clearWaitingRecords(store: KeyValueStore): Promise<void> {
  const keys = (await store.getAllKeys()).filter((k) => k.startsWith(WAITING_CARD_KEY_PREFIX));
  if (keys.length) await store.multiRemove(keys);
}
