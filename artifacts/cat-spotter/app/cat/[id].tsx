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
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppMap } from '@/components/AppMap';
import {
  useGetCat,
  getGetCatQueryKey,
  type CareEvent,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useNotifications } from '@/context/NotificationContext';
import { OwnershipBanner } from '@/components/OwnershipBanner';
import { ClaimCatSheet } from '@/components/ClaimCatSheet';
import { absoluteUrl } from '@/lib/urls';
import { Badge, Tag, StatTile, IconButton, Button } from '@/components/purropolis';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing, lineHeights } from '@/constants/theme';

function catCode(id: number): string {
  return `SYR-${String(id).padStart(4, '0')}`;
}

const CARE_META: Record<
  CareEvent['type'],
  { icon: string; bg: string }
> = {
  desexed: { icon: '✂️', bg: palette.aegean100 },
  adopted: { icon: '🏠', bg: palette.bougain100 },
  general: { icon: '📣', bg: palette.olive100 },
  discovered: { icon: '📍', bg: palette.sun100 },
};

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
          <Text style={{ color: colors.primary }}>← {t('tabCatalog')}</Text>
        </Pressable>
      </View>
    );
  }

  // fansCount and careTimeline are new fields and the generated fetch client
  // does no runtime validation, so an app talking to an older server would get
  // undefined here. That must not crash — but it also must not be treated as
  // a real zero/empty: "0 Fans" and an empty Care Timeline both look like
  // genuine measurements, when they can only mean an older server (a real
  // cat always has at least a synthetic `discovered` care event). Keep
  // "undefined" distinguishable from "really zero"/"really empty" all the
  // way to render.
  const { cat, sightings } = data;
  const fansCount = data.fansCount;
  const careTimeline = data.careTimeline;
  const isClaimed = cat.hasHome;
  const isOwner = isClaimed && ownedCatIds.includes(cat.id);
  const isDesexed = (careTimeline ?? []).some((e) => e.type === 'desexed');
  const dash = '—';
  const locationLabel = cat.description?.trim();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <View>
          <Image
            source={{ uri: absoluteUrl(cat.photoUrl) }}
            style={styles.hero}
            contentFit="cover"
          />
          <LinearGradient
            colors={['rgba(10,51,80,0.7)', 'rgba(10,51,80,0)']}
            start={{ x: 0, y: 1 }}
            end={{ x: 0, y: 0.45 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={[styles.heroTopRow, { top: insets.top + 8 }]}>
            <IconButton variant="solid" label={t('tabCatalog')} onPress={close}>
              <Feather name="arrow-left" size={18} color={colors.primaryForeground} />
            </IconButton>
          </View>
          <View style={styles.heroBottom}>
            <View style={styles.heroNameRow}>
              <Text style={styles.heroName} numberOfLines={1}>
                {cat.name}
              </Text>
              <Text style={styles.heroMonoId}>{catCode(cat.id)}</Text>
            </View>
          </View>
        </View>
        <View style={{ padding: 16, gap: 16 }}>
          <View style={{ gap: 10 }}>
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

            {isDesexed && (
              <View style={styles.badgeRow}>
                <Badge tone="success">{t('desexedBadge')}</Badge>
              </View>
            )}

            {locationLabel ? (
              <View style={styles.badgeRow}>
                <Tag tone="neutral">📍 {locationLabel}</Tag>
              </View>
            ) : null}

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
              ownerName={cat.ownerName}
              homeDescription={cat.homeDescription}
            />
          ) : (
            <Button
              variant="primary"
              size="lg"
              block
              iconLeft={
                <Feather name="home" size={16} color={colors.primaryForeground} />
              }
              onPress={() => setSheet('claim')}
            >
              {t('claimCat')}
            </Button>
          )}

          <View style={styles.statsRow}>
            <StatTile
              style={{ flex: 1 }}
              value={cat.sightingsCount}
              label={t('timesSpottedStat')}
              tone="aegean"
            />
            <StatTile
              style={{ flex: 1 }}
              value={fansCount ?? dash}
              label={t('fansStat')}
              tone="bougain"
            />
          </View>

          {careTimeline !== undefined && (
            <View style={{ gap: 11 }}>
              <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
                {t('careTimelineTitle')}
              </Text>
              {careTimeline.map((event, index) => {
                // An unknown type (older/newer server, or a leaked `sighting`
                // row) must not take the whole screen down.
                const meta = CARE_META[event.type] ?? CARE_META.general;
                return (
                  <View key={index} style={styles.careRow}>
                    <View style={[styles.careIcon, { backgroundColor: meta.bg }]}>
                      <Text style={{ fontSize: 14 }}>{meta.icon}</Text>
                    </View>
                    <Text style={[styles.careText, { color: colors.foreground }]}>
                      {event.type === 'discovered' ? (
                        <>
                          <Text style={styles.careBold}>
                            {t('careTypeDiscoveredPrefix')}
                          </Text>{' '}
                          {event.message}
                        </>
                      ) : (
                        <>
                          <Text style={styles.careBold}>
                            {t(
                              event.type === 'desexed'
                                ? 'careTypeDesexed'
                                : event.type === 'adopted'
                                  ? 'careTypeAdopted'
                                  : 'careTypeGeneral',
                            )}
                          </Text>{' '}
                          · {event.message}
                        </>
                      )}
                    </Text>
                    <Text style={[styles.careDate, { color: colors.mutedForeground }]}>
                      {new Date(event.at).toLocaleDateString(undefined, {
                        month: 'short',
                        year: '2-digit',
                      })}
                    </Text>
                  </View>
                );
              })}
            </View>
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
  heroTopRow: {
    position: 'absolute',
    left: 16,
    flexDirection: 'row',
  },
  heroBottom: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 16,
  },
  heroNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroName: {
    fontSize: fontSizes['2xl'],
    fontFamily: fonts.displayBold,
    color: '#fff',
    lineHeight: fontSizes['2xl'] * lineHeights.tight,
    flexShrink: 1,
  },
  heroMonoId: {
    fontSize: fontSizes['2xs'],
    fontFamily: fonts.mono,
    color: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radii.xs,
    overflow: 'hidden',
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  updateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
  },
  updateLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase' },
  updateMessage: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  statsRow: { flexDirection: 'row', gap: 10 },
  eyebrow: {
    fontSize: fontSizes['2xs'],
    fontFamily: fonts.bodyBold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  careRow: { flexDirection: 'row', gap: 11, alignItems: 'center' },
  careIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  careText: {
    flex: 1,
    fontSize: fontSizes.xs + 0.5,
    fontFamily: fonts.body,
  },
  careBold: {
    fontFamily: fonts.bodyBold,
  },
  careDate: {
    fontSize: fontSizes['3xs'],
    fontFamily: fonts.mono,
  },
  mapWrap: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    height: 180,
  },
  map: { flex: 1 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  sightingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sightingItem: { width: '30.5%', gap: 4 },
  sightingPhoto: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 1,
  },
  sightingDate: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  sightingSpotter: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});
