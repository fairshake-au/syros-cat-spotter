import { catsTable, db, type Cat } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { canonicalCatOf } from "./catIdentity";
import type { DbOrTx } from "./observations";

/**
 * A request about a merged-away cat acts on the cat it is part of now
 * (which-cat-is-which.md §4.2, §9.3 "Readers that must stop showing a
 * merged-away cat, or show its survivor"): an old link, a notification, or
 * a phone that hasn't refreshed yet still names Mimi, and means Agatha.
 *
 * A cat standing alone is its own survivor. So is a cat in a merge loop or a
 * chain too deep to follow (no canonical cat, lib/catIdentity.ts): bad data
 * never sends a request to some other cat.
 */

/** The id of the cat this one is now. */
export async function survivorIdOf(catId: number, q: Pick<DbOrTx, "execute"> = db): Promise<number> {
  return (await canonicalCatOf([catId], {}, q)).get(catId) ?? catId;
}

export interface Survivor {
  /** The cat to show or act on. */
  cat: Cat;
  /** The cat asked about, when it is merged into `cat`. */
  mergedFrom: { id: number; name: string } | null;
}

/** The cat to show for `catId`, and the merged-away cat asked about, if it was one. Null when `catId` is no cat. */
export async function survivorOf(catId: number, q: Pick<DbOrTx, "execute" | "select"> = db): Promise<Survivor | null> {
  const survivorId = await survivorIdOf(catId, q);
  const rows = await q.select().from(catsTable).where(inArray(catsTable.id, [...new Set([catId, survivorId])]));
  const asked = rows.find((r) => r.id === catId);
  if (!asked) return null;
  const cat = rows.find((r) => r.id === survivorId);
  if (survivorId === catId || !cat) return { cat: asked, mergedFrom: null };
  return { cat, mergedFrom: { id: asked.id, name: asked.name } };
}

/**
 * For a list (the bell's cat news): of these cats, the ones merged into
 * another, each mapped to the cat it is part of now. Two queries whatever
 * the number of cats.
 */
export async function survivorsOf(
  catIds: readonly number[],
  q: Pick<DbOrTx, "execute" | "select"> = db,
): Promise<Map<number, { id: number; name: string; primaryPhotoId: number }>> {
  const out = new Map<number, { id: number; name: string; primaryPhotoId: number }>();
  const canonical = await canonicalCatOf(catIds, {}, q);
  const moved = [...canonical].filter((e): e is [number, number] => e[1] !== null && e[1] !== e[0]);
  if (moved.length === 0) return out;
  const rows = await q
    .select({ id: catsTable.id, name: catsTable.name, primaryPhotoId: catsTable.primaryPhotoId })
    .from(catsTable)
    .where(inArray(catsTable.id, [...new Set(moved.map(([, to]) => to))]));
  for (const [from, to] of moved) {
    const row = rows.find((r) => r.id === to);
    if (row) out.set(from, row);
  }
  return out;
}

/**
 * Locks the survivor's cat row `FOR UPDATE` for a write (follow, let-go),
 * or `FOR SHARE` (a resolve filing a sighting under it), and returns its id. The cat asked about is locked too, both in id order
 * (the order a merge and an undo take them), and the survivor is read again
 * under the locks: a merge or undo committed meanwhile is seen, and the lock
 * is taken again on the cat it now is.
 */
export async function lockSurvivor(tx: DbOrTx, catId: number, mode: "update" | "share" = "update"): Promise<number> {
  const lock = async (survivorId: number) => {
    const ids = [...new Set([catId, survivorId])].sort((a, b) => a - b);
    const list = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
    await tx.execute(
      mode === "update"
        ? sql`select id from cats where id in (${list}) order by id for update`
        : sql`select id from cats where id in (${list}) order by id for share`,
    );
  };
  let guess = await survivorIdOf(catId, tx);
  for (let tries = 0; tries < 3; tries += 1) {
    await lock(guess);
    const now = await survivorIdOf(catId, tx);
    if (now === guess) return now;
    guess = now;
  }
  // Merges and undos landing faster than this can lock: the newest answer,
  // locked (a lock already held is no harm).
  await lock(guess);
  return guess;
}
