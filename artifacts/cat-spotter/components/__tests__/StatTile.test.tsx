// @vitest-environment jsdom
/**
 * SYC-143: the Greek labels on the Home stat tiles ("ΔΙΑΚΡΊΣΕΙ / Σ",
 * "ΑΝΑΚΑΛΎ / ΨΕΙΣ") broke in the middle of words on a phone, and kept
 * accents Greek capitals don't carry. The label now drops the accents,
 * never breaks inside a word, and steps its letter-spacing then its size
 * down only as far as it needs to for the longest word to fit. Tiles in one
 * StatTileGroup share the smallest step, so a row reads as one size.
 *
 * jsdom does no layout, so each label's width is faked from its own inline
 * font-size/letter-spacing: (7/12 of the font size + spacing) per character
 * of its longest word, against a 70px-wide box.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ card: '#fff', foreground: '#000', mutedForeground: '#666' }),
}));

import { StatTile, StatTileGroup } from '../purropolis/StatTile';

const BOX = 70;
function longestWordWidth(el: HTMLElement): number {
  const fontSize = parseFloat(el.style.fontSize || '12');
  const spacing = parseFloat(el.style.letterSpacing || '0');
  const longest = Math.max(...(el.textContent ?? '').split(/\s+/).map((w) => w.length));
  return longest * ((fontSize * 7) / 12 + spacing);
}

const originals = {
  scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth'),
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
};
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return BOX;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return Math.max(BOX, Math.ceil(longestWordWidth(this)));
    },
  });
});
afterAll(() => {
  if (originals.scrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', originals.scrollWidth);
  if (originals.clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originals.clientWidth);
});
afterEach(cleanup);

const label = (getByText: (t: string) => HTMLElement, text: string) => getByText(text);

describe('StatTile label', () => {
  it('writes Greek capitals without accents', () => {
    const { getByText } = render(<StatTile value={2} label="Διακρίσεις" />);
    expect(getByText('ΔΙΑΚΡΙΣΕΙΣ')).toBeTruthy();
  });

  it('keeps the design size and spacing for a label that fits', () => {
    const { getByText } = render(<StatTile value={3} label="Είδες" />);
    const el = label(getByText, 'ΕΙΔΕΣ');
    expect(parseFloat(el.style.fontSize)).toBe(12);
    expect(parseFloat(el.style.letterSpacing)).toBeCloseTo(1.44);
  });

  it('shrinks a long word until it fits, and never lets it break mid-word', () => {
    // "ΑΝΑΚΑΛΥΨΕΙΣ": 11 letters is 11 * 8.44 = 93px at the design size.
    const { getByText } = render(<StatTile value={2} label="Πρώτες ανακαλύψεις" />);
    const el = label(getByText, 'ΠΡΩΤΕΣ ΑΝΑΚΑΛΥΨΕΙΣ');
    const size = parseFloat(el.style.fontSize);
    expect(size).toBeLessThan(12);
    expect(size).toBeGreaterThanOrEqual(9);
    expect(longestWordWidth(el)).toBeLessThanOrEqual(BOX);
    expect(el.style.overflowWrap).toBe('normal');
    expect(el.style.wordBreak).toBe('normal');
  });

  it('allows a break inside the word only when even the smallest size cannot fit it', () => {
    const { getByText } = render(<StatTile value={1} label="Supercalifragilistic" />);
    const el = label(getByText, 'SUPERCALIFRAGILISTIC');
    expect(parseFloat(el.style.fontSize)).toBe(9);
    expect(el.style.overflowWrap).toBe('anywhere');
  });

  it('gives every tile in a group the smallest size any of them needed', () => {
    const { getByText } = render(
      <StatTileGroup>
        <StatTile value={3} label="Είδες" />
        <StatTile value={2} label="Πρώτες ανακαλύψεις" />
      </StatTileGroup>,
    );
    const short = label(getByText, 'ΕΙΔΕΣ');
    const long = label(getByText, 'ΠΡΩΤΕΣ ΑΝΑΚΑΛΥΨΕΙΣ');
    expect(parseFloat(long.style.fontSize)).toBeLessThan(12);
    expect(short.style.fontSize).toBe(long.style.fontSize);
    expect(short.style.letterSpacing).toBe(long.style.letterSpacing);
  });
});
