import React, { useEffect, useMemo, useState } from 'react';
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
  useClaimUsername,
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
import { LANGUAGES } from '@/lib/i18n';
import { Button, Tag } from '@/components/purropolis';
import { StepDots } from './StepDots';

const MIN_LEN = 3;

const FLAGS: Record<string, string> = { en: '🇬🇧', el: '🇬🇷', fr: '🇫🇷' };
/** English gloss under the native language name, as in the design. */
const GLOSS_KEY: Record<string, string> = {
  en: '',
  el: 'languageGlossGreek',
  fr: 'languageGlossFrench',
};

/**
 * Final onboarding step: choose a language and claim a unique username.
 * The availability/suggestion/claim behaviour is carried over verbatim from the
 * previous single-screen LandingScreen — only the presentation changed.
 */
export function LanguageUsernameStep({ onBack }: { onBack: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, language, setLanguage } = useLanguage();
  const { deviceId, setUsername } = useDevice();
  const { isOnline } = useOffline();

  const [draft, setDraft] = useState('');
  const [debounced, setDebounced] = useState('');
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(draft.trim()), 400);
    return () => clearTimeout(id);
  }, [draft]);

  const trimmed = draft.trim();
  const longEnough = trimmed.length >= MIN_LEN;
  const checkEnabled = isOnline && debounced.length >= MIN_LEN;

  const availability = useCheckUsernameAvailability(
    { name: debounced },
    {
      query: {
        enabled: checkEnabled,
        queryKey: getCheckUsernameAvailabilityQueryKey({ name: debounced }),
        staleTime: 30_000,
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

  const claim = useClaimUsername({
    mutation: {
      onSuccess: (profile) => {
        if (profile.username) setUsername(profile.username);
      },
      onError: (err: unknown) => {
        const e = err as { status?: number; data?: { code?: string } | null };
        if (e?.data?.code === 'offensive_username') {
          setClaimError(t('usernameRejected'));
        } else {
          setClaimError(e?.status === 409 ? t('landingTaken') : t('error'));
        }
      },
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
      return { text: t('landingOffline'), color: colors.mutedForeground };
    if (checking)
      return { text: t('landingChecking'), color: colors.mutedForeground };
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
    available,
    taken,
    availability.data,
    t,
    colors,
  ]);

  const canSubmit = available && isOnline && !!deviceId && !claim.isPending;

  const submit = () => {
    if (!canSubmit || !deviceId) return;
    setClaimError(null);
    claim.mutate({ deviceId, data: { username: trimmed } });
  };

  const suggestions = suggestionsQuery.data?.suggestions ?? [];
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
        <StepDots total={3} active={2} />
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
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t('makeItYours')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {t('makeItYoursSubtitle')}
          </Text>
        </View>

        {/* Language */}
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
            {t('languageTrilingualLabel')}
          </Text>
          <View style={styles.langList}>
            {LANGUAGES.map((lang) => {
              const active = lang.code === language;
              const glossKey = GLOSS_KEY[lang.code];
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => setLanguage(lang.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.langRow,
                    {
                      backgroundColor: active ? palette.aegean100 : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={styles.flag} allowFontScaling={false}>
                    {FLAGS[lang.code] ?? '🏳️'}
                  </Text>
                  <View style={styles.langText}>
                    <Text style={[styles.langName, { color: colors.foreground }]}>
                      {lang.label}
                    </Text>
                    {glossKey ? (
                      <Text
                        style={[styles.langGloss, { color: colors.mutedForeground }]}
                      >
                        {t(glossKey)}
                      </Text>
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.radio,
                      active
                        ? { backgroundColor: colors.primary, borderColor: colors.primary }
                        : { borderColor: colors.border },
                    ]}
                  >
                    {active && <Feather name="check" size={13} color="#fff" />}
                  </View>
                </Pressable>
              );
            })}
          </View>
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
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>

          {isOnline && (
            <View style={styles.suggestions}>
              <Pressable
                onPress={() => suggestionsQuery.refetch()}
                disabled={suggestionsQuery.isFetching}
                style={[styles.shuffle, { backgroundColor: palette.bougain500 }]}
                accessibilityRole="button"
              >
                <Text style={styles.shuffleText}>🎲 {t('landingShuffle')}</Text>
              </Pressable>
              {suggestionsQuery.isFetching && suggestions.length === 0 ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                suggestions.slice(0, 4).map((name, i) => (
                  <Pressable
                    key={name}
                    onPress={() => {
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
          )}
        </View>

        {claimError && (
          <Text
            style={[styles.status, { color: colors.destructive ?? '#c0392b' }]}
          >
            {claimError}
          </Text>
        )}
        {!isOnline && (
          <Text style={[styles.status, { color: colors.mutedForeground }]}>
            {t('landingOffline')}
          </Text>
        )}

        <Button
          variant="primary"
          size="lg"
          block
          disabled={!canSubmit}
          onPress={submit}
        >
          {claim.isPending ? t('landingChecking') : t('continue')}
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
  langList: { gap: 9 },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radii.md,
    borderWidth: borderWidths.thin,
  },
  flag: { fontSize: 24 },
  langText: { flex: 1 },
  langName: { fontFamily: fonts.displayBold, fontSize: fontSizes.sm },
  langGloss: { fontFamily: fonts.body, fontSize: fontSizes['2xs'] },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: borderWidths.thin,
    alignItems: 'center',
    justifyContent: 'center',
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
