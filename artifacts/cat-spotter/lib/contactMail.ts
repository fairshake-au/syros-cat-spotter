import { TRANSLATIONS, type Language } from './i18n';

export const CONTACT_EMAIL = 'hello@catspotters.com';

/** "iOS", "Android" or "web" for the email's footer line. */
export function platformLabel(platform: string): string {
  if (platform === 'ios') return 'iOS';
  if (platform === 'android') return 'Android';
  return platform;
}

/**
 * The "Email us" address (spec §3.4). Subject in the app's language; body is
 * two blank lines and then the app version and platform, nothing else: no
 * device id, no location, no spotter name.
 *
 * encodeURIComponent, not URLSearchParams: iOS Mail shows URLSearchParams'
 * "+" signs for spaces.
 */
export function contactMailto(lang: Language, version: string, platform: string): string {
  const subject = TRANSLATIONS[lang].helpContactSubject;
  const body = `\n\nApp ${version} · ${platformLabel(platform)}`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
