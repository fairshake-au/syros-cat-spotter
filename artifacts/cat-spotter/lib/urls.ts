import type { ImageSource } from 'expo-image';
import { prelaunchKey } from './prelaunch';

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

// SYC-98: photoUrl is null for a cat/sighting with no real photo yet (the
// primaryPhotoId: 0 sentinel routes/cats.ts uses for a resident-registered
// cat) — undefined here so an <Image source={{ uri }}> just renders nothing
// rather than requesting a URL that can't exist. Overloaded so a caller
// passing a literal non-null path (signInUrl, below) still gets a plain
// `string` back, not `string | undefined`.
export function absoluteUrl(path: string): string;
export function absoluteUrl(path: null): undefined;
export function absoluteUrl(path: string | null): string | undefined;
export function absoluteUrl(path: string | null): string | undefined {
  if (path === null) return undefined;
  if (path.startsWith('http')) return path;
  return `${apiOrigin()}${path}`;
}

/**
 * The website's sign-in page, carrying `?next=` so a successful sign-in
 * lands back where the user was (SYC-121 review fix). `next` is the app's
 * current in-app path, not a full URL — the server's `safeNext` only
 * accepts a same-site path.
 */
export function signInUrl(next: string): string {
  return absoluteUrl(`/_gate/login?next=${encodeURIComponent(next)}`);
}

/**
 * The image source for a photo from our API (SYC-113 item 5).
 *
 * Image loads don't go through customFetch, so on iOS and Android the tester
 * key is sent as an image header (expo-image sends `source.headers` there).
 * On web the headers are left off on purpose: expo-image on web would switch
 * to a script fetch that needs CORS, and the browser already sends the
 * website cookie with a plain same-origin image load.
 *
 * The key only goes to our own API origin, never to another host.
 *
 * SYC-98: `path` is null for a cat/sighting with no real photo yet — an
 * empty source (no `uri`) so <Image> just renders its placeholder/nothing.
 */
export function photoSource(path: string | null): ImageSource {
  const uri = absoluteUrl(path);
  if (!uri) return {};
  const key = prelaunchKey();
  if (key && uri.startsWith(`${apiOrigin()}/`)) {
    return { uri, headers: { 'X-Prelaunch-Key': key } };
  }
  return { uri };
}

// Ermoupoli, Syros — default map center
export const SYROS_CENTER = { latitude: 37.4444, longitude: 24.9433 };
