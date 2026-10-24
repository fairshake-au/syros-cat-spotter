/**
 * SYC-508 (couldnt-load-try-again.md §2.4): never spin for ever.
 *
 * The cat-alogue, notifications and profile loads stop waiting after 20 s a
 * request and retry once, so a failure shows within about 40 s at worst.
 * They also run when the phone says it's offline (react-query's
 * `networkMode: 'always'`): that flag can be wrong on weak signal, and on web
 * react-query would otherwise hold "Try again" until the browser said online.
 */
export const LOAD_TIMEOUT_MS = 20_000;

export const LOAD_QUERY_OPTIONS = {
  retry: 1,
  networkMode: 'always',
} as const;
