import { Platform } from 'react-native';

/**
 * SYC-113: the pre-launch tester key built into TestFlight and Play test
 * builds (docs/superpowers/plans/syc-113-pre-launch-gates.md, item 5).
 *
 * `EXPO_PUBLIC_PRELAUNCH_KEY` is set ONLY in the EAS build environment for
 * store builds, never on Replit: EXPO_PUBLIC_* values are written into the
 * JavaScript, and the web build is public. scripts/check-web-env.js stops a
 * web build that would include it.
 *
 * Returns null on web (the website uses its password cookie) or when unset.
 */
export function prelaunchKey(): string | null {
  if (Platform.OS === 'web') return null;
  // Read as a plain member expression so Expo inlines it at build time.
  const raw = process.env.EXPO_PUBLIC_PRELAUNCH_KEY;
  const key = typeof raw === 'string' ? raw.trim() : '';
  return key ? key : null;
}
