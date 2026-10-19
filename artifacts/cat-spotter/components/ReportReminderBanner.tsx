import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useReportQueue } from '@/context/ReportQueueContext';
import { useIssueQueue } from '@/context/IssueQueueContext';

/**
 * Spec §4.3 (SYC-42 plan item 1.13): "You have a cat report that hasn't sent
 * yet." Once per report, 24 hours on. The website can't notify when closed,
 * so this is its reminder, shown the next time it's opened. Tapping it tries
 * to send again. Mounted in BannerStack.
 */
export function ReportReminderBanner() {
  const { t } = useLanguage();
  const { reminderVisible, dismissReminder, retryFailed } = useReportQueue();
  if (!reminderVisible) return null;
  return <ReminderBanner text={t('reportReminder')} onDismiss={dismissReminder} onRetry={retryFailed} />;
}

/**
 * The same reminder for a "Report an issue" report (SYC-44 PR 6.2; spec
 * §4.2: the one reminder after 24 hours), from its own saved list.
 */
export function IssueReminderBanner() {
  const { t } = useLanguage();
  const { reminderVisible, dismissReminder, retryFailed } = useIssueQueue();
  if (!reminderVisible) return null;
  return <ReminderBanner text={t('issueReminder')} onDismiss={dismissReminder} onRetry={retryFailed} />;
}

function ReminderBanner({
  text,
  onDismiss,
  onRetry,
}: {
  text: string;
  onDismiss: () => void;
  onRetry: () => Promise<void>;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const tryAgain = () => {
    onDismiss();
    void onRetry();
  };
  return (
    <Pressable
      onPress={tryAgain}
      style={[styles.banner, { backgroundColor: colors.accent, shadowColor: '#000' }]}
      accessibilityRole="button"
    >
      <Feather name="alert-circle" size={16} color={colors.accentForeground} />
      <Text style={[styles.text, { color: colors.accentForeground }]}>{text}</Text>
      <Pressable onPress={tryAgain} hitSlop={8} accessibilityRole="button">
        <Text style={[styles.action, { color: colors.accentForeground }]}>{t('reportTryAgain')}</Text>
      </Pressable>
      <Pressable onPress={onDismiss} hitSlop={10} accessibilityLabel={t('homeScreenNudgeDismissLabel')}>
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
  action: { fontSize: 13, fontFamily: 'Inter_700Bold', textDecorationLine: 'underline' },
});
