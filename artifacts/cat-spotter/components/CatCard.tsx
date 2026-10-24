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
import { photoSource } from '@/lib/urls';
import colorsConst from '@/constants/colors';
import { SpottedStamp } from './SpottedStamp';

export function CatCard({ cat, spotted }: { cat: Cat; spotted?: boolean }) {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();

  const distanceText =
    typeof cat.distanceKm === 'number'
      ? cat.distanceKm < 1
        ? `${Math.round(cat.distanceKm * 1000)} m`
        : `${cat.distanceKm.toFixed(1)} ${t('kmAway')}`
      : null;
  const discovererText = `${t('discoveredBy')} ${
    cat.discovererUsername ??
    cat.discovererNickname ??
    (cat.discovererSpotterCode ? `${t('spotter')} ${cat.discovererSpotterCode}` : t('aSpotter'))
  }`;
  const seenText =
    cat.sightingsCount === 1
      ? t('catCardSeenOnce')
      : t('catCardSeenTimes').replace('{n}', String(cat.sightingsCount));
  const hasHomeText = cat.hasHome ? t('filterHasHome') : null;
  // Unknown is not zero: only say spotted / not spotted when we know.
  const lead =
    typeof spotted === 'boolean'
      ? t(spotted ? 'catCardA11ySpotted' : 'catCardA11yNotSpotted').replace('{name}', cat.name)
      : cat.name;
  // Join with a full stop, unless a part already ends its sentence ("Nefeli. Not spotted yet.").
  const a11yLabel = [lead, hasHomeText, seenText, distanceText, discovererText]
    .filter((part): part is string => Boolean(part))
    .reduce((acc, part) => (/[.!?;]$/.test(acc) ? `${acc} ${part}` : `${acc}. ${part}`));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
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
      <View>
        <Image
          source={photoSource(cat.photoUrl)}
          style={styles.photo}
          contentFit="cover"
          transition={200}
        />
        {cat.hasHome && (
          <View style={[styles.homeBadge, { backgroundColor: colors.primary }]}>
            <Feather name="home" size={12} color={colors.primaryForeground} />
            <Text
              style={[styles.homeBadgeText, { color: colors.primaryForeground }]}
              numberOfLines={1}
            >
              {hasHomeText}
            </Text>
          </View>
        )}
        {spotted === true && <SpottedStamp />}
      </View>
      <View style={styles.info}>
        <Text
          style={[styles.name, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {cat.name}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {seenText}
          </Text>
          {distanceText !== null && (
            <>
              <Feather
                name="map-pin"
                size={12}
                color={colors.mutedForeground}
                style={{ marginLeft: 4 }}
              />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {distanceText}
              </Text>
            </>
          )}
        </View>
        {(
          <View style={[styles.metaRow, styles.metaRowTop]}>
            <Feather name="star" size={12} color={colors.mutedForeground} style={styles.metaIcon} />
            <Text style={[styles.meta, styles.metaWrap, { color: colors.mutedForeground }]}>
              {discovererText}
            </Text>
          </View>
        )}
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
  homeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    maxWidth: '85%',
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    opacity: 0.95,
  },
  homeBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    flexShrink: 1,
  },
  info: {
    padding: 10,
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  // The discoverer line wraps (SYC-578), so pin the star to its first line.
  metaRowTop: { alignItems: 'flex-start', flexWrap: 'nowrap' },
  metaIcon: { marginTop: 2 },
  metaWrap: { flexShrink: 1 },
  meta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});
