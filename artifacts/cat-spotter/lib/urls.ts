export function absoluteUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}${path}`;
}

// Ermoupoli, Syros — default map center
export const SYROS_CENTER = { latitude: 37.4444, longitude: 24.9433 };
