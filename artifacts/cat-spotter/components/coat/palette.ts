import type { Colour } from '@/lib/coat';

/**
 * The coat drawings' paint (SYC-398, coat-colours-and-pattern.md §3). The
 * same fills as the team pages' drawn cat (api-server
 * lib/teamPages/coatDrawing.ts, PR B), so a cat looks the same everywhere.
 */
export const FILL: Record<Colour, string> = {
  black: '#2b2b2b',
  grey: '#8d929a',
  brown: '#8b5a2b',
  ginger: '#e38b3a',
  white: '#fbfaf6',
};
/** A part that isn't known: a plain neutral, never a guess. */
export const UNKNOWN = '#e4e0d8';
export const OUTLINE = '#3b3934';
