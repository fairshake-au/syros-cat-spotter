// SYC-407: node-postgres's own message when the pool could not hand out a
// connection within connectionTimeoutMillis. Drizzle wraps query errors
// ("Failed query: ..." with the original on `cause`), so look down the chain.
// Anchored: a wrapped "Failed query: ... params: ..." message carries user text.
const POOL_TIMEOUT = /^timeout exceeded when trying to connect/i;

export function isPoolTimeout(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e instanceof Error && i < 5; e = e.cause, i++) {
    if (POOL_TIMEOUT.test(e.message)) return true;
  }
  return false;
}
