/**
 * SYC-772: where the walking cat stands on the fact progress bar (spec §3.2).
 */
import { describe, expect, it } from 'vitest';
import { catPosition } from '../catPosition';

describe('catPosition', () => {
  it('puts the cat’s front paws at the end of the fill', () => {
    expect(catPosition(3, 11, 330, 36)).toBe(54);
  });
  it('clamps to the left edge when the fill is shorter than the cat', () => {
    expect(catPosition(1, 11, 330, 36)).toBe(0);
  });
  it('stops at the right edge when the bar is full', () => {
    expect(catPosition(11, 11, 330, 36)).toBe(294);
  });
  it('is 0 for no progress', () => {
    expect(catPosition(0, 11, 330, 36)).toBe(0);
  });
  it('is 0 when there is no total', () => {
    expect(catPosition(3, 0, 330, 36)).toBe(0);
  });
  it('is 0 when the bar is no wider than the cat', () => {
    expect(catPosition(3, 11, 36, 36)).toBe(0);
  });
});
