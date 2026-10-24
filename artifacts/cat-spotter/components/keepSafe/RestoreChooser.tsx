import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getProfile } from '@workspace/api-client-react';
import { Button } from '@/components/purropolis';
import { RestoreWarning, type CurrentSpotterChoice } from './RestoreWarning';
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
  type RestorePeek,
  type RestoreSpotter,
} from '@/lib/keepSafe';
import { isInAppBrowser } from '@/lib/inAppBrowser';
import { clearPendingMove, clearWaiting, notePendingMove, setMovingHandle } from '@/lib/restoreWaiting';

/**
 * The restore chooser, shared by the link page (app/restore.tsx) and the code
 * screen (SYC-664). `secret` is the link's token, or a handle from a typed
 * code (`fromCode`). It peeks (changing nothing), then walks the person through
 * the in-app-browser advice, the different-browser question, the keep/delete
 * choice (SYC-266) and the move itself. See app/restore.tsx for the history.
 */
type State =
  | { kind: 'checking' }
  | { kind: 'offline' }
  | { kind: 'already-here'; username: string | null }
  | { kind: 'in-app'; peek: RestorePeek }
  | { kind: 'confirm-different'; peek: RestorePeek }
  | { kind: 'copied'; peek: RestorePeek }
  | { kind: 'use-icon'; peek: RestorePeek }
  | { kind: 'choose'; spotters: RestoreSpotter[] }
  | { kind: 'moving' }
  | { kind: 'not-valid' }
  | { kind: 'failed' };

export function RestoreChooser({
  secret,
  fromCode,
  onMoved,
  onExit,
}: {
  secret: string;
  /** The secret is a handle from a typed code: the person is already in the app, so no in-app-browser advice. */
  fromCode?: boolean;
  /** Called once the spotter has moved, before the page reloads (the link page drops its held token). */
  onMoved?: () => void;
  /**
   * Code path only (SYC-664 I2): leave the chooser for the code screen's code
   * box (Back) or its address box ("ask again"). The link page has neither.
   */
  onExit?: (to: 'code' | 'address') => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { deviceId, username, isReady, adoptRestoredIdentity } = useDevice();
  const { isOnline, pauseSync, resumeSync } = useOffline();
  const token = useRef<string | null>(secret || null);
  token.current = secret || null;
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [currentSpots, setCurrentSpots] = useState(0);
  // SYC-266: what happens to the spotter being left. Neither is preselected.
  const [choice, setChoice] = useState<CurrentSpotterChoice | null>(null);
  const { holdIdentityDeleted } = useDeleteMyData();
  const [copied, setCopied] = useState(false);
  // Some in-app browsers refuse the clipboard: never claim a copy that didn't happen.
  const [copyFailed, setCopyFailed] = useState(false);

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
        setState(!fromCode && isInAppBrowser(ua) ? { kind: 'in-app', peek } : afterInAppAdvice(peek));
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

  // SYC-664 I2: on the code path a dead handle is never remembered, so a
  // reload can't bring the person back to it. "Already here" needs no note at all.
  useEffect(() => {
    if (!fromCode) return;
    if (state.kind === 'not-valid' || state.kind === 'failed') setMovingHandle(null);
    else if (state.kind === 'already-here') clearWaiting();
  }, [fromCode, state.kind]);

  const exitTo = fromCode ? onExit : undefined;

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
          const input = {
            token: raw,
            choice: spotter.choice,
            abandonCurrent: Boolean(username),
            ...(deleting ? { deleteCurrent: true } : {}),
          };
          const request = () => redeemRestore(deviceId, input);
          // SYC-664 I1: if the app reloads before the answer lands, start-up
          // asks again with these values (DeviceContext). Cleared on success
          // (adoptRestoredIdentity) or a definite refusal (below).
          if (fromCode) notePendingMove({ handle: raw, choice: input.choice, abandonCurrent: input.abandonCurrent, deleteCurrent: deleting });
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
      onMoved?.();
      token.current = null;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        // A fresh page load: the app starts as the restored spotter.
        window.location.replace('/');
      } else {
        router.replace('/');
      }
    } catch (err) {
      if (isLinkNotValid(err)) clearPendingMove();
      setState({ kind: isLinkNotValid(err) ? 'not-valid' : 'failed' });
    }
  };

  /** The fragment form, like the email's (review finding 2): never `?t=`, which servers log. */
  const copyLink = async (): Promise<boolean> => {
    if (!token.current || Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.clipboard) {
      setCopyFailed(true);
      return false;
    }
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/restore#t=${token.current}`);
      setCopied(true);
      setCopyFailed(false);
      return true;
    } catch {
      // Clipboard refused: say so; the email still holds the link.
      setCopyFailed(true);
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
      {exitTo && state.kind !== 'moving' ? (
        <View style={styles.topBar}>
          <Pressable
            testID="restore-chooser-back"
            onPress={() => exitTo('code')}
            accessibilityRole="button"
            accessibilityLabel={t('back')}
            hitSlop={10}
          >
            <Feather name="chevron-left" size={24} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ) : null}
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {t('restoreAskTitle')}
      </Text>

      {state.kind === 'checking' || state.kind === 'moving' ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.text, { color: colors.mutedForeground }]}>
            {state.kind === 'checking'
              ? t(fromCode ? 'restoreCodeChecking' : 'restorePageChecking')
              : t('restorePageMoving')}
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
          {copyFailed ? (
            <Text testID="restore-copy-failed" style={[styles.text, { color: colors.foreground }]}>
              {t('restoreCopyFailed')}
            </Text>
          ) : null}
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
          {/* The same size: none of the three answers is the "right" one to tap through. */}
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
                  if (await copyLink()) setState({ kind: 'copied', peek: state.peek });
                }}
              >
                {t('restoreDifferentNo')}
              </Button>
            </View>
            <View style={styles.pairItem}>
              <Button variant="secondary" size="lg" block onPress={() => setState({ kind: 'use-icon', peek: state.peek })}>
                {t('restoreUseIcon')}
              </Button>
            </View>
          </View>
          {copyFailed ? (
            <Text testID="restore-copy-failed" style={[styles.text, { color: colors.foreground }]}>
              {t('restoreCopyFailed')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {state.kind === 'copied' ? (
        <View style={styles.choices}>
          <Text testID="restore-copied" style={[styles.text, { color: colors.foreground }]}>
            {onlyName(state.peek)
              ? t('restoreDifferentCopied').replace('{name}', onlyName(state.peek)!)
              : t('restoreDifferentCopiedYou')}
          </Text>
          <Button variant="secondary" size="md" onPress={() => setState({ kind: 'confirm-different', peek: state.peek })}>
            {t('back')}
          </Button>
        </View>
      ) : null}

      {state.kind === 'use-icon' ? (
        <View style={styles.choices}>
          <Text testID="restore-use-icon" style={[styles.text, { color: colors.foreground }]}>
            {t('restoreUseIconAdvice')}
          </Text>
          <Button variant="secondary" size="md" onPress={() => setState({ kind: 'confirm-different', peek: state.peek })}>
            {t('back')}
          </Button>
        </View>
      ) : null}

      {state.kind === 'not-valid' || state.kind === 'failed' ? (
        <View style={styles.choices}>
          <Text testID="restore-not-valid" style={[styles.text, { color: colors.foreground }]}>
            {state.kind === 'not-valid'
              ? t(fromCode ? 'restoreCodeNotValid' : 'restorePageNotValid')
              : t('restorePageFailed')}
          </Text>
          <View testID="restore-ask-again">
          <Button
            variant="secondary"
            size="lg"
            block
            // The code path goes back to its own address box; replacing the
            // route would remount straight into this chooser (I2).
            onPress={() => (exitTo ? exitTo('address') : router.replace(username ? '/get-spots-back' : '/'))}
          >
            {t(fromCode ? 'restoreCodeNewEmail' : 'restorePageAskAgain')}
          </Button>
          </View>
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
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: -spacing[2] },
  choices: { gap: spacing[3] },
  strong: { fontFamily: fonts.bodyBold },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  pairItem: { flexGrow: 1, flexBasis: 220 },
});
