/**
 * SYC-170 PR 1.2: which Turnstile sitekey the website uses.
 *
 * The sitekey is public (it is sent to every browser), so it lives in code,
 * not in a setting, and cannot be left unset. It is chosen by the page's own
 * host:
 *
 * - the production app hosts (an exact list) get the production key;
 * - localhost, 127.0.0.1 and Replit's dev domains get Cloudflare's published
 *   "always passes" test key, so a developer's browser never needs a real
 *   challenge;
 * - any other host gets nothing (`null`): the production widget is locked to
 *   the production hosts, so it would only show an error elsewhere.
 *
 * The server's /_challenge page does not look at the host: it falls back to the same production constant
 * (server/challenge-page.js; a test keeps the two copies equal).
 *
 * Cloudflare's other two published test keys (always fails; forces a tap) can
 * be picked on a dev host only, by saving one of them under
 * `cat-spotter/turnstile-test-key` in the browser's local storage. That is how
 * the failure and tap paths are checked by hand. A production host ignores it.
 */

/**
 * The production hosts: an exact list (SYC-662). `apptest.catspotters.com` is
 * where testers use the app today; `syros.catspotters.com` is the launch
 * address (SYC-306). Never add `catspotters.com` itself and never match by
 * suffix. The widget's hostname list and the API's TURNSTILE_HOSTNAMES must
 * name the same addresses.
 */
export const PRODUCTION_APP_HOSTS: readonly string[] = ['apptest.catspotters.com', 'syros.catspotters.com'];
export const PRODUCTION_SITEKEY = '0x4AAAAAAFXDA4oOu3qZurFj';

export const TEST_SITEKEY_PASSES = '1x00000000000000000000AA';
export const TEST_SITEKEY_FAILS = '2x00000000000000000000AB';
export const TEST_SITEKEY_INTERACTIVE = '3x00000000000000000000FF';
export const TEST_SITEKEYS: readonly string[] = [
  TEST_SITEKEY_PASSES,
  TEST_SITEKEY_FAILS,
  TEST_SITEKEY_INTERACTIVE,
];

export const TEST_KEY_STORAGE_KEY = 'cat-spotter/turnstile-test-key';

const REPLIT_DEV_SUFFIXES = ['.replit.dev', '.repl.co'];

function bareHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
}

/** A development host: localhost, 127.0.0.1, [::1] or a Replit dev domain. */
export function isDevHost(host: string): boolean {
  const h = bareHost(host);
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  return REPLIT_DEV_SUFFIXES.some((s) => h.endsWith(s));
}

export function isProductionHost(host: string): boolean {
  return PRODUCTION_APP_HOSTS.includes(bareHost(host));
}

/**
 * The sitekey for a host, or null when the host has none.
 * `testKeyOverride` is honoured only on a dev host, and only if it is one of
 * Cloudflare's three published test keys.
 */
export function sitekeyForHost(host: string, testKeyOverride?: string | null): string | null {
  if (isProductionHost(host)) return PRODUCTION_SITEKEY;
  if (isDevHost(host)) {
    return testKeyOverride && TEST_SITEKEYS.includes(testKeyOverride)
      ? testKeyOverride
      : TEST_SITEKEY_PASSES;
  }
  return null;
}
