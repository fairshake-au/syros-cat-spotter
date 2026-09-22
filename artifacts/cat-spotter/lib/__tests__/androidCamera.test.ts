import { describe, expect, it } from 'vitest';

import {
  cameraCaptureToPhoto,
  getAndroidCameraState,
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