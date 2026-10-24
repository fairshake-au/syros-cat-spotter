import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { removeKeepSafe } from '@/lib/keepSafe';
import { KEEP_SAFE_QUERY_ROOT, useKeepSafeState } from '@/hooks/useKeepSafeState';

export { KEEP_SAFE_QUERY_ROOT };

/**
 * Settings (SYC-3 plan, Slice 1 step 8):
 * - **Keep my spots safe**: off → "Add an email" opens the same screen as
 *   onboarding; pending → "Check your inbox to confirm"; on → "Saved to
 *   s•••@gmail.com". Both of the last two offer **Change** and **Remove**.
 *   Only the masked address is ever shown.
 * - **Get your spots back** (Decision 7), always there.
 */
export function KeepSafeSettings() {
  const colors = useColors();
  const { t } = useLanguage();
  const { deviceId } = useDevice();
  const { isOnline } = useOffline();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(false);

  const state = useKeepSafeState();

  const remove = async () => {
    if (!deviceId || removing) return;
    setRemoving(true);
    try {
      await removeKeepSafe(deviceId);
      await queryClient.invalidateQueries({ queryKey: KEEP_SAFE_QUERY_ROOT });
    } finally {
      setRemoving(false);
    }
  };

  const data = state.data;
  let line: string;
  if (!isOnline || state.isError) line = t('keepSafeSettingsUnavailable');
  else if (!data) line = '…';
  else if (data.status === 'confirmed') line = t('keepSafeSettingsOn').replace('{address}', data.addressMask);
  else if (data.status === 'pending') line = t('keepSafeSettingsPending');
  else line = t('keepSafeSettingsOff');

  const link = (label: string, onPress: () => void, testID: string, disabled = false) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={styles.link}
    >
      <Text style={[styles.linkText, { color: disabled ? colors.mutedForeground : colors.primary }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View testID="keep-safe-settings" style={{ gap: 10 }}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t('keepSafeSettingsTitle')}</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.row}>
          <Feather name="shield" size={18} color={colors.primary} />
          <Text testID="keep-safe-settings-line" style={[styles.line, { color: colors.foreground }]}>
            {line}
          </Text>
        </View>
        {isOnline && data ? (
          <View style={styles.actions}>
            {data.status === 'none'
              ? link(t('keepSafeSettingsAdd'), () => router.push('/keep-safe'), 'keep-safe-add')
              : (
                <>
                  {link(t('keepSafeSettingsChange'), () => router.push('/keep-safe'), 'keep-safe-change')}
                  {link(t('keepSafeSettingsRemove'), remove, 'keep-safe-remove', removing)}
                </>
              )}
          </View>
        ) : null}
      </View>
      <Pressable
        testID="get-spots-back"
        accessibilityRole="button"
        onPress={() => router.push('/get-spots-back')}
        style={[styles.card, styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <Feather name="download" size={18} color={colors.primary} />
        <Text style={[styles.line, { color: colors.foreground }]}>{t('restoreAskTitle')}</Text>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing[4], gap: spacing[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  line: { flex: 1, fontFamily: fonts.bodyBold, fontSize: fontSizes.sm },
  actions: { flexDirection: 'row', gap: spacing[5], paddingLeft: 30 },
  // SYC-509: 44px tall, not ~30.
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { fontFamily: fonts.displaySemiBold, fontSize: fontSizes.sm },
});
