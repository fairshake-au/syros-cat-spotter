import { eq } from "drizzle-orm";
import { db, observationsTable, photosTable } from "@workspace/db";
import { consume, declareLimit } from "../limits";
import { catsDueForReading, type DueCat } from "./due";
import { copyReadingForward, recordReading } from "./record";
import { CONFIDENCE_CUTOFF, MODEL_VERSION, readCoatFromPhoto, type RawCoatAnswer } from "./reader";

/**
 * The colour sweep (SYC-161 plan, PR 1): read every cat that is due, in one
 * of three modes.
 *
 * - `dry_run`: no model call, no write. Which cats are due, their photos,
 *   and whether each would be a call or a copy.
 * - `trial`: calls the model, writes nothing. Each cat's colours and the
 *   model's raw answer, with the cut-off in use, for the contact sheet.
 * - `write`: the real thing. `exclude` lists cats NOT to write (the readings
 *   Samuel rejects, Decision A1).
 *
 * Nothing starts it automatically in this PR; only the manual route does.
 *
 * Budgets (R6, R7), counted in the database so every server shares them:
 * - `coat-read-hour`: 60 model calls an hour, all reading together;
 * - `coat-read-new`: 20 new-cat readings an hour (used from PR 2);
 * - `coat-read-photo`: 3 attempts a day per (cat, photo), so a photo that
 *   always fails costs at most 3 calls a day.
 * Each attempt is counted BEFORE the call. A run that hits the hourly limit
 * stops at once and writes nothing for the cat it was on. A copy forward
 * makes no call and spends nothing.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const BUDGETS = {
  hour: { bucket: "coat-read-hour", limit: 60, windowMs: HOUR_MS },
  newCat: { bucket: "coat-read-new", limit: 20, windowMs: HOUR_MS },
  photo: { bucket: "coat-read-photo", limit: 3, windowMs: DAY_MS },
} as const;
for (const b of Object.values(BUDGETS)) declareLimit(b.bucket, b.limit, b.windowMs, { sliding: true });

/** A manual run reads at most this many cats. */
export const MAX_SWEEP_LIMIT = 50;

export type SweepMode = "dry_run" | "trial" | "write";

export type BudgetVerdict = "ok" | "photo_attempts_used" | "new_cat_limit" | "hour_limit";

const HOUR_KEY = "all";

/**
 * Count one model call against the budgets, before it is made. Per photo
 * first, so a photo that has used its attempts costs the hourly budget
 * nothing; then, for a new cat's reading (PR 2), the new-cat allowance; then
 * the hourly budget everything shares.
 */
export async function spendReadBudget(
  target: { catId: number; photoId: number; newCat?: boolean },
  now: number = Date.now(),
): Promise<BudgetVerdict> {
  const spend = (b: (typeof BUDGETS)[keyof typeof BUDGETS], key: string) =>
    consume(b.bucket, key, b.limit, b.windowMs, undefined, now, { sliding: true });
  if (!(await spend(BUDGETS.photo, `${target.catId}:${target.photoId}`)).allowed) return "photo_attempts_used";
  if (target.newCat && !(await spend(BUDGETS.newCat, HOUR_KEY)).allowed) return "new_cat_limit";
  if (!(await spend(BUDGETS.hour, HOUR_KEY)).allowed) return "hour_limit";
  return "ok";
}

export interface SweepItem {
  catId: number;
  photoId: number;
  action: DueCat["action"];
  because: DueCat["because"];
  copyOf?: number;
  excluded?: true;
  /** What happened to this cat in this run. */
  status:
    | "due"
    | "excluded"
    | "read"
    | "copied"
    | "written"
    | "not_due_any_more"
    | "failed"
    | "photo_gone"
    | "photo_attempts_used";
  colours?: string[];
  raw?: RawCoatAnswer;
  reason?: string;
}

export interface SweepResult {
  mode: SweepMode;
  modelVersion: string;
  cutoff: number;
  /** Cats due when the run started, `exclude`d ones included. */
  due: number;
  /** Model calls made (for `dry_run`: the calls a run would make). */
  calls: number;
  written: number;
  /** Set when a budget stopped the run early. */
  stopped: "hour_limit" | null;
  /** Cats still due after the run (`exclude`d ones included). */
  stillDue: number;
  items: SweepItem[];
}

export async function sweepCoatReadings(opts: {
  mode: SweepMode;
  limit: number;
  exclude?: readonly number[];
  now?: () => Date;
  /** Tests only: look at these cats and no others. */
  catIds?: readonly number[];
}): Promise<SweepResult> {
  const now = opts.now ?? (() => new Date());
  const exclude = new Set(opts.exclude ?? []);
  const allDue = await catsDueForReading(Number.POSITIVE_INFINITY, db, { catIds: opts.catIds });
  const result: SweepResult = {
    mode: opts.mode,
    modelVersion: MODEL_VERSION,
    cutoff: CONFIDENCE_CUTOFF,
    due: allDue.length,
    calls: 0,
    written: 0,
    stopped: null,
    stillDue: allDue.length,
    items: [],
  };

  let taken = 0;
  for (const d of allDue) {
    const item: SweepItem = { catId: d.catId, photoId: d.photoId, action: d.action, because: d.because, status: "due" };
    if (d.copyOf !== undefined) item.copyOf = d.copyOf;
    if (exclude.has(d.catId)) {
      result.items.push({ ...item, excluded: true, status: "excluded" });
      continue;
    }
    if (taken >= opts.limit) break;
    taken += 1;

    if (opts.mode === "dry_run") {
      if (d.action === "read") result.calls += 1;
      result.items.push(item);
      continue;
    }

    if (d.action === "copy") {
      const [source] = await db
        .select({ value: observationsTable.value })
        .from(observationsTable)
        .where(eq(observationsTable.id, d.copyOf!));
      item.colours = (source?.value as { colours?: string[] } | undefined)?.colours;
      if (opts.mode === "trial") {
        result.items.push({ ...item, status: "copied" });
        continue;
      }
      const out = await copyReadingForward({ catId: d.catId, photoId: d.photoId, copyOf: d.copyOf!, now: now() });
      if (out.kind === "written") result.written += 1;
      result.items.push({ ...item, status: out.kind === "written" ? "written" : "not_due_any_more" });
      continue;
    }

    // A model call. The bytes are read by the id `due.ts` chose, which is
    // only ever a public photo (R1).
    const [photo] = await db
      .select({ data: photosTable.data, mime: photosTable.mime })
      .from(photosTable)
      .where(eq(photosTable.id, d.photoId));
    if (!photo) {
      result.items.push({ ...item, status: "photo_gone" });
      continue;
    }
    const verdict = await spendReadBudget({ catId: d.catId, photoId: d.photoId }, now().getTime());
    if (verdict === "photo_attempts_used") {
      result.items.push({ ...item, status: "photo_attempts_used" });
      continue;
    }
    if (verdict !== "ok") {
      result.stopped = "hour_limit";
      break;
    }
    result.calls += 1;
    const reading = await readCoatFromPhoto(photo);
    if (reading.kind === "failed") {
      // R6: a failed call writes nothing; the cat stays not known.
      result.items.push({ ...item, status: "failed", reason: reading.reason });
      continue;
    }
    item.colours = reading.colours;
    item.raw = reading.raw;
    if (opts.mode === "trial") {
      result.items.push({ ...item, status: "read" });
      continue;
    }
    const out = await recordReading({
      catId: d.catId,
      photoId: d.photoId,
      colours: reading.colours,
      raw: reading.raw,
      now: now(),
    });
    if (out.kind === "written") result.written += 1;
    result.items.push({ ...item, status: out.kind === "written" ? "written" : "not_due_any_more" });
  }
  result.stillDue = allDue.length - result.written;
  return result;
}
