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
import { useOffline } from '@/context/OfflineContext';
import { useNotifications } from '@/context/NotificationContext';
import { OwnershipBanner } from '@/components/OwnershipBanner';
import { ClaimCatSheet } from '@/components/ClaimCatSheet';
import { NeedsHelpLink } from '@/components/report/NeedsHelpLink';
import { MoreToAdd } from '@/components/MoreToAdd';
import { SightingPhotos } from '@/components/SightingPhotos';
import { photoSource } from '@/lib/urls';
import { Tag, StatTile, IconButton, Button } from '@/components/purropolis';
import { lifeLine, parseDateOnly, parsePublicDate, sterilisedLineKey } from '@/lib/catStatusLines';
import { appearanceLine } from '@/lib/appearance';
import { DEFAULT_CELL_M } from '@/lib/cellShape';
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
  const { ownedCatIds, deviceId, isReady, startupError } = useDevice();
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

  const { isOnline } = useOffline();

  // §10.6 Option B: on a cat's page the phone says who it is (X-Device-Id,
  // and its secret goes with every request). The server answers an owner
  // with the exact position, and tells a phone whether it may say "This is
  // my cat" (`canClaim`, claiming-a-cat.md §4.1). Everyone else, and every
  // list, gets the cell and `canClaim: false`.
  //
  // Ask only once the device id and secret are loaded: a request that leaves
  // first is answered as the public, and an owner would not see Edit or "doesn't
  // live with me" until a refetch. The device id is in the query key, so each
  // phone has its own answer. If the device setup failed outright (isReady
  // never comes), ask anyway as the public rather than spin forever.
  const deviceKnown = isReady || startupError !== null;
  const query = useGetCat(catId, {
    query: {
      enabled: Number.isFinite(catId) && deviceKnown,
      queryKey: [...getGetCatQueryKey(catId), deviceId],
    },
    request: deviceId !== null ? { headers: { 'X-Device-Id': deviceId } } : undefined,
  });

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/cats');
  };

  if (!deviceKnown || query.isLoading) {
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
  // The server shows the exact spot only to the proven owner, so that is
  // the truth about who owns the cat now. The list saved on the phone can be
  // stale (the team removed the owner and someone else claimed), so it is
  // only the fallback while offline.
  const isOwner =
    isClaimed &&
    (isOnline ? cat.locationPrecision === 'exact' : ownedCatIds.includes(cat.id));
  const dash = '—';
  const locationLabel = cat.description?.trim();
  // SYC-2 (spec §5.2): colour and markings beside the place, quietly. Null
  // for a cat nobody has described, and for an older server or cache.
  const appearance = appearanceLine(cat, t);

  // Data spine PR 4 (cat-record-data-spine.md §3.5, §4.2): one of five
  // mutually exclusive life lines, never a headline, never "presumed" --
  // "Not seen since {date}" takes the place the ordinary lifeStatus line
  // would otherwise sit in, exactly as quietly as "Last seen yesterday"
  // would. The Desexed badge this used to read from careTimeline is
  // replaced entirely by the sterilised line below. Pure selection logic
  // lives in lib/catStatusLines.ts, tested there across every language.
  const line = lifeLine(cat);
  const lifeLineText =
    line.key === 'notSeenSince'
      ? t('notSeenSince').replace('{date}', parseDateOnly(line.date).toLocaleDateString())
      : t(line.key);
  const sterilisedLine = t(sterilisedLineKey(cat.sterilised));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <View>
          <Image
            source={photoSource(cat.photoUrl)}
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

            {locationLabel || appearance ? (
              <View style={styles.badgeRow}>
                {locationLabel ? <Tag tone="neutral">📍 {locationLabel}</Tag> : null}
                {appearance ? <Tag tone="neutral">{appearance}</Tag> : null}
              </View>
            ) : null}

            {/* Data spine PR 4: the life line and the sterilised line, where
                the Desexed badge used to sit, right above "Last seen". */}
            <View style={styles.metaRow}>
              <Feather name="heart" size={14} color={colors.mutedForeground} />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {lifeLineText}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Feather name="info" size={14} color={colors.mutedForeground} />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {sterilisedLine}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <Feather name="eye" size={14} color={colors.mutedForeground} />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {cat.sightingsCount} · {t('lastSeen')}{' '}
                {parsePublicDate(cat.lastSeenAt).toLocaleDateString()}
              </Text>
            </View>
            {/* SYC-42: quiet, never the biggest thing on screen (spec §4.1). */}
            <NeedsHelpLink />
            {(
              <View style={styles.metaRow}>
                <Feather name="star" size={14} color={colors.mutedForeground} />
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {t('discoveredBy')}{' '}
                  {cat.discovererUsername ??
                    cat.discovererNickname ??
                    (cat.discovererSpotterCode
                  ? `${t('spotter')} ${cat.discovererSpotterCode}`
                  : t('aSpotter'))}
                </Text>
              </View>
            )}
          </View>

          {/* SYC-117 part 2: "You spotted Agatha on 3 October. Anything to
              add?" Only for this phone's own recent sightings of this cat. */}
          <MoreToAdd catId={cat.id} catName={cat.name} />

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
            <>
              <OwnershipBanner
                ownerName={cat.ownerName}
                homeDescription={cat.homeDescription}
              />
              {/* Claiming-a-cat.md §6: an owner on a new phone can't let go
                  from it. Said quietly, under "Has a home". */}
              {!isOwner && (
                <Text style={[styles.quietLine, { color: colors.mutedForeground }]}>
                  {t('claimNewPhone').split('{name}').join(cat.name)}
                </Text>
              )}
            </>
          ) : data.canClaim ? (
            /* Claiming-a-cat.md §4.1: only when the server says this phone
               may claim; styled as a secondary action, never the page's most
               prominent button. */
            <View style={{ gap: 6 }}>
              <Button
                variant="secondary"
                size="lg"
                block
                disabled={!isOnline}
                iconLeft={
                  <Feather name="home" size={16} color={colors.secondaryForeground} />
                }
                onPress={() => setSheet('claim')}
              >
                {t('claimCat')}
              </Button>
              {!isOnline && (
                <Text style={[styles.quietLine, { color: colors.mutedForeground }]}>
                  {t('claimNeedsConnection')}
                </Text>
              )}
            </View>
          ) : cat.lifeStatus === 'street' && !data.claimCooldown ? (
            /* During the 7-day cooldown this phone HAS spotted the cat, so
               "spot it first" would be false; the spec has no wording for
               the cooldown, so nothing is shown. */
            <Text style={[styles.quietLine, { color: colors.mutedForeground }]}>
              {t('claimNotMetHint').split('{name}').join(cat.name)}
            </Text>
          ) : null}

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
                          {/* SYC-235: no name means the discoverer deleted
                              their data. */}
                          {event.message ?? t('aSpotter')}
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
                      {parsePublicDate(event.at).toLocaleDateString(undefined, {
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
              // Close enough that the 250 m cell fills most of the map, so
              // "Somewhere in here" reads as an area, not a dot.
              latitudeDelta={0.0035}
              longitudeDelta={0.0035}
              interactive={false}
              markerBorderColor={colors.primary}
              // Data spine PR 6 (spec §6.2, §6.6): the cat is somewhere in
              // its published cell, drawn as that cell, never a pin. Only
              // its owner gets the exact spot. Sightings carry no position.
              markers={
                cat.locationPrecision === 'exact'
                  ? [{ id: 'cat', latitude: cat.lat, longitude: cat.lng }]
                  : []
              }
              areas={
                cat.locationPrecision === 'exact'
                  ? []
                  : [
                      {
                        id: 'cat',
                        latitude: cat.lat,
                        longitude: cat.lng,
                        sizeMetres: cat.locationCellM ?? DEFAULT_CELL_M,
                        label: t('somewhereInHere'),
                      },
                    ]
              }
            />
          </View>
          <Text style={[styles.mapCaption, { color: colors.mutedForeground }]}>
            {t(cat.locationPrecision === 'exact' ? 'firstSpottedHereOwner' : 'firstSpottedAroundHere')}
          </Text>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {t('sightingsHistory')}
          </Text>
          <View style={styles.sightingGrid}>
            {sightings.map((s, i) => (
              <View key={s.photoUrl ?? `sighting-${i}`} style={styles.sightingItem}>
                <SightingPhotos photoUrl={s.photoUrl} extraPhotos={s.extraPhotos} createdAt={s.createdAt} />
                <Text style={[styles.sightingDate, { color: colors.mutedForeground }]}>
                  {parsePublicDate(s.createdAt).toLocaleDateString()}
                </Text>
                <Text
                  style={[styles.sightingSpotter, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {s.spotterUsername ??
                    s.spotterNickname ??
                    (s.spotterCode ? `${t('spotter')} ${s.spotterCode}` : t('aSpotter'))}
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
  quietLine: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  mapCaption: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: -6 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  sightingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sightingItem: { width: '30.5%', gap: 4 },
  sightingDate: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  sightingSpotter: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});
