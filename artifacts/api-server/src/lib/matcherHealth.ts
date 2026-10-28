import { db, mailOutboxTable, photosTable, sightingMatchesTable, sightingsTable, catsTable } from "@workspace/db";
import { and, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { liveCats } from "./catIdentity";
import { logger, safeError } from "./logger";
import { kickRow } from "./mail/outbox";
import { hashRecipient } from "./mail/send";

/**
 * Is the look-alike check failing? (SYC-532, SYC-531.)
 *
 * Nothing new is stored. Every failed check already leaves a team-only
 * `sighting_matches` row with `matcher_failed = true` and `matched_at` (SYC-151,
 * SYC-503). So "failing now" is a count of those rows, and the list of cats
 * named while it was down is a join from them. The only state the alert keeps
 * is in the mail outbox: the newest `matcher_alert` row says whether a
 * "failing" email has gone and no "working again" has followed.
 *
 * Counted: spotters' sighting checks (first send and "Check again"). A "Check
 * again" that works replaces its failed row, so that failure stops counting,
 * which is right: the spotter got an answer. Find from a photo is not counted
 * (its failures aren't stored; team-only, low volume).
 *
 * Samuel, 25 Oct 2026: 5 failures in 15 minutes; banner on Home plus an email
 * to MATCHER_ALERT_TO.
 */
export const OUTAGE_FAILURES = 5;
export const OUTAGE_WINDOW_MINUTES = 15;
/** The "New cats to check" list looks back this far. */
export const NEW_CATS_DAYS = 14;
const ALERT_LOCK = 532_001;

const since = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000);

/** Checks that failed in the window. */
export async function recentFailures(now: Date = new Date(), q: Pick<typeof db, "select"> = db): Promise<number> {
  const [row] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(sightingMatchesTable)
    .where(
      and(
        eq(sightingMatchesTable.matcherFailed, true),
        gt(sightingMatchesTable.matchedAt, since(now, OUTAGE_WINDOW_MINUTES)),
        lte(sightingMatchesTable.matchedAt, now),
      ),
    );
  return Number(row?.n ?? 0);
}

export interface MatcherStatus {
  failing: boolean;
  failed: number;
  windowMinutes: number;
}

/** What the Home banner shows. */
export async function matcherStatus(now: Date = new Date()): Promise<MatcherStatus> {
  const failed = await recentFailures(now);
  return { failing: failed >= OUTAGE_FAILURES, failed, windowMinutes: OUTAGE_WINDOW_MINUTES };
}

export const matcherAlertTo = () => (process.env["MATCHER_ALERT_TO"] ?? "").trim();

/**
 * Called after each stored check. Queues one "failing" email when the count
 * reaches the threshold and none is open, and one "working again" email when
 * an open alert has had 15 quiet minutes and a check has just worked. An
 * advisory lock makes two servers agree. Never throws: a problem here must
 * not touch the spotter's answer.
 */
export async function reviewMatcherHealth(now: Date = new Date()): Promise<"down" | "up" | "none"> {
  try {
    // "Open" is the newest alert email that wasn't given up on: a "failing"
    // email that failed to send (bad address, an outage past an hour) told
    // nobody, so it must not hide the next one, nor lead to a "working again"
    // for something the team never heard about (review of #347).
    const newestKept = (q: Pick<typeof db, "select">) =>
      q
        .select({ payload: mailOutboxTable.payload, createdAt: mailOutboxTable.createdAt })
        .from(mailOutboxTable)
        .where(and(eq(mailOutboxTable.purpose, "matcher_alert"), sql`${mailOutboxTable.state} <> 'failed'`))
        .orderBy(desc(mailOutboxTable.id))
        .limit(1);
    const isOpen = (r?: { payload: unknown }) => (r?.payload as { kind?: string } | undefined)?.kind === "down";
    const windowMs = OUTAGE_WINDOW_MINUTES * 60_000;
    const mayClose = (r?: { createdAt: Date }) => !!r && now.getTime() - r.createdAt.getTime() >= windowMs;

    // The usual answer is "nothing to do", and it needs no lock and no
    // transaction: only a count at the threshold can open an alert, and only
    // an open alert, a window old and under the threshold, can close.
    const failed0 = await recentFailures(now);
    if (failed0 < OUTAGE_FAILURES) {
      const [peek] = await newestKept(db);
      if (!isOpen(peek) || !mayClose(peek)) return "none";
    }

    const queued = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ALERT_LOCK})`);
      const [latest] = await newestKept(tx);
      const open = isOpen(latest);
      const failed = await recentFailures(now, tx);
      const to = matcherAlertTo();
      const recipientHash = to ? hashRecipient(to) : "unset";
      if (!open && failed >= OUTAGE_FAILURES) {
        if (!to) {
          logger.warn({ failed }, "look-alike check is failing but MATCHER_ALERT_TO is not set; no email");
          return null;
        }
        // At most one "failing" email an hour, whatever happened to the last.
        const recent = await tx.execute(sql`
          select 1 from mail_outbox
           where purpose = 'matcher_alert' and payload->>'kind' = 'down'
             and created_at > ${new Date(now.getTime() - 3_600_000)}
           limit 1
        `);
        if (recent.rows.length > 0) return null;
        const [row] = await tx
          .insert(mailOutboxTable)
          .values({
            purpose: "matcher_alert",
            recipientHash,
            payload: { kind: "down", failed, windowMinutes: OUTAGE_WINDOW_MINUTES },
          })
          .returning({ id: mailOutboxTable.id });
        return { kind: "down" as const, id: row!.id };
      }
      // "Working again": the alert is a window old (a run of successful
      // "Check again"s each replace a failed row, so the count alone could
      // close it within seconds) and failures are back under the threshold.
      if (open && failed < OUTAGE_FAILURES && mayClose(latest)) {
        const [row] = await tx
          .insert(mailOutboxTable)
          .values({ purpose: "matcher_alert", recipientHash, payload: { kind: "up" } })
          .returning({ id: mailOutboxTable.id });
        return { kind: "up" as const, id: row!.id };
      }
      return null;
    });
    if (!queued) return "none";
    kickRow(queued.id);
    return queued.kind;
  } catch (err) {
    logger.error({ err: safeError(err) }, "look-alike alert check failed");
    return "none";
  }
}

// ---- SYC-531: cats named while the check was down ----

export interface NewCatToCheck {
  catId: number;
  name: string;
  namePending: boolean;
  at: Date;
  /** Team photo address for the spot's own photo, or null. */
  photoUrl: string | null;
}

/**
 * New cats whose spot's check failed and whose spotter then chose "It's a new
 * cat" (`matcher_failed` with `choice = new_cat`): the likeliest duplicates.
 * Newest first, the last {@link NEW_CATS_DAYS} days.
 */
export async function newCatsAfterFailedCheck(now: Date = new Date()): Promise<NewCatToCheck[]> {
  // A cat merged into another is no longer a new cat to check (spec §9.3).
  const rows = await liveCats(
    {
      catId: catsTable.id,
      photoId: sightingsTable.photoId,
      at: sightingMatchesTable.chosenAt,
      name: catsTable.name,
      namePending: catsTable.namePending,
    },
    {
      where: and(
        eq(sightingMatchesTable.matcherFailed, true),
        eq(sightingMatchesTable.choice, "new_cat"),
        isNull(sightingsTable.redactedAt),
        gt(sightingMatchesTable.chosenAt, new Date(now.getTime() - NEW_CATS_DAYS * 86_400_000)),
        lte(sightingMatchesTable.chosenAt, now),
      ),
    },
  )
    // The cat the spotter made, from the match record: the sighting may
    // have been moved to another cat since (which-cat-is-which.md §9.5).
    .innerJoin(sightingMatchesTable, eq(sightingMatchesTable.chosenCatId, catsTable.id))
    .innerJoin(sightingsTable, eq(sightingsTable.id, sightingMatchesTable.sightingId))
    .orderBy(desc(sightingMatchesTable.chosenAt));
  const photoIds = rows.map((r) => r.photoId);
  const photos = photoIds.length
    ? await db
        .select({ id: photosTable.id, publicId: photosTable.publicId })
        .from(photosTable)
        .where(and(inArray(photosTable.id, photoIds), isNull(photosTable.removedAt)))
    : [];
  const publicIdByPhoto = new Map(photos.map((p) => [p.id, p.publicId]));
  const seen = new Set<number>();
  const out: NewCatToCheck[] = [];
  for (const r of rows) {
    if (r.catId === null || r.at === null || seen.has(r.catId)) continue;
    seen.add(r.catId);
    const publicId = publicIdByPhoto.get(r.photoId);
    out.push({
      catId: r.catId,
      name: r.name,
      namePending: r.namePending,
      at: r.at,
      photoUrl: publicId ? `/api/team/photos/${encodeURIComponent(publicId)}` : null,
    });
  }
  return out;
}
