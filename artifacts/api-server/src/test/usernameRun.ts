/**
 * A random hex run, made safe to put inside a username.
 *
 * The username filter (lib/moderation.ts) turns digits into letters (8→b,
 * 1→i, 7→t, 3→e, ...), so a run like "2b1732" spells "bite" and the server
 * answers 400 for a perfectly innocent test name. About 1 random run in 7,700
 * did (SYC-695). Swapping each digit for a consonant keeps the run unique and
 * leaves the filter nothing to read.
 */
export function usernameSafeRun(hex: string): string {
  return hex.replace(/[0-9]/g, (d) => "ghjklmnqrw"[Number(d)]!);
}
