import { eq } from "drizzle-orm";
import { db, observationsTable, photosTable } from "@workspace/db";
import { readCoatValue, type CoatParts } from "../appearance";
import { consume, declareLimit } from "../limits";
import { loadCatRecords } from "../observations";
import { resolveCoatParts } from "../resolve";
import { catsDueForReading, isMachineReading, markedWrong, newest, type DueCat } from "./due";
import { copyReadingForward, recordReading } from "./record";
import { CONFIDENCE_CUTOFF, MODEL_VERSION, readCoatFromPhoto, type RawCoatAnswer } from "./reader";

/**
 * The colour sweep (SYC-161 plan, PR 1): read every cat that is due, in one
 * of three modes.
 *
 * - `dry_run`: no model call, no write. Which cats are due, their photos,
 *   and whether each would be a call or a copy.
 * - `trial`: calls the model, writes nothing. Each cat's coat and the
 *   model's raw answer, with the cut-off in use, for the contact sheet.
 * - `write`: the real thing. `exclude` lists cats NOT to write (the readings
 *   Samuel rejects, Decision A1).
 *
 * Nothing starts it automatically in this PR; only the manual route does.
 *
 * `reread` (SYC-398 §7, off by default) is the one checked re-read, started
 * by hand: cats whose photo was read by an older reader version are due
 * too. It reaches every "is this cat due?" check of the run, the re-check
 * before a photo is sent and the one inside `record.ts`'s lock included. A
 * re-read (any read in such a run of a cat that has a machine reading) is
 * **held back** (`held_back`, nothing written) when it is a whole
 * Not sure, or when it would leave not known a part that the cat's current
 * machine reading knows, so nothing showing is lost. Each read's `current`
 * coat is reported, for the contact sheet.
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
    | "photo_attempts_used"
    /** A re-read that would lose what's known: nothing written (§7). */
    | "held_back";
  /** The coat read, or copied, as its two parts (SYC-398 §6). */
  parts?: CoatParts;
  /**
   * For a model read: the cat's current machine coat, its newest machine
   * reading the team hasn't marked wrong, or null when there is none
   * (SYC-398 §7, for the contact sheet).
   */
  current?: CoatParts | null;
  raw?: RawCoatAnswer;
  reason?: string;
}

export interface SweepResult {
  mode: SweepMode;
  /** Whether this run re-reads older versions (SYC-398 §7). */
  reread: boolean;
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
  /** The one checked re-read (SYC-398 §7). Off unless a person asks. */
  reread?: boolean;
  now?: () => Date;
  /** Tests only: look at these cats and no others. */
  catIds?: readonly number[];
}): Promise<SweepResult> {
  const now = opts.now ?? (() => new Date());
  const exclude = new Set(opts.exclude ?? []);
  const reread = opts.reread ?? false;
  const allDue = await catsDueForReading(Number.POSITIVE_INFINITY, db, { catIds: opts.catIds, reread });
  const result: SweepResult = {
    mode: opts.mode,
    reread,
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
      item.parts = readCoatValue(source?.value) ?? undefined;
      if (opts.mode === "trial") {
        result.items.push({ ...item, status: "copied" });
        continue;
      }
      const out = await copyReadingForward({
        catId: d.catId,
        photoId: d.photoId,
        copyOf: d.copyOf!,
        reread,
        now: now(),
      });
      if (out.kind === "written") result.written += 1;
      result.items.push({ ...item, status: out.kind === "written" ? "written" : "not_due_any_more" });
      continue;
    }

    // A model call. The bytes are read by the id `due.ts` chose, which is
    // only ever a public photo (R1). The list above was made when the run
    // started, and a run can take minutes, so the cat is checked again right
    // before its photo leaves the server: a photo the team hid in the
    // meantime is never sent (Opus spot review, finding 1). With the run's
    // own `reread`, so a re-read's cat is still due here (SYC-398 §7).
    const [still] = await catsDueForReading(1, db, { catIds: [d.catId], reread });
    if (!still || still.photoId !== d.photoId || still.action !== "read") {
      result.items.push({ ...item, status: "not_due_any_more" });
      continue;
    }
    const { current, decided } = await currentCoat(d.catId);
    item.current = current;
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
    item.parts = reading.parts;
    item.raw = reading.raw;
    // §7: nothing showing is lost. Marked in a trial too, so the contact
    // sheet shows which cats a write would hold back. A cat never read
    // before isn't a re-read: its reading, Not sure included, is written as
    // in any run (R2: Not sure rows count as rows; Opus spot review,
    // finding 3).
    if (reread && d.because !== "unread" && losesWhatIsKnown(current, reading.parts, decided)) {
      result.items.push({ ...item, status: "held_back" });
      continue;
    }
    if (opts.mode === "trial") {
      result.items.push({ ...item, status: "read" });
      continue;
    }
    const out = await recordReading({
      catId: d.catId,
      photoId: d.photoId,
      parts: reading.parts,
      raw: reading.raw,
      reread,
      now: now(),
    });
    if (out.kind === "written") result.written += 1;
    result.items.push({ ...item, status: out.kind === "written" ? "written" : "not_due_any_more" });
  }
  result.stillDue = allDue.length - result.written;
  return result;
}

/**
 * The cat's current machine coat (SYC-398 §7): its newest machine reading
 * that the team hasn't marked wrong, through the one translation, or null.
 * Loaded through `loadCatRecords`, as `due.ts` does.
 */
async function currentCoat(catId: number): Promise<{ current: CoatParts | null; decided: DecidedParts }> {
  const records = await loadCatRecords([catId]);
  const observations = records.get(catId)?.observations ?? [];
  const wrong = markedWrong(observations);
  const row = newest(observations.filter((o) => isMachineReading(o) && !wrong.has(o.id)));
  const parts = resolveCoatParts(observations);
  return {
    current: row ? readCoatValue(row.value) : null,
    decided: { colours: parts.colours.rule === 1, pattern: parts.pattern.rule === 1 },
  };
}

/** Which parts the team or a cat guardian decides (rule 1). */
export interface DecidedParts {
  colours: boolean;
  pattern: boolean;
}

/**
 * The hold-back rule for a re-read (§7): a whole Not sure, or a reading that
 * leaves not known a part the current machine coat knows. A part the team or
 * a cat guardian decides is ignored: theirs is what shows, so a reading
 * can't lose it (Samuel, 17 Oct 2026, SYC-448 decision 1: "Keep the new
 * colours").
 */
export function losesWhatIsKnown(
  current: CoatParts | null,
  next: CoatParts,
  decided: DecidedParts = { colours: false, pattern: false },
): boolean {
  if (next.notSure) return true;
  if (!current || current.notSure) return false;
  return (
    (!decided.colours && current.colours !== null && next.colours === null) ||
    (!decided.pattern && current.pattern !== null && next.pattern === null)
  );
}
