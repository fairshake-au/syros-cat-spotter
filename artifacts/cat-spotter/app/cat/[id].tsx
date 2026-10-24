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
import { useBannerAreaReserve } from '@/lib/bannerArea';
import {
  useGetCat,
  getGetCatQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { useNotifications } from '@/context/NotificationContext';
import { ClaimCatSheet } from '@/components/ClaimCatSheet';
import { ClaimAskSheet, type ClaimAskMode } from '@/components/ClaimAskSheet';
import { ReportIssueSheet } from '@/components/report/ReportIssueSheet';
import type { IssueReason } from '@/lib/issueQueue';
import { afterModalCloses } from '@/lib/modalHandoff';
import { PhotoViewer } from '@/components/PhotoViewer';
import { mainPhotoCaption } from '@/lib/photoCaption';
import { photoSource } from '@/lib/urls';
import { IconButton } from '@/components/purropolis';
import { formatDay, formatPublicDate } from '@/lib/catPageDates';
import { lifeLine, sterilisedLineKey } from '@/lib/catStatusLines';
import { appearanceLine } from '@/lib/appearance';
import { canSpotFromPage, spotRouteFor } from '@/lib/spotHint';
import { homeActionFor, seenQuietLine, visiblePhotoCount } from '@/lib/catPageFacts';
import { CatTabBar, panelId, tabId, type CatTab, type CatTabItem } from '@/components/catPage/CatTabBar';
import { AboutTab } from '@/components/catPage/AboutTab';
import { PhotosTab } from '@/components/catPage/PhotosTab';
import { StoryTab } from '@/components/catPage/StoryTab';
import { MapTab } from '@/components/catPage/MapTab';
import { FollowButton } from '@/components/catPage/FollowButton';
import { fonts, fontSizes, lineHeights } from '@/constants/theme';

/** The photo's height. The tab row and the first facts show on a 390 px phone without scrolling. */
const HERO_H = 250;

export default function CatDetailScreen() {
  const colors = useColors();
  const { t, language } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bannerReserve = useBannerAreaReserve();
  const params = useLocalSearchParams<{ id: string; updateId?: string; report?: string }>();
  const catId = Number(params.id);
  const updateId = Number(params.updateId);
  const { ownedCatIds, deviceId, isReady, startupError } = useDevice();
  const { notifications, markRead } = useNotifications();
  const [sheet, setSheet] = React.useState<'claim' | 'edit' | null>(null);
  // "Does {name} live with you?" (design-review-fixes-oct22.md §1.1): which
  // text the small sheet shows, and the link that gets focus back on close.
  const [askSheet, setAskSheet] = React.useState<ClaimAskMode | null>(null);
  const homeCardRef = React.useRef<View>(null);
  // Hand focus back to the 🏠 card when its sheet closes (web; native keeps its own place).
  const focusHomeCard = () =>
    setTimeout(() => (homeCardRef.current as unknown as { focus?: () => void } | null)?.focus?.(), 0);
  const closeAskSheet = () => {
    setAskSheet(null);
    focusHomeCard();
  };
  // SYC-624: which tab is showing. Kept in the page, so a refetch of the cat
  // never changes it; leaving the page and coming back opens About.
  const [tab, setTab] = React.useState<CatTab>('about');
  const scrollRef = React.useRef<ScrollView>(null);
  const scrollY = React.useRef(0);
  // True once the tab row has reached the top and is pinned.
  const [stuck, setStuck] = React.useState(false);
  // SYC-44 PR 6.1: the main photo opens full screen, but only once it has
  // loaded, so nothing changes offline (report-an-issue.md §4.2).
  const [heroLoaded, setHeroLoaded] = React.useState<string | null>(null);
  // Which photo was opened, not just "open": if a refetch swaps the main
  // photo (a stand-in after a hide), the viewer closes and never reopens
  // by itself on the new one (ship review, finding 1).
  const [heroOpenUrl, setHeroOpenUrl] = React.useState<string | null>(null);
  // SYC-44 PR 6.2: the reason sheet, about the cat (no photo) or one photo.
  // `?report=wrong_info` opens it with that reason chosen: where the "Think
  // this cat is alive?" link lands (choose-a-different-cat.md; plan C11).
  const [issueSheet, setIssueSheet] = React.useState<
    { photoUrl: string | null; initialReason?: IssueReason } | null
  >(null);
  // Read whenever the link sets it, not only on the first mount (review finding 4).
  React.useEffect(() => {
    if (params.report === 'wrong_info') setIssueSheet({ photoUrl: null, initialReason: 'wrong_info' });
  }, [params.report]);

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
  const careTimeline = data.careTimeline;
  const isClaimed = cat.hasHome;
  // The server shows the exact spot only to the proven owner, so that is
  // the truth about who owns the cat now. The list saved on the phone can be
  // stale (the team removed the owner and someone else claimed), so it is
  // only the fallback while offline.
  const isOwner =
    isClaimed &&
    (isOnline ? cat.locationPrecision === 'exact' : ownedCatIds.includes(cat.id));
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
      ? t('notSeenSince').replace('{date}', formatDay(line.date, language))
      : t(line.key);
  const sterilisedLine = t(sterilisedLineKey(cat.sterilised));
  const heroCaption = mainPhotoCaption(cat, sightings, careTimeline, t);
  const heroCanOpen = !!cat.photoUrl && heroLoaded === cat.photoUrl && heroCaption !== null;

  // SYC-624: no Story tab without a care timeline (an older server or cache),
  // and a chosen Story tab that goes away falls back to About.
  const storyAvailable = careTimeline !== undefined;
  const shownTab: CatTab = tab === 'story' && !storyAvailable ? 'about' : tab;
  const photoCount = visiblePhotoCount(sightings);
  const tabs: CatTabItem[] = [
    { key: 'about', emoji: '🐱', label: t('catTabAbout'), a11yLabel: t('catTabAbout') },
    {
      key: 'photos',
      emoji: '📷',
      label: t('catTabPhotos'),
      badge: photoCount > 0 ? photoCount : undefined,
      a11yLabel:
        photoCount > 0
          ? t('catTabPhotosA11y').split('{n}').join(String(photoCount))
          : t('catTabPhotos'),
    },
    ...(storyAvailable
      ? [{ key: 'story' as const, emoji: '📖', label: t('catTabStory'), a11yLabel: t('catTabStory') }]
      : []),
    { key: 'map', emoji: '🗺️', label: t('catTabMap'), a11yLabel: t('catTabMap') },
  ];
  // The row is pinned once the photo has scrolled away (its top reaches the screen top).
  const stickAt = HERO_H - insets.top;
  const selectTab = (next: CatTab) => {
    setTab(next);
    // Past the photo: show the start of the new tab under the pinned row.
    // Not past it: the page doesn't move.
    if (scrollY.current > stickAt) scrollRef.current?.scrollTo({ y: stickAt, animated: false });
  };

  const homeAction = homeActionFor({
    isOwner,
    canClaim: !isClaimed && data.canClaim === true,
    claimCooldown: data.claimCooldown === true,
    lifeStatus: cat.lifeStatus,
    hasHome: isClaimed,
  });
  const onHome = () => {
    if (homeAction === 'claim') setSheet('claim');
    else if (homeAction === 'askStreet') setAskSheet('street');
    else if (homeAction === 'askHomed') setAskSheet('homed');
  };
  const openReport = () => setIssueSheet({ photoUrl: null });
  // SYC-624 D1: Follow needs a known phone and a server that answers
  // `isFollowing`; the owner can't unfollow; a dead cat's button stays only for
  // someone who already follows (so they can stop the news).
  // The server calls a phone the owner whatever the cat's life status, and
  // sends it the exact spot; a cat that died or went into care keeps its
  // owner, who still can't unfollow. (`isOwner` above also needs `hasHome`,
  // which is right for Edit and the pin: those belong to a homed cat.)
  const ownsForFollow = isOnline ? cat.locationPrecision === 'exact' : ownedCatIds.includes(cat.id);
  const follow =
    data.isFollowing !== undefined &&
    deviceId !== null &&
    !ownsForFollow &&
    (cat.lifeStatus !== 'deceased' || data.isFollowing)
      ? { deviceId, isFollowing: data.isFollowing }
      : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        ref={scrollRef}
        stickyHeaderIndices={[1]}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          scrollY.current = y;
          const nowStuck = y >= stickAt;
          setStuck((was) => (was === nowStuck ? was : nowStuck));
        }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        <View style={{ marginBottom: -insets.top }}>
          <Pressable
            testID="cat-hero-open"
            role={cat.photoUrl ? 'button' : undefined}
            disabled={!heroCanOpen}
            accessibilityLabel={cat.photoUrl ? cat.name : undefined}
            onPress={() => {
              if (heroCanOpen) setHeroOpenUrl(cat.photoUrl);
            }}
          >
            <Image
              source={photoSource(cat.photoUrl)}
              style={styles.hero}
              contentFit="cover"
              onLoad={() => setHeroLoaded(cat.photoUrl)}
            />
            <LinearGradient
              colors={['rgba(10,51,80,0.7)', 'rgba(10,51,80,0)']}
              start={{ x: 0, y: 1 }}
              end={{ x: 0, y: 0.45 }}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
          </Pressable>
          <View style={styles.heroBottom} pointerEvents="none">
            <Text style={styles.heroName} numberOfLines={1}>
              {cat.name}
            </Text>
          </View>
        </View>
        <CatTabBar
          tabs={tabs}
          selected={shownTab}
          onSelect={selectTab}
          topInset={insets.top}
          stuck={stuck}
        />
        <View
          key={shownTab}
          role="tabpanel"
          id={panelId(shownTab)}
          aria-labelledby={tabId(shownTab)}
          style={styles.panel}
        >
          {shownTab === 'about' && (
            <AboutTab
              cat={cat}
              isOwner={isOwner}
              onEdit={() => setSheet('edit')}
              update={highlighted}
              onSeeTab={selectTab}
              storyAvailable={storyAvailable}
              lifeLineText={lifeLineText}
              sterilisedLine={sterilisedLine}
              seenQuiet={seenQuietLine(t, {
                sightingsCount: cat.sightingsCount,
                spottersCount: data.spottersCount,
                followersCount: data.followersCount,
              })}
              appearance={appearance}
              canSpot={canSpotFromPage(cat.lifeStatus)}
              onSpot={() => router.push(spotRouteFor(cat.id))}
              homeAction={homeAction}
              claimDisabled={homeAction === 'claim' && !isOnline}
              onHome={onHome}
              homeCardRef={homeCardRef}
              offline={!isOnline}
              onReport={openReport}
            />
          )}
          {shownTab === 'photos' && (
            <PhotosTab
              sightings={sightings}
              onReportPhoto={(url) => afterModalCloses(() => setIssueSheet({ photoUrl: url }))}
              onReport={openReport}
            />
          )}
          {shownTab === 'story' && careTimeline !== undefined && (
            <StoryTab catName={cat.name} careTimeline={careTimeline} onReport={openReport} />
          )}
          {shownTab === 'map' && <MapTab cat={cat} onReport={openReport} />}
        </View>
      </ScrollView>
      {/* Belongs to the photo: gone once the tab row is pinned (the phone's or browser's own back still works). */}
      {!stuck && (
        <View style={[styles.backWrap, { top: insets.top + bannerReserve + 8 }]}>
          <IconButton variant="solid" size="lg" label={t('backA11y')} onPress={close}>
            <Feather name="arrow-left" size={18} color={colors.primaryForeground} />
          </IconButton>
        </View>
      )}
      {/* Belongs to the photo: gone while the tab row is pinned, so it never covers the Map tab. */}
      {follow !== null && !stuck && (
        <View style={[styles.followWrap, { top: insets.top + bannerReserve + 8 }]}>
          <FollowButton
            catId={cat.id}
            catName={cat.name}
            deviceId={follow.deviceId}
            isFollowing={follow.isFollowing}
            isOnline={isOnline}
          />
        </View>
      )}
      {heroOpenUrl !== null && heroOpenUrl === cat.photoUrl && heroCanOpen && heroCaption && (
        <PhotoViewer
          url={heroOpenUrl}
          label={cat.name}
          date={formatPublicDate(heroCaption.day, language)}
          byline={heroCaption.byline}
          onClose={() => setHeroOpenUrl(null)}
          onReport={() => {
            // The viewer closes first: one modal at a time.
            const url = heroOpenUrl;
            setHeroOpenUrl(null);
            afterModalCloses(() => setIssueSheet({ photoUrl: url }));
          }}
        />
      )}
      {issueSheet !== null && (
        <ReportIssueSheet
          catId={cat.id}
          catName={cat.name}
          photoUrl={issueSheet.photoUrl}
          initialReason={issueSheet.initialReason}
          onClose={() => setIssueSheet(null)}
        />
      )}
      {askSheet !== null && (
        <ClaimAskSheet
          mode={askSheet}
          catName={cat.name}
          onClose={closeAskSheet}
          // SYC-574 T2.6: the same push as "I've spotted {name}", once the
          // sheet has gone (iOS won't navigate under a closing modal).
          onSpotNow={
            canSpotFromPage(cat.lifeStatus)
              ? () => {
                  setAskSheet(null);
                  afterModalCloses(() => router.push(spotRouteFor(cat.id)));
                }
              : undefined
          }
        />
      )}
      {sheet !== null && (
        <ClaimCatSheet
          visible
          mode={sheet}
          cat={cat}
          onClose={() => {
            const wasClaim = sheet === 'claim';
            setSheet(null);
            if (wasClaim) focusHomeCard();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { width: '100%', height: HERO_H },
  backWrap: { position: 'absolute', left: 8, zIndex: 30 },
  followWrap: { position: 'absolute', right: 8, zIndex: 30 },
  heroBottom: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 16,
  },
  heroName: {
    fontSize: fontSizes['2xl'],
    fontFamily: fonts.displayBold,
    color: '#fff',
    lineHeight: fontSizes['2xl'] * lineHeights.tight,
  },
  panel: { padding: 16 },
});
