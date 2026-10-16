// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATIONS } from '../../lib/i18n';

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#000' }) }));
// react-native-svg has never been rendered under vitest here: stand in plain elements
// that keep the accessibility label, which is all these tests read.
vi.mock('react-native-svg', () => {
  const El = ({ children, accessibilityLabel }: any) =>
    React.createElement('svg', { 'aria-label': accessibilityLabel }, children);
  const Leaf = () => null;
  return {
    __esModule: true,
    default: El,
    Svg: El,
    G: Leaf,
    Rect: Leaf,
    Circle: Leaf,
    Ellipse: Leaf,
    Path: Leaf,
    Defs: Leaf,
    ClipPath: Leaf,
  };
});

import { PhotoTips } from '../photoTips/PhotoTips';

const KEYS = [
  'photoTipsTitle', 'photoTipsGotIt', 'photoTipsLink',
  'photoTipGetClose', 'photoTipGetCloseLine', 'photoTipFace', 'photoTipFaceLine',
  'photoTipBody', 'photoTipBodyLine', 'photoTipLight', 'photoTipLightLine',
  'cartoonGoodLabel', 'cartoonPoorLabel', 'cartoonFaceLabel', 'cartoonBodyLabel',
] as const;

describe('PhotoTips', () => {
  afterEach(cleanup);

  it('has every string in English, Greek and French', () => {
    for (const lang of ['en', 'el', 'fr'] as const) {
      for (const k of KEYS) expect((TRANSLATIONS as any)[lang][k], `${lang}.${k}`).toBeTruthy();
    }
  });

  it('never says "snapper" or "colony carer" in any language', () => {
    for (const lang of ['en', 'el', 'fr'] as const) {
      for (const k of KEYS) {
        expect((TRANSLATIONS as any)[lang][k]).not.toMatch(/snapper|colony carer/i);
      }
    }
  });

  it('shows four tips and both cartoons with spoken descriptions', () => {
    const { container, getByText } = render(<PhotoTips />);
    for (const k of ['photoTipGetClose', 'photoTipFace', 'photoTipBody', 'photoTipLight']) {
      expect(getByText(k)).toBeTruthy();
    }
    expect(container.querySelector('[aria-label="cartoonGoodLabel"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="cartoonPoorLabel"]')).not.toBeNull();
  });
});
