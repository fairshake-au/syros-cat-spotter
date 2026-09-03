// @vitest-environment jsdom
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getItem, setItem, setColorScheme, systemAppearance } = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(async () => {}),
  setColorScheme: vi.fn(),
  systemAppearance: { scheme: 'light' as 'light' | 'dark' | null },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem },
}));

vi.mock('react-native', () => ({
  Appearance: { setColorScheme },
  Platform: { OS: 'ios' },
  useColorScheme: () => systemAppearance.scheme,
}));

import colors from '@/constants/colors';
import {
  AppearanceProvider,
  useAppearance,
} from '@/context/AppearanceContext';
import { useColors } from '@/hooks/useColors';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppearanceProvider>{children}</AppearanceProvider>
);

describe('AppearanceProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemAppearance.scheme = 'light';
    getItem.mockResolvedValue(null);
  });

  it('defaults to system appearance when no preference is stored', async () => {
    const { result } = renderHook(
      () => ({ preference: useAppearance(), palette: useColors() }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.preference.isHydrated).toBe(true));

    expect(result.current.preference.appearance).toBe('system');
    expect(result.current.palette.background).toBe(colors.light.background);
    expect(setColorScheme).toHaveBeenLastCalledWith(null);
  });

  it('restores a saved override and applies it to native appearance', async () => {
    getItem.mockResolvedValue('dark');

    const { result } = renderHook(
      () => ({ preference: useAppearance(), palette: useColors() }),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.preference.appearance).toBe('dark'),
    );

    expect(result.current.palette.background).toBe(colors.dark.background);
    expect(setColorScheme).toHaveBeenLastCalledWith('dark');
  });

  it('does not let delayed hydration overwrite a new selection', async () => {
    let resolveStored!: (value: string | null) => void;
    getItem.mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveStored = resolve;
      }),
    );

    const { result } = renderHook(() => useAppearance(), { wrapper });

    act(() => result.current.setAppearance('light'));
    await act(async () => resolveStored('dark'));

    expect(result.current.appearance).toBe('light');
    expect(result.current.isHydrated).toBe(true);
    expect(setItem).toHaveBeenCalledWith('cat-spotter/appearance', 'light');
    expect(setColorScheme).toHaveBeenLastCalledWith('light');
  });

  it('follows device changes in system mode and ignores them when overridden', async () => {
    const { result, rerender } = renderHook(
      () => ({ preference: useAppearance(), palette: useColors() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.preference.isHydrated).toBe(true));

    systemAppearance.scheme = 'dark';
    rerender();
    expect(result.current.palette.background).toBe(colors.dark.background);

    act(() => result.current.preference.setAppearance('light'));
    systemAppearance.scheme = 'dark';
    rerender();
    expect(result.current.palette.background).toBe(colors.light.background);
  });
});