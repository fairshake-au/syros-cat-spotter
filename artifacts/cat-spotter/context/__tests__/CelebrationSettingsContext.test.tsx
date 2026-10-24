// @vitest-environment jsdom
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getItem, setItem } = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(async () => {}),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem },
}));

import { CelebrationSettingsProvider, useCelebrationSettings } from '@/context/CelebrationSettingsContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CelebrationSettingsProvider>{children}</CelebrationSettingsProvider>
);

describe('CelebrationSettingsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getItem.mockResolvedValue(null);
  });

  it('defaults to sounds on', async () => {
    const { result } = renderHook(() => useCelebrationSettings(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.soundsOn).toBe(true);
    expect(getItem).toHaveBeenCalledWith('cat-spotter/celebration-sounds');
  });

  it('restores a saved off', async () => {
    getItem.mockResolvedValue('false');
    const { result } = renderHook(() => useCelebrationSettings(), { wrapper });
    await waitFor(() => expect(result.current.soundsOn).toBe(false));
  });

  it('saves a change', async () => {
    const { result } = renderHook(() => useCelebrationSettings(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => result.current.setSoundsOn(false));
    expect(result.current.soundsOn).toBe(false);
    expect(setItem).toHaveBeenCalledWith('cat-spotter/celebration-sounds', 'false');
  });

  it('keeps working when storage throws', async () => {
    getItem.mockRejectedValue(new Error('no storage'));
    setItem.mockRejectedValue(new Error('no storage'));
    const { result } = renderHook(() => useCelebrationSettings(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.soundsOn).toBe(true);
    act(() => result.current.setSoundsOn(false));
    expect(result.current.soundsOn).toBe(false);
  });
});
