// @vitest-environment jsdom
/**
 * SYC-524: the explain-first location card on the Spot screen, and its
 * smaller forms (the "Use where I am" link and the "location is off" lines).
 */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATIONS } from '../../lib/i18n';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#000' }) }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (key: string) => (T.en as any)[key] ?? key }) };
});

import { LocationAskCard } from '../spot/LocationAskCard';

const en = TRANSLATIONS.en as Record<string, string>;
const NEW_KEYS = ['locAskTitle', 'locAskBody', 'locAskUse', 'locAskMap', 'locOffNative', 'locOffWeb'] as const;

function setup(view: 'card' | 'link' | 'off-native' | 'off-web', busy = false) {
  const onUse = vi.fn();
  const onMap = vi.fn();
  const onOpenSettings = vi.fn();
  const utils = render(
    <LocationAskCard view={view} busy={busy} onUse={onUse} onMap={onMap} onOpenSettings={onOpenSettings} />,
  );
  return { ...utils, onUse, onMap, onOpenSettings };
}

const disabled = (el: HTMLElement | null) => el?.closest('[aria-disabled]')?.getAttribute('aria-disabled') === 'true';

describe('LocationAskCard', () => {
  afterEach(cleanup);

  it('has every new line in English, Greek and French', () => {
    for (const lang of ['en', 'el', 'fr'] as const) {
      for (const k of NEW_KEYS) expect((TRANSLATIONS as any)[lang][k], `${lang}.${k}`).toBeTruthy();
    }
  });

  it('uses the agreed English words', () => {
    expect(en.locAskTitle).toBe("Use where you're standing?");
    expect(en.locAskUse).toBe('Use where I am');
    expect(en.locAskMap).toBe("I'll put the pin on the map");
  });

  it('card: the heading, the line and both buttons, each doing its own thing', () => {
    const { getByText, queryByText, onUse, onMap, onOpenSettings } = setup('card');
    expect(getByText(en.locAskTitle)).toBeTruthy();
    expect(getByText(en.locAskBody)).toBeTruthy();
    fireEvent.click(getByText(en.locAskUse));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onMap).not.toHaveBeenCalled();
    fireEvent.click(getByText(en.locAskMap));
    expect(onMap).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(queryByText(en.openSettings)).toBeNull();
    expect(queryByText(en.locOffNative)).toBeNull();
  });

  it('card while busy: the first button says it is locating and is disabled; the map button still works', () => {
    const { getByText, queryByText, onUse, onMap } = setup('card', true);
    expect(queryByText(en.locAskUse)).toBeNull();
    const locating = getByText(en.locating);
    expect(disabled(locating)).toBe(true);
    fireEvent.click(locating);
    expect(onUse).not.toHaveBeenCalled();
    const map = getByText(en.locAskMap);
    expect(disabled(map)).toBe(false);
    fireEvent.click(map);
    expect(onMap).toHaveBeenCalledTimes(1);
  });

  it('link: only the small "Use where I am" link', () => {
    const { getByText, queryByText, onUse } = setup('link');
    expect(queryByText(en.locAskTitle)).toBeNull();
    expect(queryByText(en.locAskBody)).toBeNull();
    expect(queryByText(en.locAskMap)).toBeNull();
    fireEvent.click(getByText(en.locAskUse));
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it('off-native: the line and Open Settings', () => {
    const { getByText, queryByText, onOpenSettings, onUse } = setup('off-native');
    expect(getByText(en.locOffNative)).toBeTruthy();
    expect(queryByText(en.locAskUse)).toBeNull();
    expect(queryByText(en.locOffWeb)).toBeNull();
    fireEvent.click(getByText(en.openSettings));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onUse).not.toHaveBeenCalled();
  });

  it('off-web: the line only', () => {
    const { getByText, queryByText } = setup('off-web');
    expect(getByText(en.locOffWeb)).toBeTruthy();
    expect(queryByText(en.openSettings)).toBeNull();
    expect(queryByText(en.locAskUse)).toBeNull();
    expect(queryByText(en.locOffNative)).toBeNull();
  });
});
