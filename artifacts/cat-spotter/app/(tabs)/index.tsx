import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppMap } from '@/components/AppMap';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useLocation } from '@/hooks/useLocation';
import { useCatsWithCache } from '@/hooks/useCatsWithCache';
import { OfflineBanner } from '@/components/OfflineBanner';
import { absoluteUrl, SYROS_CENTER } from '@/lib/urls';

export default function MapScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { coords, loading: locating } = useLocation();
  const { cats, isLoading } = useCatsWithCache(
    coords?.latitude,
    coords?.longitude,
  );

  const initialRegion = useMemo(
    () => ({
      latitude: coords?.latitude ?? SYROS_CENTER.latitude,
      longitude: coords?.longitude ?? SYROS_CENTER.longitude,
      latitudeDelta: 0.06,
      longitudeDelta: 0.06,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coords === null],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t('appName')}
        </Text>
        {locating && (
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {t('locating')}
          </Text>
        )}
      </View>
      <OfflineBanner />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <AppMap
          key={coords ? 'located' : 'default'}
          latitude={initialRegion.latitude}
          longitude={initialRegion.longitude}
          latitudeDelta={initialRegion.latitudeDelta}
          longitudeDelta={initialRegion.longitudeDelta}
          showsUserLocation
          markerBorderColor={colors.primary}
          markers={cats.map((cat) => ({
            id: String(cat.id),
            latitude: cat.lat,
            longitude: cat.lng,
            title: cat.name,
            imageUrl: absoluteUrl(cat.photoUrl),
            onPress: () =>
              router.push({
                pathname: '/cat/[id]',
                params: { id: String(cat.id) },
              }),
          }))}
        />
      )}
      <Pressable
        onPress={() => router.push('/spot')}
        style={[
          styles.fab,
          {
            backgroundColor: colors.primary,
            bottom: insets.bottom + (Platform.OS === 'web' ? 100 : 90),
          },
        ]}
      >
        <Feather name="camera" size={22} color={colors.primaryForeground} />
        <Text style={[styles.fabText, { color: colors.primaryForeground }]}>
          {t('tabSpot')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  fabText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
