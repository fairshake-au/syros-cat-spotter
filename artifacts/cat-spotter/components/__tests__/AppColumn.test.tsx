// @vitest-environment jsdom
/**
 * SYC-6: on the web the app is a centred 480px column; native is untouched.
 */
import React from 'react';
import { Platform, Text } from 'react-native';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ background: '#fefcf7', border: '#d7dee4' }),
}));

import { AppColumn } from '../AppColumn';

afterEach(() => {
  cleanup();
  (Platform as { OS: string }).OS = 'web';
});

describe('AppColumn', () => {
  it('wraps children in a column with the app background on web', () => {
    const { getByTestId, getByText } = render(
      <AppColumn>
        <Text>hello</Text>
      </AppColumn>,
    );
    const column = getByTestId('app-column');
    expect(column.style.backgroundColor).toBe('rgb(254, 252, 247)');
    expect(column.contains(getByText('hello'))).toBe(true);
    expect(column.parentElement?.style.backgroundColor).toBe('rgb(254, 252, 247)');
  });

  it('adds no wrapper on native', () => {
    (Platform as { OS: string }).OS = 'ios';
    const { queryByTestId, getByText } = render(
      <AppColumn>
        <Text>hello</Text>
      </AppColumn>,
    );
    expect(queryByTestId('app-column')).toBeNull();
    expect(getByText('hello')).toBeTruthy();
  });
});
