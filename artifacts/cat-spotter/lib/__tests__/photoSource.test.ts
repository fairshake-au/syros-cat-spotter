/**
 * SYC-113 test 19: photoSource sends the tester key as an image header on
 * native, never on web, and never without a key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'ios' as string }));
vi.mock('react-native', () => ({ Platform: platform }));

import { photoSource } from '../urls';
import { prelaunchKey } from '../prelaunch';

const saved = { ...process.env };

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = 'https://apptest.example';
  process.env.EXPO_PUBLIC_PRELAUNCH_KEY = 'tester-key';
  platform.OS = 'ios';
});

afterEach(() => {
  process.env.EXPO_PUBLIC_API_URL = saved.EXPO_PUBLIC_API_URL;
  if (saved.EXPO_PUBLIC_PRELAUNCH_KEY === undefined) delete process.env.EXPO_PUBLIC_PRELAUNCH_KEY;
  else process.env.EXPO_PUBLIC_PRELAUNCH_KEY = saved.EXPO_PUBLIC_PRELAUNCH_KEY;
});

describe('photoSource', () => {
  it.each(['ios', 'android'])('%s with a key → the header', (os) => {
    platform.OS = os;
    expect(photoSource('/api/photos/7')).toEqual({
      uri: 'https://apptest.example/api/photos/7',
      headers: { 'X-Prelaunch-Key': 'tester-key' },
    });
  });

  it('web → no headers (the browser sends the cookie with a same-origin image load)', () => {
    platform.OS = 'web';
    expect(photoSource('/api/photos/7')).toEqual({ uri: 'https://apptest.example/api/photos/7' });
  });

  it('no key → no headers', () => {
    delete process.env.EXPO_PUBLIC_PRELAUNCH_KEY;
    expect(photoSource('/api/photos/7')).toEqual({ uri: 'https://apptest.example/api/photos/7' });
    process.env.EXPO_PUBLIC_PRELAUNCH_KEY = '   ';
    expect(photoSource('/api/photos/7')).toEqual({ uri: 'https://apptest.example/api/photos/7' });
  });

  it('never sends the key to another host', () => {
    expect(photoSource('https://cdn.example.com/x.jpg')).toEqual({ uri: 'https://cdn.example.com/x.jpg' });
    expect(photoSource('https://apptest.example.evil.io/x.jpg')).toEqual({
      uri: 'https://apptest.example.evil.io/x.jpg',
    });
  });

  // SYC-98 Fable re-review, nit 4: '' used to fall through to
  // absoluteUrl(''), which returns the bare API origin (truthy, since ''
  // doesn't start with 'http') rather than undefined — photoSource would
  // request the API root instead of rendering nothing. '' is now treated
  // the same as null, same as a candidate with no real photo at all.
  it('a null photoUrl renders nothing (no uri)', () => {
    expect(photoSource(null)).toEqual({});
  });

  it("an empty string is treated the same as null, not a request to the bare API origin", () => {
    expect(photoSource('')).toEqual({});
  });
});

describe('prelaunchKey', () => {
  it('is trimmed on native, null on web', () => {
    process.env.EXPO_PUBLIC_PRELAUNCH_KEY = '  k1  ';
    expect(prelaunchKey()).toBe('k1');
    platform.OS = 'web';
    expect(prelaunchKey()).toBeNull();
  });
});
