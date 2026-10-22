// @vitest-environment jsdom
/**
 * SYC-6: on the web the app is a centred 480px column; native is untouched.
 */
import React from 'react';
import { Platform, Text } from 'react-native';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { windowWidth } = vi.hoisted(() => ({ windowWidth: { current: 1280 } }));

vi.mock('react-native', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-native')>()),
  useWindowDimensions: () => ({ width: windowWidth.current, height: 800, scale: 1, fontScale: 1 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ background: '#fefcf7', border: '#d7dee4' }),
}));

import { AppColumn } from '../AppColumn';
import { appWidth, isWide } from '@/lib/appColumn';

afterEach(() => {
  cleanup();
  (Platform as { OS: string }).OS = 'web';
});

function column(width: number) {
  windowWidth.current = width;
  const r = render(
    <AppColumn>
      <Text>hello</Text>
    </AppColumn>,
  );
  return { ...r, el: r.getByTestId('app-column') };
}

describe('AppColumn', () => {
  it('caps the column at 480px with the app background, and draws its edges, on a wide window', () => {
    const { el, getByText } = column(1280);
    expect(el.style.maxWidth).toBe('480px');
    expect(el.style.backgroundColor).toBe('rgb(254, 252, 247)');
    expect(el.style.borderLeftWidth).toBe('1px');
    expect(el.style.borderRightWidth).toBe('1px');
    expect(el.contains(getByText('hello'))).toBe(true);
    expect(el.parentElement?.style.backgroundColor).toBe('rgb(254, 252, 247)');
  });

  it('draws no edges on a phone-width window', () => {
    const { el } = column(390);
    expect(el.style.maxWidth).toBe('480px');
    expect(el.style.borderLeftWidth).toBe('');
  });

  it('adds no wrapper on native', () => {
    (Platform as { OS: string }).OS = 'ios';
    windowWidth.current = 1280;
    const { queryByTestId, getByText } = render(
      <AppColumn>
        <Text>hello</Text>
      </AppColumn>,
    );
    expect(queryByTestId('app-column')).toBeNull();
    expect(getByText('hello')).toBeTruthy();
  });
});

describe('column helpers', () => {
  it('isWide is true only above 480', () => {
    expect(isWide(480)).toBe(false);
    expect(isWide(481)).toBe(true);
  });
  it('appWidth caps at the column on web and is the window on native', () => {
    expect(appWidth(1280)).toBe(480);
    expect(appWidth(390)).toBe(390);
    (Platform as { OS: string }).OS = 'ios';
    expect(appWidth(1280)).toBe(1280);
  });
});
