import { describe, expect, it } from 'vitest';
import { catDisplayName } from '../catDisplayName';

const t = (k: string) => (k === 'noNameYet' ? 'No name yet' : k);

describe('catDisplayName', () => {
  it('says "No name yet" while the name is pending, never the SYR number', () => {
    expect(catDisplayName({ name: 'SYR-0007', namePending: true }, t)).toBe('No name yet');
  });
  it('shows the name otherwise, including from an older server', () => {
    expect(catDisplayName({ name: 'Agatha', namePending: false }, t)).toBe('Agatha');
    expect(catDisplayName({ name: 'Agatha' }, t)).toBe('Agatha');
  });
});
