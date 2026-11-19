import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { buildCheckPrompt, readCheckAnswer, type CatCheck } from "../lib/photoCheck";
import type { NewPhotoInput } from "../lib/matching";
import { safeError } from "../lib/logger";

// SYC-866 (spec docs/specs/photo-check-not-sure.md §7): proves the new photo
// check prompt on real photos before it goes live. READ-ONLY (the database
// session is made read-only, the way calibrateDuplicateSweep does) and it
// changes nothing in the app. It needs the AI keys, so it is run in Replit.
//
//   pnpm --filter @workspace/db exec tsx ../../artifacts/api-server/src/scripts/photoCheckEval.ts --half tune|held [--prompt-file <path>]
//
// Printed: a photo number (or an extra file's name), the old answer, the new
// answers for each of two variants, and the worst. Never a photo, name,
// position or photoSeen: those go to ./photo-check-eval-out.json only.

/** Fixed, letters only (no clock, no random digits): the test set is the same every run. */
export const EVAL_SEED = "sockcheckseed";
/** Cats in the test set, about. */
export const TARGET_CATS = 40;
/** Multi-photo spots to make sure of, if there are that many. */
export const MULTI_PHOTO_SPOTS = 3;
/** The sock. */
export const SOCK_PHOTO_ID = 62;
export const RUNS = 3;
export const DARKEST_N = 3;
const SYROS = { lat: 37.44, lng: 24.94 };
const OUT_FILE = "./photo-check-eval-out.json";

export type Half = "tune" | "held";
export type Truth = "cat" | "not_cat";
export type OldAnswer = CatCheck | "failed" | "none";

/** One finished spot, keyed by its cover photo. */
export interface SpotRow {
  photoId: number;
  takenAt: Date;
  /** The old check said no photo in the spot showed a cat. */
  noCat: boolean;
  photoCount: number;
}

// ---- night, by a small deterministic sun calculation (NOAA's formulas) ----

/** True between sunset and sunrise at Syros (the island's own sun; Athens time is the same clock). */
export function isAthensNight(at: Date): boolean {
  const start = Date.UTC(at.getUTCFullYear(), 0, 0);
  const doy = Math.floor((at.getTime() - start) / 86_400_000);
  const g = ((2 * Math.PI) / 365) * (doy - 1);
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const lat = (SYROS.lat * Math.PI) / 180;
  const cosHa = Math.cos((90.833 * Math.PI) / 180) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
  if (cosHa >= 1) return true; // sun never rises
  if (cosHa <= -1) return false; // never sets
  const haDeg = (Math.acos(cosHa) * 180) / Math.PI;
  const sunriseMin = 720 - 4 * (SYROS.lng + haDeg) - eqTime; // minutes after 00:00 UTC
  const sunsetMin = 720 - 4 * (SYROS.lng - haDeg) - eqTime;
  const min = at.getUTCHours() * 60 + at.getUTCMinutes() + at.getUTCSeconds() / 60;
  return min < sunriseMin || min > sunsetMin;
}

// ---- the test set ----

/** FNV-1a: the same text always gives the same number. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface PickedPhoto {
  photoId: number;
  half: Half;
}

/**
 * Spec §7. In: every night spot, photo 62, every not-a-cat photo, a few
 * multi-photo spots, and a seeded sample of the rest up to about 40 cats.
 * Each is put in the tune or the held half by the seed. Deterministic.
 */
export function pickTestSet(rows: readonly SpotRow[], seed: string): PickedPhoto[] {
  const order = (r: SpotRow) => hash(`${seed}:pick:${r.photoId}`);
  const byOrder = [...rows].sort((a, b) => order(a) - order(b) || a.photoId - b.photoId);
  const chosen = new Map<number, SpotRow>();
  const take = (r: SpotRow) => chosen.set(r.photoId, r);
  for (const r of byOrder) if (r.noCat || r.photoId === SOCK_PHOTO_ID) take(r);
  for (const r of byOrder) if (!r.noCat && isAthensNight(r.takenAt)) take(r);
  for (const r of byOrder.filter((r) => r.photoCount > 1 && !r.noCat).slice(0, MULTI_PHOTO_SPOTS)) take(r);
  const catCount = () => [...chosen.values()].filter((r) => !r.noCat && r.photoId !== SOCK_PHOTO_ID).length;
  for (const r of byOrder) {
    if (catCount() >= TARGET_CATS) break;
    if (!r.noCat) take(r);
  }
  return [...chosen.values()]
    .sort((a, b) => a.photoId - b.photoId)
    .map((r) => ({ photoId: r.photoId, half: hash(`${seed}:half:${r.photoId}`) % 2 === 0 ? "tune" : "held" }));
}

// ---- scoring ----

const RANK_FOR_NOT_CAT: Record<CatCheck, number> = { cat: 2, unsure: 1, not_cat: 0 };
const RANK_FOR_CAT: Record<CatCheck, number> = { not_cat: 2, unsure: 1, cat: 0 };

/** The worst of the runs for what the photo really is: a non-cat's worst is "cat", a cat's worst is "not_cat". */
export function worstOf(answers: readonly CatCheck[], truth: Truth): CatCheck {
  const rank = truth === "not_cat" ? RANK_FOR_NOT_CAT : RANK_FOR_CAT;
  return answers.reduce((w, a) => (rank[a] > rank[w] ? a : w), answers[0]!);
}

export interface HeldResult {
  id: number | string;
  truth: Truth;
  night: boolean;
  worst: CatCheck;
}

/** Decision D4's bar, on the held half, worst of 3 runs. */
export function scoreHeld(results: readonly HeldResult[]): { passed: boolean; lines: string[] } {
  const nonCats = results.filter((r) => r.truth === "not_cat");
  const cats = results.filter((r) => r.truth === "cat");
  const nightCats = cats.filter((r) => r.night);
  const nonCatsCalledCat = nonCats.filter((r) => r.worst === "cat");
  const catsCalledNotCat = cats.filter((r) => r.worst === "not_cat");
  const nightUnsure = nightCats.filter((r) => r.worst === "unsure");
  const ok1 = nonCatsCalledCat.length === 0;
  const ok2 = catsCalledNotCat.length === 0;
  const ok3 = nightUnsure.length * 5 <= nightCats.length;
  return {
    passed: ok1 && ok2 && ok3,
    lines: [
      `Non-cats called "cat": ${nonCatsCalledCat.length} of ${nonCats.length}${nonCatsCalledCat.length ? ` (${nonCatsCalledCat.map((r) => r.id).join(", ")})` : ""}. Bar: none. ${ok1 ? "pass" : "FAIL"}`,
      `Cats called "not a cat": ${catsCalledNotCat.length} of ${cats.length}${catsCalledNotCat.length ? ` (${catsCalledNotCat.map((r) => r.id).join(", ")})` : ""}. Bar: none. ${ok2 ? "pass" : "FAIL"}`,
      `Night cats called "not sure": ${nightUnsure.length} of ${nightCats.length}. Bar: at most 1 in 5. ${ok3 ? "pass" : "FAIL"}`,
    ],
  };
}

/** The old check's answer, read from the stored record (the old prompt is not re-run). */
export function oldAnswerOf(rec: { noCatInAnyPhoto: boolean | null; matcherFailed: boolean } | null): OldAnswer {
  if (!rec) return "none";
  if (rec.matcherFailed) return "failed";
  return rec.noCatInAnyPhoto === true ? "not_cat" : "cat";
}

/** One printed line: number (or file name), the answers, the worst. Nothing else. */
export function formatPhotoLine(p: { label: string; old: OldAnswer; answers: readonly CatCheck[]; worst: CatCheck | null }): string {
  return `${p.label.padEnd(14)} old=${p.old.padEnd(8)} new=[${p.answers.join(", ")}] worst=${p.worst ?? "-"}`;
}

// ---- the 3 darkest nearby known cats ----

/** Mean brightness 0 (black) to 255, of a base64 picture. */
export async function meanLuminance(base64: string): Promise<number> {
  const stats = await sharp(Buffer.from(base64, "base64")).greyscale().stats();
  return stats.channels[0]!.mean;
}

export function darkestCandidates<T extends { lum: number; catId: number }>(cands: readonly T[], n: number): T[] {
  return [...cands].sort((a, b) => a.lum - b.lum || a.catId - b.catId).slice(0, n);
}

// ---- the script ----

interface Label {
  photoId: number;
  label: "cat" | "not_cat" | "skip";
  half: Half;
}

const here = dirname(fileURLToPath(import.meta.url));
const MIME_BY_EXT: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

interface Item {
  label: string;
  photoId: number | null;
  half: Half;
  night: boolean;
  photos: NewPhotoInput[];
  candidates: { catId: number; name: string; photoBase64: string; mime: string }[];
  old: OldAnswer;
  /** Variant "with candidates" is skipped when there are no known cats nearby. */
  noCandidatesNote: boolean;
}

export async function main(say: (l: string) => void, args: string[]): Promise<number> {
  const halfIdx = args.indexOf("--half");
  const half = args[halfIdx + 1];
  if (halfIdx === -1 || (half !== "tune" && half !== "held")) {
    say("Usage: --half tune|held [--prompt-file <path>]");
    return 2;
  }
  const promptIdx = args.indexOf("--prompt-file");
  const promptOverride = promptIdx === -1 ? null : readFileSync(args[promptIdx + 1]!, "utf8");
  const labels: Label[] = JSON.parse(readFileSync(join(here, "photoCheckEval", "labels.json"), "utf8"));
  if (half === "held" && labels.length === 0) {
    say("Refusing to run the held half: labels.json has no labels yet. Tune first, label the photos, then run held once.");
    return 2;
  }
  const truthOf = new Map(labels.map((l) => [l.photoId, l.label]));

  const { pool } = await import("@workspace/db");
  try {
    const { makeReadOnly } = await import("./smokeCheck");
    await makeReadOnly();
    const items = await loadItems(half);
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const { VISION_MODEL } = await import("../lib/visionModel");
    const { MATCH_TIMEOUT_MS } = await import("../lib/matching");

    const ask = async (it: Item, withCandidates: boolean): Promise<{ check: CatCheck; photoSeen: string | null; raw: string }> => {
      const cands = withCandidates ? it.candidates : [];
      const text = promptOverride ?? buildCheckPrompt({ photos: it.photos, candidates: cands.map((c) => ({ catId: c.catId, name: c.name })) });
      const content: any[] = [
        { type: "text", text },
        ...it.photos.map((p) => ({ type: "image_url", image_url: { url: `data:${p.mime};base64,${p.photoBase64}` } })),
        ...cands.map((c) => ({ type: "image_url", image_url: { url: `data:${c.mime};base64,${c.photoBase64}` } })),
      ];
      try {
        const response = await openai.chat.completions.create(
          { model: VISION_MODEL, max_completion_tokens: 8192, messages: [{ role: "user", content }] },
          { timeout: MATCH_TIMEOUT_MS, maxRetries: 0 },
        );
        const raw = response.choices[0]?.message?.content ?? "";
        const read = readCheckAnswer(raw, it.photos.length > 1);
        return { check: read.catCheck, photoSeen: read.photoSeen, raw };
      } catch (err) {
        // A failed run counts as "unsure": it is neither a cat nor a not-a-cat call.
        return { check: "unsure", photoSeen: null, raw: `ERROR ${JSON.stringify(safeError(err))}` };
      }
    };

    const out: unknown[] = [];
    const scored: Record<"plain" | "withCandidates", HeldResult[]> = { plain: [], withCandidates: [] };
    for (const it of items) {
      const truth = it.photoId === null ? "not_cat" : truthOf.get(it.photoId);
      if (truth === "skip") continue;
      const plainRuns = await Promise.all(Array.from({ length: RUNS }, () => ask(it, false)));
      const candRuns = it.candidates.length > 0 ? await Promise.all(Array.from({ length: RUNS }, () => ask(it, true))) : [];
      const variants = [
        { name: "plain" as const, runs: plainRuns },
        { name: "withCandidates" as const, runs: candRuns },
      ];
      for (const v of variants) {
        if (v.runs.length === 0) {
          say(`${it.label.padEnd(14)} ${v.name}: skipped, no known cats nearby`);
          continue;
        }
        const answers = v.runs.map((r) => r.check);
        const worst = truth ? worstOf(answers, truth) : null;
        say(`${v.name.padEnd(15)} ${formatPhotoLine({ label: it.label, old: it.old, answers, worst })}`);
        if (truth && worst) scored[v.name].push({ id: it.label, truth, night: it.night, worst });
      }
      out.push({ label: it.label, old: it.old, plain: plainRuns, withCandidates: candRuns });
    }
    writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

    if (labels.length === 0) {
      say(`Unscored: no labels yet. Photo numbers picked for the ${half} half, to label: ${items.filter((i) => i.photoId !== null).map((i) => i.photoId).join(", ")}`);
    } else if (half === "held") {
      for (const name of ["plain", "withCandidates"] as const) {
        const s = scoreHeld(scored[name]);
        say(`Held half, ${name}: ${s.passed ? "PASS" : "FAIL"}`);
        s.lines.forEach(say);
      }
    }
  } finally {
    await pool.end();
  }
  return 0;
}

async function loadItems(half: Half): Promise<Item[]> {
  const { db } = await import("@workspace/db");
  const { sightingsTable, sightingPhotosTable, sightingMatchesTable, photosTable, catsTable } = await import("@workspace/db/schema");
  const { and, asc, eq, inArray, isNull } = await import("drizzle-orm");
  const { getTableColumns } = await import("drizzle-orm");
  const { liveCats } = await import("../lib/catIdentity");
  const { selectCandidateCats } = await import("../lib/candidateSelection");
  const { catMatchingPhotoIds } = await import("../lib/photoVisibility");

  const spots = await db
    .select({ id: sightingsTable.id, photoId: sightingsTable.photoId, lat: sightingsTable.lat, lng: sightingsTable.lng, createdAt: sightingsTable.createdAt })
    .from(sightingsTable)
    .where(and(eq(sightingsTable.status, "resolved"), isNull(sightingsTable.redactedAt)));
  const spotIds = spots.map((s) => s.id);
  const recs = spotIds.length ? await db.select().from(sightingMatchesTable).where(inArray(sightingMatchesTable.sightingId, spotIds)) : [];
  const recOf = new Map(recs.map((r) => [r.sightingId, r]));
  const extras = spotIds.length
    ? await db.select().from(sightingPhotosTable).where(inArray(sightingPhotosTable.sightingId, spotIds)).orderBy(asc(sightingPhotosTable.position))
    : [];
  const photosOf = new Map<number, { photoId: number; role: NewPhotoInput["role"] }[]>();
  for (const e of extras) photosOf.set(e.sightingId, [...(photosOf.get(e.sightingId) ?? []), { photoId: e.photoId, role: e.role as NewPhotoInput["role"] }]);

  const rows: (SpotRow & { spot: (typeof spots)[number] })[] = spots.map((s) => ({
    photoId: s.photoId,
    takenAt: s.createdAt,
    noCat: recOf.get(s.id)?.noCatInAnyPhoto === true,
    photoCount: Math.max(1, photosOf.get(s.id)?.length ?? 1),
    spot: s,
  }));
  const picked = pickTestSet(rows, EVAL_SEED).filter((p) => p.half === half);
  const rowOf = new Map(rows.map((r) => [r.photoId, r]));

  const cats = await liveCats(getTableColumns(catsTable));
  const load = async (photoId: number) => {
    const [p] = await db.select().from(photosTable).where(eq(photosTable.id, photoId));
    return p && p.data !== null ? { photoBase64: p.data, mime: p.mime } : null;
  };

  const items: Item[] = [];
  for (const p of picked) {
    const r = rowOf.get(p.photoId)!;
    const list = photosOf.get(r.spot.id) ?? [{ photoId: r.photoId, role: "first" as const }];
    const photos: NewPhotoInput[] = [];
    for (const l of list) {
      const b = await load(l.photoId);
      if (b) photos.push({ role: l.role, ...b });
    }
    if (photos.length === 0) continue;
    // The cats the live check would have compared for this spot, then the darkest few.
    const nearest = selectCandidateCats(cats, r.spot.lat, r.spot.lng);
    const photoIds = await catMatchingPhotoIds(nearest);
    const withLum: { catId: number; name: string; photoBase64: string; mime: string; lum: number }[] = [];
    for (const cat of nearest) {
      const pid = photoIds.get(cat.id) ?? null;
      const b = pid === null ? null : await load(pid);
      if (b) withLum.push({ catId: cat.id, name: cat.name, ...b, lum: await meanLuminance(b.photoBase64) });
    }
    items.push({
      label: String(p.photoId),
      photoId: p.photoId,
      half: p.half,
      night: isAthensNight(r.takenAt),
      photos,
      candidates: darkestCandidates(withLum, DARKEST_N),
      old: oldAnswerOf(recOf.get(r.spot.id) ?? null),
      noCandidatesNote: withLum.length === 0,
    });
  }

  // Samuel's own non-cat photos: always the held half, no photo id, keyed by file name.
  const extraDir = join(here, "photoCheckEval", "extra");
  if (half === "held" && existsSync(extraDir)) {
    for (const f of readdirSync(extraDir).sort()) {
      const mime = MIME_BY_EXT[extname(f).toLowerCase()];
      if (!mime) continue;
      items.push({
        label: f,
        photoId: null,
        half: "held",
        night: false,
        photos: [{ role: "first", photoBase64: readFileSync(join(extraDir, f)).toString("base64"), mime }],
        candidates: [],
        old: "none",
        noCandidatesNote: true,
      });
    }
  }
  return items;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main((l) => console.log(l), process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`photo-check-eval failed: ${JSON.stringify(safeError(err))}`);
      process.exitCode = 1;
    },
  );
}
