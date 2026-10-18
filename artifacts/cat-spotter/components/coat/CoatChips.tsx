import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { COLOURS, PATTERNS, type Colour, type Pattern, type Picked } from '@/lib/coat';
import { borderWidths, fonts, fontSizes, radii } from '@/constants/theme';
import { ColourSwatch } from './ColourSwatch';
import { PatternTile } from './PatternTile';

/** Both rows at *All*: nothing picked. */
export const NOTHING_PICKED: Picked = { colours: new Set(), patterns: new Set() };

/**
 * The two rows of drawn chips (coat-colours-and-pattern.md §5): colours
 * *All · Black · Grey · Brown · Ginger · White* and patterns *All · Plain ·
 * Stripes · Patches*. Each chip is a drawing plus its word, and a toggle:
 * within a row any number can be picked, and *All* clears the row.
 */
export function CoatChips({ picked, onChange }: { picked: Picked; onChange: (next: Picked) => void }) {
  const { t } = useLanguage();
  const toggle = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  return (
    <View style={styles.rows}>
      <View style={styles.row}>
        <CoatChip
          testID="coat-chip-colour-all"
          label={t('coatAll')}
          selected={picked.colours.size === 0}
          drawing={<ColourSwatch colour="all" />}
          onPress={() => onChange({ ...picked, colours: new Set() })}
        />
        {COLOURS.map((c: Colour) => (
          <CoatChip
            key={c}
            testID={`coat-chip-colour-${c}`}
            label={t(`coat_${c}`)}
            selected={picked.colours.has(c)}
            drawing={<ColourSwatch colour={c} />}
            onPress={() => onChange({ ...picked, colours: toggle(picked.colours, c) })}
          />
        ))}
      </View>
      <View style={styles.row}>
        <CoatChip
          testID="coat-chip-pattern-all"
          label={t('coatAll')}
          selected={picked.patterns.size === 0}
          drawing={<PatternTile pattern="all" />}
          onPress={() => onChange({ ...picked, patterns: new Set() })}
        />
        {PATTERNS.map((p: Pattern) => (
          <CoatChip
            key={p}
            testID={`coat-chip-pattern-${p}`}
            label={t(`pattern_${p}`)}
            selected={picked.patterns.has(p)}
            drawing={<PatternTile pattern={p} />}
            onPress={() => onChange({ ...picked, patterns: toggle(picked.patterns, p) })}
          />
        ))}
      </View>
    </View>
  );
}

function CoatChip({
  testID,
  label,
  selected,
  drawing,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  drawing: ReactNode;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      // react-native-web 0.21 drops accessibilityState, so on the web a
      // screen reader hears the toggle through aria-pressed (aria-selected
      // isn't valid on a button).
      aria-pressed={selected}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.card,
          borderColor: selected ? colors.primary : colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {drawing}
      <Text style={[styles.label, { color: selected ? colors.primaryForeground : colors.foreground }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    // A comfortable tap target (44 points), as elsewhere in the app.
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: radii.pill,
    borderWidth: borderWidths.thin,
  },
  label: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.xs },
});
