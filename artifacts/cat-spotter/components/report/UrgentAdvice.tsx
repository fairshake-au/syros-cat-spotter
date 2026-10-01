import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { WelfareGuidance } from '@workspace/welfare-guidance';
import { useColors } from '@/hooks/useColors';
import { fonts, radii, spacing } from '@/constants/theme';
import { RichText } from './RichText';
import { VetList } from './VetList';

/**
 * The "Urgent" advice, spec §5.3(b), shown BEFORE the report is sent
 * (guidance before the report, never instead of it: nothing here blocks Send).
 *
 * Layout is part of the design (§5.2): a short lead that is never the
 * discouraging half ("Send this…"), the cage line, the vets, then a labelled
 * expander "How to get a hurt cat to a vet", open by default on first use.
 * The cage comes before any handling, and handling is the fallback (§10).
 *
 * The words come from the guidance file and are pinned by a test
 * (artifacts/api-server/src/lib/welfareGuidance.test.ts): changing them goes
 * back through Samuel (§5.4).
 */
export function UrgentAdvice({
  guidance,
  firstUse,
}: {
  guidance: WelfareGuidance;
  /** Open the how-to the first time someone sees this block (§5.2). */
  firstUse: boolean;
}) {
  const colors = useColors();
  const u = guidance.copy.urgent;
  const [open, setOpen] = useState(firstUse);
  const para = [styles.para, { color: colors.foreground }];

  return (
    <View style={styles.block}>
      <RichText text={u.send} style={[styles.lead, { color: colors.foreground }]} />
      <RichText text={u.intro} style={para} />
      <RichText text={u.cage} style={para} />

      <Text role="heading" style={[styles.subheading, { color: colors.foreground }]}>
        {u.vetListHeading}
      </Text>
      <VetList guidance={guidance} />

      <View style={[styles.expander, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={styles.expanderHeader}
        >
          <Feather name={open ? 'chevron-down' : 'chevron-right'} size={18} color={colors.foreground} />
          <Text style={[styles.subheading, styles.expanderTitle, { color: colors.foreground }]}>
            {u.howToHeading}
          </Text>
        </Pressable>
        {open && (
          <View style={styles.expanderBody}>
            {u.steps.map((step, i) => (
              <RichText key={i} text={step} style={para} />
            ))}
            <RichText text={u.wontGoIn} style={para} />
          </View>
        )}
      </View>

      <RichText text={u.vetDoes} style={para} />
      <RichText text={u.cost} style={para} />
      <RichText text={u.decision} style={para} />
      <RichText text={u.municipality} style={para} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing[3] },
  lead: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24 },
  para: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  subheading: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22 },
  expander: { borderWidth: 1, borderRadius: radii.md, overflow: 'hidden' },
  expanderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    minHeight: 44,
  },
  expanderTitle: { flex: 1 },
  expanderBody: { paddingHorizontal: spacing[3], paddingBottom: spacing[3], gap: spacing[3] },
});
