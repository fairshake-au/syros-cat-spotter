// @vitest-environment jsdom
/**
 * SYC-35: the keep-your-distance guidance Syros Cats asked for (PRODUCT-SPEC
 * §2.2) has its own onboarding screen, straight after "How it works". The
 * copy is `onboarding.healthy` from
 * docs/specs/source/safety-copy-translations.md, word for word, in all three
 * languages. These tests render the real screen against the real
 * translation tables, so a missing or renamed key fails here rather than
 * silently falling back to English (or to the raw key) on a phone.
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
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
    border: '#ddd',
    primary: '#123',
    primaryForeground: '#fff',
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The design-system barrel pulls in Expo native modules (via Avatar and
// friends) that don't load under vitest; the screen only needs Button.
vi.mock('@/components/purropolis', async () => {
  const { Text } = await import('react-native');
  return {
    Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
      <Text role="button" onPress={onPress}>
        {children}
      </Text>
    ),
  };
});

import { SafetyStep, SHOW_HURT_LINE } from '../onboarding/SafetyStep';

const SAFETY_KEYS = [
  'howSafetyTitle',
  'howSafetyLiveHere',
  'howSafetyDistance',
  'howSafetyLeaveBe',
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

describe('SafetyStep keep-your-distance screen (SYC-35)', () => {
  it.each(['en', 'el', 'fr'] as const)('renders every line of the guidance in %s', (code) => {
    lang.current = code;
    const { container } = render(<SafetyStep onNext={() => {}} />);
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
    // The button uses the shared `continue` key in the reader's language.
    expect(text).toContain(TRANSLATIONS[code].continue);
  });

  it('shows the hurt-or-sick line, now the cat-in-trouble flow keeps its promise (SYC-42, Decision 7)', () => {
    // Samuel, 1 Oct 2026: the line ships with SYC-42 Slice 1, in the same PR
    // as the flow it promises ("the app will tell you what to do").
    expect(SHOW_HURT_LINE).toBe(true);
    for (const code of ['en', 'el', 'fr'] as const) {
      lang.current = code;
      const { container } = render(<SafetyStep onNext={() => {}} />);
      expect(TRANSLATIONS[code].howSafetyHurt, `${code}.howSafetyHurt`).toBeTruthy();
      expect(container.textContent ?? '').toContain(TRANSLATIONS[code].howSafetyHurt);
      cleanup();
    }
  });

  it('keeps the Greek and French distinct from the English (no silent fallback)', () => {
    for (const key of [...SAFETY_KEYS, 'howSafetyHurt'] as const) {
      expect(TRANSLATIONS.el[key]).not.toBe(TRANSLATIONS.en[key]);
      expect(TRANSLATIONS.fr[key]).not.toBe(TRANSLATIONS.en[key]);
    }
  });

  it('exposes the heading to screen readers', () => {
    const { getByRole } = render(<SafetyStep onNext={() => {}} />);
    expect(getByRole('heading').textContent).toBe(TRANSLATIONS.en.howSafetyTitle);
  });

  it('continues only through its one button, and offers no Skip', () => {
    const onNext = vi.fn();
    const { getByText, queryByText } = render(<SafetyStep onNext={onNext} />);
    expect(queryByText(TRANSLATIONS.en.skip)).toBeNull();
    fireEvent.click(getByText(TRANSLATIONS.en.continue));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
