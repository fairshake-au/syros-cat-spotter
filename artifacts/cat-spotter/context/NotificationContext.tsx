import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListNotifications,
  getListNotificationsQueryKey,
  useMarkAllNotificationsRead,
  useRegisterPushToken,
  type AppNotification,
} from '@workspace/api-client-react';
import { router } from 'expo-router';
import { getCat } from '@workspace/api-client-react';
import { useDevice } from './DeviceContext';

/**
 * Navigate to the cat referenced by a tapped push notification, or fall
 * back to the notifications inbox when the cat no longer exists (or the
 * payload has no usable catId).
 */
async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
) {
  const data = response.notification.request.content.data as
    | Record<string, unknown>
    | undefined;
  const catId = Number(data?.catId);
  if (Number.isFinite(catId) && catId > 0) {
    try {
      await getCat(catId);
      router.push(`/cat/${catId}`);
      return;
    } catch {
      // Cat is gone (or unreachable) — fall through to the inbox.
    }
  }
  router.push('/notifications');
}

// Foreground notifications show a banner and update the badge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

const POLL_MS = 30_000;

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  refetch: () => void;
  markAllRead: () => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  refetch: () => {},
  markAllRead: () => {},
});

export function NotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { deviceId } = useDevice();
  const queryClient = useQueryClient();
  const registeredRef = useRef(false);

  const registerToken = useRegisterPushToken();

  // Request push permission and sync the Expo push token on startup.
  useEffect(() => {
    if (!deviceId || registeredRef.current || Platform.OS === 'web') return;
    registeredRef.current = true;
    (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        let granted = status === 'granted';
        if (!granted) {
          const req = await Notifications.requestPermissionsAsync();
          granted = req.status === 'granted';
        }
        if (!granted) return;
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ??
          Constants.easConfig?.projectId;
        const token = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );
        if (token?.data) {
          registerToken.mutate({ deviceId, data: { token: token.data } });
        }
      } catch (err) {
        // Push is optional (e.g. simulators, Expo Go limits) — inbox still works.
        console.warn('Push token registration skipped:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  // Deep-link when the user taps a push notification: foreground/background
  // taps arrive via the listener; a cold-start tap is retrieved once.
  const coldStartHandledRef = useRef(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        void handleNotificationResponse(response);
      },
    );
    if (!coldStartHandledRef.current) {
      coldStartHandledRef.current = true;
      Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (response) void handleNotificationResponse(response);
        })
        .catch(() => {});
    }
    return () => sub.remove();
  }, []);

  const query = useListNotifications(deviceId ?? '', {
    query: {
      enabled: !!deviceId,
      queryKey: getListNotificationsQueryKey(deviceId ?? ''),
      refetchInterval: POLL_MS,
    },
  });

  const markAllMutation = useMarkAllNotificationsRead({
    mutation: {
      onSuccess: () => {
        if (deviceId) {
          queryClient.invalidateQueries({
            queryKey: getListNotificationsQueryKey(deviceId),
          });
        }
      },
    },
  });

  const notifications = useMemo(() => query.data ?? [], [query.data]);
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  // Keep the app icon badge in sync when permitted.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Notifications.setBadgeCountAsync(unreadCount).catch(() => {});
  }, [unreadCount]);

  const refetch = useCallback(() => {
    query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.refetch]);

  const markAllRead = useCallback(() => {
    if (deviceId) markAllMutation.mutate({ deviceId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, markAllMutation.mutate]);

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      isLoading: query.isLoading,
      refetch,
      markAllRead,
    }),
    [notifications, unreadCount, query.isLoading, refetch, markAllRead],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  return useContext(NotificationContext);
}
