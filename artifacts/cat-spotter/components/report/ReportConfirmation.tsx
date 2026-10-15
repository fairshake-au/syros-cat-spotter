import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import type { WelfareGuidance } from '@workspace/welfare-guidance';
import type { ConfirmationState } from '@/lib/reportQueue';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/purropolis';
import { fonts, spacing } from '@/constants/theme';
import { savedWording } from '@/lib/savedWording';
import type { Language } from '@/lib/i18n';
import { RichText } from './RichText';
import { VetList } from './VetList';

/**
 * The screen straight after a report (spec §5.3(e), as cut by DECISIONS
 * Part 2b; SYC-42 plan item 1.12).
 *
 * "Sent. Syros Cats have this." ONLY once the server has accepted the text.
 * A report saved on the phone says so, and is never called sent (plan test
 * 20). Whatever happened to the report, the vet advice is on screen.
 *
 * SYC-42 Slice 3: if they left an address, §5.3(e)'s "[If an email was
 * given]" line once the server has the report, or, while it's still on the
 * phone, that the check goes when they're back online (email-capture.md
 * §4.3). Never that it has gone when it hasn't.
 */
export function ReportConfirmation({
  state,
  guidance,
  onDone,
  onRetry,
  hasPhoto = true,
  emailGiven = false,
}: {
  state: ConfirmationState;
  guidance: WelfareGuidance;
  /** SYC-180: a report sent without a photo never says the photo is saved. */
  hasPhoto?: boolean;
  /** SYC-42 Slice 3: the reporter left an address with this report. */
  emailGiven?: boolean;
  onDone: () => void;
  /** Failed only: put the report back in the queue and send. */
  onRetry?: () => void;
}) {
  const colors = useColors();
  const { t, language } = useLanguage();
  const c = guidance.copy.confirmation;
  // On the website a waiting report is saved in the browser, not on a phone.
  const saved = (text: string) => savedWording(text, language as Language, Platform.OS === 'web');
  const para = [styles.para, { color: colors.foreground }];

  return (
    <View style={styles.block}>
      {state === 'sent' ? (
        <>
          <Text role="heading" style={[styles.heading, { color: colors.foreground }]}>
            {c.sentHeading}
          </Text>
          <Text style={para}>{hasPhoto ? c.sentBody : c.sentBodyNoPhoto}</Text>
        </>
      ) : state === 'sending' ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text role="heading" style={[styles.headingSmall, { color: colors.foreground }]}>
            {t('reportSending')}
          </Text>
        </View>
      ) : state === 'busy' ? (
        <Text role="heading" style={[styles.headingSmall, { color: colors.foreground }]}>
          {saved(t('reportBusy'))}
        </Text>
      ) : state === 'blocked' ? (
        <Text role="heading" style={[styles.headingSmall, { color: colors.foreground }]}>
          {t('reportCheckBlocked')}
        </Text>
      ) : state === 'check' ? (
        <Text role="heading" style={[styles.headingSmall, { color: colors.foreground }]}>
          {t('reportCheckUnavailable')}
        </Text>
      ) : state === 'failed' ? (
        <Text role="heading" style={[styles.headingSmall, { color: colors.destructive }]}>
          {saved(t('reportFailed'))}
        </Text>
      ) : (
        <Text role="heading" style={[styles.headingSmall, { color: colors.foreground }]}>
          {saved(c.offline)}
        </Text>
      )}

      <RichText text={c.next} style={para} />
      <RichText text={c.hurt} style={para} />
      <VetList guidance={guidance} />

      {emailGiven && state === 'sent' && (
        <Text style={para} testID="report-email-line">{c.emailGiven}</Text>
      )}
      {emailGiven && (state === 'queued' || state === 'busy' || state === 'sending') && (
        <Text style={para} testID="report-email-line">{c.emailGivenOffline}</Text>
      )}

      {state === 'failed' && onRetry && (
        <Button variant="primary" size="lg" block onPress={onRetry}>
          {t('reportTryAgain')}
        </Button>
      )}
      <Button variant="secondary" size="lg" block onPress={onDone}>
        {t('reportDone')}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  heading: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 30 },
  headingSmall: { fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 24, flexShrink: 1 },
  para: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
});
