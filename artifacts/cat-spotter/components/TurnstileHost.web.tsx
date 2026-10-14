/** SYC-170 spike: the web build runs the widget in-page (not in this spike). */
import { forwardRef } from 'react';
import type { TurnstileHostHandle } from './TurnstileHost';

export type { TurnstileHostHandle } from './TurnstileHost';
export const CHALLENGE_TIMEOUT_MS = 20_000;
export const TurnstileHost = forwardRef<TurnstileHostHandle>(function TurnstileHost() {
  return null;
});
