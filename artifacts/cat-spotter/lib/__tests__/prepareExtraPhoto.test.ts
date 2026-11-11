import { beforeEach, describe, expect, it, vi } from 'vitest';

// A plain recorder rather than vi.fn(), so the stub can fail without vitest
// tracking the failure on the spy itself.
type Impl = (uri: string, actions: unknown[], opts: Record<string, unknown>) => unknown;
const state: { impl: Impl; calls: unknown[][] } = { impl: () => ({}), calls: [] };
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: async (uri: string, actions: unknown[], opts: Record<string, unknown>) => {
    state.calls.push([uri, actions, opts]);
    return state.impl(uri, actions, opts);
  },
  SaveFormat: { JPEG: 'jpeg' },
}));

import { prepareExtraPhoto, preparePhotoForUpload } from '../prepareExtraPhoto';

const ENCODE = { compress: 0.8, format: 'jpeg', base64: true };
const lastCall = () => state.calls[state.calls.length - 1];

function sourceOf(width: number, height: number) {
  state.impl = (_uri, _actions, opts) =>
    !opts || !('base64' in opts) ? { uri: 'src', width, height } : { uri: 'prepared-uri', width: 1, height: 1, base64: 'PREPARED' };
}

describe('prepareExtraPhoto (SYC-415 spec §6.1: 2048px long side, quality 0.8)', () => {
  beforeEach(() => {
    state.calls = [];
  });

  it('resizes a landscape photo to 2048 wide', async () => {
    sourceOf(4000, 3000);
    expect(await prepareExtraPhoto('file://a.jpg')).toEqual({ uri: 'prepared-uri', base64: 'PREPARED' });
    expect(lastCall()).toEqual(['file://a.jpg', [{ resize: { width: 2048 } }], ENCODE]);
  });

  it('resizes a portrait photo to 2048 high', async () => {
    sourceOf(3000, 4000);
    await prepareExtraPhoto('file://b.jpg');
    expect(lastCall()).toEqual(['file://b.jpg', [{ resize: { height: 2048 } }], ENCODE]);
  });

  it('only re-encodes a photo already within 2048px', async () => {
    sourceOf(1200, 900);
    await prepareExtraPhoto('file://c.jpg');
    expect(lastCall()).toEqual(['file://c.jpg', [], ENCODE]);
  });

  it('returns null when the photo cannot be read (refused at pick time, spec §4.3)', async () => {
    state.impl = () => {
      throw new Error('cannot decode HEIC');
    };
    expect(await prepareExtraPhoto('file://d.heic')).toBeNull();
    expect(state.calls.length).toBe(1);
  });

  it('returns null when the re-encode produces no base64', async () => {
    state.impl = (_u, _a, opts) => (opts && 'base64' in opts ? { uri: 'x', width: 1, height: 1 } : { uri: 'src', width: 10, height: 10 });
    expect(await prepareExtraPhoto('file://e.jpg')).toBeNull();
  });
});

describe('preparePhotoForUpload with a known size (SYC-864: the camera photo)', () => {
  beforeEach(() => {
    state.calls = [];
    state.impl = () => ({ uri: 'prepared-uri', width: 1, height: 1, base64: 'PREPARED' });
  });

  it('decodes the photo once: no measuring pass when the size is known', async () => {
    expect(await preparePhotoForUpload('file://cam.jpg', { width: 8160, height: 6120 })).toEqual({
      uri: 'prepared-uri',
      base64: 'PREPARED',
    });
    expect(state.calls).toEqual([['file://cam.jpg', [{ resize: { width: 2048 } }], ENCODE]]);
  });

  it('resizes a portrait camera photo to 2048 high', async () => {
    await preparePhotoForUpload('file://cam.jpg', { width: 3000, height: 4000 });
    expect(state.calls).toEqual([['file://cam.jpg', [{ resize: { height: 2048 } }], ENCODE]]);
  });

  it('measures first when the picker gave no size', async () => {
    state.impl = (_uri, _actions, opts) =>
      !opts || !('base64' in opts) ? { uri: 'src', width: 4000, height: 3000 } : { uri: 'p', width: 1, height: 1, base64: 'P' };
    await preparePhotoForUpload('file://cam.jpg', { width: 0, height: 0 });
    expect(state.calls.length).toBe(2);
    expect(lastCall()).toEqual(['file://cam.jpg', [{ resize: { width: 2048 } }], ENCODE]);
  });

  it('returns null when the photo cannot be read', async () => {
    state.impl = () => {
      throw new Error('out of memory');
    };
    expect(await preparePhotoForUpload('file://cam.jpg', { width: 4000, height: 3000 })).toBeNull();
  });
});
