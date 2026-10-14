// @vitest-environment jsdom
/**
 * SYC-130: the let-go confirmation's label is long ("{name} doesn't live with
 * me any more"), and at 390 px with a long name it was cut off with "...".
 * `wrapLabel` lets a label wrap; every other button keeps its single line.
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));

import { Button } from '../purropolis/Button';

afterEach(cleanup);

const labelClass = (text: string) => screen.getByText(text).className;

describe('Button label wrapping', () => {
  it('wrapLabel drops the one-line class that truncates', () => {
    render(<Button>Plain</Button>);
    const plain = labelClass('Plain').split(' ');
    cleanup();
    render(<Button wrapLabel>Wrapped</Button>);
    const wrapped = labelClass('Wrapped').split(' ');
    const oneLine = plain.filter((c) => !wrapped.includes(c));
    expect(oneLine.length).toBeGreaterThan(0);
  });
});
