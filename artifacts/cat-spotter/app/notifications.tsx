import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppNotification } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useNotifications } from '@/context/NotificationContext';
import { absoluteUrl } from '@/lib/urls';

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

export default function NotificationsScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notifications, unreadCount, isLoading, refetch, markAllRead } =
    useNotifications();

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const renderItem = ({ item }: { item: AppNotification }) => (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/cat/[id]', params: { id: String(item.catId) } })
      }
      style={[
        styles.row,
        {
          backgroundColor: item.read ? colors.background : colors.card,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Image
        source={{ uri: absoluteUrl(item.catPhotoUrl) }}
        style={[styles.thumb, { borderColor: colors.border }]}
        contentFit="cover"
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.catName, { color: colors.foreground }]}>
          {item.catName}
        </Text>
        <Text
          style={[styles.message, { color: colors.mutedForeground }]}
          numberOfLines={2}
        >
          {item.message}
        </Text>
      </View>
      <View style={styles.rightCol}>
        <Text style={[styles.time, { color: colors.mutedForeground }]}>
          {relativeTime(item.createdAt, t)}
        </Text>
        {!item.read && (
          <View style={[styles.dot, { backgroundColor: colors.primary }]} />
        )}
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={close} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t('notificationsTitle')}
        </Text>
        {unreadCount > 0 ? (
          <Pressable onPress={markAllRead} hitSlop={8}>
            <Text style={[styles.markAll, { color: colors.primary }]}>
              {t('markAllRead')}
            </Text>
          </Pressable>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <Feather name="bell-off" size={40} color={colors.mutedForeground} />
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            {t('noNotifications')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => String(n.id)}
          renderItem={renderItem}
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
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', flex: 1 },
  markAll: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 48, height: 48, borderRadius: 24, borderWidth: 1 },
  catName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  message: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  rightCol: { alignItems: 'flex-end', gap: 6 },
  time: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
