// @vitest-environment jsdom
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getItem, setItem } = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(async () => {}),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem },
}));

import { LanguageProvider, useLanguage } from '@/context/LanguageContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LanguageProvider>{children}</LanguageProvider>
);

function phoneSpeaks(...languages: string[]) {
  vi.stubGlobal('navigator', { languages, language: languages[0] });
}

describe('LanguageProvider (SYC-155)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getItem.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts in the phone's language and does not store the guess", async () => {
    phoneSpeaks('el-GR');
    const { result } = renderHook(() => useLanguage(), { wrapper });
    expect(result.current.language).toBe('el');
    await waitFor(() => expect(result.current.isLanguageReady).toBe(true));
    expect(result.current.language).toBe('el');
    expect(setItem).not.toHaveBeenCalled();
  });

  it("a stored choice beats the phone's language", async () => {
    phoneSpeaks('el-GR');
    getItem.mockResolvedValue('fr');
    const { result } = renderHook(() => useLanguage(), { wrapper });
    await waitFor(() => expect(result.current.isLanguageReady).toBe(true));
    expect(result.current.language).toBe('fr');
  });

  it('a tapped language is stored', async () => {
    phoneSpeaks('de-DE');
    const { result } = renderHook(() => useLanguage(), { wrapper });
    await waitFor(() => expect(result.current.isLanguageReady).toBe(true));
    expect(result.current.language).toBe('en');
    act(() => result.current.setLanguage('el'));
    expect(result.current.language).toBe('el');
    expect(setItem).toHaveBeenCalledWith('cat-spotter/language', 'el');
  });

  it('is ready even when storage fails', async () => {
    phoneSpeaks('fr-FR');
    getItem.mockRejectedValue(new Error('blocked'));
    const { result } = renderHook(() => useLanguage(), { wrapper });
    await waitFor(() => expect(result.current.isLanguageReady).toBe(true));
    expect(result.current.language).toBe('fr');
  });
});
