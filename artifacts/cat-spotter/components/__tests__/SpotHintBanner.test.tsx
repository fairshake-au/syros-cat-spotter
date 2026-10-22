// @vitest-environment jsdom
/**
 * SYC-574 (design-review-fixes-oct22.md §2.2): "Spotting {name}" with the
 * cat's photo and a ✕ labelled "Stop spotting {name}". Theme colours only,
 * and the name is never cut short (long names wrap at 390px).
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({ Image: () => <img data-testid="spot-hint-photo" alt="" /> }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: (_t, k) => `token-${String(k)}` }) }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (k: string) => TRANSLATIONS.en[k] ?? k }) };
});

import { SpotHintBanner } from '../SpotHintBanner';

afterEach(cleanup);

const LONG = 'Αφροδίτη-Παναγιώτα της Άνω Σύρου και του Βαπορίων';

describe('SpotHintBanner', () => {
  it('says who is being spotted, with the photo', () => {
    render(<SpotHintBanner catName="Agatha" photoUrl="/api/photos/7" onStop={() => {}} />);
    expect(screen.getByTestId('spot-hint-text').textContent).toBe('Spotting Agatha');
    expect(screen.getByTestId('spot-hint-photo')).toBeTruthy();
  });

  it('the ✕ is labelled "Stop spotting {name}" and stops', () => {
    const onStop = vi.fn();
    render(<SpotHintBanner catName="Agatha" photoUrl={null} onStop={onStop} />);
    const stop = screen.getByLabelText('Stop spotting Agatha');
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('never clips a long name: no line limit on the text', () => {
    render(<SpotHintBanner catName={LONG} photoUrl={null} onStop={() => {}} />);
    const text = screen.getByTestId('spot-hint-text');
    expect(text.textContent).toBe(`Spotting ${LONG}`);
    // react-native-web turns numberOfLines into a line clamp / ellipsis.
    const style = text.getAttribute('style') ?? '';
    expect(style).not.toMatch(/line-clamp|text-overflow|ellipsis/);
    const source = readFileSync(path.resolve(__dirname, '../SpotHintBanner.tsx'), 'utf8');
    expect(source).not.toMatch(/numberOfLines/);
  });

  it('uses theme colours only (works in dark mode)', () => {
    const source = readFileSync(path.resolve(__dirname, '../SpotHintBanner.tsx'), 'utf8');
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|palette\./);
    expect(source).toMatch(/backgroundColor: colors\.card, borderColor: colors\.border/);
    expect(source).toMatch(/color: colors\.foreground/);
  });
});
