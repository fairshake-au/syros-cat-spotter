import { db, catsTable, foldName, foldedNameEquals } from "@workspace/db";
import { catDisplayPhoto, type PublicPhotoUrl } from "./photoVisibility";

/**
 * The cat that already holds `name`, if any: the same once folded (SYC-101,
 * DECISIONS.md Part 2g: accents, case, final sigma), which is exactly what
 * `cats_normalised_name_unique` refuses. The fold runs in SQL, so this can
 * never disagree with the index.
 */
export async function catNamed(name: string) {
  const [cat] = await db
    .select({
      id: catsTable.id,
      name: catsTable.name,
      primaryPhotoId: catsTable.primaryPhotoId,
    })
    .from(catsTable)
    .where(foldedNameEquals(name));
  return cat;
}

/** The words every name check refuses with (the sightings route, and a vet batch's new cat). */
export const NAME_TAKEN_WORDS = "Cat name already taken";
export const OFFENSIVE_NAME_WORDS = "Cat name contains offensive language";

// SYC-119 (choose-a-different-cat.md §3.1, §9): NAME_TAKEN names the cat that
// has the name, so the phone can ask "Is this them?". Public details only:
// the photo is the one the catalogue shows, so a main photo the team hid is
// replaced by the newest visible one, or none (PR 6, decided by Samuel,
// 11 Oct 2026).
export async function nameTakenBody(
  cat: Awaited<ReturnType<typeof catNamed>>,
): Promise<{
  error: string;
  code: "NAME_TAKEN";
  cat?: { id: number; name: string; photoUrl: PublicPhotoUrl | null };
}> {
  const body = { error: NAME_TAKEN_WORDS, code: "NAME_TAKEN" as const };
  if (!cat) return body;
  return {
    ...body,
    cat: { id: cat.id, name: cat.name, photoUrl: await catDisplayPhoto(cat) },
  };
}

/**
 * A violation of the folded-name unique index specifically, however Drizzle
 * wraps the pg error. Any other unique violation (a primary key, say) is not
 * "name taken" and must surface as the error it is.
 */
export function isUniqueViolation(err: unknown): boolean {
  for (let cur = err; cur; cur = (cur as { cause?: unknown }).cause) {
    const pgErr = cur as { code?: string; constraint?: string };
    if (pgErr.code === "23505" && pgErr.constraint === "cats_normalised_name_unique") {
      return true;
    }
  }
  return false;
}

/**
 * A name with nothing left once folded (only invisible characters, say).
 * Refused: it would be "taken" by every other such name, and nobody could
 * read it.
 */
export function isBlankName(name: string): boolean {
  return foldName(name) === "";
}

export const BLANK_NAME_BODY = {
  error: "Cat name is empty",
  code: "EMPTY_NAME" as const,
};

/**
 * For `.catch` on a write that can lose a race for a cat name: a
 * unique-index violation becomes `null` (answer NAME_TAKEN); anything else
 * is thrown on.
 */
export function nullOnUniqueViolation(err: unknown): null {
  if (isUniqueViolation(err)) return null;
  throw err;
}

/** A typed name that looks like a SYR number. */
export const SYR_SHAPED_NAME = "That looks like a cat's SYR number. Choose a name.";

/**
 * A name that reads as a SYR number ("SYR-0042", "syr42"). Refused wherever a
 * name is chosen: it would read as another cat's number, and could take the
 * name a cat left for spotters needs (its stored name is its SYR number).
 */
export function isSyrShapedName(name: string): boolean {
  // Folded first (case, accents), then Greek ΣΥΡ/συρ read as syr, and any
  // run of spaces and dashes (hyphen, en dash, minus ...) between SYR and
  // the digits is the same number.
  const folded = foldName(name).replace(/^συρ/u, "syr");
  return /^syr[\s\p{Pd}\u2212]*\d+$/u.test(folded);
}

export const SYR_SHAPED_NAME_BODY = {
  error: SYR_SHAPED_NAME,
  code: "SYR_SHAPED_NAME" as const,
};

/** A typed name with a web link or a phone number in it (SYC-709). */
export const NAME_HAS_LINK = "Names can't include web links or phone numbers.";

// Web endings that end a word ("buy-stuff.com", not "Mr.Whiskers"). `.co`,
// `.io` and `.me` are left out: they would catch names like "Mr.Co"; the
// "dot-word then /" rule below still catches t.me/x and wa.me/x.
const LINK_ENDINGS =
  "com|net|org|gr|eu|fr|de|it|es|uk|ru|info|biz|app|shop|site|online|xyz|link|ly|tv|cc";
const LINK_RE = new RegExp(
  `:\\/\\/|www\\.|\\.(?:${LINK_ENDINGS})(?![\\p{L}\\p{N}])|\\.[\\p{L}\\p{N}]+\\/`,
  "iu",
);
// Five digits in a row, or seven digits in a run where only single spaces,
// dots or dashes come between them ("691 234 5678", "+30 691-234-5678").
// \p{Nd} is a digit in any script.
const DIGITS_IN_A_ROW_RE = /\p{Nd}{5}/u;
const SPACED_DIGITS_RE = /\p{Nd}(?:[ .\p{Pd}]?\p{Nd}){6}/u;

/**
 * A name that carries a web link or a phone number (SYC-709 spec
 * docs/specs/syc-709-naming-limits.md). Best effort, not a guarantee: it
 * shuts the obvious advert route on names the public types (a pending cat,
 * a new cat on a sighting, an owner's rename), never on the team's.
 * NFKC first, so fullwidth dots and letters read as plain ones, and
 * invisible format characters are dropped.
 */
export function hasLinkOrPhoneNumber(name: string): boolean {
  // Invisible format characters (zero-width spaces, joiners) come out too,
  // so "691\u200b234\u200b5678" still reads as a phone number.
  const n = name.normalize("NFKC").replace(/\p{Cf}/gu, "");
  return LINK_RE.test(n) || DIGITS_IN_A_ROW_RE.test(n) || SPACED_DIGITS_RE.test(n);
}

export const NAME_HAS_LINK_BODY = {
  error: NAME_HAS_LINK,
  code: "NAME_HAS_LINK" as const,
};
