import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { WelfareGuidance } from '@workspace/welfare-guidance';
import { palette } from '@/constants/colors';
import { fonts, radii, spacing } from '@/constants/theme';
import { RichText } from './RichText';

/**
 * Kittens, spec §5.3(d): please don't move them. Deliberately no donation
 * ask here (somebody crouched over a box is not being asked for money).
 */
export function LitterAdvice({ guidance }: { guidance: WelfareGuidance }) {
  const l = guidance.copy.litter;
  return (
    <View style={[styles.block, { backgroundColor: palette.sun100 }]}>
      <Text role="heading" style={[styles.heading, { color: palette.aegean950 }]}>
        {l.heading}
      </Text>
      {l.paragraphs.map((p, i) => (
        <RichText key={i} text={p} style={[styles.para, { color: palette.aegean950 }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing[3], padding: spacing[3], borderRadius: radii.md },
  heading: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 23 },
  para: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
});
