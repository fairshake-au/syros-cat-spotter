import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { fonts } from '@/constants/theme';

/**
 * Renders the guidance file's one piece of markup: **bold**, exactly where
 * the spec has it (docs/specs/team-access-and-welfare-queue.md §5.3). Nothing
 * else is interpreted, so the file can't carry links or layout.
 */
export function RichText({
  text,
  style,
  role,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  role?: 'heading';
}) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text style={style} role={role}>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <Text key={i} style={styles.bold}>
            {part.slice(2, -2)}
          </Text>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  bold: { fontFamily: fonts.bodyBold, fontWeight: '700' },
});
