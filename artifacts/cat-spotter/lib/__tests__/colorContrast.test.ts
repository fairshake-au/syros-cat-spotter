import { describe, expect, it } from 'vitest';
import colors, { toneColors } from '@/constants/colors';

/**
 * SYC-766: every colour pair the app draws text or controls with meets
 * WCAG 2.2 AA in both themes: 4.5:1 for text, 3:1 for outlines (1.4.11).
 *
 * Left out on purpose: white on the brand pink (`accentForeground` on
 * `accent`, 3.4:1). Samuel chose on 23 Oct 2026 to keep the pink as it is
 * (SYC-142, closed as won't do).
 */

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TEXT = 4.5;
const OUTLINE = 3;

describe.each(['light', 'dark'] as const)('%s theme', (scheme) => {
  const c = colors[scheme];
  const surfaces = {
    background: c.background,
    card: c.card,
    muted: c.muted,
    secondary: c.secondary,
  };

  const textOnSurfaces = [
    'foreground',
    'mutedForeground',
    'primary',
    'destructive',
    'danger',
    'success',
    'info',
    'warningText',
  ] as const;

  for (const ink of textOnSurfaces) {
    for (const [surface, bg] of Object.entries(surfaces)) {
      it(`${ink} text on ${surface}`, () => {
        expect(contrast(c[ink], bg)).toBeGreaterThanOrEqual(TEXT);
      });
    }
  }

  const textPairs: [string, string, string][] = [
    ['primaryForeground on primaryFill', c.primaryForeground, c.primaryFill],
    ['destructiveForeground on destructiveFill', c.destructiveForeground, c.destructiveFill],
    ['secondaryForeground on secondary', c.secondaryForeground, c.secondary],
    // Badge labels on their soft fills.
    ['success on successSoft', c.success, c.successSoft],
    ['warningText on warningSoft', c.warningText, c.warningSoft],
    ['danger on dangerSoft', c.danger, c.dangerSoft],
    ['info on infoSoft', c.info, c.infoSoft],
  ];
  it.each(textPairs)('%s', (_name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(TEXT);
  });

  // Focused and selected controls carry a `primary` outline, so a selected
  // fill that is itself under 3:1 against a dark card is still marked.
  const outlinePairs: [string, string, string][] = [
    ['controlBorder on background', c.controlBorder, c.background],
    ['controlBorder on card', c.controlBorder, c.card],
    ['controlBorder on muted', c.controlBorder, c.muted],
    ['focused or selected outline (primary) on background', c.primary, c.background],
    ['focused or selected outline (primary) on card', c.primary, c.card],
    ['error outline (danger) on card', c.danger, c.card],
  ];
  it.each(outlinePairs)('%s', (_name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(OUTLINE);
  });
});

describe('toned Tag and StatTile labels (same in both themes)', () => {
  it.each(Object.entries(toneColors))('%s', (_tone, { fg, bg }) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(TEXT);
  });
});

describe('the contrast helper', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // The failing pairs the ticket listed, so a regression would be caught.
    expect(contrast('#ffc94d', '#fff5df')).toBeLessThan(TEXT);
    expect(contrast('#d7dee4', '#fefcf7')).toBeLessThan(OUTLINE);
  });
});
