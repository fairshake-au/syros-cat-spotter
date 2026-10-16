import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { fonts, fontSizes, spacing } from '@/constants/theme';
import { GoodPhotoCartoon, PoorPhotoCartoon } from './cartoons';

/**
 * The two cartoons and the four tips (SYC-415 spec §3.1). Shown inside the
 * first-visit card, and on the "this doesn't look like a cat" screen.
 */
export function PhotoTips({ compact = false }: { compact?: boolean }) {
  const colors = useColors();
  const { t } = useLanguage();
  const cartoon = compact ? 110 : 150;

  const tips: { title: string; line: string }[] = [
    { title: t('photoTipGetClose'), line: t('photoTipGetCloseLine') },
    { title: t('photoTipFace'), line: t('photoTipFaceLine') },
    { title: t('photoTipBody'), line: t('photoTipBodyLine') },
    { title: t('photoTipLight'), line: t('photoTipLightLine') },
  ];

  return (
    <View testID="photo-tips" style={styles.wrap}>
      <View style={styles.cartoons}>
        <View style={styles.cartoonCell}>
          <GoodPhotoCartoon size={cartoon} label={t('cartoonGoodLabel')} />
        </View>
        <View style={styles.cartoonCell}>
          <PoorPhotoCartoon size={cartoon} label={t('cartoonPoorLabel')} />
        </View>
      </View>
      <View style={styles.tips}>
        {tips.map((tip) => (
          <View key={tip.title} style={styles.tip}>
            <Text style={[styles.tipTitle, { color: colors.foreground }]}>{tip.title}</Text>
            <Text style={[styles.tipLine, { color: colors.mutedForeground }]}>{tip.line}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: spacing[4] },
  cartoons: { flexDirection: 'row', gap: spacing[3] },
  cartoonCell: { flex: 1, alignItems: 'center' },
  tips: { gap: spacing[3] },
  tip: { gap: 2 },
  tipTitle: { fontFamily: fonts.bodySemiBold, fontSize: fontSizes.md },
  tipLine: { fontFamily: fonts.body, fontSize: fontSizes.sm },
});
