import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useBannerAreaReserve } from '@/lib/bannerArea';
import { Avatar } from '@/components/purropolis';

export type ProfileTab = 'me' | 'badges' | 'spotters';

/**
 * SYC-628 §3.1: the blue header shared by the three Profile tabs. Name,
 * a "Spotter · 4th on the island" line, the labelled Settings button
 * (never icon-only: Samuel, 23 Oct), and the Me / Badges / Spotters tabs.
 */
export function ProfileHeader({
  name,
  nameNotSaved,
  emailNotSaved = false,
  rankLine,
  tab,
  onTab,
}: {
  name: string;
  nameNotSaved: boolean;
  /** SYC-715: an email typed when the server gave no answer, still waiting to be saved. */
  emailNotSaved?: boolean;
  rankLine: string | null;
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const bannerReserve = useBannerAreaReserve();

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: 'me', label: t('profileTabMe') },
    { key: 'badges', label: t('statBadges') },
    { key: 'spotters', label: t('profileTabSpotters') },
  ];
  const onPrimary = colors.primaryForeground;

  return (
    <View
      style={[
        styles.header,
        { backgroundColor: colors.primary, paddingTop: insets.top + bannerReserve + 20 },
      ]}
    >
      <View style={styles.identity}>
        <Avatar name={name} ring size="lg" />
        <View style={styles.names}>
          <Text
            testID="profile-name"
            style={[styles.name, { color: onPrimary }]}
            numberOfLines={1}
          >
            {name}
          </Text>
          {nameNotSaved && (
            <Text style={[styles.sub, { color: onPrimary }]}>{t('nameNotSavedYet')}</Text>
          )}
          <Text testID="profile-rank-line" style={[styles.sub, { color: onPrimary }]} numberOfLines={2}>
            {rankLine ? `${t('profileRole')} · ${rankLine}` : t('profileRole')}
          </Text>
        </View>
        <Pressable
          testID="profile-settings-button"
          accessibilityRole="button"
          accessibilityLabel={t('profileSettingsButton')}
          onPress={() => router.push('/settings')}
          style={({ pressed }) => [styles.settings, pressed && { opacity: 0.8 }]}
        >
          <Feather name="settings" size={18} color={onPrimary} />
          <Text style={[styles.settingsText, { color: onPrimary }]}>{t('profileSettingsButton')}</Text>
        </Pressable>
      </View>

      {/* Full width, under the avatar row: this line is long, and beside the
          Settings button it would squeeze the name (SYC-715, checked at 320px). */}
      {emailNotSaved && (
        <Text testID="profile-email-not-saved" style={[styles.sub, { color: onPrimary }]}>
          {t('emailNotSavedYet')}
        </Text>
      )}

      <View accessibilityRole="tablist" style={styles.tabs}>
        {tabs.map((item) => {
          const active = item.key === tab;
          return (
            <Pressable
              key={item.key}
              testID={`profile-tab-${item.key}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              onPress={() => onTab(item.key)}
              style={[
                styles.tab,
                { borderBottomColor: active ? palette.sun500 : 'transparent' },
              ]}
            >
              {/* Shrink-to-fit works on phones only; react-native-web cuts long
                  labels with "…" instead (SYC-628 review #6). */}
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={[
                  styles.tabText,
                  { color: onPrimary, opacity: active ? 1 : 0.85 },
                  active && styles.tabTextActive,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing[4], gap: spacing[4] },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  names: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: fonts.displayBold, fontSize: fontSizes.xl },
  sub: { fontFamily: fonts.body, fontSize: fontSizes.xs, opacity: 0.92 },
  settings: {
    flexShrink: 0,
    minHeight: 44,
    paddingLeft: spacing[3],
    paddingRight: spacing[4],
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'rgba(255,255,255,0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  settingsText: { fontFamily: fonts.bodyBold, fontSize: fontSizes.sm },
  tabs: { flexDirection: 'row' },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
    paddingHorizontal: spacing[1],
  },
  tabText: { fontFamily: fonts.bodySemiBold, fontSize: fontSizes.md },
  tabTextActive: { fontFamily: fonts.bodyBold },
});
