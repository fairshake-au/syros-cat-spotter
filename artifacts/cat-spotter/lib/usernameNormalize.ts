/**
 * SYC-211 F3/F7: compare usernames the way the server does.
 *
 * Mirrors `normalizeUsername` in artifacts/api-server/src/lib/usernames.ts
 * (strip control characters, collapse whitespace, trim) plus the server's
 * case-insensitive uniqueness (`lower(username)`). Two names with the same
 * key are the same name to the server.
 */
export function usernameKey(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function sameUsername(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  return usernameKey(a) === usernameKey(b);
}
