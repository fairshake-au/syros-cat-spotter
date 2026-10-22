// @vitest-environment jsdom
/**
 * SYC-120 step 2.2: Fold moved out of UrgentAdvice and gained a `tone`.
 * The default must stay "urgent" so the report's advice renders as before.
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    card: 'rgb(1, 2, 3)',
    border: 'rgb(200, 201, 202)',
    primary: 'rgb(10, 20, 30)',
  }),
}));

import { Fold } from '../report/Fold';

afterEach(cleanup);

function borderOf(container: HTMLElement): string {
  // The outermost View of the Fold carries the border colour.
  const root = container.firstElementChild as HTMLElement;
  return getComputedStyle(root).borderTopColor;
}

describe('Fold', () => {
  it('tone defaults to urgent: the urgent-primary border', () => {
    const { container } = render(
      <Fold title="T" icon="info">
        body
      </Fold>,
    );
    expect(borderOf(container)).toBe('rgb(10, 20, 30)');
  });

  it('tone "urgent" is the same as the default', () => {
    const { container } = render(
      <Fold title="T" icon="info" tone="urgent">
        body
      </Fold>,
    );
    expect(borderOf(container)).toBe('rgb(10, 20, 30)');
  });

  it('tone "plain" uses the ordinary card border', () => {
    const { container } = render(
      <Fold title="T" icon="info" tone="plain">
        body
      </Fold>,
    );
    expect(borderOf(container)).toBe('rgb(200, 201, 202)');
  });

  it('is closed by default and opens and closes on tap', () => {
    const { getByRole, queryByText } = render(
      <Fold title="Title" icon="info" tone="plain">
        the body
      </Fold>,
    );
    expect(queryByText('the body')).toBeNull();
    const header = getByRole('button');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(header);
    expect(queryByText('the body')).not.toBeNull();
    expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(header);
    expect(queryByText('the body')).toBeNull();
  });
});
