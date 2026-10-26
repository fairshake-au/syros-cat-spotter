import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

/**
 * SYC-715: an email typed on the name screen when the server gave no answer,
 * kept on the phone until the background save adds it (hooks/useHeldEmailSaver.ts).
 * It is part of this spotter's identity: "Delete my data", "Start again" and a
 * restore all clear it (context/DeviceContext.tsx).
 */
export const HELD_EMAIL_KEY = 'cat-spotter/held-email';

let current: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Reads the saved address once per app start. */
export async function loadHeldEmail(): Promise<void> {
  if (loaded) return;
  try {
    const stored = await AsyncStorage.getItem(HELD_EMAIL_KEY);
    // A hold or clear made while this read was out wins.
    if (!loaded) {
      current = stored || null;
      loaded = true;
      emit();
    }
  } catch {
    // unreadable storage: treated as nothing held
  }
}

export async function holdEmail(email: string): Promise<void> {
  current = email;
  loaded = true;
  emit();
  try {
    await AsyncStorage.setItem(HELD_EMAIL_KEY, email);
  } catch {
    // kept in memory for this run
  }
}

export async function clearHeldEmail(): Promise<void> {
  current = null;
  loaded = true;
  emit();
  try {
    await AsyncStorage.removeItem(HELD_EMAIL_KEY);
  } catch {
    // nothing to remove
  }
}

/** The address waiting to be saved, right now (not from a render), or null. */
export function heldEmailNow(): string | null {
  return current;
}

/** The address waiting to be saved, or null. */
export function useHeldEmail(): string | null {
  useEffect(() => { void loadHeldEmail(); }, []);
  return useSyncExternalStore(subscribe, () => current, () => current);
}

/** Tests only: forget the held address, as a fresh app start would. */
export function resetHeldEmailForTests() {
  current = null;
  loaded = false;
}
