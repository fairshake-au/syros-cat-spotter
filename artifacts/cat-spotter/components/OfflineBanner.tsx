import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useOffline } from '@/context/OfflineContext';

export function OfflineBanner() {
  const colors = useColors();
  const { t } = useLanguage();
  const { isOnline } = useOffline();

  if (isOnline) return null;

  return (
    <View
      style={[styles.banner, { backgroundColor: colors.accent }]}
      accessibilityLiveRegion="polite"
      aria-live="polite"
    >
      <Feather name="wifi-off" size={14} color={colors.accentForeground} aria-hidden />
      <Text style={[styles.text, { color: colors.accentForeground }]}>
        {t('offlineBanner')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
});
