// @vitest-environment jsdom
/**
 * useStoredPhotoUri (spec §3.2): file paths pass through; an idb: reference
 * becomes an object URL from the stored bytes, revoked on unmount and when
 * the reference changes.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  EncodingType: { Base64: 'base64' },
}));

import { setPhotoStoreAdapterForTests } from '@/lib/pendingPhotos';
import { createFakePhotoStore, type FakePhotoStore } from '@/lib/__tests__/fakePhotoStore';
import { useInlinePhotoUri, useStoredPhotoUri } from '../useStoredPhotoUri';

let fake: FakePhotoStore;
let created: string[];

beforeEach(() => {
  fake = createFakePhotoStore();
  setPhotoStoreAdapterForTests(fake.adapter);
  created = [];
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:test/${created.length + 1}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  setPhotoStoreAdapterForTests(undefined);
});

describe('useStoredPhotoUri', () => {
  it('returns a native file path unchanged', () => {
    const { result } = renderHook(() =>
      useStoredPhotoUri('file:///documents/pending-photos/A.jpg'),
    );
    expect(result.current).toBe('file:///documents/pending-photos/A.jpg');
  });

  it('turns an idb: reference into an object URL and revokes it on unmount', async () => {
    fake.seed('A', 'photo-A');
    const { result, unmount } = renderHook(() => useStoredPhotoUri('idb:A'));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe('blob:test/1'));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
  });

  it('revokes the old object URL when the reference changes', async () => {
    fake.seed('A', 'photo-A');
    fake.seed('A-r1', 'photo-A-replaced');
    const { result, rerender } = renderHook(
      ({ ref }: { ref: string }) => useStoredPhotoUri(ref),
      { initialProps: { ref: 'idb:A' } },
    );
    await waitFor(() => expect(result.current).toBe('blob:test/1'));
    rerender({ ref: 'idb:A-r1' });
    // Never the previous photo while the new one loads.
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe('blob:test/2'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
  });

  it('shows an inline photo on web through an object URL made from its bytes, never a data URL', async () => {
    const { result, unmount } = renderHook(() =>
      useInlinePhotoUri(`data:image/jpeg;base64,${btoa('inline-photo')}`),
    );
    await waitFor(() => expect(result.current).toBe('blob:test/1'));
    expect(result.current).not.toMatch(/^data:/);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
  });

  it('gives nothing when there is no inline photo', () => {
    const { result } = renderHook(() => useInlinePhotoUri(undefined));
    expect(result.current).toBeUndefined();
  });

  it('gives nothing for a photo the browser cleared', async () => {
    const { result } = renderHook(() => useStoredPhotoUri('idb:gone'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current).toBeUndefined();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
