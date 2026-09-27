import { describe, expect, it } from 'vitest';

import {
  cameraCaptureToPhoto,
  getCameraMode,
  shutterKindFor,
  splitDataUrl,
} from '../cameraMode';

describe('getCameraMode', () => {
  it('uses the live camera on native Android and web', () => {
    expect(getCameraMode('android', null)).toBe('loading');
    expect(getCameraMode('web', { granted: true, canAskAgain: true })).toBe(
      'ready',
    );
  });

  it('keeps the picker flow on iOS native', () => {
    expect(getCameraMode('ios', null)).toBe('picker');
  });

  // Safari on an iPhone reports Platform.OS === 'web', not 'ios'. That is the
  // configuration the first tester said was working, so it must stay covered
  // explicitly — the 'ios' case above does not cover it.
  it('puts iPhone Safari (web) on the live camera path, not the iOS native path', () => {
    const iphoneSafari = getCameraMode('web', { granted: true, canAskAgain: true });
    const iosNative = getCameraMode('ios', { granted: true, canAskAgain: true });
    expect(iphoneSafari).not.toBe(iosNative);
    expect(iosNative).toBe('picker');
    expect(iphoneSafari).toBe('ready');
  });

  it('offers retry while permission can be requested and settings otherwise', () => {
    expect(
      getCameraMode('android', {
        granted: false,
        canAskAgain: true,
      }),
    ).toBe('request');
    expect(
      getCameraMode('android', {
        granted: false,
        canAskAgain: false,
      }),
    ).toBe('settings');
  });
});

describe('getCameraMode — permission lookup failure', () => {
  // expo-camera's web implementation THROWS when navigator.permissions.query is
  // missing (older Safari, Android in-app WebViews). Without this fallback the
  // permission stays null forever and the screen pins to 'loading' — a spinner
  // with no way to photograph a cat, which is the bug the live camera was
  // meant to fix.
  it('falls back to the system picker when the browser cannot report permission', () => {
    expect(getCameraMode('web', null, true)).toBe('picker');
    expect(getCameraMode('android', null, true)).toBe('picker');
  });

  it('never reports loading once the lookup has failed', () => {
    expect(getCameraMode('web', null, true)).not.toBe('loading');
  });

  it('defaults to the pre-existing behaviour when the flag is omitted', () => {
    expect(getCameraMode('web', null)).toBe('loading');
  });
});

// The regression guard for the original report. Jacky's Android phone showed a
// viewfinder with no camera button at all; these assert that every reachable
// combination resolves to a specific, named shutter — and in particular that
// the states which previously rendered nothing now resolve to 'picker'.
describe('shutterKindFor', () => {
  it('uses the live shutter only when the preview is genuinely up', () => {
    expect(shutterKindFor('ready', false, true)).toBe('live');
  });

  it.each([
    ['preview failed to mount', 'ready', true, true],
    ['tab is not focused', 'ready', false, false],
    ['permission still loading', 'loading', false, true],
    ['permission not yet granted', 'request', false, true],
    ['permission permanently refused', 'settings', false, true],
    ['platform uses the picker', 'picker', false, true],
  ] as const)(
    'falls back to the system camera when %s',
    (_label, state, cameraFailed, cameraActive) => {
      expect(shutterKindFor(state, cameraFailed, cameraActive)).toBe('picker');
    },
  );

  // A 'picker'-always implementation must fail here, not just the live case.
  it('does not fall back to the picker while the preview is usable', () => {
    expect(shutterKindFor('ready', false, true)).not.toBe('picker');
  });
});

describe('splitDataUrl', () => {
  it('splits a data URL into media type and bare payload', () => {
    expect(splitDataUrl('data:image/png;base64,AAAA')).toEqual({
      mediaType: 'image/png',
      base64: 'AAAA',
    });
  });

  it('leaves a bare payload alone', () => {
    expect(splitDataUrl('AAAA')).toEqual({ mediaType: null, base64: 'AAAA' });
  });

  it('does not mistake a file path for a data URL', () => {
    expect(splitDataUrl('file:///camera/cat.jpg')).toEqual({
      mediaType: null,
      base64: 'file:///camera/cat.jpg',
    });
  });
});

// This is the crash guard. expo-camera on web returns the ENTIRE image as a
// data URL in both `uri` and `base64`. `submit()` puts the uri in a router
// param, and expo-router carries params in the browser URL — so an unnormalised
// capture put a multi-megabyte photograph into the address bar and killed the
// tab the moment a tester pressed "check for matches".
describe('cameraCaptureToPhoto — web data URLs (SYC-73)', () => {
  const webCapture = {
    uri: 'data:image/png;base64,QUJDRA==',
    base64: 'data:image/png;base64,QUJDRA==',
  };
  const stubObjectUrl = () => 'blob:http://localhost/abc-123';

  it('never returns a data URL as the uri', () => {
    const photo = cameraCaptureToPhoto(webCapture, stubObjectUrl);
    expect(photo?.uri.startsWith('data:')).toBe(false);
    expect(photo?.uri).toBe('blob:http://localhost/abc-123');
  });

  it('strips the data-URL prefix off the base64 payload', () => {
    const photo = cameraCaptureToPhoto(webCapture, stubObjectUrl);
    expect(photo?.base64).toBe('QUJDRA==');
    expect(photo?.base64.startsWith('data:')).toBe(false);
  });

  it('keeps the uri small enough to survive a router param', () => {
    // A real capture is hundreds of KB to megabytes. Whatever the payload size,
    // the uri handed onward must not scale with it.
    const big = 'A'.repeat(200_000);
    const photo = cameraCaptureToPhoto(
      { uri: `data:image/png;base64,${big}`, base64: `data:image/png;base64,${big}` },
      stubObjectUrl,
    );
    expect(photo?.uri.length).toBeLessThan(200);
  });

  it('passes the real media type through to the object URL', () => {
    const seen: string[] = [];
    cameraCaptureToPhoto(webCapture, (_b64, mediaType) => {
      seen.push(mediaType);
      return 'blob:x';
    });
    expect(seen).toEqual(['image/png']);
  });

  it('falls back to the original uri when object URLs are unavailable', () => {
    const photo = cameraCaptureToPhoto(webCapture, () => null);
    expect(photo?.uri).toBe(webCapture.uri);
    // The base64 is still normalised even on the fallback path.
    expect(photo?.base64).toBe('QUJDRA==');
  });

  it('leaves a native capture untouched', () => {
    const photo = cameraCaptureToPhoto(
      { uri: 'file:///camera/cat.jpg', base64: 'QUJDRA==' },
      stubObjectUrl,
    );
    expect(photo).toEqual({ uri: 'file:///camera/cat.jpg', base64: 'QUJDRA==' });
  });

  it('rejects a capture whose payload is only a prefix', () => {
    expect(
      cameraCaptureToPhoto({ uri: 'x', base64: 'data:image/png;base64,' }, stubObjectUrl),
    ).toBeNull();
  });
});

describe('cameraCaptureToPhoto', () => {
  it('hands a camera capture to the existing photo representation', () => {
    expect(
      cameraCaptureToPhoto({
        uri: 'file:///camera/cat.jpg',
        base64: 'cat-photo',
      }),
    ).toEqual({
      uri: 'file:///camera/cat.jpg',
      base64: 'cat-photo',
    });
  });

  it('requests the existing resize fallback when base64 is unavailable', () => {
    expect(cameraCaptureToPhoto({ uri: 'file:///camera/cat.jpg' })).toBeNull();
  });
});