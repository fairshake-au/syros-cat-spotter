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
import { useDevice } from '@/context/DeviceContext';
import { useNotifications } from '@/context/NotificationContext';
import { OwnershipBanner } from '@/components/OwnershipBanner';
import { ClaimCatSheet } from '@/components/ClaimCatSheet';
import { absoluteUrl } from '@/lib/urls';

export default function CatDetailScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; updateId?: string }>();
  const catId = Number(params.id);
  const updateId = Number(params.updateId);
  const { ownedCatIds } = useDevice();
  const { notifications, markRead } = useNotifications();
  const [sheet, setSheet] = React.useState<'claim' | 'edit' | null>(null);

  // The inbox row matching the tapped push notification, if any.
  const highlighted = React.useMemo(
    () =>
      Number.isFinite(updateId) && updateId > 0
        ? notifications.find(
            (n) => n.catUpdateId === updateId && n.catId === catId,
          )
        : undefined,
    [notifications, updateId, catId],
  );

  // Mark the matching inbox row read once it is known.
  const markedRef = React.useRef(false);
  React.useEffect(() => {
    if (highlighted && !highlighted.read && !markedRef.current) {
      markedRef.current = true;
      markRead(highlighted.id);
    }
  }, [highlighted, markRead]);

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
  const isClaimed = !!cat.ownerName;
  const isOwner = isClaimed && ownedCatIds.includes(cat.id);

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
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: colors.foreground }]}>
                {cat.name}
              </Text>
              {isOwner && (
                <Pressable
                  onPress={() => setSheet('edit')}
                  hitSlop={8}
                  style={[
                    styles.editBtn,
                    { borderColor: colors.border, backgroundColor: colors.card },
                  ]}
                >
                  <Feather name="edit-2" size={13} color={colors.primary} />
                  <Text style={[styles.editText, { color: colors.primary }]}>
                    {t('editCat')}
                  </Text>
                </Pressable>
              )}
            </View>
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
                  {cat.discovererUsername ??
                    cat.discovererNickname ??
                    `${t('spotter')} ${cat.discovererSpotterCode}`}
                </Text>
              </View>
            )}
          </View>

          {highlighted && (
            <View
              style={[
                styles.updateBanner,
                { backgroundColor: colors.card, borderColor: colors.primary },
              ]}
            >
              <Feather
                name={
                  highlighted.updateType === 'adopted'
                    ? 'home'
                    : highlighted.updateType === 'desexed'
                      ? 'heart'
                      : highlighted.updateType === 'sighting'
                        ? 'eye'
                        : 'bell'
                }
                size={18}
                color={colors.primary}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.updateLabel, { color: colors.primary }]}>
                  {t('catUpdateBanner')} ·{' '}
                  {new Date(highlighted.createdAt).toLocaleDateString()}
                </Text>
                <Text style={[styles.updateMessage, { color: colors.foreground }]}>
                  {highlighted.message}
                </Text>
              </View>
            </View>
          )}

          {isClaimed ? (
            <OwnershipBanner
              ownerName={cat.ownerName!}
              homeDescription={cat.homeDescription}
            />
          ) : (
            <Pressable
              onPress={() => setSheet('claim')}
              style={[styles.claimBtn, { backgroundColor: colors.primary }]}
            >
              <Feather name="home" size={16} color={colors.primaryForeground} />
              <Text style={[styles.claimText, { color: colors.primaryForeground }]}>
                {t('claimCat')}
              </Text>
            </Pressable>
          )}

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
                <Text
                  style={[styles.sightingSpotter, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {s.spotterUsername ??
                    s.spotterNickname ??
                    `${t('spotter')} ${s.spotterCode}`}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      {sheet !== null && (
        <ClaimCatSheet
          visible
          mode={sheet}
          cat={cat}
          onClose={() => setSheet(null)}
        />
      )}
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
  name: { fontSize: 26, fontFamily: 'Poppins_700Bold', flexShrink: 1 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editText: { fontSize: 12, fontFamily: 'Nunito_700Bold' },
  claimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 13,
  },
  claimText: { fontSize: 15, fontFamily: 'Nunito_700Bold' },
  updateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
  },
  updateLabel: { fontSize: 11, fontFamily: 'Nunito_700Bold', textTransform: 'uppercase' },
  updateMessage: { fontSize: 14, fontFamily: 'Nunito_600SemiBold' },
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
  sightingSpotter: { fontSize: 11, fontFamily: 'Nunito_600SemiBold' },
});
