import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { catsTable, db, photosTable, pool, sightingsTable } from "@workspace/db";
import { areaFor } from "../lib/areas/namedAreas";
import { makeVariant } from "../lib/photoVariants";
import { catDisplayPhotoIds, hiddenPhotoIds } from "../lib/photoVisibility";
import { allTeamCats } from "../lib/teamCatList";
import { hitRate, mostlyOne, pct, rankGallery, rankOf, type ModelName } from "./accuracyRules";
import type { Embedder } from "./embedders";

// SYC-527 piece 3, Task 4, check 1 (spec section 8): the smoke test on the
// island's own photos. STRICTLY READ-ONLY:
//  - the connection is read-only at the session level ({@link makeReadOnly});
//  - photos are made into their medium size in memory with makeVariant, never
//    variantFor (which saves into photo_variants);
//  - what is printed is ranks and counts only: no photo id, cat id, name,
//    public id, position or vector.

type Pool = typeof pool;

/** Run a statement on every idle connection of the pool. */
async function onIdle(p: Pool, statement: string): Promise<void> {
  const idle = [];
  for (let i = p.idleCount; i > 0; i--) idle.push(await p.connect());
  for (const c of idle) {
    await c.query(statement);
    c.release();
  }
}

const READ_ONLY = "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY";
const READ_WRITE = "SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE";

/**
 * Make every connection of the shared pool read-only for its whole session,
 * and prove it before anything else runs. Returns a function that undoes it:
 * for tests only (the test harness writes to the same pool); the script never
 * calls it.
 */
export async function makeReadOnly(p: Pool = pool): Promise<() => Promise<void>> {
  const onConnect = (client: { query: (q: string) => Promise<unknown> }) => {
    // Queued ahead of the first query the pool hands this connection to.
    void client.query(READ_ONLY).catch(() => undefined);
  };
  p.on("connect", onConnect);
  await onIdle(p, READ_ONLY); // connections made before the hook
  const res = await p.query("SHOW transaction_read_only");
  if (res.rows[0]?.transaction_read_only !== "on") throw new Error("the database session is not read-only; refusing to run");
  return async () => {
    p.off("connect", onConnect);
    await onIdle(p, READ_WRITE);
  };
}

const athensDay = (d: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(d);

export interface SmokePair {
  /** 1..n, opaque: carries no id. */
  index: number;
  rank: Partial<Record<ModelName, number>>;
  /** Is the top 20 mostly (more than half) cats from one area? */
  mostlyOneArea: Partial<Record<ModelName, boolean>>;
}

export interface SmokeResult {
  galleryCats: number;
  pairs: SmokePair[];
}

interface SmokeInput {
  /** Gallery position of the right cat, and the query photo's id. */
  right: number;
  queryPhotoId: number;
}

async function jpegOf(photoId: number): Promise<Buffer | null> {
  const [p] = await db.select({ data: photosTable.data }).from(photosTable).where(and(eq(photosTable.id, photoId), isNull(photosTable.removedAt), isNotNull(photosTable.data)));
  if (!p || p.data === null) return null;
  try {
    return await makeVariant(Buffer.from(p.data, "base64"), "medium");
  } catch {
    return null;
  }
}

/**
 * Pairs and gallery. The gallery is the display photo of every active cat
 * (the same cats as the team's Cats list with no filters).
 * A pair is a cat with a second photo that is confirmed (a resolved sighting
 * of that cat), visible (not hidden, not removed), and from a different Athens
 * calendar day than the display photo. One query photo per cat: the lowest
 * photo id.
 */
export async function runSmokeCheck(
  embedders: readonly Embedder[],
  opts: { onlyCats?: (c: { id: number; name: string }) => boolean } = {},
): Promise<SmokeResult> {
  // Exactly what catsToCompare({}) returns (findFromPhoto.ts): the team list with no
  // filters, so only active cats. Not imported from there: that file pulls in the
  // paid matching service, which needs its keys to even load.
  const active = (await allTeamCats({})).cats.filter((c) => opts.onlyCats?.(c) ?? true);
  const rows = active.length
    ? await db
        .select({ id: catsTable.id, primaryPhotoId: catsTable.primaryPhotoId })
        .from(catsTable)
        .where(inArray(catsTable.id, active.map((c) => c.id)))
    : [];
  const shown = await catDisplayPhotoIds(rows);

  const galleryCats = active.filter((c) => shown.get(c.id) != null);
  const displayOf = new Map(galleryCats.map((c) => [c.id, shown.get(c.id)!]));
  const position = new Map(galleryCats.map((c, i) => [c.id, i]));

  const inputs: SmokeInput[] = [];
  if (galleryCats.length > 0) {
    const created = new Map(
      (
        await db
          .select({ id: photosTable.id, createdAt: photosTable.createdAt })
          .from(photosTable)
          .where(inArray(photosTable.id, [...displayOf.values()]))
      ).map((p) => [p.id, p.createdAt]),
    );
    const others = await db
      .select({ catId: sightingsTable.catId, photoId: photosTable.id, createdAt: photosTable.createdAt })
      .from(sightingsTable)
      .innerJoin(photosTable, eq(photosTable.id, sightingsTable.photoId))
      .where(
        and(
          inArray(sightingsTable.catId, galleryCats.map((c) => c.id)),
          eq(sightingsTable.status, "resolved"),
          isNull(photosTable.removedAt),
        ),
      )
      .orderBy(asc(photosTable.id));
    const hidden = await hiddenPhotoIds(others.map((o) => o.photoId));
    const chosen = new Set<number>();
    for (const o of others) {
      const catId = o.catId!;
      const display = displayOf.get(catId)!;
      if (chosen.has(catId) || o.photoId === display || hidden.has(o.photoId)) continue;
      const dDay = created.get(display) ? athensDay(created.get(display)!) : null;
      if (dDay === null || athensDay(o.createdAt) === dDay) continue;
      chosen.add(catId);
      inputs.push({ right: position.get(catId)!, queryPhotoId: o.photoId });
    }
  }

  const areas = galleryCats.map((c) => {
    return areaFor(c.placedAt.lat, c.placedAt.lng).key;
  });
  const pairs: SmokePair[] = inputs.map((_, i) => ({ index: i + 1, rank: {}, mostlyOneArea: {} }));

  // Photos are fetched and made one at a time, so memory stays small. One
  // model at a time, in the order given (CLIP first: see loadClipEmbedder).
  for (const e of embedders) {
    const gallery: Float32Array[] = [];
    for (const c of galleryCats) {
      const jpeg = await jpegOf(displayOf.get(c.id)!);
      if (!jpeg) throw new Error("a display photo could not be read; the check cannot be trusted");
      gallery.push(await e.embed(jpeg));
    }
    for (const [i, input] of inputs.entries()) {
      const jpeg = await jpegOf(input.queryPhotoId);
      if (!jpeg) throw new Error("a query photo could not be read; the check cannot be trusted");
      const q = await e.embed(jpeg);
      pairs[i]!.rank[e.name] = rankOf(q, gallery, input.right);
      const top20 = rankGallery(q, gallery).slice(0, 20).map((g) => areas[g]!);
      pairs[i]!.mostlyOneArea[e.name] = mostlyOne(top20);
    }
  }
  return { galleryCats: galleryCats.length, pairs };
}

export function smokePassesAt(r: SmokeResult, model: ModelName, k: number): boolean {
  return r.pairs.length > 0 && r.pairs.every((p) => (p.rank[model] ?? Infinity) <= k);
}

export function formatSmoke(r: SmokeResult, models: readonly ModelName[]): string[] {
  const lines = [
    "Check 1: smoke test on the island's own photos (read-only; ranks only)",
    `Gallery: ${r.galleryCats} active cats with a visible display photo`,
    `Pairs: ${r.pairs.length} cats with a second confirmed, visible photo from a different Athens day`,
  ];
  if (r.pairs.length === 0) {
    lines.push("No pairs to test: the smoke test cannot pass or fail.");
    return lines;
  }
  const chance20 = r.galleryCats === 0 ? null : (Math.min(20, r.galleryCats) / r.galleryCats) * 100;
  lines.push(`Chance level for the top 20: ${pct(chance20)}`);
  lines.push("Right cat's rank per pair (1 is best; this shows the index is not broken, not that it is good):");
  for (const p of r.pairs) {
    lines.push(`  pair ${p.index}: ${models.map((m) => `${m} rank ${p.rank[m]}`).join(", ")}`);
  }
  for (const m of models) {
    const ranks = r.pairs.map((p) => p.rank[m]!);
    const inside = (k: number) => ranks.filter((x) => x <= k).length;
    const area = r.pairs.filter((p) => p.mostlyOneArea[m]).length;
    lines.push(
      `${m}: top 10 ${inside(10)}/${ranks.length} (${pct(hitRate(ranks, 10))}), top 20 ${inside(20)}/${ranks.length} (${pct(hitRate(ranks, 20))}); ` +
        `smoke ${smokePassesAt(r, m, 10) ? "PASSES" : "FAILS"} at top 10, ${smokePassesAt(r, m, 20) ? "passes" : "fails"} at top 20; ` +
        `top 20 mostly one area in ${area}/${ranks.length} searches`,
    );
  }
  return lines;
}
