// @vitest-environment jsdom
/**
 * SYC-155: Welcome opens in the phone's language and its switch changes the
 * language for every screen after it (they all read the same context).
 */
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATIONS } from '@/lib/i18n';

const { getItem, setItem } = vi.hoisted(() => ({
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => {}),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/components/FairShakeMark', () => ({ FairShakeMark: () => null }));
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

import { LanguageProvider, useLanguage } from '@/context/LanguageContext';
import { WelcomeStep } from '../onboarding/WelcomeStep';

/** Stands in for a later screen: any later screen reading the context. */
function NextScreen() {
  const { t } = useLanguage();
  return <>{t('keepSafeTitle')}</>;
}

function renderWelcome() {
  return render(
    <LanguageProvider>
      <WelcomeStep onNext={() => {}} onRestore={() => {}} />
      <NextScreen />
    </LanguageProvider>,
  );
}

describe('Welcome language switch (SYC-155)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', { languages: ['fr-BE'], language: 'fr-BE' });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens in the phone's language, with that choice selected", async () => {
    const view = renderWelcome();
    expect(view.getByText(TRANSLATIONS.fr.welcomeCta)).toBeTruthy();
    const french = view.getByRole('radio', { name: 'Français' });
    expect(french.getAttribute('aria-checked')).toBe('true');
    expect(view.getByRole('radiogroup', { name: TRANSLATIONS.fr.language })).toBeTruthy();
  });

  it('a tap switches Welcome and the screens after it, and is remembered', async () => {
    const view = renderWelcome();
    fireEvent.click(view.getByRole('radio', { name: 'Ελληνικά' }));
    await waitFor(() => expect(view.getByText(TRANSLATIONS.el.welcomeCta)).toBeTruthy());
    expect(view.getByText(TRANSLATIONS.el.keepSafeTitle)).toBeTruthy();
    expect(setItem).toHaveBeenCalledWith('cat-spotter/language', 'el');
    expect(view.getByRole('radio', { name: 'Ελληνικά' }).getAttribute('aria-checked')).toBe('true');
  });
  // SYC-524: the old How it works screen's three steps now live on Welcome.
  it('shows the three steps under the subtitle, in order, each as one labelled element', () => {
    const view = renderWelcome();
    const t = TRANSLATIONS.fr;
    const rows = [
      [t.howStepSpot, t.howStepSpotBody],
      [t.howStepCatalog, t.howStepCatalogBody],
      [t.howStepHelp, t.howStepHelpBody],
    ];
    const text = view.container.textContent ?? '';
    let last = -1;
    for (const [title, body] of rows) {
      const at = text.indexOf(title);
      expect(at).toBeGreaterThan(last);
      last = at;
      expect(view.getByLabelText(`${title}. ${body}`)).toBeTruthy();
    }
  });

  it('re-renders the steps in Greek when the language changes', async () => {
    const view = renderWelcome();
    fireEvent.click(view.getByRole('radio', { name: 'Ελληνικά' }));
    const t = TRANSLATIONS.el;
    await waitFor(() =>
      expect(view.getByLabelText(`${t.howStepCatalog}. ${t.howStepCatalogBody}`)).toBeTruthy(),
    );
    expect(view.getByLabelText(`${t.howStepSpot}. ${t.howStepSpotBody}`)).toBeTruthy();
    expect(view.getByLabelText(`${t.howStepHelp}. ${t.howStepHelpBody}`)).toBeTruthy();
  });
});
