import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useNotifications } from '@/context/NotificationContext';

export function NotificationBell() {
  const colors = useColors();
  const router = useRouter();
  const { unreadCount } = useNotifications();

  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      hitSlop={8}
      style={styles.wrap}
      accessibilityLabel="Notifications"
    >
      <Feather name="bell" size={22} color={colors.foreground} />
      {unreadCount > 0 && (
        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.badgeText, { color: colors.accentForeground }]}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 4 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
});
