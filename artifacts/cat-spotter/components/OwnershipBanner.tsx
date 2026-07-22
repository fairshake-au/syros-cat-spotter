import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';

/**
 * Read-only banner shown on a claimed cat's detail screen:
 * "Owned by Eleni · Lives near the blue door on Odos Miaouli".
 */
export function OwnershipBanner({
  ownerName,
  homeDescription,
}: {
  ownerName: string;
  homeDescription?: string | null;
}) {
  const colors = useColors();
  const { t } = useLanguage();

  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: colors.secondary, borderColor: colors.border },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
        <Feather name="home" size={16} color={colors.primary} />
      </View>
      <Text style={[styles.text, { color: colors.foreground }]}>
        {t('ownedBy')} {ownerName}
        {homeDescription ? ` · ${homeDescription}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Nunito_700Bold',
  },
});
