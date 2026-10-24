/**
 * The spotter's location choice, remembered on this phone (SYC-524):
 * 'shared' = they let the app use their location, 'map' = they chose to pick
 * a spot on the map instead. null = not chosen yet.
 */
export type LocationChoice = 'map' | 'shared' | null;

export const LOCATION_CHOICE_KEY = 'cat-spotter/location-choice';

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export async function readLocationChoice(storage: Storage): Promise<LocationChoice> {
  try {
    const v = await storage.getItem(LOCATION_CHOICE_KEY);
    return v === 'map' || v === 'shared' ? v : null;
  } catch {
    // A store we can't read just means no remembered choice.
    return null;
  }
}

export async function writeLocationChoice(
  storage: Storage,
  choice: 'map' | 'shared',
): Promise<void> {
  try {
    await storage.setItem(LOCATION_CHOICE_KEY, choice);
  } catch {
    // Not worth an error: the choice is asked again next time.
  }
}

export async function clearLocationChoice(storage: Storage): Promise<void> {
  await storage.removeItem(LOCATION_CHOICE_KEY);
}
