import { db, catsTable, foldedNameEquals } from "@workspace/db";
import { photoUrl } from "./catHelpers";

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

// SYC-119 (choose-a-different-cat.md §3.1, §9): NAME_TAKEN names the cat that
// has the name, so the phone can ask "Is this them?". Public details only.
export async function nameTakenBody(
  cat: Awaited<ReturnType<typeof catNamed>>,
): Promise<{
  error: string;
  code: "NAME_TAKEN";
  cat?: { id: number; name: string; photoUrl: string | null };
}> {
  const body = { error: "Cat name already taken", code: "NAME_TAKEN" as const };
  if (!cat) return body;
  return {
    ...body,
    cat: { id: cat.id, name: cat.name, photoUrl: await photoUrl(cat.primaryPhotoId) },
  };
}

/** A unique-index violation, however Drizzle wraps the pg error. */
export function isUniqueViolation(err: unknown): boolean {
  for (let cur = err; cur; cur = (cur as { cause?: unknown }).cause) {
    if ((cur as { code?: string }).code === "23505") return true;
  }
  return false;
}

/**
 * For `.catch` on a write that can lose a race for a cat name: a
 * unique-index violation becomes `null` (answer NAME_TAKEN); anything else
 * is thrown on.
 */
export function nullOnUniqueViolation(err: unknown): null {
  if (isUniqueViolation(err)) return null;
  throw err;
}
