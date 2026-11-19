import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { buildCheckPrompt, readCheckAnswer, type CatCheck } from "../lib/photoCheck";
import { callVision, type NewPhotoInput } from "../lib/matching";
import { safeError } from "../lib/logger";
import { validatePhotoBase64 } from "../lib/imageValidation";

// SYC-866 (spec docs/specs/photo-check-not-sure.md §7): proves the new photo
// check prompt on real photos before it goes live. READ-ONLY (the database
// session is made read-only, the way calibrateDuplicateSweep does) and it
// changes nothing in the app. It needs the AI keys, so it is run in Replit.
//
//   pnpm --filter @workspace/db exec tsx ../../artifacts/api-server/src/scripts/photoCheckEval.ts --half tune|held [--prompt-module <path.ts>]
//
// Printed: a photo number (or an extra file's name), the old answer, the new
// answers for each of two variants, and the worst. Never a photo, name,
// position or photoSeen: those go to ./photo-check-eval-out.json only.
//
// labels.json (scripts/photoCheckEval/labels.json): [{ photoId, label }] with
// label "cat" | "not_cat" | "skip". The tune/held split comes only from
// pickTestSet (seeded), never from the labels. Photos in extra/ are not-a-cat,
// held, and need no label. --prompt-module (tune only) swaps in a file that
// exports buildCheckPrompt with the committed signature; held always uses the
// committed one. Night is judged from sightings.created_at, which the app
// already sets to the phone's capture time (clamped) for offline uploads; the
// schema has no separate capture-time column.

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

/** The two ways each photo is asked: plain, and with the darkest known cats beside it. */
const VARIANTS = [["plain", false], ["withCandidates", true]] as const;
type VariantName = (typeof VARIANTS)[number][0];

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
  // Split by stratum so each half gets some of each kind: non-cats (the sock
  // and the not-a-cat photos), night cats, day cats. Within a stratum, seeded
  // order, alternating. The sock is always held; the other non-cats start on
  // held so a second non-cat is never left only in tune.
  const picked = [...chosen.values()];
  const stratumOf = (r: SpotRow) => (r.noCat || r.photoId === SOCK_PHOTO_ID ? 0 : isAthensNight(r.takenAt) ? 1 : 2);
  const halves = new Map<number, Half>();
  for (const stratum of [0, 1, 2]) {
    const members = picked
      .filter((r) => stratumOf(r) === stratum)
      .sort((a, b) => (a.photoId === SOCK_PHOTO_ID ? -1 : b.photoId === SOCK_PHOTO_ID ? 1 : order(a) - order(b) || a.photoId - b.photoId));
    // Stratum 0: the sock (if present) is held, the rest alternate from held. Others alternate from tune.
    const rest = members.filter((r) => r.photoId !== SOCK_PHOTO_ID);
    if (members.length > rest.length) halves.set(SOCK_PHOTO_ID, "held");
    rest.forEach((r, i) => halves.set(r.photoId, (i % 2 === 0) === (stratum === 0) ? "held" : "tune"));
  }
  return picked.sort((a, b) => a.photoId - b.photoId).map((r) => ({ photoId: r.photoId, half: halves.get(r.photoId)! }));
}

// ---- scoring ----

/** What one call gave: an answer, or "failed" (an error or a timeout, never read as "unsure"). */
export type RunCheck = CatCheck | "failed";

const RANK_FOR_NOT_CAT: Record<RunCheck, number> = { failed: 3, cat: 2, unsure: 1, not_cat: 0 };
const RANK_FOR_CAT: Record<RunCheck, number> = { failed: 3, not_cat: 2, unsure: 1, cat: 0 };

/** The worst of the runs for what the photo really is: a non-cat's worst is "cat", a cat's worst is "not_cat"; a failed call is worse than either. */
export function worstOf(answers: readonly RunCheck[], truth: Truth): RunCheck {
  const rank = truth === "not_cat" ? RANK_FOR_NOT_CAT : RANK_FOR_CAT;
  return answers.reduce((w, a) => (rank[a] > rank[w] ? a : w), answers[0]!);
}

export interface HeldResult {
  id: number | string;
  truth: Truth;
  night: boolean;
  worst: RunCheck;
  /** How many of its calls failed (defaults to 1 if worst is "failed"). */
  failedCalls?: number;
}

/** Fewer night cats than this prove nothing about the 1-in-5 bar. */
export const MIN_NIGHT_CATS = 5;

/** Held-half photo numbers that have no label (a "skip" counts as labelled). Extra files (no photo number) are not-a-cat by definition. */
export function missingLabels(items: readonly { photoId: number | null }[], truthOf: ReadonlyMap<number, string>): number[] {
  return items.filter((i): i is { photoId: number } => i.photoId !== null && !truthOf.has(i.photoId)).map((i) => i.photoId);
}

/**
 * Decision D4's bar, on the held half, worst of 3 runs. FAIL if any bar is
 * missed or any call failed. INCOMPLETE (never PASS) when the run can't prove
 * the bar: photo 62 not scored, no non-cats, or fewer than 5 night cats.
 */
export function scoreHeld(results: readonly HeldResult[]): { status: "PASS" | "FAIL" | "INCOMPLETE"; passed: boolean; lines: string[] } {
  const nonCats = results.filter((r) => r.truth === "not_cat");
  const cats = results.filter((r) => r.truth === "cat");
  const nightCats = cats.filter((r) => r.night);
  const nonCatsCalledCat = nonCats.filter((r) => r.worst === "cat");
  const catsCalledNotCat = cats.filter((r) => r.worst === "not_cat");
  const nightUnsure = nightCats.filter((r) => r.worst === "unsure");
  const failedCalls = results.reduce((n, r) => n + (r.failedCalls ?? (r.worst === "failed" ? 1 : 0)), 0);
  const ok1 = nonCatsCalledCat.length === 0;
  const ok2 = catsCalledNotCat.length === 0;
  const ok3 = nightUnsure.length * 5 <= nightCats.length;
  const ok4 = failedCalls === 0;
  const incomplete: string[] = [];
  if (!results.some((r) => String(r.id) === String(SOCK_PHOTO_ID))) incomplete.push(`photo ${SOCK_PHOTO_ID} was not scored`);
  if (nonCats.length === 0) incomplete.push("no non-cats were scored");
  if (nightCats.length < MIN_NIGHT_CATS) incomplete.push(`only ${nightCats.length} night cats were scored (need ${MIN_NIGHT_CATS})`);
  const status = !(ok1 && ok2 && ok3 && ok4) ? "FAIL" : incomplete.length ? "INCOMPLETE" : "PASS";
  const lines = [
    `Non-cats called "cat": ${nonCatsCalledCat.length} of n=${nonCats.length}${nonCatsCalledCat.length ? ` (${nonCatsCalledCat.map((r) => r.id).join(", ")})` : ""}. Bar: none. ${ok1 ? "pass" : "FAIL"}`,
    `Cats called "not a cat": ${catsCalledNotCat.length} of n=${cats.length}${catsCalledNotCat.length ? ` (${catsCalledNotCat.map((r) => r.id).join(", ")})` : ""}. Bar: none. ${ok2 ? "pass" : "FAIL"}`,
    `Night cats called "not sure": ${nightUnsure.length} of n=${nightCats.length}. Bar: at most 1 in 5. ${ok3 ? "pass" : "FAIL"}`,
  ];
  if (!ok4) lines.push(`FAIL: ${failedCalls} calls failed (an error or a timeout); run again.`);
  for (const why of incomplete) lines.push(`INCOMPLETE: ${why}.`);
  return { status, passed: status === "PASS", lines };
}

/** The old check's answer, read from the stored record (the old prompt is not re-run). */
export function oldAnswerOf(rec: { noCatInAnyPhoto: boolean | null; matcherFailed: boolean } | null): OldAnswer {
  if (!rec) return "none";
  if (rec.matcherFailed) return "failed";
  return rec.noCatInAnyPhoto === true ? "not_cat" : "cat";
}

/** One printed line: number (or file name), the answers, the worst. Nothing else. */
export function formatPhotoLine(p: { label: string; old: OldAnswer; answers: readonly RunCheck[]; worst: RunCheck | null }): string {
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

export function darkestOrIsland<T extends { lum: number; catId: number }>(nearby: readonly T[], island: readonly T[], n: number): T[] {
  return darkestCandidates(nearby.length > 0 ? nearby : island, n);
}

/** The with-candidates variant never skips: nearby cats if any, else the darkest live cats island-wide. */
export const candidatesFor = darkestOrIsland;

/** 8 hex characters of the prompt text, so runs with different prompts can be told apart. */
export function promptHash(text: string): string {
  return hash(text).toString(16).padStart(8, "0");
}

export type ParsedArgs = { ok: true; half: Half; promptModule: string | null } | { ok: false; error: string };

export function parseArgs(args: readonly string[]): ParsedArgs {
  const usage = "Usage: --half tune|held [--prompt-module <path.ts>]";
  const known = new Set(["--half", "--prompt-module"]);
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith("--") && !known.has(args[i]!)) return { ok: false, error: `Unknown option ${args[i]}. ${usage}` };
  }
  const val = (flag: string) => {
    const i = args.indexOf(flag);
    return i === -1 ? null : (args[i + 1] ?? "");
  };
  const half = val("--half");
  if (half !== "tune" && half !== "held") return { ok: false, error: usage };
  const promptModule = val("--prompt-module");
  if (promptModule === "") return { ok: false, error: usage };
  if (promptModule !== null && half === "held") {
    return { ok: false, error: "--prompt-module can't be used with --half held: the held run always uses the committed prompt." };
  }
  return { ok: true, half, promptModule };
}

/** A photo's bytes only if it is still there: a photo removed for good (removed_at set, or no data) is left out. The query filters the same way; this is the tested rule. */
export function keptPhoto(p: { data: string | null; mime: string; removedAt: Date | null } | undefined): { photoBase64: string; mime: string } | null {
  return p && p.removedAt === null && p.data !== null ? { photoBase64: p.data, mime: p.mime } : null;
}

/**
 * Production never sends a raw upload: every photo goes through
 * validatePhotoBase64 first (upright, longest edge at most 2048, JPEG) and
 * the stored copy is what the AI is sent. An extra file gets the same step,
 * in memory, so the eval sends the AI what production would. Nothing is stored.
 */
export async function normaliseExtra(file: Buffer): Promise<{ photoBase64: string; mime: string }> {
  const v = await validatePhotoBase64(file.toString("base64"));
  if ("error" in v) throw new Error(v.error);
  return { photoBase64: v.buffer.toString("base64"), mime: v.mime };
}

// ---- the script ----

interface Label {
  photoId: number;
  label: "cat" | "not_cat" | "skip";
}

const here = dirname(fileURLToPath(import.meta.url));
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);

interface Item {
  label: string;
  photoId: number | null;
  half: Half;
  night: boolean;
  photos: NewPhotoInput[];
  candidates: { catId: number; name: string; photoBase64: string; mime: string }[];
  old: OldAnswer;
}

export async function main(say: (l: string) => void, args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    say(parsed.error);
    return 2;
  }
  const { half, promptModule } = parsed;
  let buildPrompt = buildCheckPrompt;
  if (promptModule !== null) {
    const mod = await import(pathToFileURL(resolve(promptModule)).href);
    if (typeof mod.buildCheckPrompt !== "function") {
      say(`${promptModule} does not export buildCheckPrompt.`);
      return 2;
    }
    buildPrompt = mod.buildCheckPrompt;
  }
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
    say("Night is judged by the spot's stored time (sightings.created_at: the phone's capture time for offline uploads, else upload time); there is no separate capture-time column.");
    const items = await loadItems(half);
    if (half === "held") {
      const missing = missingLabels(items, truthOf);
      if (missing.length > 0) {
        say(`Refusing to score the held half: no label in labels.json for photo numbers ${missing.join(", ")}.`);
        return 1;
      }
    }
    if (items[0]) {
      say(`prompt hash: ${promptHash(buildPrompt({ photos: items[0].photos, candidates: [] }))}${promptModule ? ` (from ${promptModule})` : " (committed)"}`);
    }

    const ask = async (it: Item, withCandidates: boolean): Promise<{ check: RunCheck; photoSeen: string | null; raw: string }> => {
      const cands = withCandidates ? it.candidates : [];
      const text = buildPrompt({ photos: it.photos, candidates: cands.map((c) => ({ catId: c.catId, name: c.name })) });
      try {
        const response = await callVision(text, [
          ...it.photos.map((p) => ({ mime: p.mime, base64: p.photoBase64 })),
          ...cands.map((c) => ({ mime: c.mime, base64: c.photoBase64 })),
        ]);
        const raw = response.choices[0]?.message?.content ?? "";
        const read = readCheckAnswer(raw, it.photos.length > 1);
        return { check: read.catCheck, photoSeen: read.photoSeen, raw };
      } catch (err) {
        // A failed or timed-out call is "failed", never "unsure": it must not look like an answer.
        return { check: "failed", photoSeen: null, raw: `ERROR ${JSON.stringify(safeError(err))}` };
      }
    };

    const out: unknown[] = [];
    let failedTotal = 0;
    const scored: Record<VariantName, HeldResult[]> = { plain: [], withCandidates: [] };
    for (const it of items) {
      const truth = it.photoId === null ? "not_cat" : truthOf.get(it.photoId);
      if (truth === "skip") continue;
      // All six calls for this item at once (never across items).
      const calls = await Promise.all(VARIANTS.flatMap(([, withCandidates]) => Array.from({ length: RUNS }, () => ask(it, withCandidates))));
      const runsOf = {} as Record<VariantName, Awaited<ReturnType<typeof ask>>[]>;
      VARIANTS.forEach(([name], i) => {
        const runs = (runsOf[name] = calls.slice(i * RUNS, (i + 1) * RUNS));
        const answers = runs.map((r) => r.check);
        const worst = truth ? worstOf(answers, truth) : null;
        say(`${name.padEnd(15)} ${formatPhotoLine({ label: it.label, old: it.old, answers, worst })}`);
        if (truth && worst) scored[name].push({ id: it.label, truth, night: it.night, worst, failedCalls: answers.filter((a) => a === "failed").length });
      });
      failedTotal += calls.filter((r) => r.check === "failed").length;
      out.push({ label: it.label, old: it.old, ...runsOf });
      // Written after every item, so a crash keeps what already ran.
      writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
    }
    say(`Failed calls: ${failedTotal}`);

    if (labels.length === 0) {
      say(`Unscored: no labels yet. Photo numbers picked for the ${half} half, to label: ${items.filter((i) => i.photoId !== null).map((i) => i.photoId).join(", ")}`);
    } else if (half === "held") {
      let allPass = true;
      for (const [name] of VARIANTS) {
        const s = scoreHeld(scored[name]);
        say(`Held half, ${name}: ${s.status}`);
        s.lines.forEach(say);
        if (!s.passed) allPass = false;
      }
      if (!allPass) return 1;
    }
  } finally {
    await pool.end();
  }
  return 0;
}

async function loadItems(half: Half): Promise<Item[]> {
  const { db } = await import("@workspace/db");
  const { sightingsTable, sightingPhotosTable, sightingMatchesTable, photosTable, catsTable } = await import("@workspace/db/schema");
  const { and, asc, eq, inArray, isNull, isNotNull } = await import("drizzle-orm");
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
    // Only the columns needed, and only a photo that is still there (SYC-462: removed_at null, data not null).
    const [p] = await db
      .select({ data: photosTable.data, mime: photosTable.mime, removedAt: photosTable.removedAt })
      .from(photosTable)
      .where(and(eq(photosTable.id, photoId), isNull(photosTable.removedAt), isNotNull(photosTable.data)));
    return keptPhoto(p);
  };

  // Each cat's main photo is read and measured once, however many spots (or the island-wide fallback) use it.
  type CatPhoto = { photoBase64: string; mime: string; lum: number };
  const catPhotoOf = new Map<number, CatPhoto | null>();
  const withLuminance = async (list: readonly { id: number; name: string; primaryPhotoId: number }[]) => {
    const todo = list.filter((c) => !catPhotoOf.has(c.id));
    const photoIds = todo.length ? await catMatchingPhotoIds(todo) : null;
    for (const cat of todo) {
      const pid = photoIds?.get(cat.id) ?? null;
      const b = pid === null ? null : await load(pid);
      catPhotoOf.set(cat.id, b ? { ...b, lum: await meanLuminance(b.photoBase64) } : null);
    }
    return list.flatMap((cat) => {
      const p = catPhotoOf.get(cat.id);
      return p ? [{ catId: cat.id, name: cat.name, ...p }] : [];
    });
  };
  // Every live cat's brightness, worked out only if some spot or extra file has no cat nearby.
  let islandCache: Awaited<ReturnType<typeof withLuminance>> | null = null;
  const island = async () => (islandCache ??= await withLuminance(cats));

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
    const withLum = await withLuminance(nearest);
    items.push({
      label: String(p.photoId),
      photoId: p.photoId,
      half: p.half,
      night: isAthensNight(r.takenAt),
      photos,
      candidates: candidatesFor(withLum, withLum.length > 0 ? [] : await island(), DARKEST_N),
      old: oldAnswerOf(recOf.get(r.spot.id) ?? null),
    });
  }

  // Samuel's own non-cat photos: always the held half, no photo id, keyed by file name.
  const extraDir = join(here, "photoCheckEval", "extra");
  if (half === "held" && existsSync(extraDir)) {
    for (const f of readdirSync(extraDir).sort()) {
      if (!IMAGE_EXTS.has(extname(f).toLowerCase())) continue;
      const photo = await normaliseExtra(readFileSync(join(extraDir, f))).catch((err: unknown) => {
        throw new Error(`extra/${f}: ${err instanceof Error ? err.message : "could not be read"}`);
      });
      items.push({
        label: f,
        photoId: null,
        half: "held",
        night: false,
        photos: [{ role: "first", ...photo }],
        candidates: candidatesFor([], await island(), DARKEST_N),
        old: "none",
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
