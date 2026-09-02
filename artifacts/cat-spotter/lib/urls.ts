/**
 * Origin the app talks to.
 *
 * Priority:
 * 1. `EXPO_PUBLIC_API_URL` overrides outright, so a local build can point at
 *    a plain-http API (`http://localhost:3001`).
 * 2. On web, the page's own origin: the deployment serves the site and /api
 *    together, so the same bundle works on any domain (dev preview,
 *    password-protected staging, the final custom domain).
 * 3. Native builds fall back to the domain baked in at build time.
 */
export function apiOrigin(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit && explicit.trim() !== '') return explicit.trim().replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
}

export function absoluteUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${apiOrigin()}${path}`;
}

// Ermoupoli, Syros — default map center
export const SYROS_CENTER = { latitude: 37.4444, longitude: 24.9433 };
