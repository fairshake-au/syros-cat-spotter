import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/purropolis';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';

/**
 * "Your spots moved to a new phone" (SYC-3 plan, Slice 1 step 8 and appendix).
 * Shown whenever the server says `device_moved`. The offline queue has stopped
 * sending. **Start again as a new spotter** forgets this phone's old identity
 * and goes back to onboarding; sightings saved here and not yet sent are kept,
 * and go under the new spotter once it has a name.
 */
export function MovedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { username, startAgain } = useDevice();
  const { pending } = useOffline();
  const [busy, setBusy] = useState(false);
  const unsent = pending.filter((p) => p.status === 'queued').length;

  return (
    <View
      testID="moved-screen"
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top + spacing[6], paddingBottom: insets.bottom + spacing[5] },
      ]}
    >
      <View style={styles.body}>
        <Text style={styles.emoji} allowFontScaling={false}>
          📱
        </Text>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
          {t('movedTitle')}
        </Text>
        <Text style={[styles.text, { color: colors.foreground }]}>
          {username ? t('movedBody').replace('{username}', username) : t('movedBodyNoName')}
        </Text>
        {unsent > 0 ? (
          <Text testID="moved-unsent" style={[styles.text, { color: colors.mutedForeground }]}>
            {unsent === 1 ? t('movedPendingOne') : t('movedPendingMany').replace('{n}', String(unsent))}
          </Text>
        ) : null}
      </View>
      <Button
        variant="primary"
        size="lg"
        block
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await startAgain();
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('movedStartAgain')}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing[5] },
  body: { flex: 1, justifyContent: 'center', gap: spacing[3] },
  emoji: { fontSize: 48 },
  title: { fontFamily: fonts.displayBold, fontSize: 26, lineHeight: 30 },
  text: { fontFamily: fonts.body, fontSize: fontSizes.md, lineHeight: 23 },
});
