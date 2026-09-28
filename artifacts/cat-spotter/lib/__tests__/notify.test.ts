// @vitest-environment jsdom
/**
 * The notify helper: Alert.alert is an empty function on react-native-web, so
 * on the web build messages must go through the browser's own dialogs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { platform, alert } = vi.hoisted(() => ({
  platform: { OS: 'web' as string },
  alert: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: platform,
  Alert: { alert },
}));

import { confirmChoice, notify } from '../notify';

beforeEach(() => {
  alert.mockReset();
  window.alert = vi.fn();
  window.confirm = vi.fn(() => true);
});

afterEach(() => {
  platform.OS = 'web';
});

describe('notify', () => {
  it('uses window.alert on web, where Alert.alert does nothing', () => {
    notify('Couldn’t save', 'Your photo is still here.');
    expect(window.alert).toHaveBeenCalledWith('Couldn’t save\n\nYour photo is still here.');
    expect(alert).not.toHaveBeenCalled();
  });

  it('uses Alert.alert on the phone apps', () => {
    platform.OS = 'android';
    notify('Saved');
    expect(alert).toHaveBeenCalledWith('Saved', undefined);
    expect(window.alert).not.toHaveBeenCalled();
  });
});

describe('confirmChoice', () => {
  const question = {
    title: 'Couldn’t reach the server',
    message: 'Save it and send it later?',
    confirmLabel: 'Save and send later',
    cancelLabel: 'Cancel',
  };

  it('uses window.confirm on web', async () => {
    expect(await confirmChoice(question)).toBe(true);
    expect(window.confirm).toHaveBeenCalledWith(
      'Couldn’t reach the server\n\nSave it and send it later?',
    );
  });

  it('resolves with the button chosen on the phone apps', async () => {
    platform.OS = 'ios';
    const answer = confirmChoice(question);
    const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress: () => void }>;
    buttons.find((b) => b.text === 'Save and send later')!.onPress();
    expect(await answer).toBe(true);
  });

  it('treats a dismissed dialog as no', async () => {
    platform.OS = 'android';
    const answer = confirmChoice(question);
    const options = alert.mock.calls[0][3] as { onDismiss: () => void };
    options.onDismiss();
    expect(await answer).toBe(false);
  });
});
