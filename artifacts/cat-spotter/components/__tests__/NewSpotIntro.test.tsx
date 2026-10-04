// @vitest-environment jsdom
/**
 * The top of the "New spot" screen, straight after the photo is taken
 * (SYC-117 part 1, SYC-118).
 *
 * Testers on the 29 Sep call read the old copy ("Add a few details so we can
 * catalogue this cat.") as a promise of questions that never came, and read
 * "＋ Add another photo" as adding a second photo, when it actually threw the
 * first one away. These tests pin the replacement: the screen says it is about
 * location, and the way back to the camera is a visible "Retake photo" button.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

vi.mock('expo-image', () => ({
  Image: () => null,
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    foreground: '#111',
    mutedForeground: '#666',
    primary: '#c50',
    border: '#ddd',
    card: '#fff',
  }),
}));

import { NewSpotIntro } from '../NewSpotIntro';
import { TRANSLATIONS, type Language } from '@/lib/i18n';

function renderIntro(
  overrides: Partial<React.ComponentProps<typeof NewSpotIntro>> = {},
) {
  const props = {
    photoUri: 'blob:photo-1',
    title: 'Nice shot! 📸',
    hint: TRANSLATIONS.en.spotLocationHint,
    retakeLabel: TRANSLATIONS.en.retakePhoto,
    onRetake: vi.fn(),
    ...overrides,
  };
  return { ...render(<NewSpotIntro {...props} />), props };
}

const retakeButton = (c: HTMLElement) =>
  c.querySelector('[data-testid="retake-photo"]') as HTMLElement | null;

describe('NewSpotIntro', () => {
  it('says the screen is about where the cat was seen, not about details', () => {
    const { getByText } = renderIntro();
    expect(getByText(TRANSLATIONS.en.spotLocationHint)).toBeTruthy();
    expect(TRANSLATIONS.en.spotLocationHint.toLowerCase()).toContain('where');
    expect(TRANSLATIONS.en.spotLocationHint.toLowerCase()).not.toContain('detail');
  });

  it('shows a "Retake photo" button, announced as a button', () => {
    const { container } = renderIntro();
    const button = retakeButton(container);
    expect(button).not.toBeNull();
    expect(button!.textContent).toContain('Retake photo');
    expect(button!.getAttribute('role')).toBe('button');
  });

  it('throws the photo away when Retake is pressed', () => {
    const { container, props } = renderIntro();
    fireEvent.click(retakeButton(container)!);
    expect(props.onRetake).toHaveBeenCalledTimes(1);
  });

  // While a sighting is being sent or saved, the photo is still being read.
  // Throwing it away mid-save (on web that frees the photo's memory) could
  // leave a half-saved sighting, so Retake waits until the save has finished.
  it('cannot retake while the sighting is being saved', () => {
    const { container, props } = renderIntro({ disabled: true });
    const button = retakeButton(container)!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(props.onRetake).not.toHaveBeenCalled();
  });
});

describe('New spot copy in every language', () => {
  const langs = Object.keys(TRANSLATIONS) as Language[];

  it.each(langs)('has a location hint and a retake label (%s)', (lang) => {
    expect(TRANSLATIONS[lang].spotLocationHint?.trim()).toBeTruthy();
    expect(TRANSLATIONS[lang].retakePhoto?.trim()).toBeTruthy();
  });

  // The old keys promised details and "another" photo. They must not come
  // back under the old names with the old meaning.
  it.each(langs)('no longer carries the misleading strings (%s)', (lang) => {
    expect(TRANSLATIONS[lang].addDetailsHint).toBeUndefined();
    expect(TRANSLATIONS[lang].addAnotherPhoto).toBeUndefined();
    expect(TRANSLATIONS[lang].retakePhoto).not.toMatch(/＋|\+/);
  });
});
