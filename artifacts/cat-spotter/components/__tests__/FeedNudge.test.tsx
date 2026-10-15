// @vitest-environment jsdom
/**
 * SYC-36 (match-wait plan PR 2; feeding-nudge.md §4, §5, §9.1 tests 1, 16,
 * 18): the nudge on the result screen, with its two buttons, and the
 * visitor's one-liner.
 */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    foreground: '#111', mutedForeground: '#666', border: '#ddd', card: '#fff', primary: '#c50',
    primaryForeground: '#fff', secondary: '#eee', secondaryForeground: '#111', accent: '#c50',
    accentForeground: '#fff', background: '#fff',
  }),
}));

import { FeedNudge } from '../FeedNudge';
import { TRANSLATIONS } from '@/lib/i18n';

afterEach(cleanup);
const en = TRANSLATIONS.en;
const t = (key: string) => en[key] ?? key;

function setup(over: Partial<React.ComponentProps<typeof FeedNudge>> = {}) {
  const onHelp = vi.fn();
  const onDismiss = vi.fn();
  const view = render(
    <FeedNudge variant="full" form="link" t={t} donateHost="syroscats.com" onHelp={onHelp} onDismiss={onDismiss} {...over} />,
  );
  return { ...view, onHelp, onDismiss };
}

describe('FeedNudge', () => {
  it('the full nudge: heading, both paragraphs, the figures, Help feed a cat and Got it', () => {
    const { getByText } = setup();
    expect(getByText(en.feedNudgeTitle!)).toBeTruthy();
    expect(getByText(en.feedNudgeWhy!)).toBeTruthy();
    expect(getByText(en.feedNudgeInstead!)).toBeTruthy();
    expect(getByText(en.feedNudgeEuro!)).toBeTruthy();
    expect(getByText('Help feed a cat')).toBeTruthy();
    expect(getByText('Got it')).toBeTruthy();
    expect(getByText('Opens syroscats.com in your browser')).toBeTruthy();
  });

  it('the buttons do what they say', () => {
    const { getByText, onHelp, onDismiss } = setup();
    fireEvent.click(getByText('Help feed a cat'));
    expect(onHelp).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText('Got it'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('16. without a link: no figures, no Help feed a cat, the Help tab line, and Got it', () => {
    const { queryByText, getByText } = setup({ form: 'noLink' });
    expect(queryByText(en.feedNudgeEuro!)).toBeNull();
    expect(queryByText('Help feed a cat')).toBeNull();
    expect(getByText(en.feedNudgeInsteadNoLink!)).toBeTruthy();
    expect(getByText('Got it')).toBeTruthy();
  });

  it('the one-liner: one line and Help feed a cat, no Got it', () => {
    const { getByText, queryByText, getByTestId } = setup({ variant: 'line' });
    expect(getByTestId('feed-nudge-line')).toBeTruthy();
    expect(getByText(en.feedNudgeLine!)).toBeTruthy();
    expect(getByText('Help feed a cat')).toBeTruthy();
    expect(queryByText('Got it')).toBeNull();
    expect(queryByText(en.feedNudgeTitle!)).toBeNull();
  });

  it('18. both buttons are at least 44 points tall and wrap to one per line when they don\'t fit', () => {
    const { getByText } = setup();
    for (const label of ['Help feed a cat', 'Got it']) {
      let el: HTMLElement | null = getByText(label);
      let minHeight = 0;
      while (el && !minHeight) {
        minHeight = parseFloat(getComputedStyle(el).minHeight) || 0;
        el = el.parentElement;
      }
      expect({ label, ok: minHeight >= 44 }).toEqual({ label, ok: true });
    }
    // The row wraps (one button per line on a narrow screen or at large text).
    let row: HTMLElement | null = getByText('Got it');
    while (row && getComputedStyle(row).flexWrap !== 'wrap') row = row.parentElement;
    expect(row).not.toBeNull();
  });
});
