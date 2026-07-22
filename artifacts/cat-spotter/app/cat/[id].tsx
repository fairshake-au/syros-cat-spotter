import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppMap } from '@/components/AppMap';
import { useGetCat, getGetCatQueryKey } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { absoluteUrl } from '@/lib/urls';

export default function CatDetailScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const catId = Number(params.id);

  const query = useGetCat(catId, {
    query: { enabled: Number.isFinite(catId), queryKey: getGetCatQueryKey(catId) },
  });

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/cats');
  };

  if (query.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>{t('error')}</Text>
        <Pressable onPress={close} style={{ marginTop: 12 }}>
          <Text style={{ color: colors.primary }}>← {t('tabCats')}</Text>
        </Pressable>
      </View>
    );
  }

  const { cat, sightings } = data;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <View>
          <Image
            source={{ uri: absoluteUrl(cat.photoUrl) }}
            style={styles.hero}
            contentFit="cover"
          />
          <Pressable
            onPress={close}
            style={[
              styles.backBtn,
              { top: insets.top + 8, backgroundColor: colors.background },
            ]}
            hitSlop={8}
          >
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={{ padding: 16, gap: 16 }}>
          <View style={{ gap: 4 }}>
            <Text style={[styles.name, { color: colors.foreground }]}>
              {cat.name}
            </Text>
            <View style={styles.metaRow}>
              <Feather name="eye" size={14} color={colors.mutedForeground} />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {cat.sightingsCount} · {t('lastSeen')}{' '}
                {new Date(cat.lastSeenAt).toLocaleDateString()}
              </Text>
            </View>
            {!!cat.discovererSpotterCode && (
              <View style={styles.metaRow}>
                <Feather name="star" size={14} color={colors.mutedForeground} />
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {t('discoveredBy')}{' '}
                  {cat.discovererNickname ??
                    `${t('spotter')} ${cat.discovererSpotterCode}`}
                </Text>
              </View>
            )}
          </View>

          <View style={[styles.mapWrap, { borderColor: colors.border }]}>
            <AppMap
              latitude={cat.lat}
              longitude={cat.lng}
              latitudeDelta={0.02}
              longitudeDelta={0.02}
              interactive={false}
              markerBorderColor={colors.primary}
              markers={[
                { id: 'cat', latitude: cat.lat, longitude: cat.lng },
                ...sightings.slice(0, 20).map((s) => ({
                  id: String(s.id),
                  latitude: s.lat,
                  longitude: s.lng,
                  pinColor: colors.accent,
                })),
              ]}
            />
          </View>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {t('sightingsHistory')}
          </Text>
          <View style={styles.sightingGrid}>
            {sightings.map((s) => (
              <View key={s.id} style={styles.sightingItem}>
                <Image
                  source={{ uri: absoluteUrl(s.photoUrl) }}
                  style={[styles.sightingPhoto, { borderColor: colors.border }]}
                  contentFit="cover"
                />
                <Text style={[styles.sightingDate, { color: colors.mutedForeground }]}>
                  {new Date(s.createdAt).toLocaleDateString()}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { width: '100%', aspectRatio: 1.3 },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.92,
  },
  name: { fontSize: 26, fontFamily: 'Poppins_700Bold' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontSize: 13, fontFamily: 'Nunito_400Regular' },
  mapWrap: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    height: 180,
  },
  map: { flex: 1 },
  sectionTitle: { fontSize: 16, fontFamily: 'Nunito_700Bold' },
  sightingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sightingItem: { width: '30.5%', gap: 4 },
  sightingPhoto: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 1,
  },
  sightingDate: { fontSize: 11, fontFamily: 'Nunito_400Regular' },
});
