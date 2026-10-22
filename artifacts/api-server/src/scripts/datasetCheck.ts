import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { makeVariant } from "../lib/photoVariants";
import { hitRate, pct, rankOf, type ModelName } from "./accuracyRules";
import type { Embedder } from "./embedders";

// SYC-527 piece 3, Task 4, check 2 (spec section 8): a local folder of
// individually labelled cats, one sub-folder per cat. Runs on the Mac only;
// nothing is uploaded and nothing is written.
//
// Choice (deterministic): in each cat's folder the image file names are
// sorted (plain string order); the gallery image is the FIRST and the query
// image the LAST. A cat needs two readable images. The gallery is one image
// per cat across all cats.

const IMAGE = /\.(jpe?g|png|webp)$/i;

export interface DatasetResult {
  /** Cats with at least two readable images: the cats in the gallery. */
  cats: number;
  /** Sub-folders skipped (fewer than two readable images). */
  skipped: number;
  ranks: Partial<Record<ModelName, number[]>>;
}

export async function loadDatasetPairs(
  root: string,
  maxCats?: number,
): Promise<{ gallery: Buffer[]; queries: Buffer[]; skipped: number }> {
  const folders = (await readdir(root)).sort();
  const gallery: Buffer[] = [];
  const queries: Buffer[] = [];
  let skipped = 0;
  for (const f of folders) {
    if (maxCats !== undefined && gallery.length >= maxCats) break;
    const dir = path.join(root, f);
    if (!(await stat(dir)).isDirectory()) continue;
    const files = (await readdir(dir)).filter((n) => IMAGE.test(n)).sort();
    // First and last readable, trying inward if an end is unreadable.
    let lo = 0;
    let hi = files.length - 1;
    let first: Buffer | null = null;
    let last: Buffer | null = null;
    while (lo < hi && first === null) first = await readImage(dir, files[lo++]!);
    while (hi >= lo && last === null) last = await readImage(dir, files[hi--]!);
    if (first === null || last === null) {
      skipped++;
      continue;
    }
    gallery.push(first);
    queries.push(last);
  }
  return { gallery, queries, skipped };
}

/** The image as the app's medium JPEG, or null if it can't be read. */
async function readImage(dir: string, name: string): Promise<Buffer | null> {
  try {
    return await makeVariant(await readFile(path.join(dir, name)), "medium");
  } catch {
    return null;
  }
}

export async function runDatasetCheck(
  root: string,
  embedders: readonly Embedder[],
  opts: { maxCats?: number } = {},
): Promise<DatasetResult> {
  const { gallery, queries, skipped } = await loadDatasetPairs(root, opts.maxCats);
  const ranks: DatasetResult["ranks"] = {};
  // One model at a time, in the order given (CLIP first: see loadClipEmbedder).
  for (const e of embedders) {
    const g: Float32Array[] = [];
    for (const b of gallery) g.push(await e.embed(b));
    const out: number[] = [];
    for (const [i, q] of queries.entries()) out.push(rankOf(await e.embed(q), g, i));
    ranks[e.name] = out;
  }
  return { cats: gallery.length, skipped, ranks };
}

export function formatDataset(r: DatasetResult): string[] {
  const lines = [
    "Check 2: larger set of individually known cats (local only, never uploaded)",
    `Cats with two readable images: ${r.cats} (${r.skipped} folders skipped)`,
    "Gallery: first image per cat (sorted file names); query: the last image",
  ];
  if (r.cats < 100) lines.push(`WARNING: ${r.cats} cats is under the 100 the spec asks for; treat as indicative only.`);
  const chance20 = r.cats === 0 ? null : (Math.min(20, r.cats) / r.cats) * 100;
  lines.push(`Chance level for the top 20: ${pct(chance20)}`);
  for (const [name, ranks] of Object.entries(r.ranks)) {
    lines.push(`${name}: top 10 ${pct(hitRate(ranks, 10))}, top 20 ${pct(hitRate(ranks, 20))} (of ${ranks.length} searches)`);
  }
  lines.push('"Mostly one place" is not computed for this set: it has no areas (it applies to check 1 only).');
  return lines;
}
