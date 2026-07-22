import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import type { Cat } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { absoluteUrl } from '@/lib/urls';
import colorsConst from '@/constants/colors';

export function CatCard({ cat }: { cat: Cat }) {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => {
        if (Platform.OS !== 'web') Haptics.selectionAsync();
        router.push({ pathname: '/cat/[id]', params: { id: String(cat.id) } });
      }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Image
        source={{ uri: absoluteUrl(cat.photoUrl) }}
        style={styles.photo}
        contentFit="cover"
        transition={200}
      />
      <View style={styles.info}>
        <Text
          style={[styles.name, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {cat.name}
        </Text>
        <View style={styles.metaRow}>
          <Feather name="eye" size={12} color={colors.mutedForeground} />
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {cat.sightingsCount}
          </Text>
          {typeof cat.distanceKm === 'number' && (
            <>
              <Feather
                name="map-pin"
                size={12}
                color={colors.mutedForeground}
                style={{ marginLeft: 8 }}
              />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {cat.distanceKm < 1
                  ? `${Math.round(cat.distanceKm * 1000)} m`
                  : `${cat.distanceKm.toFixed(1)} ${t('kmAway')}`}
              </Text>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: colorsConst.radius,
    borderWidth: 1,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    aspectRatio: 1,
  },
  info: {
    padding: 10,
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  meta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});
