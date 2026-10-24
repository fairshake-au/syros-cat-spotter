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
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
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
import { spokenText } from '@/lib/a11yText';

const MIN_LEN = 3;

/**
 * Final onboarding step: claim a unique username. Claim completion opens the
 * app; full profile statistics load independently. The language is chosen on
 * Welcome (SYC-155).
 *
 * SYC-506: offline, the phone suggests names and "Start spotting" keeps the
 * chosen one on the phone (DeviceContext `heldUsername`); the app opens and
 * saves it once there's a connection (hooks/useHeldNameSaver.ts).
 */
export function LanguageUsernameStep({ onBack }: { onBack: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { deviceId, setUsername, holdUsername, setKeepSafeOffer } = useDevice();
  const { isOnline } = useOffline();

  const tappedAt = useRef(0);

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
      (uncertainName
        ? true
        : longEnough && !taken && !isRejectedName(trimmed));

  const submit = () => {
    if (!canSubmit) return;
    if (offline) {
      if (!heldName) return;
      // "Don't lose your spots" needs a connection and a saved name. An
      // offline start counts as skipping it here, which offers it again at
      // the first badge (FirstBadgeOffer), never mid-visit.
      setKeepSafeOffer('skipped-onboarding');
      holdUsername(heldName);
      return;
    }
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
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          hitSlop={10}
        >
          <Feather name="chevron-left" size={24} color={colors.mutedForeground} />
        </Pressable>
        <StepDots total={ONBOARDING_DOT_COUNT} active={stepIndex('name')} />
        <View style={styles.topBarSpacer} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          paddingHorizontal: spacing[5],
          paddingTop: spacing[4],
          paddingBottom: insets.bottom + spacing[5],
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
                if (uncertainName || pending) return;
                setDraft(v);
                setClaimError(null);
              }}
              placeholder={t('landingUsernamePlaceholder')}
              placeholderTextColor={colors.mutedForeground}
              maxLength={24}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={submit}
              editable={!pending && !uncertainName}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>

          <View style={styles.suggestions}>
            <Pressable
              onPress={shuffle}
              disabled={(!offline && suggestionsQuery.isFetching) || pending || !!uncertainName}
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
                    if (pending || uncertainName) return;
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

        <Button
          variant="primary"
          size="lg"
          block
          disabled={!canSubmit}
          onPress={submit}
        >
          {pending
            ? t('usernameClaiming')
            : uncertainName
              ? t('usernameRetryClaim')
              : offline
                ? t('startSpotting')
                : t('continue')}
        </Button>
      </KeyboardAwareScrollViewCompat>
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
