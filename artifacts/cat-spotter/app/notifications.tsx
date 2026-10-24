import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { openWeeklyResult } from '@/lib/celebrationBus';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getGetProfileQueryKey,
  useGetProfile,
  type AppNotification,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, spacing, tracking } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';
import { useNotifications } from '@/context/NotificationContext';
import { IconButton } from '@/components/purropolis';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { LoadFailed } from '@/components/LoadFailed';
import { Button } from '@/components/purropolis/Button';
import { LOAD_QUERY_OPTIONS, LOAD_TIMEOUT_MS } from '@/lib/loadTiming';
import { notificationsEmptyKey } from '@/lib/notificationsEmpty';
import { goToSpotTab } from '@/lib/goToSpotTab';
import { useBannerAreaReserve } from '@/lib/bannerArea';

function relativeTime(iso: string, t: (k: string) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return t('justNow');
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const UPDATE_STYLE: Record<
  AppNotification['updateType'],
  { icon: keyof typeof Feather.glyphMap; bg: string; fg: string }
> = {
  sighting: { icon: 'check', bg: palette.aegean100, fg: palette.aegean800 },
  desexed: { icon: 'scissors', bg: palette.olive100, fg: palette.olive700 },
  adopted: { icon: 'heart', bg: palette.bougain100, fg: palette.bougain700 },
  general: { icon: 'bell', bg: palette.sun100, fg: palette.sun700 },
};

type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'item'; key: string; notification: AppNotification };

export default function NotificationsScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bannerReserve = useBannerAreaReserve();
  const { notifications, unreadCount, isLoading, loadFailed, refetch, markAllRead } =
    useNotifications();
  // SYC-508 §4.1: the profile Home already loads (same key), only to pick the
  // empty line.
  const { deviceId } = useDevice();
  const { isOnline } = useOffline();
  const profileQuery = useGetProfile(deviceId ?? '', {
    query: {
      enabled: !!deviceId && isOnline,
      queryKey: getGetProfileQueryKey(deviceId ?? ''),
      ...LOAD_QUERY_OPTIONS,
    },
    request: { timeoutMs: LOAD_TIMEOUT_MS },
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const rows = useMemo<Row[]>(() => {
    const now = new Date();
    const today: AppNotification[] = [];
    const earlier: AppNotification[] = [];
    for (const n of notifications) {
      if (isSameDay(new Date(n.createdAt), now)) today.push(n);
      else earlier.push(n);
    }
    const out: Row[] = [];
    if (today.length > 0) {
      out.push({ kind: 'header', key: 'hdr-today', label: t('notificationsToday') });
      today.forEach((n) => out.push({ kind: 'item', key: `n-${n.id}`, notification: n }));
    }
    if (earlier.length > 0) {
      out.push({ kind: 'header', key: 'hdr-earlier', label: t('notificationsEarlier') });
      earlier.forEach((n) => out.push({ kind: 'item', key: `n-${n.id}`, notification: n }));
    }
    return out;
  }, [notifications, t]);

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'header') {
      return (
        <View style={styles.sectionHeader}>
          <Text
            style={[
              styles.eyebrow,
              {
                color: colors.mutedForeground,
                letterSpacing: fontSizes['2xs'] * tracking.wider,
              },
            ]}
          >
            {item.label}
          </Text>
        </View>
      );
    }

    const n = item.notification;
    const iconStyle = UPDATE_STYLE[n.updateType] ?? UPDATE_STYLE.general;
    const time = relativeTime(n.createdAt, t);
    const rowLabel = [n.read ? null : t('notificationUnread'), n.message, time]
      .filter(Boolean)
      .join('. ');

    return (
      <Pressable
        onPress={() => {
          // A weekly result has no cat: it opens its celebration while one is
          // still queued, and otherwise the Spotters board (SYC-706).
          if (n.catId == null) {
            void openWeeklyResult(router);
            return;
          }
          router.push({
            pathname: '/cat/[id]',
            params: {
              id: String(n.catId),
              updateId: String(n.catUpdateId),
            },
          });
        }}
        accessibilityRole="button"
        accessibilityLabel={rowLabel}
        style={[
          styles.row,
          { backgroundColor: n.read ? 'transparent' : colors.secondary },
        ]}
      >
        {n.read ? (
          <View style={styles.dotSlot} />
        ) : (
          <View style={styles.dotSlot}>
            <View style={[styles.dot, { backgroundColor: colors.accent }]} />
          </View>
        )}
        <View style={[styles.iconCircle, { backgroundColor: iconStyle.bg }]}>
          <Feather name={iconStyle.icon} size={18} color={iconStyle.fg} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={[styles.message, { color: colors.foreground }]}
            numberOfLines={2}
          >
            {n.message}
          </Text>
          <Text style={[styles.time, { color: colors.mutedForeground }]}>
            {time}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + bannerReserve + 8 }]}>
        <IconButton variant="ghost" label={t('back')} onPress={close}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </IconButton>
        {/* The bell emoji is decoration: the label keeps it from being read aloud. */}
        <Text
          role="heading"
          accessibilityLabel={t('notificationsTitle')}
          style={[styles.title, { color: colors.foreground }]}
        >
          {t('notificationsTitle')} 🔔
        </Text>
        {unreadCount > 0 ? (
          <Pressable
            onPress={markAllRead}
            accessibilityRole="button"
            style={styles.markAllHit}
          >
            <Text style={[styles.markAll, { color: colors.primary }]}>
              {t('markAllRead')}
            </Text>
          </Pressable>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : loadFailed ? (
        // SYC-508 §3.3: a failed load is not an empty inbox.
        <LoadFailed size="full" onRetry={refetch} testID="notifications-load-failed" />
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <Feather name="bell-off" size={40} color={colors.mutedForeground} />
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            {t(notificationsEmptyKey(profileQuery.data))}
          </Text>
          {/* SYC-578: the empty inbox's way forward. */}
          <Button variant="primary" size="lg" onPress={() => goToSpotTab(router)}>
            {t('spotTitle')}
          </Button>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[3],
  },
  title: { fontSize: fontSizes.xl, fontFamily: fonts.displayBold, flex: 1 },
  markAll: { fontSize: fontSizes.xs, fontFamily: fonts.bodyBold },
  markAllHit: { minHeight: 44, justifyContent: 'center' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  empty: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  sectionHeader: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[1],
  },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes['2xs'],
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  dotSlot: { width: 8, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { fontSize: fontSizes.xs, fontFamily: fonts.body, lineHeight: fontSizes.xs * 1.4 },
  time: { fontSize: fontSizes['3xs'], fontFamily: fonts.body },
});
