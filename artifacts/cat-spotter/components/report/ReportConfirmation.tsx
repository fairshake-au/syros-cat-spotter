import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { WelfareGuidance } from '@workspace/welfare-guidance';
import type { ConfirmationState } from '@/lib/reportQueue';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/purropolis';
import { fonts, spacing } from '@/constants/theme';
import { RichText } from './RichText';
import { VetList } from './VetList';

/**
 * The screen straight after a report (spec §5.3(e), as cut by DECISIONS
 * Part 2b; SYC-42 plan item 1.12).
 *
 * "Sent. Syros Cats have this." ONLY once the server has accepted the text.
 * A report saved on the phone says so, and is never called sent (plan test
 * 20). The "if an email was given" line isn't here: Slice 1 collects no
 * address (Decision 4). Whatever happened to the report, the vet advice is
 * on screen.
 */
export function ReportConfirmation({
  state,
  guidance,
  onDone,
}: {
  state: ConfirmationState;
  guidance: WelfareGuidance;
  onDone: () => void;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const c = guidance.copy.confirmation;
  const para = [styles.para, { color: colors.foreground }];

  return (
    <View style={styles.block}>
      {state === 'sent' ? (
        <>
          <Text role="heading" style={[styles.heading, { color: colors.foreground }]}>
            {c.sentHeading}
          </Text>
          <Text style={para}>{c.sentBody}</Text>
        </>
      ) : state === 'sending' ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text role="heading" style={[styles.headingSmall, { color: colors.foreground }]}>
            {t('reportSending')}
          </Text>
        </View>
      ) : state === 'failed' ? (
        <Text role="heading" style={[styles.headingSmall, { color: colors.destructive }]}>
          {t('reportFailed')}
        </Text>
      ) : (
        <Text role="heading" style={[styles.headingSmall, { color: colors.foreground }]}>
          {c.offline}
        </Text>
      )}

      <RichText text={c.next} style={para} />
      <RichText text={c.hurt} style={para} />
      <VetList guidance={guidance} />

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
