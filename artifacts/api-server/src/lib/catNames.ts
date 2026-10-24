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
  return /^syr-?\d+$/i.test(foldName(name));
}

export const SYR_SHAPED_NAME_BODY = {
  error: SYR_SHAPED_NAME,
  code: "SYR_SHAPED_NAME" as const,
};
