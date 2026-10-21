import { db, photoVisibilityEventsTable, welfareReportsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { addressKey, consume, declareLimit, warmSalts } from "../limits";
import { logger, safeError } from "../logger";
import { enqueueIssueAlert } from "../mail/outbox";

/**
 * "Report an issue": the one-report photo hide (SYC-44 PR 5.1; spec §6,
 * §8.1 rules (i)–(iv); plan docs/superpowers/plans/syc-44-report-an-issue.md,
 * PR 5.1 step 8).
 *
 * Runs inside the report's own transaction, so the report row, the hide and
 * the queued alert commit together or not at all. Two reasons can hide:
 * `photo_private` and `photo_inappropriate`. For them the photo row is
 * locked (the same `for update` as `setPhotoVisibility`, so ids in
 * photo_visibility_events follow the real order) and the rules are applied
 * in this order; the FIRST that stops the hide is recorded in `hide_skipped`:
 *
 *   1. already hidden (by anyone)        → `already_hidden` (the reply says hidden)
 *   2. no `ok` Turnstile verdict          → `unchecked`        (rule (i))
 *   3. any `restore` of this photo, ever  → `restored_before`  (rule (ii))
 *   4. the island-wide daily brake        → `brake`            (rule (iv))
 *   5. this address's hide limits         → `address_limit`    (5 an hour, 15 a day)
 *
 * Otherwise a `hide` event is written with author `report:<id>` and no
 * person, the row is marked `hidden_by_report`, and the "Photo hidden"
 * alert is queued. Every failure of a limit counter here FAILS CLOSED: the
 * report is still saved, and the photo is not hidden.
 */

/** The two reasons that hide on one confirmed report (spec §2, D2). */
export const HIDING_REASONS: ReadonlySet<string> = new Set(["photo_private", "photo_inappropriate"]);

export type HideSkipped =
  | "already_hidden"
  | "restored_before"
  | "address_limit"
  | "brake"
  | "unchecked";

// ── The brake (rule (iv)) ──────────────────────────────────────────────────

/**
 * Report-hides allowed per calendar day, Athens time, island-wide (Samuel,
 * 12 Oct 2026). Once this many report-hides have happened since midnight
 * Athens time, hide-type reports are still saved but don't hide until the
 * next midnight. There is no "resume". A named value so a test can raise it
 * (T5-4 needs a day on which the brake hasn't tripped; plan review finding 5).
 */
export const REPORT_HIDES_PER_ATHENS_DAY = 5;
let brakeLimit = REPORT_HIDES_PER_ATHENS_DAY;

/** Test-only: raise (or restore, with no argument) the brake. */
export function _setBrakeForTests(limit: number = REPORT_HIDES_PER_ATHENS_DAY): void {
  brakeLimit = limit;
}

// One transaction-level advisory lock serialises the count-then-hide, so two
// reports racing for the last place can't both take it (T5-10). Distinct from
// the outbox's 170_001.
const BRAKE_LOCK = 44_051;
// How long a report waits for that lock before giving up. Every hide holds it
// for a few quick statements, so a wait this long means something is stuck;
// the report is then saved without a hide (fails closed, as `brake`) instead
// of holding its pool connection for ever (review finding 1).
const BRAKE_LOCK_TIMEOUT = "5s";

/**
 * How many photos reports have hidden since midnight Athens time, island-wide.
 * **The brake's one count**: the hide above and the team's banner (SYC-44 PR
 * 7.1) both read it, so the banner can't disagree with what a report meets.
 */
export async function reportHidesToday(q: Pick<typeof db, "execute"> = db): Promise<number> {
  const now = nowSql();
  const counted = await q.execute<{ n: number }>(sql`
    select count(*)::int as n from photo_visibility_events
     where action = 'hide'
       and author like 'report:%'
       and at >= date_trunc('day', ${now} at time zone 'Europe/Athens') at time zone 'Europe/Athens'
       and at < (date_trunc('day', ${now} at time zone 'Europe/Athens') + interval '1 day') at time zone 'Europe/Athens'
  `);
  return Number(counted.rows[0]?.n ?? 0);
}

/**
 * Whether the brake has tripped: today's report-hides have reached the limit,
 * so until midnight Athens time no report hides a photo. There is no resume.
 */
export async function brakeOn(q: Pick<typeof db, "execute"> = db): Promise<boolean> {
  return (await reportHidesToday(q)) >= brakeLimit;
}

// ── The address hide limits (spec §8.1) ────────────────────────────────────

export const ADDRESS_HIDES_PER_HOUR = 5;
export const ADDRESS_HIDES_PER_DAY = 15;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HIDE_HOUR_BUCKET = "issue_hide_hour";
const HIDE_DAY_BUCKET = "issue_hide_day";
// Both sliding, so an hour boundary hands out no fresh allowance (review
// finding 9: a fixed hour allowed 10 hides in 2 minutes across one).
declareLimit(HIDE_HOUR_BUCKET, ADDRESS_HIDES_PER_HOUR, HOUR_MS, { sliding: true });
declareLimit(HIDE_DAY_BUCKET, ADDRESS_HIDES_PER_DAY, DAY_MS, { sliding: true });

// ── The clock ──────────────────────────────────────────────────────────────

// Production passes no time: the database's clock decides "since midnight
// Athens time" and stamps the hide, so the app server's clock never matters.
// Tests set one so the brake can be run across the 25 Oct 2026 clock change.
let clockOverride: number | null = null;

/** Test-only: pin "now" for the brake, the limits and the hide's timestamp (ms), or null. */
export function _setIssueClockForTests(ms: number | null): void {
  clockOverride = ms;
}

/** The pinned time, or null for "the database's clock". */
export function issueClock(): number | null {
  return clockOverride;
}

/** SQL for "now": the pinned time in tests, the database's clock otherwise. */
function nowSql() {
  return clockOverride === null
    ? sql`clock_timestamp()`
    : sql`to_timestamp(${clockOverride} / 1000.0)`;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type HideInput = {
  reportId: number;
  reason: string;
  photoId: number | null;
  /** True only for an `ok` Turnstile verdict in enforce mode. */
  tokenOk: boolean;
  /** The sender's address (`req.ip`), grouped before it is hashed. Never stored. */
  address: string;
  /**
   * From {@link prepareHide}, called before the transaction opened. Null when
   * it couldn't prepare: then no hide (fails closed, as `address_limit`).
   */
  limitsAt: number | null;
};

/**
 * Call BEFORE opening the report's transaction; pass the result as
 * `limitsAt`. It fixes the moment the address limits are counted at, and
 * caches the rate-limit salts for it, so nothing inside the transaction
 * (which may hold the brake lock) ever needs a second pool connection.
 * Without this, a dozen hide reports at once after a restart locked up the
 * whole pool for good (review finding 1).
 */
export async function prepareHide(): Promise<number | null> {
  const at = clockOverride ?? Date.now();
  try {
    await warmSalts(at);
    // The "Photo hidden" alert's own cap counts on the real clock.
    if (clockOverride !== null) await warmSalts(Date.now());
  } catch (err) {
    // Never lose the report over this (re-check finding R3): it is saved,
    // and simply can't hide.
    logger.error({ err: safeError(err) }, "issue hide: limits not prepared; the report is saved, not hidden");
    return null;
  }
  return at;
}

export type HideResult = {
  /** Whether a hide event was written by this report. */
  hiddenByReport: boolean;
  skipped: HideSkipped | null;
};

/**
 * Apply rules 1–5 for one report and, if none stops it, hide the photo.
 * Writes `hidden_by_report` / `hide_skipped` on the report row and queues the
 * alert for a hide. Call only inside the report's transaction.
 */
export async function applyHideRules(tx: Tx, input: HideInput): Promise<HideResult> {
  if (!HIDING_REASONS.has(input.reason) || input.photoId === null) {
    return { hiddenByReport: false, skipped: null };
  }
  const result = await decide(tx, { ...input, photoId: input.photoId });
  await tx
    .update(welfareReportsTable)
    .set({ hiddenByReport: result.hiddenByReport, hideSkipped: result.skipped })
    .where(eq(welfareReportsTable.id, input.reportId));
  if (result.hiddenByReport) await enqueueIssueAlert(tx, input.reportId);
  return result;
}

async function decide(tx: Tx, input: HideInput & { photoId: number }): Promise<HideResult> {
  const photoId = input.photoId;
  // The same lock setPhotoVisibility takes, before reading the newest event.
  await tx.execute(sql`select id from photos where id = ${photoId} for update`);

  // 1. Already hidden, by the team or an earlier report.
  const newest = await tx.execute<{ action: string }>(sql`
    select action from photo_visibility_events
     where photo_id = ${photoId}
     order by id desc
     limit 1
  `);
  if (newest.rows[0]?.action === "hide") return skip("already_hidden");

  // 2. Rule (i): a hide needs a verified token.
  if (!input.tokenOk) return skip("unchecked");

  // 3. Rule (ii): any restore of this photo, ever.
  const restored = await tx.execute(sql`
    select 1 from photo_visibility_events
     where photo_id = ${photoId} and action = 'restore'
     limit 1
  `);
  if (restored.rows.length > 0) return skip("restored_before");

  // 4. Rule (iv): the brake. The lock is held to the end of the transaction,
  //    so the count and the hide below are one step for every report.
  //    Taken in a savepoint with a lock timeout: a lock that can't be had in
  //    time fails closed (no hide) rather than waiting for ever. A lock taken
  //    in a savepoint that is released is held to the end of the transaction.
  try {
    await tx.transaction(async (sp) => {
      // Put back whatever lock_timeout the session had, not '0' (re-check R2).
      const before = await sp.execute<{ v: string }>(sql`select current_setting('lock_timeout') as v`);
      await sp.execute(sql`select set_config('lock_timeout', ${BRAKE_LOCK_TIMEOUT}, true)`);
      await sp.execute(sql`select pg_advisory_xact_lock(${BRAKE_LOCK})`);
      await sp.execute(sql`select set_config('lock_timeout', ${before.rows[0]?.v ?? "0"}, true)`);
    });
  } catch (err) {
    logger.error({ err: safeError(err) }, "issue brake lock: not had in time; the report is saved, not hidden");
    return skip("brake");
  }
  const now = nowSql();
  if ((await reportHidesToday(tx)) >= brakeLimit) return skip("brake");

  // 5. This address's hide limits, counted in this transaction (a savepoint,
  //    so a counter error can't poison the report). A report that rolls back
  //    therefore uses none of them up. Fails CLOSED.
  if (input.limitsAt === null) return skip("address_limit");
  const at = input.limitsAt;
  try {
    const allowed = await tx.transaction(async (sp) => {
      const key = addressKey(input.address);
      const hour = await consume(HIDE_HOUR_BUCKET, key, ADDRESS_HIDES_PER_HOUR, HOUR_MS, sp, at, {
        sliding: true,
      });
      if (!hour.allowed) return false;
      const day = await consume(HIDE_DAY_BUCKET, key, ADDRESS_HIDES_PER_DAY, DAY_MS, sp, at, {
        sliding: true,
      });
      return day.allowed;
    });
    if (!allowed) return skip("address_limit");
  } catch (err) {
    logger.error({ err: safeError(err) }, "issue hide limit: counter failed; the report is saved, not hidden");
    return skip("address_limit");
  }

  await tx.insert(photoVisibilityEventsTable).values({
    photoId,
    action: "hide",
    author: `report:${input.reportId}`,
    personId: null,
    reason: input.reason,
    at: now,
  });
  return { hiddenByReport: true, skipped: null };
}

function skip(reason: HideSkipped): HideResult {
  return { hiddenByReport: false, skipped: reason };
}

/**
 * What the reporter was told, from the stored columns (plan, "What a repeat
 * send is told"): hidden exactly when this report hid the photo, or found it
 * already hidden. Never worked out from the reason, and never the photo's
 * state today.
 */
export function storedHidden(row: { hiddenByReport: boolean; hideSkipped: string | null }): boolean {
  return row.hiddenByReport || row.hideSkipped === "already_hidden";
}
