import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetProfile, getGetProfileQueryKey } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useAppearance } from '@/context/AppearanceContext';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { useBannerAreaReserve } from '@/lib/bannerArea';
import { OfflineBanner } from '@/components/OfflineBanner';
import { UsernameEditor } from '@/components/UsernameEditor';
import { KeepSafeSettings } from '@/components/keepSafe/KeepSafeSettings';
import { NameNoteCard, sharedStyles, useSubtleText } from '@/components/profile/shared';
import { LANGUAGES } from '@/lib/i18n';

/**
 * SYC-628 §3.5: Settings, moved off the Profile tab onto their own screen.
 * Everything here behaves as it did on Profile.
 */
export default function SettingsScreen() {
  const colors = useColors();
  const subtle = useSubtleText();
  const insets = useSafeAreaInsets();
  const bannerReserve = useBannerAreaReserve();
  const { appearance, setAppearance } = useAppearance();
  const { t, language, setLanguage } = useLanguage();
  const { deviceId, username, heldUsername, nameNote, setNameNote } = useDevice();
  const { isOnline } = useOffline();
  const params = useLocalSearchParams<{ editName?: string }>();

  // Same query (and cache) as the Profile tab, for the current name.
  const profileQuery = useGetProfile(deviceId ?? '', {
    query: {
      enabled: !!deviceId && isOnline,
      queryKey: getGetProfileQueryKey(deviceId ?? ''),
    },
  });
  const profile = profileQuery.data;

  // SYC-506 / §8.7: "Change it" opens the name editor. From Profile it arrives
  // as ?editName=1; the editor opens on a request newer than its mount value,
  // so bump once it is mounted.
  const showEditor = isOnline && !!deviceId && !heldUsername;
  const [editRequest, setEditRequest] = useState(0);
  const askedFromProfile = useRef(params.editName === '1');
  useEffect(() => {
    if (showEditor && askedFromProfile.current) {
      askedFromProfile.current = false;
      setEditRequest((n) => n + 1);
    }
  }, [showEditor]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'));

  const appearanceOptions = [
    { key: 'system', label: t('appearanceSystem'), icon: 'smartphone' },
    { key: 'light', label: t('appearanceLight'), icon: 'sun' },
    { key: 'dark', label: t('appearanceDark'), icon: 'moon' },
  ] as const;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <View style={[styles.header, { paddingTop: insets.top + bannerReserve + 8 }]}>
        <Pressable
          testID="settings-back"
          onPress={leave}
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          style={styles.back}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]} accessibilityRole="header">
          {t('settingsTitle')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.section}>
          <Text style={[sharedStyles.eyebrow, { color: subtle }]}>{t('settingsYou')}</Text>
          {!!nameNote && (
            <NameNoteCard
              note={nameNote}
              onChange={() => {
                setNameNote(null);
                setEditRequest((n) => n + 1);
              }}
              onDismiss={() => setNameNote(null)}
            />
          )}
          {/* Waits until a name held offline has been saved, as before. */}
          {showEditor && (
            <UsernameEditor
              currentUsername={profile?.username ?? username ?? null}
              editRequest={editRequest}
            />
          )}
          <KeepSafeSettings />
        </View>

        <View style={styles.section}>
          <Text style={[sharedStyles.eyebrow, { color: subtle }]}>{t('language')}</Text>
          <View accessibilityRole="radiogroup" style={[styles.segment, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {LANGUAGES.map((lang) => {
              const active = lang.code === language;
              return (
                <Pressable
                  key={lang.code}
                  testID={`language-${lang.code}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, checked: active }}
                  aria-checked={active}
                  accessibilityLabel={lang.label}
                  onPress={() => setLanguage(lang.code)}
                  style={[styles.segmentBtn, { backgroundColor: active ? colors.primary : 'transparent' }]}
                >
                  <Text
                    style={[styles.segmentText, { color: active ? colors.primaryForeground : colors.foreground }]}
                  >
                    {lang.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[sharedStyles.eyebrow, { color: subtle }]}>{t('appearance')}</Text>
          <View accessibilityRole="radiogroup" style={[styles.segment, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {appearanceOptions.map((option) => {
              const active = option.key === appearance;
              return (
                <Pressable
                  key={option.key}
                  testID={`appearance-${option.key}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, checked: active }}
                  aria-checked={active}
                  accessibilityLabel={option.label}
                  onPress={() => setAppearance(option.key)}
                  style={[styles.segmentBtn, { backgroundColor: active ? colors.primary : 'transparent' }]}
                >
                  <Feather
                    name={option.icon}
                    size={16}
                    color={active ? colors.primaryForeground : colors.mutedForeground}
                  />
                  <Text
                    style={[styles.segmentText, { color: active ? colors.primaryForeground : colors.foreground }]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[sharedStyles.eyebrow, { color: subtle }]}>{t('settingsYourData')}</Text>
          {/* SYC-63: always here, whether or not an email was ever given. */}
          <Pressable
            testID="delete-my-data-row"
            accessibilityRole="button"
            accessibilityLabel={t('deleteMyDataRow')}
            accessibilityHint={t('deleteMyDataRowHint')}
            onPress={() => router.push('/delete-my-data')}
            style={[styles.deleteRow, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.deleteTitle, { color: colors.destructive }]}>{t('deleteMyDataRow')}</Text>
              <Text style={[styles.deleteHint, { color: subtle }]}>{t('deleteMyDataRowHint')}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingBottom: spacing[2],
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.displayBold, fontSize: fontSizes.xl },
  content: { padding: spacing[4], gap: spacing[5] },
  section: { gap: spacing[2] },
  segment: {
    flexDirection: 'row',
    gap: spacing[1],
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[1],
  },
  segmentBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    borderRadius: radii.sm,
    paddingHorizontal: spacing[1],
  },
  segmentText: { fontFamily: fonts.bodyBold, fontSize: fontSizes.xs, textAlign: 'center' },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing[3],
    minHeight: 44,
  },
  deleteTitle: { fontFamily: fonts.bodyBold, fontSize: fontSizes.md },
  deleteHint: { fontFamily: fonts.body, fontSize: fontSizes.xs },
});
