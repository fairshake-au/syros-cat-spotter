import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useReportQueue } from '@/context/ReportQueueContext';

/**
 * Spec §4.3 (SYC-42 plan item 1.13): "You have a cat report that hasn't sent
 * yet." Once per report, 24 hours on. The website can't notify when closed,
 * so this is its reminder, shown the next time it's opened. Tapping it tries
 * to send again. Mounted in BannerStack.
 */
export function ReportReminderBanner() {
  const colors = useColors();
  const { t } = useLanguage();
  const { reminderVisible, dismissReminder, syncNow } = useReportQueue();
  if (!reminderVisible) return null;
  return (
    <Pressable
      onPress={() => {
        dismissReminder();
        void syncNow();
      }}
      style={[styles.banner, { backgroundColor: colors.accent, shadowColor: '#000' }]}
      accessibilityRole="button"
    >
      <Feather name="alert-circle" size={16} color={colors.accentForeground} />
      <Text style={[styles.text, { color: colors.accentForeground }]}>{t('reportReminder')}</Text>
      <Pressable onPress={dismissReminder} hitSlop={10} accessibilityLabel={t('homeScreenNudgeDismissLabel')}>
        <Feather name="x" size={16} color={colors.accentForeground} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  text: { flex: 1, fontSize: 13, fontFamily: 'Inter_700Bold' },
});
