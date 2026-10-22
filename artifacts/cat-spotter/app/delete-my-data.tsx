import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useOffline } from '@/context/OfflineContext';
import { useDeleteMyData } from '@/context/DeleteMyDataContext';
import { useReportQueue } from '@/context/ReportQueueContext';
import { useIssueQueue } from '@/context/IssueQueueContext';
import { Button } from '@/components/purropolis';
import type { DeleteOutcome, ReportChoice } from '@/lib/deleteMyData';

/**
 * "Delete my data" (SYC-63). The words are email-capture.md §6.3 exactly,
 * plus the lines Samuel approved on 29 Sep: no connection (E), unsent spots
 * (B), and a cat that lives with them (A). "Keep my data" is the safe
 * default and carries the visual weight.
 *
 * The "Done" screen that follows is DeleteMyDataDone, shown by the root gate.
 */
export default function DeleteMyDataScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isOnline, unsentCount } = useOffline();
  const { deleteNow } = useDeleteMyData();
  // SYC-234: cat reports still waiting on the phone. The person chooses.
  // Not before the report store has loaded: a 0 that's really "not read
  // yet" would skip the question (#97 review, finding 9).
  const reportQueue = useReportQueue();
  // SYC-44 PR 6.2: a waiting "Report an issue" report is a report about a
  // cat too, so it is counted in the same choice and follows it.
  const issueQueue = useIssueQueue();
  const reportCount = reportQueue.reports.length + issueQueue.issues.length;
  const reportsReady = reportQueue.ready && issueQueue.ready;
  const many = reportCount > 1;
  const pick = (one: string, several: string) =>
    many ? t(several).replace('{n}', String(reportCount)) : t(one);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<DeleteOutcome | null>(null);

  // Can't be dismissed half-way (plan §1.3).
  useEffect(() => {
    if (!working) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [working]);

  const close = () => {
    if (working) return;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile');
  };

  const onDelete = async (reports: ReportChoice = 'none') => {
    setWorking(true);
    setOutcome(null);
    const result = await deleteNow(reports);
    // On 'done' the root gate has already moved to the Done screen.
    if (result !== 'done') {
      setOutcome(result);
      setWorking(false);
    }
  };

  const muted = { color: colors.mutedForeground };
  const body = [styles.body, { color: colors.foreground }];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: !working }} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={close}
          disabled={working}
          accessibilityRole="button"
          accessibilityLabel={t('deleteKeep')}
          hitSlop={12}
          style={{ opacity: working ? 0.3 : 1 }}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]} accessibilityRole="header">
          {t('deleteTitle')}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      >
        <Text style={body}>
          {t('deleteIntro')} <Text style={styles.bold}>{t('deleteCantUndo')}</Text>
          {t('deleteIntroEnd')}
        </Text>

        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.foreground }]}>{t('deleteWhatGoes')}</Text>
          <Text style={body}>{t('deleteWhatGoesBody')}</Text>
          {unsentCount > 0 && (
            <Text style={[body, styles.bold]} testID="delete-unsent-line">
              {unsentCount === 1
                ? t('deleteUnsentOne')
                : t('deleteUnsentMany').replace('{n}', String(unsentCount))}
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.foreground }]}>{t('deleteWhatStays')}</Text>
          <Text style={body}>{t('deleteWhatStaysBody')}</Text>
          <Text style={body}>{t('deleteWhatStaysNames')}</Text>
          <Text style={body} testID="delete-home-line">
            {t('deleteWhatStaysHome')}
          </Text>
        </View>

        {reportCount > 0 && (
          <View style={styles.section} testID="delete-reports-block">
            <Text style={[body, styles.bold]}>
              {pick('deleteReportsOne', 'deleteReportsMany')}
            </Text>
            <Text style={body}>
              {pick('deleteReportsExplainOne', 'deleteReportsExplainMany')}
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <Button variant="primary" size="lg" block onPress={close} disabled={working}>
            {t('deleteKeep')}
          </Button>
          {reportCount === 0 ? (
            <Button
              variant="ghost"
              size="md"
              block
              onPress={() => onDelete()}
              disabled={working || !isOnline || !reportsReady}
              accessibilityLabel={t('deleteConfirm')}
            >
              {working ? t('deleteWorking') : t('deleteConfirm')}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="md"
                block
                onPress={() => onDelete('send')}
                disabled={working || !isOnline || !reportsReady}
                accessibilityLabel={pick('deleteSendReportsOne', 'deleteSendReportsMany')}
              >
                {working
                  ? t('deleteWorking')
                  : pick('deleteSendReportsOne', 'deleteSendReportsMany')}
              </Button>
              <Button
                variant="ghost"
                size="md"
                block
                onPress={() => onDelete('delete')}
                disabled={working || !isOnline || !reportsReady}
                accessibilityLabel={pick('deleteReportsTooOne', 'deleteReportsTooMany')}
              >
                {pick('deleteReportsTooOne', 'deleteReportsTooMany')}
              </Button>
            </>
          )}
          {working && <ActivityIndicator color={colors.mutedForeground} />}
          {!isOnline && !working && (
            <Text style={[styles.note, muted]} testID="delete-offline-line">
              {t('deleteNeedsConnection')}
            </Text>
          )}
          {outcome === 'failed' && (
            <Text style={[styles.note, { color: colors.destructive }]} accessibilityRole="alert">
              {t('deleteFailed')}
            </Text>
          )}
          {outcome === 'reports_unsent' && (
            <Text
              style={[styles.note, { color: colors.destructive }]}
              accessibilityRole="alert"
            >
              {pick('deleteReportsUnsentOne', 'deleteReportsUnsentMany')}
            </Text>
          )}
          {outcome === 'wipe_failed' && (
            <Text style={[styles.note, { color: colors.destructive }]} accessibilityRole="alert">
              {t('deleteWipeFailed')}
            </Text>
          )}
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
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[3],
  },
  title: { fontSize: fontSizes.xl, fontFamily: fonts.displayBold, flex: 1 },
  content: {
    paddingHorizontal: spacing[4],
    gap: spacing[4],
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  section: { gap: spacing[2] },
  heading: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  body: { fontSize: fontSizes.xs, fontFamily: fonts.body, lineHeight: fontSizes.xs * 1.4 },
  bold: { fontFamily: fonts.bodyBold },
  note: { fontSize: fontSizes.xs, fontFamily: fonts.body, textAlign: 'center' },
  actions: { gap: spacing[3], marginTop: spacing[2] },
});
