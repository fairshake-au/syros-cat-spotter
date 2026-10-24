import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { RestoreChooser } from '@/components/keepSafe/RestoreChooser';
import { RESTORE_TOKEN_SESSION_KEY } from '@/lib/keepSafe';

/**
 * The page a restore link opens (SYC-3 plan, Slice 1 step 8). An app route, so
 * it uses this browser's own device id and secret: the spots move to the phone
 * that presses the button.
 *
 * SYC-3 Decision 12 (Samuel, 11–12 Oct 2026): the link works on whichever
 * phone opens it, with advice so the spots land in the right place:
 * - opened on the phone that asked: one tap, as before;
 * - inside another app's built-in browser: a warning first (advice, never a
 *   block);
 * - on another phone or browser: "Is this the app or browser … uses for Cat
 *   Spotters?" first;
 * - on the phone that already is that spotter: "already on this phone".
 *
 * 1. The token arrives in the URL fragment (`#t=`), or after a website sign-in
 *    from sessionStorage (the password page keeps it there), or as `?t=` from
 *    a link sent before this change. It's held in memory and taken out of the
 *    address bar and history at once (review finding 3). Through the router
 *    too: Expo Router keeps the URL in step with its own params.
 * 2. `peek`s: lists the spotters this link can move (Decision 3), and changes
 *    nothing, so an email scanner opening the link burns nothing.
 * 3. Pressing a spotter waits for any open username claim (SYC-214), then
 *    `redeem`s, and this phone becomes that spotter.
 */
/** The link's token, held in memory only, so the page can drop it from the URL. */
let heldToken: string | null = null;

/** Tests only. */
export function __resetHeldRestoreTokenForTests(): void {
  heldToken = null;
}

/** Take the token from wherever this page load carries it, and clear every trace of it. */
function takeTokenFromPage(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  let token: string | null = null;
  const hash = /^#t=([A-Za-z0-9_-]{43})$/.exec(window.location.hash ?? '');
  if (hash) token = hash[1]!;
  try {
    const saved = window.sessionStorage.getItem(RESTORE_TOKEN_SESSION_KEY);
    if (saved) {
      window.sessionStorage.removeItem(RESTORE_TOKEN_SESSION_KEY);
      token = token ?? saved;
    }
  } catch {
    // Storage refused (private mode on some browsers): the fragment still works.
  }
  if (window.location.hash || window.location.search) {
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }
  return token;
}

export default function RestorePage() {
  const params = useLocalSearchParams<{ t?: string }>();
  if (typeof params.t === 'string' && params.t) heldToken = params.t;
  const tookFromPage = useRef(false);
  if (!tookFromPage.current) {
    tookFromPage.current = true;
    const fromPage = takeTokenFromPage();
    if (fromPage) heldToken = fromPage;
  }

  // The fragment too, once the router has started: on web it writes the page's
  // first address back as it starts, which would put `#t=` back in the
  // address bar and history (found in the Decision 12 browser check).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const clear = () => {
      if (/[#&]t=/.test(window.location.hash ?? '')) {
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      }
    };
    // Checked for a few seconds rather than at fixed moments, so a slow phone
    // whose router starts late is covered too (review of #114).
    clear();
    const started = Date.now();
    const timer = setInterval(() => {
      clear();
      if (Date.now() - started > 5000) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!params.t) return;
    router.replace('/restore');
    if (Platform.OS === 'web' && typeof window !== 'undefined' && (window.location.search || window.location.hash)) {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, [params.t]);
  return <RestoreChooser secret={heldToken ?? ''} onMoved={() => { heldToken = null; }} />;
}
