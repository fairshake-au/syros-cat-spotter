import { afterEach, describe, expect, it } from 'vitest';
import { isPhoneBrowser, openInAppOn, openInAppUrl } from '@/lib/openInApp';

afterEach(() => {
  delete process.env.EXPO_PUBLIC_OPEN_IN_APP;
});

describe('openInApp', () => {
  it('is off unless the switch says on', () => {
    expect(openInAppOn()).toBe(false);
    process.env.EXPO_PUBLIC_OPEN_IN_APP = 'true';
    expect(openInAppOn()).toBe(false);
    process.env.EXPO_PUBLIC_OPEN_IN_APP = 'on';
    expect(openInAppOn()).toBe(true);
  });

  it('builds the app link on the scheme in app.json', async () => {
    const app = (await import('../../app.json')).default;
    expect(openInAppUrl('abc_-123')).toBe(`${app.expo.scheme}://restore?t=abc_-123`);
  });

  it('knows phone browsers from desktop ones', () => {
    expect(isPhoneBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)')).toBe(true);
    expect(isPhoneBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126')).toBe(true);
    expect(isPhoneBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false);
  });
});
