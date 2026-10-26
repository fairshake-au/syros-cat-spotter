import { Platform } from 'react-native';

/**
 * "Open in Cat Spotters" on the website's restore page (SYC-137, SYC-3 plan
 * Slice 2 item 2). In a phone's browser it opens the installed app at
 * `syroscatspotters://restore?t=…` (the scheme in app.json), and the app runs
 * the same peek → button → redeem flow with its own device id.
 *
 * Off until SYC-596 has checked it on a real TestFlight and Play build:
 * before the store apps exist the button would lead nowhere. Set
 * EXPO_PUBLIC_OPEN_IN_APP=on on the website build to show it.
 *
 * The token travels in the custom-scheme URL, which goes to the operating
 * system and never to a server. Opening the app only peeks; the page here
 * stays as it was, so a failed hand-over leaves the browser flow working.
 */
const RESTORE_SCHEME_URL = 'syroscatspotters://restore';

export function openInAppOn(): boolean {
  // Written as a literal so Expo inlines it into the bundle.
  return process.env.EXPO_PUBLIC_OPEN_IN_APP === 'on';
}

/** An iPhone, iPad or Android browser: the only places the app can be. */
export function isPhoneBrowser(userAgent: string): boolean {
  return /iPhone|iPad|iPod|Android/i.test(userAgent || '');
}

export function openInAppUrl(token: string): string {
  return `${RESTORE_SCHEME_URL}?t=${encodeURIComponent(token)}`;
}

/** Whether the restore page should offer the button, given what it can see. */
export function shouldOfferOpenInApp(token: string | null, userAgent: string): boolean {
  return Platform.OS === 'web' && openInAppOn() && Boolean(token) && isPhoneBrowser(userAgent);
}
