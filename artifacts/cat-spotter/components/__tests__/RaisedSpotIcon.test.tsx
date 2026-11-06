// @vitest-environment jsdom
/**
 * SYC-781: the Spot tab's raised camera, and its ring in each theme.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-symbols', () => ({ SymbolView: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ accent: '#b02f66', accentForeground: '#fefcf7', background: '#f4f2ec' }),
}));

import { RaisedSpotIcon } from '../RaisedSpotIcon';

afterEach(cleanup);

const raised = (isDark: boolean) =>
  render(<RaisedSpotIcon isDark={isDark} />).getByTestId('spot-tab-raised');

describe('RaisedSpotIcon', () => {
  it('fills the camera with the Spot pink', () => {
    expect(getComputedStyle(raised(false)).backgroundColor).toBe('rgb(176, 47, 102)');
  });

  it('blends its ring into the page in light mode', () => {
    expect(getComputedStyle(raised(false)).borderTopColor).toBe('rgb(244, 242, 236)');
  });

  it('rings it in white in dark mode, where the pink alone is under 3:1', () => {
    expect(getComputedStyle(raised(true)).borderTopColor).toBe('rgb(254, 252, 247)');
  });
});
