import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useNotifications } from '@/context/NotificationContext';
import { useLanguage } from '@/context/LanguageContext';

export function NotificationBell() {
  const colors = useColors();
  const router = useRouter();
  const { unreadCount } = useNotifications();
  const { t } = useLanguage();
  const label =
    unreadCount > 0
      ? t('notificationsBellUnread').replace('{n}', String(unreadCount))
      : t('notificationsTitle');

  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      style={styles.wrap}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name="bell" size={22} color={colors.foreground} />
      {unreadCount > 0 && (
        <View
          style={[styles.badge, { backgroundColor: colors.accent }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={[styles.badgeText, { color: colors.accentForeground }]}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // SYC-509: a 44pt target on every platform (hitSlop does not widen it on web).
  wrap: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 5,
    right: 3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
});
