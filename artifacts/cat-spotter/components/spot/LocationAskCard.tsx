import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/purropolis/Button';
import { Card } from '@/components/purropolis/Card';
import { fonts, fontSizes, spacing } from '@/constants/theme';

interface Props {
  view: 'card' | 'link' | 'off-native' | 'off-web';
  /** An ask started here is running: "Use where I am" waits, the map stays open. */
  busy: boolean;
  onUse: () => void;
  onMap: () => void;
  onOpenSettings: () => void;
}

/**
 * SYC-524 (spec onboarding-fewer-screens.md §2): what Spot says about location
 * under "Where did you see it?" after a camera photo. 'card' explains first and
 * offers both ways; 'link' is the small "Use where I am" for later photos;
 * 'off-native' / 'off-web' say location is off and the map is the way.
 */
export function LocationAskCard({ view, busy, onUse, onMap, onOpenSettings }: Props) {
  const colors = useColors();
  const { t } = useLanguage();

  if (view === 'link') {
    return (
      <Pressable
        onPress={busy ? undefined : onUse}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy }}
        style={styles.link}
        testID="location-ask-link"
      >
        <Feather name="map-pin" size={14} color={colors.primary} />
        <Text style={[styles.linkText, { color: colors.primary }]}>
          {busy ? t('locating') : t('locAskUse')}
        </Text>
      </Pressable>
    );
  }

  if (view === 'off-native' || view === 'off-web') {
    return (
      <View style={styles.off} testID="location-off">
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {t(view === 'off-native' ? 'locOffNative' : 'locOffWeb')}
        </Text>
        {/* The browser has no settings page to open; the address bar is the way. */}
        {view === 'off-native' && (
          <Button variant="secondary" size="sm" onPress={onOpenSettings} testID="location-open-settings">
            {t('openSettings')}
          </Button>
        )}
      </View>
    );
  }

  return (
    <Card flat padding={spacing[4]}>
      <View style={styles.cardContent} testID="location-ask-card">
        <View style={styles.titleRow}>
          <Feather name="map-pin" size={18} color={colors.accent} />
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            {t('locAskTitle')}
          </Text>
        </View>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{t('locAskBody')}</Text>
        <Button
          variant="primary"
          block
          wrapLabel
          disabled={busy}
          busy={busy}
          onPress={onUse}
          testID="location-ask-use"
        >
          {busy ? t('locating') : t('locAskUse')}
        </Button>
        {/* Stays available while the phone looks for a position. */}
        <Button variant="secondary" block wrapLabel onPress={onMap} testID="location-ask-map">
          {t('locAskMap')}
        </Button>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  cardContent: { gap: spacing[3] },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title: { flexShrink: 1, fontSize: fontSizes.md, fontFamily: fonts.bodyBold },
  body: { fontSize: fontSizes.sm, fontFamily: fonts.body, lineHeight: 20 },
  off: { gap: spacing[2], alignItems: 'flex-start' },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], alignSelf: 'flex-start' },
  linkText: { fontSize: fontSizes.sm, fontFamily: fonts.bodyBold },
});
