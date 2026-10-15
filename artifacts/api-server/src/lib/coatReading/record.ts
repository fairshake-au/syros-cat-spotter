import { eq, sql } from "drizzle-orm";
import { db, observationsTable, type Observation } from "@workspace/db";
import type { CoatColour } from "../appearance";
import { writeObservation } from "../observations";
import { catsDueForReading } from "./due";
import { MODEL_VERSION, type RawCoatAnswer } from "./reader";

/**
 * Writing a colour reading (SYC-161 plan, rules R3, R4 and R8).
 *
 * **The only place in `src/` that writes as `system:vision` with
 * `provenance: "machine"`** (a source guard in
 * `appearance.notNotifiable.test.ts` holds it to that).
 *
 * R3. Each reading is a NEW `coat` row, never an edit and never a
 *     supersession: no `supersedesId`. `observedAt` is the moment of the
 *     reading, never the photo's date, so "the machine's newest reading" is
 *     the last one read. Colour is not evidence of life, so the date says
 *     nothing about whether the cat is alive.
 * R4. A copy forward makes no model call: a new row with the earlier
 *     reading's colours, `modelVersion` and photo, dated now.
 * R8. Inside one transaction: an advisory lock on the cat, then a fresh check
 *     that the cat is still due for the same photo and the same action, then
 *     the insert. Two servers reading one cat at once can waste a call but
 *     never write two rows.
 */

export const VISION_AUTHOR = "system:vision";
export const READER_SOURCE = "coat-reader";
export const COPY_SOURCE = "coat-reader:copy";

/** The advisory-lock namespace for colour readings (with the cat id). */
const LOCK_NAMESPACE = 161;

/** Tests only: runs between the re-check and the insert (T-race). */
export const _recordHooks: { afterRecheck: null | (() => Promise<void>) } = { afterRecheck: null };

export type RecordOutcome =
  | { kind: "written"; row: Observation }
  /** Someone else got there first, or the cat stopped being due. Nothing written. */
  | { kind: "not_due" };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockAndRecheck(
  tx: Tx,
  catId: number,
  photoId: number,
  action: "read" | "copy",
  copyOf?: number,
): Promise<boolean> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${catId})`);
  const [entry] = await catsDueForReading(1, tx, { catIds: [catId] });
  const still =
    entry !== undefined &&
    entry.photoId === photoId &&
    entry.action === action &&
    (action === "read" || entry.copyOf === copyOf);
  if (still && _recordHooks.afterRecheck) await _recordHooks.afterRecheck();
  return still;
}

/** Record one model reading of `photoId` for `catId` (R3). */
export async function recordReading(input: {
  catId: number;
  photoId: number;
  colours: CoatColour[];
  raw: RawCoatAnswer;
  now?: Date;
}): Promise<RecordOutcome> {
  return db.transaction(async (tx) => {
    if (!(await lockAndRecheck(tx, input.catId, input.photoId, "read"))) return { kind: "not_due" } as const;
    const row = await writeObservation(
      tx,
      {
        catId: input.catId,
        kind: "coat",
        value: { colours: input.colours, modelVersion: MODEL_VERSION },
        accountId: VISION_AUTHOR,
        roleAtTime: "system",
        provenance: "machine",
        photoId: input.photoId,
        observedAt: input.now ?? new Date(),
        suggestedValue: input.raw,
        suggestionSource: READER_SOURCE,
      },
      input.now ?? new Date(),
    );
    return { kind: "written", row } as const;
  });
}

/**
 * Copy an earlier reading of the same photo forward, with no model call (R4).
 * `due.ts` only offers a copy when the team never marked a reading of that
 * photo wrong; the re-check here holds that again inside the lock.
 */
export async function copyReadingForward(input: {
  catId: number;
  photoId: number;
  copyOf: number;
  now?: Date;
}): Promise<RecordOutcome> {
  return db.transaction(async (tx) => {
    if (!(await lockAndRecheck(tx, input.catId, input.photoId, "copy", input.copyOf))) {
      return { kind: "not_due" } as const;
    }
    const [source] = await tx.select().from(observationsTable).where(eq(observationsTable.id, input.copyOf));
    const value = source?.value as { colours?: CoatColour[]; modelVersion?: string } | undefined;
    if (!source || source.photoId !== input.photoId || !value?.colours || !value.modelVersion) {
      return { kind: "not_due" } as const;
    }
    const row = await writeObservation(
      tx,
      {
        catId: input.catId,
        kind: "coat",
        value: { colours: value.colours, modelVersion: value.modelVersion },
        accountId: VISION_AUTHOR,
        roleAtTime: "system",
        provenance: "machine",
        photoId: input.photoId,
        observedAt: input.now ?? new Date(),
        suggestedValue: { copiedFrom: source.id },
        suggestionSource: COPY_SOURCE,
      },
      input.now ?? new Date(),
    );
    return { kind: "written", row } as const;
  });
}
