import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { WelfareGuidance } from '@workspace/welfare-guidance';
import { useColors } from '@/hooks/useColors';
import { fonts, spacing } from '@/constants/theme';
import { RichText } from './RichText';

/** "Needs attention", spec §5.3(c). Shown before Send; never blocks it. */
export function AttentionAdvice({ guidance }: { guidance: WelfareGuidance }) {
  const colors = useColors();
  const a = guidance.copy.attention;
  return (
    <View style={styles.block}>
      <Text role="heading" style={[styles.heading, { color: colors.foreground }]}>
        {a.heading}
      </Text>
      {a.paragraphs.map((p, i) => (
        <RichText key={i} text={p} style={[styles.para, { color: colors.foreground }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing[3] },
  heading: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 24 },
  para: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
});
