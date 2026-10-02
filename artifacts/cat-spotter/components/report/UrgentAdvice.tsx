import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { WelfareGuidance } from '@workspace/welfare-guidance';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { fonts, radii, spacing } from '@/constants/theme';
import { RichText } from './RichText';
import { MunicipalityCard, VetList } from './VetList';

/**
 * The "Urgent" advice, spec §5.3(b), on the "Before you send" screen. It is
 * guidance before the report, never instead of it: nothing here blocks Send.
 *
 * Presentation (Samuel, 2 Oct 2026: the advice screen must not scroll):
 *  - the lead: the vet route, never the discouraging half (§5.2);
 *  - the cage line;
 *  - the three vets as compact tap-to-call cards with map links;
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
function Fold({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  children: React.ReactNode;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.fold, { borderColor: colors.primary, backgroundColor: colors.card }]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        style={styles.foldHeader}
      >
        <Feather name={icon} size={18} color={colors.primary} />
        <Text style={[styles.foldTitle, { color: colors.primary }]}>{title}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.primary} />
      </Pressable>
      {open && <View style={styles.foldBody}>{children}</View>}
    </View>
  );
}

export function UrgentAdvice({ guidance }: { guidance: WelfareGuidance }) {
  const colors = useColors();
  const { t } = useLanguage();
  const u = guidance.copy.urgent;
  const para = [styles.para, { color: colors.foreground }];

  return (
    <View style={styles.block}>
      <RichText text={u.intro} style={[styles.lead, { color: colors.foreground }]} />
      <RichText text={u.cage} style={para} />

      <Text role="heading" style={[styles.subheading, { color: colors.foreground }]}>
        {u.vetListHeading}
      </Text>
      <VetList guidance={guidance} compact />

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
  block: { gap: 10 },
  lead: { fontFamily: fonts.bodySemiBold, fontSize: 16, lineHeight: 22 },
  para: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  capacity: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  subheading: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 18 },
  fold: { borderWidth: 1.5, borderRadius: radii.md, overflow: 'hidden' },
  foldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    minHeight: 44,
  },
  foldTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 18, paddingVertical: 8 },
  foldBody: { paddingHorizontal: spacing[3], paddingBottom: spacing[3], gap: spacing[2] },
});
