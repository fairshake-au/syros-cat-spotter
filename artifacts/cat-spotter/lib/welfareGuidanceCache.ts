/**
 * The injured-cat advice and vet list, as the app sees them (SYC-42 plan,
 * Slice 1 items 1.10 and 1.14; Decision 6).
 *
 * Order of preference:
 *  1. the last version downloaded from GET /api/welfare/guidance (so a fixed
 *     phone number reaches people without an app release);
 *  2. the copy built into the app (@workspace/welfare-guidance), so the advice
 *     shows with no signal, even the first time the app is ever opened
 *     offline.
 *
 * A copy whose schemaVersion this app doesn't know is ignored, never shown:
 * a future file shape can't break the advice on an older app.
 *
 * Framework-free so it is unit-testable; the screen passes AsyncStorage and
 * the API call in.
 */
import {
  GUIDANCE_SCHEMA_VERSION,
  getGuidance,
  type GuidanceLanguage,
  type WelfareGuidance,
} from '@workspace/welfare-guidance';

export const GUIDANCE_STORAGE_PREFIX = 'cat-spotter/welfare-guidance/';

export interface GuidanceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type LoadedGuidance = WelfareGuidance & { source: 'saved' | 'built-in' };

/**
 * True when `value` has every key `shape` has, with the same kind of value
 * (string, number, boolean, list or object), all the way down. Extra keys
 * are fine; a missing or mistyped one is not.
 */
function hasShape(value: unknown, shape: unknown): boolean {
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return false;
    // A list the built-in copy fills (the steps, say) can't arrive empty.
    if (shape.length && !value.length) return false;
    return value.every((v) => (shape.length ? hasShape(v, shape[0]) : true));
  }
  if (shape && typeof shape === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const v = value as Record<string, unknown>;
    return Object.entries(shape as Record<string, unknown>).every(
      ([k, s]) => k in v && hasShape(v[k], s),
    );
  }
  if (shape === null) return true;
  // Nor can a line the built-in copy has (the capacity line, say) arrive blank.
  if (typeof shape === 'string' && shape.trim() && typeof value === 'string') return value.trim() !== '';
  return typeof value === typeof shape;
}

/**
 * Never render a copy that is malformed, foreign, or missing anything this
 * app shows: it must match the built-in copy's shape, key for key. A served
 * file from an older (or newer) API that lacks a field falls back to the
 * built-in copy rather than crashing the screen (found in the 2 Oct 2026
 * browser check). Optional notes (`locked`, `coordinates`) are not required.
 */
export function isUsableGuidance(value: unknown, language: GuidanceLanguage): value is WelfareGuidance {
  if (!value || typeof value !== 'object') return false;
  const g = value as Partial<WelfareGuidance>;
  if (g.schemaVersion !== GUIDANCE_SCHEMA_VERSION || g.language !== language || typeof g.version !== 'string') {
    return false;
  }
  const built = getGuidance(language);
  const { locked: _locked, ...urgentShape } = built.copy.urgent;
  const copyShape = { ...built.copy, urgent: urgentShape };
  const vetShape = built.vets.map(({ coordinates: _c, ...rest }) => rest)[0];
  return (
    hasShape(g.copy, copyShape) &&
    Array.isArray(g.vets) &&
    g.vets.length > 0 &&
    g.vets.every((v) => hasShape(v, vetShape)) &&
    hasShape(g.municipality, built.municipality)
  );
}

export function builtInGuidance(language: GuidanceLanguage): LoadedGuidance {
  return { ...getGuidance(language), source: 'built-in' };
}

export async function loadGuidance(
  language: GuidanceLanguage,
  storage: GuidanceStorage,
): Promise<LoadedGuidance> {
  try {
    const raw = await storage.getItem(`${GUIDANCE_STORAGE_PREFIX}${language}`);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isUsableGuidance(parsed, language)) return { ...parsed, source: 'saved' };
    }
  } catch {
    // Unreadable storage is the same as nothing saved.
  }
  return builtInGuidance(language);
}

/**
 * Fetch the served copy and keep it. Returns null (and changes nothing) on
 * any failure, including a copy this app can't read.
 */
export async function refreshGuidance(
  language: GuidanceLanguage,
  storage: GuidanceStorage,
  fetchGuidance: (language: GuidanceLanguage) => Promise<unknown>,
): Promise<LoadedGuidance | null> {
  let served: unknown;
  try {
    served = await fetchGuidance(language);
  } catch {
    return null;
  }
  if (!isUsableGuidance(served, language)) return null;
  try {
    await storage.setItem(`${GUIDANCE_STORAGE_PREFIX}${language}`, JSON.stringify(served));
  } catch {
    // Still use it this session.
  }
  return { ...served, source: 'saved' };
}
