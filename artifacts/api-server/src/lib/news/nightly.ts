import {
  catNewsBaselineTable,
  catNewsChangesTable,
  catNewsRunsTable,
  catSubscriptionsTable,
  db,
  sightingsTable,
  type CatNewsBaseline,
} from "@workspace/db";
import type { Observation } from "@workspace/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { loadCatRecords, type DbOrTx } from "../observations";
import {
  APPEARANCE_AND_HEALTH_KINDS,
  athensDay,
  resolveCat,
  resolveLifeStatus,
  resolveSterilised,
} from "../resolve";

/**
 * SYC-45 Slice 1: the nightly news check, watch only
 * (docs/superpowers/plans/syc-344-email-capture.md, PR 1.1;
 * email-capture.md §5.3; cat-record-data-spine.md §9).
 *
 * Once a night it walks EVERY followed cat (any row in cat_subscriptions),
 * whoever follows it, so no baseline is ever months stale (plan review
 * finding 3). For each cat it takes the status the cat page shows from
 * `resolveCat`, and the evidence ids from `resolveSterilised` /
 * `resolveLifeStatus` (plan C2: `resolveCat` carries no ids). The resolver
 * is called, never reimplemented, and never reads `cat_news_baseline`.
 *
 * News is only (spec §5.3):
 * - sterilisation newly confirmed (`value: true`, `confidence: "confirmed"`);
 * - life status newly `homed`;
 * - a sighting four calendar months or more after the sighting before it.
 * Never "not sterilised", "likely", "in care", or anything about a death.
 *
 * Guards, in order:
 * 1. A cat that is dead or presumed dead gives no news of any kind
 *    (silenced `deceased`; F4).
 * 2. The observations newer than the baseline: all `import` or `legacy` →
 *    silenced with that reason; all recorded more than 90 days after they
 *    were observed → silenced `old_news`.
 * 3. A cat with no baseline yet is seeded, and nothing is recorded.
 * 4. More than BULK_LIMIT news changes in one night → every one silenced
 *    `bulk`, and the caller raises the alarm (plan C14; data spine §9.2).
 * Watch mode (the only mode in Slice 1) marks what's left `watched`. Nothing
 * here sends anything.
 *
 * The whole night is one transaction under an advisory lock: two callers
 * at once can't both run, and the night is claimed (its cat_news_runs row)
 * only when the run FINISHES, so a crash part-way leaves nothing and the
 * backup runs it again.
 */

/** More news changes than this in one night silences all of them. */
export const BULK_LIMIT = 50;
/** An observation recorded more than this long after it was observed is old news. */
export const OLD_NEWS_DAYS = 90;
/** "Seen again" needs a gap of at least this many calendar months between sightings. */
export const SEEN_AGAIN_MONTHS = 4;
const BATCH = 200;
const DAY_MS = 86_400_000;

export type NewsChangeKind = "sterilised" | "homed" | "seen_again";
export type SilencedReason = "import" | "legacy" | "old_news" | "first_seen" | "deceased" | "bulk";

/** One change found tonight, before it's written. */
export interface FoundChange {
  catId: number;
  change: NewsChangeKind;
  evidenceIds: number[];
  causedByDevices: string[];
  silencedReason: SilencedReason | null;
}

/** What the check works out for one cat. */
export interface CatNewsStatus {
  catId: number;
  sterilisedConfirmed: boolean;
  lifeStatus: string;
  dead: boolean;
  sterilisedEvidence: number[];
  lifeEvidence: number[];
  lastSightingAt: Date | null;
}

interface SightingRow {
  id: number;
  catId: number;
  createdAt: Date;
  deviceId: string | null;
}

export type NightlyResult =
  | {
      status: "ran";
      night: string;
      catsWalked: number;
      changesFound: number;
      news: number;
      silenced: number;
      silencedBulk: boolean;
    }
  | { status: "already"; night: string }
  | { status: "busy"; night: string };

export interface NightlyOptions {
  now?: Date;
  /** Test-only: runs after everything is worked out, before the night is claimed. */
  beforeFinish?: () => Promise<void> | void;
}

/** YYYY-MM-DD plus whole calendar months, the day clamped to the month's end. */
export function addCalendarMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Is `later` four calendar months or more after `earlier`, on Athens days? */
export function isLongGap(earlier: Date, later: Date): boolean {
  return athensDay(later) >= addCalendarMonths(athensDay(earlier), SEEN_AGAIN_MONTHS);
}

/** The status the check reads for each cat, from the resolver only. */
export async function newsStatuses(
  catIds: readonly number[],
  now: Date,
  exec: DbOrTx = db,
): Promise<{ statuses: Map<number, CatNewsStatus>; observations: Map<number, Observation[]> }> {
  const records = await loadCatRecords(catIds, exec);
  const statuses = new Map<number, CatNewsStatus>();
  const observations = new Map<number, Observation[]>();
  for (const catId of catIds) {
    const rec = records.get(catId);
    const obs = rec?.observations ?? [];
    const eol = rec?.evidenceOfLife ?? null;
    // The cat page's status (deriveCatStatuses' live path does exactly this).
    const snapshot = resolveCat(obs, eol, now);
    // The evidence ids, from the same rows resolveCat hands its status resolvers.
    const statusRows = obs.filter((o) => !APPEARANCE_AND_HEALTH_KINDS.has(o.kind));
    const sterilised = resolveSterilised(statusRows, []);
    const life = resolveLifeStatus(statusRows, eol, now);
    statuses.set(catId, {
      catId,
      sterilisedConfirmed:
        snapshot.sterilised.value === true && snapshot.sterilised.confidence === "confirmed",
      lifeStatus: snapshot.lifeStatus,
      dead: snapshot.lifeStatus === "deceased" || snapshot.presumedDeceased,
      sterilisedEvidence: sterilised.supportingObservationIds,
      lifeEvidence: life.supportingObservationIds,
      lastSightingAt: eol?.lastSightingAt ?? null,
    });
    observations.set(catId, obs);
  }
  return { statuses, observations };
}

async function loadSightings(catIds: readonly number[], exec: DbOrTx): Promise<Map<number, SightingRow[]>> {
  const rows = await exec
    .select({
      id: sightingsTable.id,
      catId: sightingsTable.catId,
      createdAt: sightingsTable.createdAt,
      deviceId: sightingsTable.deviceId,
    })
    .from(sightingsTable)
    .where(and(inArray(sightingsTable.catId, [...catIds]), eq(sightingsTable.status, "resolved")))
    .orderBy(asc(sightingsTable.createdAt), asc(sightingsTable.id));
  const out = new Map<number, SightingRow[]>();
  for (const r of rows) {
    if (r.catId == null) continue;
    const list = out.get(r.catId) ?? [];
    list.push({ id: r.id, catId: r.catId, createdAt: r.createdAt, deviceId: r.deviceId });
    out.set(r.catId, list);
  }
  return out;
}

const STERILISED_KINDS = new Set(["sterilised", "ear_tip"]);
const LIFE_KINDS = new Set(["life_status"]);

/**
 * Spec §5.3's guards, on the observations newer than the baseline that bear
 * on this change. `null` means the change is news.
 */
function guardReason(newer: readonly Observation[]): SilencedReason | null {
  // Never empty for a real status change (a change needs a new row); if it
  // ever is, nothing here can say it's old, and a person reviews it.
  if (newer.length === 0) return null;
  if (newer.every((o) => o.provenance === "legacy")) return "legacy";
  if (newer.every((o) => o.provenance === "import" || o.provenance === "legacy")) return "import";
  if (newer.every((o) => o.createdAt.getTime() - o.observedAt.getTime() > OLD_NEWS_DAYS * DAY_MS)) {
    return "old_news";
  }
  return null;
}

function devicesOf(rows: readonly { deviceId: string | null }[]): string[] {
  return [...new Set(rows.flatMap((r) => (r.deviceId ? [r.deviceId] : [])))].sort();
}

/**
 * Compare one cat with its baseline. Pure: the changes found and the
 * baseline row to write. `walkedAt` is when tonight's reading began, so an
 * observation written during the run counts as newer tomorrow.
 */
export function compareCat(
  status: CatNewsStatus,
  observations: readonly Observation[],
  sightings: readonly SightingRow[],
  baseline: CatNewsBaseline | undefined,
  walkedAt: Date,
): { changes: FoundChange[]; baseline: CatNewsBaseline } {
  const lastSightingAt = sightings.length ? sightings[sightings.length - 1]!.createdAt : status.lastSightingAt;
  // The ratchet: set the first time the check sees the status, whether that
  // is news, silenced or a first sight, and never cleared.
  const next: CatNewsBaseline = {
    catId: status.catId,
    sterilisedConfirmed: status.sterilisedConfirmed,
    notifiedSterilisedAt:
      baseline?.notifiedSterilisedAt ?? (status.sterilisedConfirmed ? walkedAt : null),
    notifiedHomedAt: baseline?.notifiedHomedAt ?? (status.lifeStatus === "homed" ? walkedAt : null),
    lifeStatus: status.lifeStatus,
    lastSightingAt: lastSightingAt ?? null,
    updatedAt: walkedAt,
  };
  // First sight: seed, record nothing.
  if (!baseline) return { changes: [], baseline: next };

  const since = baseline.updatedAt.getTime();
  const newerOf = (kinds: ReadonlySet<string>) =>
    observations.filter((o) => kinds.has(o.kind) && o.createdAt.getTime() > since);

  const changes: FoundChange[] = [];

  if (status.sterilisedConfirmed && baseline.notifiedSterilisedAt == null) {
    const newer = newerOf(STERILISED_KINDS);
    changes.push({
      catId: status.catId,
      change: "sterilised",
      evidenceIds: status.sterilisedEvidence,
      causedByDevices: devicesOf(newer),
      silencedReason: guardReason(newer),
    });
  }

  if (status.lifeStatus === "homed" && baseline.notifiedHomedAt == null) {
    const newer = newerOf(LIFE_KINDS);
    changes.push({
      catId: status.catId,
      change: "homed",
      evidenceIds: status.lifeEvidence,
      causedByDevices: devicesOf(newer),
      silencedReason: guardReason(newer),
    });
  }

  // Seen again: a new sighting whose gap from the sighting BEFORE IT is
  // four calendar months or more. Measured between sightings, never
  // against the baseline's date (review finding 3).
  const after = baseline.lastSightingAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const longGaps: SightingRow[] = [];
  for (let i = 1; i < sightings.length; i++) {
    const s = sightings[i]!;
    if (s.createdAt.getTime() <= after) continue;
    if (isLongGap(sightings[i - 1]!.createdAt, s.createdAt)) longGaps.push(s);
  }
  if (longGaps.length) {
    changes.push({
      catId: status.catId,
      change: "seen_again",
      evidenceIds: longGaps.map((s) => s.id),
      causedByDevices: devicesOf(longGaps),
      silencedReason: null,
    });
  }

  // The blanket rule: a dead or presumed-dead cat gives no news of any kind.
  if (status.dead) {
    for (const c of changes) c.silencedReason = "deceased";
  }

  return { changes, baseline: next };
}

async function followedCatIds(exec: DbOrTx): Promise<number[]> {
  const rows = await exec
    .selectDistinct({ catId: catSubscriptionsTable.catId })
    .from(catSubscriptionsTable)
    .orderBy(asc(catSubscriptionsTable.catId));
  return rows.map((r) => r.catId);
}

async function walk(
  catIds: readonly number[],
  walkedAt: Date,
  exec: DbOrTx,
): Promise<{ baselines: CatNewsBaseline[]; changes: FoundChange[] }> {
  const baselines: CatNewsBaseline[] = [];
  const changes: FoundChange[] = [];
  for (let i = 0; i < catIds.length; i += BATCH) {
    const batch = catIds.slice(i, i + BATCH);
    const { statuses, observations } = await newsStatuses(batch, walkedAt, exec);
    const sightings = await loadSightings(batch, exec);
    const existing = await exec
      .select()
      .from(catNewsBaselineTable)
      .where(inArray(catNewsBaselineTable.catId, batch));
    const byCat = new Map(existing.map((b) => [b.catId, b]));
    for (const catId of batch) {
      const out = compareCat(
        statuses.get(catId)!,
        observations.get(catId) ?? [],
        sightings.get(catId) ?? [],
        byCat.get(catId),
        walkedAt,
      );
      baselines.push(out.baseline);
      changes.push(...out.changes);
    }
  }
  return { baselines, changes };
}

async function writeBaselines(rows: readonly CatNewsBaseline[], exec: DbOrTx): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await exec
      .insert(catNewsBaselineTable)
      .values([...batch])
      .onConflictDoUpdate({
        target: catNewsBaselineTable.catId,
        set: {
          sterilisedConfirmed: sql`excluded.sterilised_confirmed`,
          // The ratchet: once set, never cleared or moved.
          notifiedSterilisedAt: sql`coalesce(${catNewsBaselineTable.notifiedSterilisedAt}, excluded.notified_sterilised_at)`,
          notifiedHomedAt: sql`coalesce(${catNewsBaselineTable.notifiedHomedAt}, excluded.notified_homed_at)`,
          lifeStatus: sql`excluded.life_status`,
          lastSightingAt: sql`excluded.last_sighting_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

const NIGHTLY_LOCK = sql`hashtextextended('cat-news-nightly', 0)`;

/**
 * The night's check. Answers `already` if tonight (the Athens date) has a
 * finished run, `busy` if another caller holds the lock.
 */
export async function runNightlyNewsCheck(options: NightlyOptions = {}): Promise<NightlyResult> {
  const startedAt = options.now ?? new Date();
  const night = athensDay(startedAt);
  return db.transaction(async (tx) => {
    const lock = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${NIGHTLY_LOCK}) as locked`,
    );
    if (!lock.rows[0]?.locked) return { status: "busy", night } as const;

    const [done] = await tx
      .select({ athensDate: catNewsRunsTable.athensDate })
      .from(catNewsRunsTable)
      .where(eq(catNewsRunsTable.athensDate, night));
    if (done) return { status: "already", night } as const;

    const catIds = await followedCatIds(tx);
    const { baselines, changes } = await walk(catIds, startedAt, tx);

    const news = changes.filter((c) => c.silencedReason === null);
    const silencedBulk = news.length > BULK_LIMIT;
    if (silencedBulk) for (const c of news) c.silencedReason = "bulk";

    await options.beforeFinish?.();

    await writeBaselines(baselines, tx);
    if (changes.length) {
      await tx.insert(catNewsChangesTable).values(
        changes.map((c) => ({
          catId: c.catId,
          change: c.change,
          evidenceIds: c.evidenceIds,
          // Kept only while a change could still be sent (Slice 3 reads it
          // to skip the person whose own spot caused it); a silenced change
          // is settled, so it keeps none.
          causedByDevices: c.silencedReason === null ? c.causedByDevices : null,
          foundAt: startedAt,
          state: c.silencedReason === null ? "watched" : "silenced",
          silencedReason: c.silencedReason,
        })),
      );
    }
    const finishedAt = new Date();
    await tx.insert(catNewsRunsTable).values({
      athensDate: night,
      startedAt,
      finishedAt,
      catsWalked: catIds.length,
      changesFound: changes.length,
      silencedBulk,
    });
    const newsCount = silencedBulk ? 0 : news.length;
    return {
      status: "ran",
      night,
      catsWalked: catIds.length,
      changesFound: changes.length,
      news: newsCount,
      silenced: changes.length - newsCount,
      silencedBulk,
    } as const;
  });
}

/**
 * Write the current status of these cats as their baseline, recording no
 * change (plan C11; email-capture.md §5.3, data spine §9.2). Any records
 * import must call this as each batch lands, so an import sends nothing.
 * The ratchet is kept: a cat already announced stays announced.
 */
export async function seedNewsBaseline(
  catIds: readonly number[],
  exec: DbOrTx = db,
  now: Date = new Date(),
): Promise<number> {
  const ids = [...new Set(catIds)];
  if (ids.length === 0) return 0;
  const rows: CatNewsBaseline[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const { statuses } = await newsStatuses(batch, now, exec);
    const sightings = await loadSightings(batch, exec);
    for (const catId of batch) {
      const s = statuses.get(catId)!;
      const list = sightings.get(catId) ?? [];
      rows.push({
        catId,
        sterilisedConfirmed: s.sterilisedConfirmed,
        notifiedSterilisedAt: s.sterilisedConfirmed ? now : null,
        notifiedHomedAt: s.lifeStatus === "homed" ? now : null,
        lifeStatus: s.lifeStatus,
        lastSightingAt: list.length ? list[list.length - 1]!.createdAt : s.lastSightingAt,
        updatedAt: now,
      });
    }
  }
  await writeBaselines(rows, exec);
  return rows.length;
}

/** The newest finished night, for the Worker's "no run in 36 hours" alarm. */
export async function lastNewsRun(exec: DbOrTx = db) {
  const [row] = await exec
    .select()
    .from(catNewsRunsTable)
    .orderBy(sql`${catNewsRunsTable.finishedAt} desc`)
    .limit(1);
  return row ?? null;
}
