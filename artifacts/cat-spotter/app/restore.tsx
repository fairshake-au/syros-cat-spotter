import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getProfile } from '@workspace/api-client-react';
import { Button } from '@/components/purropolis';
import { RestoreWarning, type CurrentSpotterChoice } from '@/components/keepSafe/RestoreWarning';
import { useDeleteMyData } from '@/context/DeleteMyDataContext';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { waitForUsernameClaimToSettle } from '@/hooks/useUsernameClaim';
import {
  isLinkNotValid,
  peekRestore,
  redeemRestore,
  RESTORE_TOKEN_SESSION_KEY,
  type RestorePeek,
  type RestoreSpotter,
} from '@/lib/keepSafe';
import { isInAppBrowser } from '@/lib/inAppBrowser';

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

type State =
  | { kind: 'checking' }
  | { kind: 'offline' }
  | { kind: 'already-here'; username: string | null }
  | { kind: 'in-app'; peek: RestorePeek }
  | { kind: 'confirm-different'; peek: RestorePeek }
  | { kind: 'copied'; peek: RestorePeek }
  | { kind: 'choose'; spotters: RestoreSpotter[] }
  | { kind: 'moving' }
  | { kind: 'not-valid' }
  | { kind: 'failed' };

export default function RestorePage() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { deviceId, username, isReady, adoptRestoredIdentity } = useDevice();
  const { isOnline, pauseSync, resumeSync } = useOffline();
  const params = useLocalSearchParams<{ t?: string }>();
  if (typeof params.t === 'string' && params.t) heldToken = params.t;
  const tookFromPage = useRef(false);
  if (!tookFromPage.current) {
    tookFromPage.current = true;
    const fromPage = takeTokenFromPage();
    if (fromPage) heldToken = fromPage;
  }
  const token = useRef<string | null>(heldToken);
  token.current = heldToken;
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [currentSpots, setCurrentSpots] = useState(0);
  // SYC-266: what happens to the spotter being left. Neither is preselected.
  const [choice, setChoice] = useState<CurrentSpotterChoice | null>(null);
  const { holdIdentityDeleted } = useDeleteMyData();
  const [copied, setCopied] = useState(false);

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
    clear();
    const timers = [0, 50, 250].map((ms) => setTimeout(clear, ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!params.t) return;
    router.replace('/restore');
    if (Platform.OS === 'web' && typeof window !== 'undefined' && (window.location.search || window.location.hash)) {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, [params.t]);

  useEffect(() => {
    if (!isReady || !deviceId) return;
    if (!isOnline) {
      setState({ kind: 'offline' });
      return;
    }
    let cancelled = false;
    (async () => {
      const raw = token.current;
      try {
        if (!raw) throw new Error('no token');
        const peek = await peekRestore(deviceId, raw);
        if (cancelled) return;
        if (peek.alreadyHere) {
          setState({ kind: 'already-here', username: peek.alreadyHere.username });
          return;
        }
        if (username) {
          const profile = await getProfile(deviceId).catch(() => null);
          if (!cancelled) setCurrentSpots(profile?.totalSightings ?? 0);
        }
        if (cancelled) return;
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        setState(isInAppBrowser(ua) ? { kind: 'in-app', peek } : afterInAppAdvice(peek));
      } catch (err) {
        if (cancelled) return;
        setState({ kind: !raw || isLinkNotValid(err) ? 'not-valid' : 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `username` is read once: the warning names who this phone is now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, deviceId, isOnline]);

  /** After any in-app-browser advice: the different-browser question, or straight to the spotters. */
  function afterInAppAdvice(peek: RestorePeek): State {
    return peek.openedOnAskingPhone ? { kind: 'choose', spotters: peek.spotters } : { kind: 'confirm-different', peek };
  }

  /** "Yes, this is the one": one spotter and nothing to decide about this phone's own goes straight on. */
  const confirmDifferent = (peek: RestorePeek) => {
    if (peek.spotters.length === 1 && !username) {
      void move(peek.spotters[0]!);
      return;
    }
    setState({ kind: 'choose', spotters: peek.spotters });
  };

  const move = async (spotter: RestoreSpotter) => {
    const raw = token.current;
    if (!raw || !deviceId) return;
    // Never a silent "Keep": the person must have said (SYC-266).
    if (username && !choice) return;
    const deleting = Boolean(username) && choice === 'delete';
    setState({ kind: 'moving' });
    try {
      await waitForUsernameClaimToSettle();
      // "Delete Nikos" makes Nikos's id answer 410; a late reply to a request
      // sent as Nikos must not wipe the phone and make a new spotter over the
      // one coming back (SYC-266). Held until the phone has become it.
      await holdIdentityDeleted(async () => {
        // No upload as Nikos may land after the deletion and put Nikos back
        // (as "Delete my data" pauses first: #110 review, F1).
        if (deleting) await pauseSync();
        try {
          const request = () =>
            redeemRestore(deviceId, {
              token: raw,
              choice: spotter.choice,
              abandonCurrent: Boolean(username),
              ...(deleting ? { deleteCurrent: true } : {}),
            });
          let result: Awaited<ReturnType<typeof request>>;
          try {
            result = await request();
          } catch (err) {
            // A lost answer after a Delete has committed would leave this
            // phone on Nikos's deleted id: the next 410 would wipe it and the
            // spotter coming back would be lost. Ask again: within 60 s the
            // server gives the same answer and moves nothing twice (#110
            // review, F2).
            if (!deleting || isLinkNotValid(err)) throw err;
            await new Promise((r) => setTimeout(r, 1500));
            result = await request();
          }
          await adoptRestoredIdentity(result.deviceId, result.username);
        } finally {
          if (deleting) resumeSync();
        }
      });
      heldToken = null;
      token.current = null;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // A fresh page load: the app starts as the restored spotter.
        window.location.replace('/');
      } else {
        router.replace('/');
      }
    } catch (err) {
      setState({ kind: isLinkNotValid(err) ? 'not-valid' : 'failed' });
    }
  };

  /** The fragment form, like the email's (review finding 2): never `?t=`, which servers log. */
  const copyLink = async (): Promise<boolean> => {
    if (!token.current || Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/restore#t=${token.current}`);
      setCopied(true);
      return true;
    } catch {
      // Clipboard refused: nothing else to do; the email still holds the link.
      return false;
    }
  };

  /** The one spotter's name when there's just one; otherwise the question is about "you". */
  const onlyName = (peek: RestorePeek) =>
    peek.spotters.length === 1 ? nameOf(peek.spotters[0]!) : null;

  const nameOf = (s: RestoreSpotter) => s.username ?? t('restorePageAnotherSpotter');

  return (
    <View
      testID="restore-page"
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + spacing[6],
          paddingBottom: insets.bottom + spacing[5],
        },
      ]}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {t('restoreAskTitle')}
      </Text>

      {state.kind === 'checking' || state.kind === 'moving' ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.text, { color: colors.mutedForeground }]}>
            {state.kind === 'checking' ? t('restorePageChecking') : t('restorePageMoving')}
          </Text>
        </View>
      ) : null}

      {state.kind === 'offline' ? (
        <Text style={[styles.text, { color: colors.foreground }]}>{t('restorePageOffline')}</Text>
      ) : null}

      {state.kind === 'choose' ? (
        <View style={styles.choices}>
          {username ? (
            <RestoreWarning current={username} spots={currentSpots} choice={choice} onChoose={setChoice} />
          ) : null}
          {state.spotters.length > 1 ? (
            <Text style={[styles.text, { color: colors.foreground }]}>{t('restorePagePick')}</Text>
          ) : null}
          {state.spotters.map((s) => (
            <Button
              key={s.choice}
              variant="primary"
              size="lg"
              block
              // Not until the person has said what happens to the spotter being left.
              disabled={Boolean(username) && !choice}
              onPress={() => move(s)}
            >
              {t('restorePageMove').replace('{name}', nameOf(s))}
            </Button>
          ))}
        </View>
      ) : null}

      {state.kind === 'already-here' ? (
        <View style={styles.choices}>
          <Text testID="restore-already-here" style={[styles.text, { color: colors.foreground }]}>
            {state.username
              ? t('restoreAlreadyHere').replace('{name}', state.username)
              : t('restoreAlreadyHereNoName')}
          </Text>
          <Button variant="primary" size="lg" block onPress={() => router.replace('/')}>
            {t('restoreAlreadyHereOpen')}
          </Button>
        </View>
      ) : null}

      {state.kind === 'in-app' ? (
        <View style={styles.choices}>
          <Text testID="restore-in-app" style={[styles.text, { color: colors.foreground }]}>
            {t('restoreInAppWarning')}
          </Text>
          <Button variant="primary" size="lg" block onPress={() => void copyLink()}>
            {copied ? t('restorePageCopied') : t('restorePageCopyLink')}
          </Button>
          <Button variant="ghost" size="sm" onPress={() => setState(afterInAppAdvice(state.peek))}>
            {t('restoreInAppAnyway')}
          </Button>
        </View>
      ) : null}

      {state.kind === 'confirm-different' ? (
        <View style={styles.choices}>
          <Text testID="restore-different" style={[styles.text, { color: colors.foreground }]}>
            {t('restoreDifferentIntro')}
          </Text>
          <Text style={[styles.text, styles.strong, { color: colors.foreground }]}>
            {onlyName(state.peek)
              ? t('restoreDifferentQuestion').replace('{name}', onlyName(state.peek)!)
              : t('restoreDifferentQuestionYou')}
          </Text>
          {/* The same size: neither answer is the "right" one to tap through. */}
          <View style={styles.pair}>
            <View style={styles.pairItem}>
              <Button variant="primary" size="lg" block onPress={() => confirmDifferent(state.peek)}>
                {onlyName(state.peek)
                  ? t('restoreDifferentYes').replace('{name}', onlyName(state.peek)!)
                  : t('restoreDifferentYesYou')}
              </Button>
            </View>
            <View style={styles.pairItem}>
              <Button
                variant="secondary"
                size="lg"
                block
                onPress={async () => {
                  await copyLink();
                  setState({ kind: 'copied', peek: state.peek });
                }}
              >
                {t('restoreDifferentNo')}
              </Button>
            </View>
          </View>
        </View>
      ) : null}

      {state.kind === 'copied' ? (
        <Text testID="restore-copied" style={[styles.text, { color: colors.foreground }]}>
          {onlyName(state.peek)
            ? t('restoreDifferentCopied').replace('{name}', onlyName(state.peek)!)
            : t('restoreDifferentCopiedYou')}
        </Text>
      ) : null}

      {state.kind === 'not-valid' || state.kind === 'failed' ? (
        <View style={styles.choices}>
          <Text testID="restore-not-valid" style={[styles.text, { color: colors.foreground }]}>
            {state.kind === 'not-valid' ? t('restorePageNotValid') : t('restorePageFailed')}
          </Text>
          <Button
            variant="secondary"
            size="lg"
            block
            onPress={() => router.replace(username ? '/get-spots-back' : '/')}
          >
            {t('restorePageAskAgain')}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing[5], gap: spacing[4] },
  title: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 30 },
  text: { fontFamily: fonts.body, fontSize: fontSizes.md, lineHeight: 23 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  choices: { gap: spacing[3] },
  strong: { fontFamily: fonts.bodyBold },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  pairItem: { flexGrow: 1, flexBasis: 220 },
});
