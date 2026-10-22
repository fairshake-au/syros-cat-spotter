import React from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { APP_COLUMN_MAX_WIDTH, isWide } from '@/lib/appColumn';

/**
 * SYC-6: on the web, keeps the whole app to a centred phone-width column so a
 * cat's page, Home and the stat tiles don't stretch across a desktop window.
 * Both sides use the app's own background, so light and dark both match. The
 * column is a positioned box, so the tab bar and the floating banners (all
 * `position: absolute`) sit inside it. Native is untouched.
 */
export function AppColumn({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  if (Platform.OS !== 'web') return <>{children}</>;
  const wide = isWide(width);
  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <View
        testID="app-column"
        style={[
          styles.column,
          { maxWidth: APP_COLUMN_MAX_WIDTH },
          { backgroundColor: colors.background },
          wide && { borderColor: colors.border, borderLeftWidth: 1, borderRightWidth: 1 },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%', overflow: 'hidden' },
});
