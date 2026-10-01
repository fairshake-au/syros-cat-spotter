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

/** Enough of a check that a malformed or foreign copy is never rendered. */
export function isUsableGuidance(value: unknown, language: GuidanceLanguage): value is WelfareGuidance {
  if (!value || typeof value !== 'object') return false;
  const g = value as Partial<WelfareGuidance>;
  return (
    g.schemaVersion === GUIDANCE_SCHEMA_VERSION &&
    g.language === language &&
    typeof g.version === 'string' &&
    !!g.copy?.urgent?.intro &&
    !!g.copy?.urgent?.capacity &&
    Array.isArray(g.copy?.urgent?.steps) &&
    !!g.copy?.attention?.heading &&
    !!g.copy?.litter?.heading &&
    !!g.copy?.confirmation?.sentHeading &&
    !!g.copy?.vetList?.phoneKinds &&
    Array.isArray(g.vets) &&
    g.vets.length > 0 &&
    !!g.municipality?.phone?.tel
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
