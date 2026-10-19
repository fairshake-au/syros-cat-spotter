import { Platform } from 'react-native';

/**
 * Shared by the cat-report and "Report an issue" queues (SYC-44 PR 6.2).
 *
 * Phone apps: the 24-hour reminder is a local notification scheduled when
 * the report is saved, so it fires even if the app isn't opened (spec §4.3),
 * and is cancelled the moment the report's text is accepted. The website
 * can't notify when closed, so it shows a banner the next time it's opened.
 */
export async function scheduleNativeReminder(title: string, at: Date): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    const Notifications = await import('expo-notifications');
    return await Notifications.scheduleNotificationAsync({
      content: { title },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  } catch {
    return undefined;
  }
}

export async function cancelNativeReminder(id: string | undefined): Promise<void> {
  if (!id || Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // nothing to cancel
  }
}
