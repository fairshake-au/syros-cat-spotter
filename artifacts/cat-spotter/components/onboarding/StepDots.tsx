import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

/** The design's progress pips: the active step is a wide pill, the rest dots. */
export function StepDots({ total, active }: { total: number; active: number }) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i === active
              ? { width: 22, backgroundColor: colors.primary }
              : { width: 6, backgroundColor: colors.border },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { height: 6, borderRadius: 3 },
});
