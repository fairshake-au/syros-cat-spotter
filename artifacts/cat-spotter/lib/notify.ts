import { Alert, Platform } from 'react-native';

/**
 * Tell the user something, on every platform.
 *
 * `Alert.alert` is an empty function on react-native-web, so on the web build
 * — the one every tester uses — a message sent through it is never seen. This
 * routes through `window.alert` there.
 */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      // eslint-disable-next-line no-alert
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}

/**
 * Ask a yes/no question. Resolves true when the user picks `confirmLabel`.
 * On web the browser's own OK / Cancel buttons are used, so the message must
 * make plain what OK does.
 */
export function confirmChoice(options: {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
}): Promise<boolean> {
  const { title, message, confirmLabel, cancelLabel } = options;
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
      return Promise.resolve(false);
    }
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
