import React from 'react';
import type { ReactNode } from 'react';

/**
 * True when `children` is nothing but text — a bare string/number, or an array
 * of them, as produced by JSX like `{'📍 '}{cat.description}`.
 *
 * The components use this to decide whether to wrap children in their own
 * styled `<Text>`. A naive `typeof children === 'string'` check silently fails
 * for the array case and renders the content unstyled, which on web means the
 * default serif face in the default black — dark text on a dark chip.
 */
export function isTextChildren(children: ReactNode): boolean {
  const flat = React.Children.toArray(children);
  if (flat.length === 0) return false;
  return flat.every((c) => typeof c === 'string' || typeof c === 'number');
}
