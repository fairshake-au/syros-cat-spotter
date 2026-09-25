import { describe, expect, it } from 'vitest';

import {
  cameraCaptureToPhoto,
  getAndroidCameraState,
  shutterKindFor,
  type AndroidCameraState,
} from '../androidCamera';

describe('getAndroidCameraState', () => {
  it('uses the live camera on native Android and web', () => {
    expect(getAndroidCameraState('android', null)).toBe('loading');
    expect(getAndroidCameraState('web', { granted: true, canAskAgain: true })).toBe(
      'ready',
    );
  });

  it('keeps the existing picker camera flow on iOS', () => {
    expect(getAndroidCameraState('ios', null)).toBe('picker');
  });

  it('offers retry while permission can be requested and settings otherwise', () => {
    expect(
      getAndroidCameraState('android', {
        granted: false,
        canAskAgain: true,
      }),
    ).toBe('request');
    expect(
      getAndroidCameraState('android', {
        granted: false,
        canAskAgain: false,
      }),
    ).toBe('settings');
  });
});

describe('getAndroidCameraState — permission lookup failure', () => {
  // expo-camera's web implementation THROWS when navigator.permissions.query is
  // missing (older Safari, Android in-app WebViews). Without this fallback the
  // permission stays null forever and the screen pins to 'loading' — a spinner
  // with no way to photograph a cat, which is the bug the live camera was
  // meant to fix.
  it('falls back to the system picker when the browser cannot report permission', () => {
    expect(getAndroidCameraState('web', null, true)).toBe('picker');
    expect(getAndroidCameraState('android', null, true)).toBe('picker');
  });

  it('never reports loading once the lookup has failed', () => {
    expect(getAndroidCameraState('web', null, true)).not.toBe('loading');
  });

  it('defaults to the pre-existing behaviour when the flag is omitted', () => {
    expect(getAndroidCameraState('web', null)).toBe('loading');
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

  it('resolves every state to a shutter, never to nothing', () => {
    const states: AndroidCameraState[] = [
      'picker',
      'loading',
      'request',
      'settings',
      'ready',
    ];
    for (const state of states) {
      for (const cameraFailed of [true, false]) {
        for (const cameraActive of [true, false]) {
          expect(['live', 'picker']).toContain(
            shutterKindFor(state, cameraFailed, cameraActive),
          );
        }
      }
    }
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