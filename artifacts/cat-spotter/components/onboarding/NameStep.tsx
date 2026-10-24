import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useCheckUsernameAvailability,
  getCheckUsernameAvailabilityQueryKey,
  useGetUsernameSuggestions,
  getGetUsernameSuggestionsQueryKey,
  checkUsernameAvailability,
  getClaimedUsername,
} from '@workspace/api-client-react';
import {
  KeyboardAwareScrollViewCompat,
  KeyboardStickyViewCompat,
} from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import {
  borderWidths,
  fonts,
  fontSizes,
  radii,
  spacing,
} from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import {
  normalizeUsernameLocally,
  suggestLocalUsernames,
} from '@/lib/usernameSuggestions';
import { Button, Tag } from '@/components/purropolis';
import { StepDots } from './StepDots';
import { ONBOARDING_DOT_COUNT, stepIndex } from './steps';
import { RECONCILE_WAIT_MS, withDeadline } from '@/lib/usernameClaim';
import { useUsernameClaim } from '@/hooks/useUsernameClaim';
import { decorative, spokenText } from '@/lib/a11yText';
import { useOnboardingEmail } from './useOnboardingEmail';

const MIN_LEN = 3;
/** How much of the pinned footer sits above the keyboard: the button and its padding. */
const FOOTER_ABOVE_KEYBOARD = 48 + spacing[2] + spacing[4];

/**
 * Final onboarding step: claim a unique username. Claim completion opens the
 * app; full profile statistics load independently. The language is chosen on
 * Welcome (SYC-155).
 *
 * SYC-506: offline, the phone suggests names and "Start spotting" keeps the
 * chosen one on the phone (DeviceContext `heldUsername`); the app opens and
 * saves it once there's a connection (hooks/useHeldNameSaver.ts).
 *
 * SYC-524: the same screen offers "Don't lose your spots", an optional email
 * (docs/specs/onboarding-fewer-screens.md, Screen 3). **Start spotting**:
 * (1) stops on an email that isn't one; (2) writes the offer as
 * `skipped-onboarding`, so whichever way a name arrives the root gate never
 * shows the keep-safe screen; (3) adds the email, if typed and not already
 * added here, and upgrades the offer to `done`, or stops on failure; (4)
 * claims the name, which opens the app. The email goes first because a saved
 * name opens the app by itself. A change of identity mid-save drops the
 * result. Offline, the email box gives way to a note and counts as skipped.
 */
export function NameStep({ onBack }: { onBack: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, language } = useLanguage();
  const {
    deviceId,
    setUsername,
    holdUsername,
    keepSafeOffer,
    setKeepSafeOffer,
    identityGeneration,
  } = useDevice();
  const { isOnline } = useOffline();
  const {
    email,
    setEmail,
    savedFor,
    error: emailError,
    saving,
    saveIfNeeded,
  } = useOnboardingEmail({ deviceId, language });

  const tappedAt = useRef(0);
  /** Which spotter this phone was when the claim was sent (spec "Identity changes mid-save"). */
  const claimGeneration = useRef<number | null>(null);
  /** A tap is between Start spotting and the claim (the email is being checked or added). */
  const submitting = useRef(false);

  const {
    submit: claim,
    pending,
    uncertainName,
    outstandingName,
    claimError,
    setClaimError,
    isRejectedName,
    hasStarted,
  } = useUsernameClaim({
    deviceId,
    t,
    finishOnClaim: true,
    onClaimed: (name) => {
      if (claimGeneration.current !== null && identityGeneration() !== claimGeneration.current) return;
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('Username claim-to-navigation timing', { ms: Date.now() - tappedAt.current });
      setUsername(name);
    },
  });

  // SYC-214: back on this screen with a claim still outstanding, show its name.
  const [draft, setDraft] = useState(() => outstandingName ?? '');
  const [debounced, setDebounced] = useState(() => (outstandingName ?? '').trim());

  // Recover a claim committed before the app closed or its response was lost.
  // Once this screen has sent a claim, that claim decides the name instead.
  useEffect(() => {
    if (!deviceId || !isOnline) return;
    let active = true;
    withDeadline(getClaimedUsername(deviceId), RECONCILE_WAIT_MS)
      .then((result) => {
        if (active && result.username && !hasStarted()) setUsername(result.username);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [deviceId, isOnline, setUsername, hasStarted]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(draft.trim()), 400);
    return () => clearTimeout(id);
  }, [draft]);

  const trimmed = draft.trim();
  const longEnough = trimmed.length >= MIN_LEN;
  const offline = !isOnline;
  // SYC-506: offline, the phone checks the server's rules itself.
  const heldName = offline ? normalizeUsernameLocally(trimmed) : null;
  const [localSuggestions, setLocalSuggestions] = useState(() => suggestLocalUsernames(4));
  const checkEnabled = isOnline && debounced.length >= MIN_LEN;

  const availability = useCheckUsernameAvailability(
    { name: debounced },
    {
      query: {
        enabled: checkEnabled,
        queryKey: getCheckUsernameAvailabilityQueryKey({ name: debounced }),
        staleTime: 30_000,
        retry: false,
        // SYC-211 F2: no UI deadline here. A slow answer (cold server, weak
        // signal) is kept when it arrives, and Continue does not wait for it.
        // The transport timeout in custom-fetch.ts still ends a stalled request.
        queryFn: ({ signal }) => {
          const startedCheck = Date.now();
          return checkUsernameAvailability({ name: debounced }, { signal })
            .then((result) => {
              if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('Username availability timing', { ms: Date.now() - startedCheck });
              return result;
            });
        },
      },
    },
  );

  const suggestionsQuery = useGetUsernameSuggestions({
    query: {
      enabled: isOnline,
      queryKey: getGetUsernameSuggestionsQueryKey(),
      staleTime: Infinity,
    },
  });

  const checking =
    longEnough && (availability.isFetching || debounced !== trimmed);
  const available =
    longEnough &&
    !checking &&
    debounced === trimmed &&
    availability.data?.available === true;
  const taken =
    longEnough &&
    !checking &&
    debounced === trimmed &&
    availability.data?.available === false;

  const status = useMemo(() => {
    if (trimmed.length === 0) return null;
    if (!longEnough)
      return { text: t('landingTooShort'), color: colors.mutedForeground };
    if (!isOnline)
      return heldName
        ? null
        : { text: t('landingInvalid'), color: colors.destructive ?? '#c0392b' };
    if (checking)
      return { text: t('landingChecking'), color: colors.mutedForeground };
    if (availability.isError)
      return { text: t('usernameCheckFailed'), color: colors.destructive ?? '#c0392b' };
    if (available)
      return { text: `✓ ${t('landingAvailable')}`, color: colors.success ?? palette.olive600 };
    if (taken)
      return {
        text:
          availability.data?.reason === 'offensive'
            ? t('usernameRejected')
            : availability.data?.reason === 'invalid'
              ? t('landingInvalid')
              : t('landingTaken'),
        color: colors.destructive ?? '#c0392b',
      };
    return null;
  }, [
    trimmed,
    longEnough,
    isOnline,
    checking,
    availability.isError,
    available,
    taken,
    availability.data,
    heldName,
    t,
    colors,
  ]);

  // SYC-211 F2: availability informs but does not gate Continue; the claim
  // itself is authoritative (409 when taken). A name known to be taken, or
  // firmly refused by the server, still disables it. While a claim is
  // uncertain, only the same-name retry is offered.
  const canSubmit = offline
    ? !!deviceId && !pending && !uncertainName && heldName !== null
    : !!deviceId &&
      !pending &&
      !saving &&
      (uncertainName
        ? true
        : longEnough && !taken && !isRejectedName(trimmed));

  // Written before anything is saved. An email added on an earlier tap
  // already made it `done`; that is never taken back.
  const markSkipped = () => {
    if (keepSafeOffer !== 'done') setKeepSafeOffer('skipped-onboarding');
  };

  const submit = async () => {
    if (!canSubmit || submitting.current) return;
    if (offline) {
      if (!heldName) return;
      // "Don't lose your spots" needs a connection. An offline start counts
      // as skipping it here, which offers it again at the first badge
      // (FirstBadgeOffer), never mid-visit.
      markSkipped();
      holdUsername(heldName);
      return;
    }
    const generation = identityGeneration();
    submitting.current = true;
    let emailResult;
    try {
      emailResult = await saveIfNeeded(markSkipped);
    } finally {
      submitting.current = false;
    }
    if (emailResult === 'invalid' || emailResult === 'failed' || emailResult === 'stale') return;
    if (identityGeneration() !== generation) return;
    if (emailResult === 'saved') setKeepSafeOffer('done');
    claimGeneration.current = generation;
    tappedAt.current = Date.now();
    void claim(trimmed);
  };

  const suggestions = offline ? localSuggestions : (suggestionsQuery.data?.suggestions ?? []);
  const shuffle = () => {
    if (offline) setLocalSuggestions(suggestLocalUsernames(4));
    else void suggestionsQuery.refetch();
  };
  const tones = ['sun', 'olive', 'aegean', 'terra'] as const;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable
          onPress={onBack}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          accessibilityState={{ disabled: saving }}
          hitSlop={10}
        >
          <Feather
            name="chevron-left"
            size={24}
            color={colors.mutedForeground}
            style={saving ? styles.backDisabled : undefined}
          />
        </Pressable>
        <StepDots total={ONBOARDING_DOT_COUNT} active={stepIndex('name')} />
        <View style={styles.topBarSpacer} />
      </View>

      <KeyboardAwareScrollViewCompat
        bottomOffset={FOOTER_ABOVE_KEYBOARD + spacing[3]}
        contentContainerStyle={{
          paddingHorizontal: spacing[5],
          paddingTop: spacing[4],
          paddingBottom: spacing[5],
          gap: spacing[5],
        }}
      >
        <View style={styles.heading}>
          <Text
            role="heading"
            accessibilityLabel={spokenText(t('makeItYours'))}
            style={[styles.title, { color: colors.foreground }]}
          >
            {t('makeItYours')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {t('nameScreenSubtitle')}
          </Text>
        </View>

        {/* Username */}
        <View style={styles.field}>
          <View style={styles.fieldHeader}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
              {t('landingUsernameLabel')}
            </Text>
            {status && (
              <Text style={[styles.status, { color: status.color }]}>
                {status.text}
              </Text>
            )}
          </View>
          <View
            style={[
              styles.inputWrap,
              {
                backgroundColor: colors.card,
                borderColor: available
                  ? colors.primary
                  : taken
                    ? (colors.destructive ?? '#c0392b')
                    : colors.border,
              },
            ]}
          >
            <Text style={[styles.at, { color: colors.mutedForeground }]}>@</Text>
            <TextInput
              value={draft}
              onChangeText={(v) => {
                if (uncertainName || pending || saving) return;
                setDraft(v);
                setClaimError(null);
              }}
              placeholder={t('landingUsernamePlaceholder')}
              placeholderTextColor={colors.mutedForeground}
              maxLength={24}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              editable={!pending && !uncertainName && !saving}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>

          <View style={styles.suggestions}>
            <Pressable
              onPress={shuffle}
              disabled={(!offline && suggestionsQuery.isFetching) || pending || !!uncertainName || saving}
              style={[styles.shuffle, { backgroundColor: palette.bougain500 }]}
              accessibilityRole="button"
            >
              <Text style={styles.shuffleText}>🎲 {t('landingShuffle')}</Text>
            </Pressable>
            {!offline && suggestionsQuery.isFetching && suggestions.length === 0 ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              suggestions.slice(0, 4).map((name, i) => (
                <Pressable
                  key={name}
                  onPress={() => {
                    if (pending || uncertainName || saving) return;
                    setDraft(name);
                    setClaimError(null);
                  }}
                  accessibilityRole="button"
                >
                  <Tag tone={tones[i % tones.length]}>@{name}</Tag>
                </Pressable>
              ))
            )}
          </View>
        </View>

        {claimError && (
          <Text
            style={[styles.status, { color: colors.destructive ?? '#c0392b' }]}
          >
            {claimError}
          </Text>
        )}
        {offline && (
          <Text style={[styles.status, { color: colors.mutedForeground }]}>
            {t('offlineNameNote')}
          </Text>
        )}

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* SYC-524: "Don't lose your spots", optional (email-capture.md §3.0 words). */}
        <View style={styles.field}>
          <View style={styles.heading}>
            <Text role="heading" style={[styles.emailTitle, { color: colors.foreground }]}>
              <Text {...decorative}>🔒 </Text>
              {t('keepSafeTitle')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {t('keepSafeOptional')}
            </Text>
          </View>
          <Text style={[styles.body, { color: colors.foreground }]}>{t('keepSafeBody')}</Text>
          {isOnline ? (
            <>
              <View
                style={[
                  styles.inputWrap,
                  {
                    backgroundColor: colors.card,
                    borderColor: emailError
                      ? (colors.destructive ?? '#c0392b')
                      : savedFor !== null
                        ? colors.primary
                        : colors.border,
                  },
                ]}
              >
                <TextInput
                  testID="onboarding-email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('keepSafePlaceholder')}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  inputMode="email"
                  returnKeyType="done"
                  onSubmitEditing={() => void submit()}
                  editable={!saving && !pending}
                  accessibilityLabel={t('keepSafePlaceholder')}
                  style={[styles.input, { color: colors.foreground }]}
                />
              </View>
              {emailError ? (
                <Text style={[styles.status, { color: colors.destructive ?? '#c0392b' }]}>
                  {t(emailError)}
                </Text>
              ) : savedFor !== null ? (
                <Text style={[styles.status, { color: colors.success ?? palette.olive600 }]}>
                  ✓ {t('saved')}
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={[styles.status, { color: colors.mutedForeground }]}>
              {t('keepSafeOffline')}
            </Text>
          )}
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {t('keepSafeWarning')} <Text style={styles.strong}>{t('keepSafeUnder15')}</Text>
          </Text>
        </View>
      </KeyboardAwareScrollViewCompat>

      {/* Pinned outside the scroll, riding above the keyboard (spec: the
          button never scrolls away). */}
      <KeyboardStickyViewCompat
        offset={{ closed: 0, opened: insets.bottom }}
        style={[
          styles.footer,
          { paddingBottom: insets.bottom + spacing[4], backgroundColor: colors.background },
        ]}
      >
        <Button
          variant="primary"
          size="lg"
          block
          busy={saving}
          disabled={!canSubmit}
          onPress={() => void submit()}
        >
          {pending
            ? t('usernameClaiming')
            : uncertainName
              ? t('usernameRetryClaim')
              : t('startSpotting')}
        </Button>
      </KeyboardStickyViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[5],
    paddingBottom: 6,
  },
  topBarSpacer: { width: 24 },
  backDisabled: { opacity: 0.4 },
  heading: { gap: 6 },
  title: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 30 },
  subtitle: { fontFamily: fonts.body, fontSize: fontSizes.sm },
  field: { gap: spacing[2] },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  fieldLabel: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: fontSizes['2xs'],
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: radii.md,
    borderWidth: borderWidths.thin,
    paddingHorizontal: spacing[4],
    paddingVertical: 12,
  },
  at: { fontFamily: fonts.bodyBold, fontSize: fontSizes.md },
  input: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes.md,
    padding: 0,
  },
  status: { fontFamily: fonts.bodyExtraBold, fontSize: fontSizes['2xs'] },
  divider: { height: borderWidths.thin },
  emailTitle: { fontFamily: fonts.displayBold, fontSize: fontSizes.lg, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: fontSizes.sm, lineHeight: 21 },
  strong: { fontFamily: fonts.bodyExtraBold },
  footer: {
    width: '100%',
    paddingHorizontal: spacing[5],
    paddingTop: spacing[2],
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 7,
    marginTop: 4,
  },
  shuffle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  shuffleText: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes['2xs'],
    color: '#fff',
  },
});
