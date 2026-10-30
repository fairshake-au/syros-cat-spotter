import { randomBytes } from "node:crypto";

const LETTERS = "bcdfghjkmpqrvwxz";

let counter = 0;

/**
 * A letters-only tag for test cat names (SYC-709, SYC-796).
 *
 * The public naming rule refuses names holding digit runs, so the tag is
 * spelt in letters. A clock-based tag repeats when two tests start in the same
 * millisecond, and the unique index on cats.normalised_name refuses the second
 * insert. The counter (four letters, base 16) keeps tags apart inside one run;
 * the random letters keep them apart across runs sharing a database.
 */
export function nameTag(): string {
  let n = counter++;
  let count = "";
  for (let i = 0; i < 4; i++) {
    count = LETTERS[n % 16]! + count;
    n = Math.floor(n / 16);
  }
  const random = [...randomBytes(6)].map((b) => LETTERS[b % 16]).join("");
  return `${count}${random}`;
}
