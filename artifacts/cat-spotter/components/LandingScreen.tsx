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
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { LANGUAGES } from '@/lib/i18n';

const MIN_LEN = 3;

/**
 * One-time first-run screen: pick a unique username (with live availability
 * and fun suggestions) and the app language. Shown until a username is
 * claimed on the server and persisted locally.
 */
export function LandingScreen() {
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
        const status = (err as { status?: number })?.status;
        setClaimError(status === 409 ? t('landingTaken') : t('error'));
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
    if (!longEnough) return { text: t('landingTooShort'), color: colors.mutedForeground, icon: 'info' as const };
    if (!isOnline) return { text: t('landingOffline'), color: colors.mutedForeground, icon: 'wifi-off' as const };
    if (checking) return { text: t('landingChecking'), color: colors.mutedForeground, icon: 'loader' as const };
    if (available) return { text: t('landingAvailable'), color: colors.primary, icon: 'check-circle' as const };
    if (taken)
      return {
        text: availability.data?.reason === 'invalid' ? t('landingInvalid') : t('landingTaken'),
        color: colors.destructive ?? '#c0392b',
        icon: 'x-circle' as const,
      };
    return null;
  }, [trimmed, longEnough, isOnline, checking, available, taken, availability.data, t, colors]);

  const canSubmit = available && isOnline && !!deviceId && !claim.isPending;

  const submit = () => {
    if (!canSubmit || !deviceId) return;
    setClaimError(null);
    claim.mutate({ deviceId, data: { username: trimmed } });
  };

  const suggestions = suggestionsQuery.data?.suggestions ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          paddingTop: insets.top + 48,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 24,
          gap: 24,
        }}
      >
        <View style={{ alignItems: 'center', gap: 8 }}>
          <View style={[styles.iconCircle, { backgroundColor: colors.secondary }]}>
            <Text style={{ fontSize: 40 }}>🐈</Text>
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t('landingWelcome')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {t('landingIntro')}
          </Text>
        </View>

        {/* Language */}
        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {t('language')}
          </Text>
          <View style={styles.langRow}>
            {LANGUAGES.map((lang) => {
              const active = lang.code === language;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => setLanguage(lang.code)}
                  style={[
                    styles.langBtn,
                    {
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.langText,
                      { color: active ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {lang.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Username */}
        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {t('landingUsernameLabel')}
          </Text>
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
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: available
                  ? colors.primary
                  : taken
                    ? (colors.destructive ?? '#c0392b')
                    : colors.border,
                color: colors.foreground,
              },
            ]}
          />
          {status && (
            <View style={styles.statusRow}>
              <Feather name={status.icon} size={14} color={status.color} />
              <Text style={[styles.statusText, { color: status.color }]}>
                {status.text}
              </Text>
            </View>
          )}
        </View>

        {/* Suggestions */}
        {isOnline && (
          <View style={{ gap: 10 }}>
            <View style={styles.suggestHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                {t('landingSuggest')}
              </Text>
              <Pressable
                onPress={() => suggestionsQuery.refetch()}
                disabled={suggestionsQuery.isFetching}
                style={[styles.shuffleBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              >
                <Feather
                  name="refresh-cw"
                  size={13}
                  color={colors.primary}
                />
                <Text style={[styles.shuffleText, { color: colors.primary }]}>
                  {t('landingShuffle')}
                </Text>
              </Pressable>
            </View>
            <View style={styles.chipWrap}>
              {suggestionsQuery.isFetching && suggestions.length === 0 ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                suggestions.map((name) => (
                  <Pressable
                    key={name}
                    onPress={() => {
                      setDraft(name);
                      setClaimError(null);
                    }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor:
                          trimmed === name ? colors.secondary : colors.card,
                        borderColor:
                          trimmed === name ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: colors.foreground }]}>
                      {name}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>
          </View>
        )}

        {claimError && (
          <Text style={[styles.statusText, { color: colors.destructive ?? '#c0392b' }]}>
            {claimError}
          </Text>
        )}
        {!isOnline && (
          <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
            {t('landingOffline')}
          </Text>
        )}

        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          style={[
            styles.startBtn,
            { backgroundColor: colors.primary, opacity: canSubmit ? 1 : 0.5 },
          ]}
        >
          {claim.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.startText, { color: colors.primaryForeground }]}>
              {t('landingStart')}
            </Text>
          )}
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: { fontSize: 24, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  langRow: { flexDirection: 'row', gap: 10 },
  langBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  langText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  input: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  suggestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shuffleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  shuffleText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  startBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  startText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
});
