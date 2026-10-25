import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { WelfareGuidance } from '@workspace/welfare-guidance';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { fonts } from '@/constants/theme';
import { Fold } from './Fold';
import { RichText } from './RichText';
import { MunicipalityCard, VetList } from './VetList';
import type { LatLng } from '@/lib/vetOrder';

/**
 * The "Urgent" advice, spec §5.3(b), on the "Before you send" screen. It is
 * guidance before the report, never instead of it: nothing here blocks Send.
 *
 * Presentation (Samuel, 2 Oct 2026: the advice screen must not scroll):
 *  - the lead: the vet route, never the discouraging half (§5.2);
 *  - the cage line;
 *  - the three vets as tap-to-call cards with map links, nearest first when
 *    the phone's position is known (SYC-570: they also have their own screen
 *    before this one for an Urgent report);
 *  - "How to get a hurt cat to a vet": folded, behind a prominent button;
 *  - "Costs, and the Municipality": folded, holding what the vet does, the
 *    cost, the decision at the desk and the Municipality (with its number);
 *  - the capacity paragraph, ALWAYS in full and always the last thing, so it
 *    sits directly above the pinned "Send report" button.
 *
 * The words are the guidance file's, pinned by a test
 * (artifacts/api-server/src/lib/welfareGuidance.test.ts). Folding changes
 * how they are shown, not what they say. The cage still comes before any
 * handling: the handling paragraph is inside the how-to, after the cage line.
 */
export function UrgentAdvice({ guidance, from = null }: { guidance: WelfareGuidance; from?: LatLng | null }) {
  const colors = useColors();
  const { t } = useLanguage();
  const u = guidance.copy.urgent;
  const para = [styles.para, { color: colors.foreground }];

  return (
    <View style={styles.block}>
      <RichText text={u.intro} style={[styles.lead, { color: colors.foreground }]} />
      <RichText text={u.cage} style={para} />

      <VetList guidance={guidance} compact from={from} heading={u.vetListHeading} />

      <Fold title={u.howToHeading} icon="info">
        {u.steps.map((step, i) => (
          <RichText key={i} text={step} style={para} />
        ))}
        <RichText text={u.wontGoIn} style={para} />
      </Fold>

      <Fold title={t('reportCostsHeading')} icon="credit-card">
        <RichText text={u.vetDoes} style={para} />
        <RichText text={u.cost} style={para} />
        <RichText text={u.decision} style={para} />
        <RichText text={u.municipality} style={para} />
        <MunicipalityCard guidance={guidance} />
      </Fold>

      {/* Always shown in full, never folded, always last (Samuel, 1-2 Oct 2026). */}
      <RichText text={u.capacity} style={[styles.capacity, { color: colors.foreground }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 6 },
  lead: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 20 },
  para: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19 },
  capacity: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17 },
});
