import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useDeleteMyData } from '@/context/DeleteMyDataContext';
import { Button } from '@/components/purropolis';

/**
 * After "Delete my data" (SYC-63), in email-capture.md §6.3's words. The root
 * gate shows this in place of the app; carrying on takes the person into the
 * first-run step as a brand-new spotter, which is what "start again from
 * zero" means in practice (plan §1.4).
 */
export function DeleteMyDataDone() {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { dismissDone } = useDeleteMyData();
  const body = [styles.body, { color: colors.foreground }];
  return (
    <View
      testID="delete-my-data-done"
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + spacing[6],
          paddingBottom: insets.bottom + spacing[6],
        },
      ]}
    >
      <View style={styles.inner}>
        <Text style={[styles.title, { color: colors.foreground }]} accessibilityRole="header">
          {t('deleteDoneTitle')}
        </Text>
        <Text style={body}>{t('deleteDoneBody')}</Text>
        <Button variant="primary" size="lg" block onPress={dismissDone}>
          {t('deleteDoneContinue')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing[4], justifyContent: 'center' },
  inner: { gap: spacing[4], maxWidth: 640, width: '100%', alignSelf: 'center' },
  title: { fontSize: fontSizes.xl, fontFamily: fonts.displayBold },
  body: { fontSize: fontSizes.xs, fontFamily: fonts.body, lineHeight: fontSizes.xs * 1.4 },
});
