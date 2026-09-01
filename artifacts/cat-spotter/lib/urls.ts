/**
 * Origin the app talks to.
 *
 * Normally derived from the Replit dev/deploy domain, which is always https.
 * `EXPO_PUBLIC_API_URL` overrides it outright so a local build can point at a
 * plain-http API (`http://localhost:3001`) — without it there is no way to run
 * the app against a local server, since the scheme was hardcoded.
 */
export function apiOrigin(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit && explicit.trim() !== '') return explicit.trim().replace(/\/+$/, '');
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
}

export function absoluteUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${apiOrigin()}${path}`;
}

// Ermoupoli, Syros — default map center
export const SYROS_CENTER = { latitude: 37.4444, longitude: 24.9433 };
