import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { fonts, radii, spacing } from '@/constants/theme';

/**
 * A closed-by-default card with a tappable header. Used by the report's
 * "Before you send" advice (tone "urgent", the default: the urgent-primary
 * border) and by the Help & info page (tone "plain": the ordinary card
 * border). The default keeps UrgentAdvice rendering exactly as before.
 */
export function Fold({
  title,
  icon,
  children,
  tone = 'urgent',
}: {
  title: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  children: React.ReactNode;
  tone?: 'urgent' | 'plain';
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const borderColor = tone === 'plain' ? colors.border : colors.primary;
  return (
    <View style={[styles.fold, { borderColor, backgroundColor: colors.card }]}>
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

const styles = StyleSheet.create({
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
