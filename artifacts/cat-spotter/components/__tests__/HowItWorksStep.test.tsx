// @vitest-environment jsdom
/**
 * SYC-35: onboarding screen 2 carries the keep-your-distance guidance Syros
 * Cats asked for (PRODUCT-SPEC §2.2). The copy is `onboarding.healthy` from
 * docs/specs/source/safety-copy-translations.md, word for word, in all three
 * languages. These tests render the real screen against the real
 * translation tables, so a missing or renamed key fails here rather than
 * silently falling back to English (or to the raw key) on a phone.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATIONS, type Language } from '@/lib/i18n';

const lang = vi.hoisted(() => ({ current: 'en' as 'en' | 'el' | 'fr' }));

vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return {
    useLanguage: () => ({
      language: lang.current,
      // Deliberately no English fallback: a key missing from el/fr must
      // show up as the raw key and fail the assertions below.
      t: (key: string) => T[lang.current][key] ?? key,
    }),
  };
});

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff',
    foreground: '#000',
    mutedForeground: '#666',
    card: '#fff',
    primary: '#123',
    primaryForeground: '#fff',
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: vi.fn(() => Promise.resolve({ status: 'granted' })),
}));

// The design-system barrel pulls in Expo native modules (via Avatar and
// friends) that don't load under vitest; the screen only needs Button.
vi.mock('@/components/purropolis', async () => {
  const { Text } = await import('react-native');
  return {
    Button: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
  };
});

import { HowItWorksStep } from '../onboarding/HowItWorksStep';

const SAFETY_KEYS = [
  'howSafetyTitle',
  'howSafetyLiveHere',
  'howSafetyDistance',
  'howSafetyLeaveBe',
  'howSafetyHurt',
] as const;

// The words that carry the safety message in each language, pinned
// independently of the translation table so an accidental edit to the
// copy (not just a missing key) is caught.
const MUST_SAY: Record<Language, string[]> = {
  en: ['Look, don\'t touch.', 'Keep a step or two back', 'leave them be'],
  el: ['Κοίτα, μην αγγίζεις.', 'Κράτα ένα-δυο βήματα απόσταση', 'άσε τες ήσυχες'],
  fr: ['Regardez, ne touchez pas.', 'Restez à un pas ou deux', 'laissez-les tranquilles'],
};

afterEach(() => {
  cleanup();
  lang.current = 'en';
});

describe('HowItWorksStep keep-your-distance guidance (SYC-35)', () => {
  it.each(['en', 'el', 'fr'] as const)('renders every line of the guidance in %s', (code) => {
    lang.current = code;
    const { container } = render(<HowItWorksStep onNext={() => {}} onSkip={() => {}} />);
    const text = container.textContent ?? '';

    for (const key of SAFETY_KEYS) {
      const copy = TRANSLATIONS[code][key];
      expect(copy, `${code}.${key} is missing`).toBeTruthy();
      expect(text).toContain(copy);
      expect(text).not.toContain(key);
    }
    for (const phrase of MUST_SAY[code]) {
      expect(text).toContain(phrase);
    }
  });

  it('keeps the Greek and French distinct from the English (no silent fallback)', () => {
    for (const key of SAFETY_KEYS) {
      expect(TRANSLATIONS.el[key]).not.toBe(TRANSLATIONS.en[key]);
      expect(TRANSLATIONS.fr[key]).not.toBe(TRANSLATIONS.en[key]);
    }
  });

  it('exposes the guidance to screen readers as a labelled region', () => {
    const { getByLabelText } = render(<HowItWorksStep onNext={() => {}} onSkip={() => {}} />);
    expect(getByLabelText(TRANSLATIONS.en.howSafetyTitle)).toBeTruthy();
  });
});
