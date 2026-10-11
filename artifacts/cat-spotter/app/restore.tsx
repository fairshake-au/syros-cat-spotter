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
  askedForRestoreRecently,
  isLinkNotValid,
  peekRestore,
  redeemRestore,
  type RestoreSpotter,
} from '@/lib/keepSafe';

/**
 * The page a restore link opens (SYC-3 plan, Slice 1 step 8). An app route, so
 * it can use this browser's own device id and secret: the link only works on
 * the phone that asked for it (Decision 2).
 *
 * 1. Takes `t` out of the address bar at once, so it isn't left in history
 *    or sent on in a Referer: the token is held in memory and the router
 *    replaces the page with plain `/restore`. Expo Router keeps the URL in
 *    step with its own params, so neither `history.replaceState` nor
 *    `setParams({ t: undefined })` alone sticks (found in the browser check).
 * 2. `peek`s: lists the spotters this link can move (Decision 3), and changes
 *    nothing, so an email scanner opening the link burns nothing.
 * 3. One button per spotter. Pressing it waits for any open username claim
 *    (SYC-214), then `redeem`s, and this phone becomes that spotter.
 *
 * Every failure looks the same from the server. If this browser didn't ask
 * for a link recently, the page says to open it where it was asked for, with
 * **Copy link**; otherwise it says the link has expired or been used.
 */
/** The link's token, held in memory only, so the page can drop it from the URL. */
let heldToken: string | null = null;

/** Tests only. */
export function __resetHeldRestoreTokenForTests(): void {
  heldToken = null;
}

type State =
  | { kind: 'checking' }
  | { kind: 'offline' }
  | { kind: 'choose'; spotters: RestoreSpotter[] }
  | { kind: 'moving' }
  | { kind: 'wrong-browser' }
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
  const token = useRef<string | null>(heldToken);
  token.current = heldToken;
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [currentSpots, setCurrentSpots] = useState(0);
  // SYC-266: what happens to the spotter being left. Neither is preselected.
  const [choice, setChoice] = useState<CurrentSpotterChoice | null>(null);
  const { holdIdentityDeleted } = useDeleteMyData();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!params.t) return;
    router.replace('/restore');
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.search) {
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
        const { spotters } = await peekRestore(deviceId, raw);
        if (cancelled) return;
        if (username) {
          const profile = await getProfile(deviceId).catch(() => null);
          if (!cancelled) setCurrentSpots(profile?.totalSightings ?? 0);
        }
        if (!cancelled) setState({ kind: 'choose', spotters });
      } catch (err) {
        if (cancelled) return;
        if (!raw || isLinkNotValid(err)) {
          setState({ kind: (await askedForRestoreRecently()) ? 'not-valid' : 'wrong-browser' });
        } else {
          setState({ kind: 'failed' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `username` is read once: the warning names who this phone is now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, deviceId, isOnline]);

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
              spotterDeviceId: spotter.deviceId,
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

  const copyLink = async () => {
    if (!token.current || Platform.OS !== 'web' || typeof navigator === 'undefined') return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/restore?t=${token.current}`);
      setCopied(true);
    } catch {
      // Clipboard refused: nothing else to do; the email still holds the link.
    }
  };

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
              key={s.deviceId}
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

      {state.kind === 'wrong-browser' ? (
        <View style={styles.choices}>
          <Text testID="restore-wrong-browser" style={[styles.text, { color: colors.foreground }]}>
            {t('restorePageWrongBrowser')}
          </Text>
          {Platform.OS === 'web' && token.current ? (
            <Button variant="secondary" size="lg" block onPress={copyLink}>
              {copied ? t('restorePageCopied') : t('restorePageCopyLink')}
            </Button>
          ) : null}
        </View>
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
});
