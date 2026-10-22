// @vitest-environment jsdom
/**
 * "Does {name} live with you?" sheet (design-review-fixes-oct22.md §1.2):
 * the title and text for each state, the address as selectable text plus a
 * mailto link, and the way it closes.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@/lib/modalVisibility', () => ({ registerModalOpen: () => () => {} }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (k: string) => TRANSLATIONS.en[k] ?? k }) };
});
const openURL = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('react-native', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, Linking: { openURL } };
});

import { ClaimAskSheet } from '../ClaimAskSheet';
import { TRANSLATIONS } from '@/lib/i18n';
import { CONTACT_EMAIL } from '@/lib/contactMail';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ClaimAskSheet', () => {
  it('street: the title, the "spot first" text and OK, with no email', () => {
    const onClose = vi.fn();
    render(<ClaimAskSheet mode="street" catName="Agatha" onClose={onClose} />);
    expect(screen.getByRole('heading').textContent).toBe('Does Agatha live with you?');
    expect(screen.getByTestId('claim-ask-body').textContent).toBe(
      'If Agatha lives with you, first take a photo of Agatha with the Spot button. Then come back here and you can say Agatha lives with you.',
    );
    expect(screen.queryByTestId('claim-ask-mailto')).toBeNull();
    // "Spot Agatha now" (SYC-574 T2.6) only renders when the page offers it.
    expect(screen.queryByText('Spot Agatha now')).toBeNull();
    fireEvent.click(screen.getByTestId('claim-ask-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('claim-ask-close').textContent).toBe('OK');
  });

  it('homed: the "email us" text, with the address as a mailto link', () => {
    render(<ClaimAskSheet mode="homed" catName="Agatha" onClose={() => {}} />);
    expect(screen.getByTestId('claim-ask-body').textContent).toBe(
      'Agatha already has a home on the app. If Agatha’s yours and you’ve changed phone, email us at hello@catspotters.com and we’ll help.',
    );
    const mail = screen.getByTestId('claim-ask-mailto');
    expect(mail.textContent).toBe(CONTACT_EMAIL);
    expect(mail.getAttribute('role')).toBe('link');
    fireEvent.click(mail);
    expect(openURL).toHaveBeenCalledWith(`mailto:${CONTACT_EMAIL}`);
  });

  it('homed: the sentence is selectable text', () => {
    render(<ClaimAskSheet mode="homed" catName="Agatha" onClose={() => {}} />);
    const body = screen.getByTestId('claim-ask-body');
    expect(getComputedStyle(body).userSelect).not.toBe('none');
  });

  it('is a dialog that covers the screen behind it', () => {
    render(<ClaimAskSheet mode="street" catName="Agatha" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('tapping outside the sheet closes it', () => {
    const onClose = vi.fn();
    render(<ClaimAskSheet mode="street" catName="Agatha" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('claim-ask-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('every language keeps the address in the homed text, so the link can find it', () => {
    for (const code of ['en', 'el', 'fr'] as const) {
      expect(TRANSLATIONS[code].claimAskHomed).toContain(CONTACT_EMAIL);
      expect(TRANSLATIONS[code].claimAskHomed).toContain('{name}');
    }
  });
});

describe('ClaimAskSheet: "Spot {name} now" (SYC-574 T2.6)', () => {
  it('street mode shows it as the main button, and it calls onSpotNow', () => {
    const onSpotNow = vi.fn();
    const onClose = vi.fn();
    render(<ClaimAskSheet mode="street" catName="Agatha" onClose={onClose} onSpotNow={onSpotNow} />);
    const spot = screen.getByTestId('claim-ask-spot-now');
    expect(spot.textContent).toBe('Spot Agatha now');
    fireEvent.click(spot);
    expect(onSpotNow).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    // OK still closes.
    expect(screen.getByTestId('claim-ask-close')).toBeTruthy();
  });

  it('homed mode never shows it', () => {
    render(<ClaimAskSheet mode="homed" catName="Agatha" onClose={() => {}} onSpotNow={() => {}} />);
    expect(screen.queryByTestId('claim-ask-spot-now')).toBeNull();
  });
});
