export function absoluteUrl(path: string): string {
  if (path.startsWith('http')) return path;
  // On web the API is same-origin (the deployment serves both the site and
  // /api), so prefer the page's own origin over a baked-in domain.
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}${path}`;
}

// Ermoupoli, Syros — default map center
export const SYROS_CENTER = { latitude: 37.4444, longitude: 24.9433 };
