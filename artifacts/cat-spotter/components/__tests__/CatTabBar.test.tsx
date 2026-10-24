// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));

import { CatTabBar, type CatTabItem } from '../catPage/CatTabBar';

afterEach(cleanup);

// jsdom has no layout: say a label is 0.6 em per character wide, in a 66 px box.
const CLIENT = 66;
function fakeLayout() {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => CLIENT });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      const px = parseFloat((this as HTMLElement).style.fontSize || '12');
      return (this as HTMLElement).textContent!.length * px * 0.6;
    },
  });
}

const tabs: CatTabItem[] = [
  { key: 'about', emoji: '🐱', label: 'Σχετικά', a11yLabel: 'Σχετικά' },
  { key: 'photos', emoji: '📷', label: 'Φωτογραφίες', a11yLabel: 'Φωτογραφίες' },
];

describe('CatTabBar label fit', () => {
  it('a long label shrinks to fit, and choosing it keeps it fitted', () => {
    fakeLayout();
    const view = render(<CatTabBar tabs={tabs} selected="about" onSelect={() => {}} />);
    const label = () => view.getByText('Φωτογραφίες');
    expect(getComputedStyle(label()).fontSize).toBe('10px');
    view.rerender(<CatTabBar tabs={tabs} selected="photos" onSelect={() => {}} />);
    expect(getComputedStyle(label()).fontSize).toBe('10px');
    fireEvent.click(view.getByText('Σχετικά'));
  });
});
