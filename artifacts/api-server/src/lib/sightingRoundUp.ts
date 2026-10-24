import { db, notificationsTable, pushRoundupRunsTable } from "@workspace/db";
import { desc, eq, lt, sql } from "drizzle-orm";
import { sendPushNotification } from "./push";
import { isResolvedDeceased } from "./catHelpers";
import { logger, safeError } from "./logger";

/**
 * The evening sighting round-up (data-spine.md PR 9, spec §6.4.4; Q4 = A,
 * decided by Samuel 2 Oct).
 *
 * A live "Agatha was spotted again!" gave anyone who once spotted a cat a
 * to-the-minute record of every later sighting, and so of when her cat
 * guardian comes to feed. So for a cat the recipient doesn't own, nothing
 * about a sighting reaches them straight away: `fanOutNotifications` writes
 * the in-app row and sends the push to the owner only. This writes everyone
 * else's in-app rows and sends at most one push per person, once an evening,
 * naming the cats and never a time. (Review of #89, finding 1: the in-app
 * list is polled every 30 seconds, so holding back only the push left the
 * same feed open inside the app. Samuel chose to close both here.)
 *
 * Due from {@link ROUND_UP_HOUR} until midnight, Athens time. Two triggers,
 * because the deployment can sleep and GitHub runs the 10-minute mail-drain
 * schedule only every few hours in practice (review of #89, finding 2):
 *   1. POST /api/internal/mail/drain (`.github/workflows/mail-drain.yml`);
 *   2. after any API response (`opportunisticRoundUp`), throttled.
 * The `push_roundup_runs` row for that Athens date is the claim, inserted in
 * the same transaction as the in-app rows: two triggers never send the same
 * evening twice, and a failure before the commit leaves the evening unclaimed
 * for the next trigger to retry (finding 5). An evening nobody triggered
 * rolls into the next one's window.
 *
 * Recipients are read from `cat_subscriptions`, which SYC-63's deletion
 * removes for a deleted device, so a deleted person is never sent anything.
 *
 * Pushes are best-effort, like every push: if the server dies mid-send, that
 * evening's remaining pushes are lost, never sent twice. The in-app rows are
 * already committed by then.
 */

/** Europe/Athens hour (0–23) from which the evening's round-up is due. */
export const ROUND_UP_HOUR = 20;
const TIME_ZONE = "Europe/Athens";
/** A missed evening rolls into the next, but never reaches back further. */
const MAX_WINDOW_MS = 72 * 60 * 60 * 1000;

function athensParts(now: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

/**
 * The round-up's words. Never a time, a clock reading, "x minutes ago", or
 * even "today" (§6.4.4), since a window can start the evening before or
 * span a missed evening (review of #89, finding 4).
 */
export function roundUpText(catNames: readonly string[]): {
  title: string;
  body: string;
} {
  const title = "Cats you follow";
  const [first, second] = catNames;
  if (catNames.length <= 1) return { title, body: `${first} was spotted again.` };
  if (catNames.length === 2) {
    return { title, body: `${first} and ${second} were spotted again.` };
  }
  const others = catNames.length - 1;
  return {
    title,
    body: `${first} and ${others} other cats you follow were spotted again.`,
  };
}

export type RoundUpResult =
  | { status: "not_due" }
  | { status: "already_sent" }
  | { status: "sent"; devices: number; pushes: number };

type Row = {
  device_id: string;
  token: string | null;
  cat_id: number;
  cat_name: string;
  cat_update_id: number;
  seen: string | Date;
};

type Planned = Map<string, { token: string | null; cats: { id: number; name: string }[] }>;

export async function sendDailyRoundUp(now: Date = new Date()): Promise<RoundUpResult> {
  const { date, hour } = athensParts(now);
  if (hour < ROUND_UP_HOUR) return { status: "not_due" };

  const planned = await db.transaction(async (tx): Promise<Planned | null> => {
    // The window runs from where the last evening's ended, so nothing falls
    // between two round-ups, but never further back than 72 hours.
    const [previous] = await tx
      .select({ windowEnd: pushRoundupRunsTable.windowEnd })
      .from(pushRoundupRunsTable)
      .where(lt(pushRoundupRunsTable.roundUpDate, date))
      .orderBy(desc(pushRoundupRunsTable.roundUpDate))
      .limit(1);
    const floor = new Date(now.getTime() - MAX_WINDOW_MS);
    const windowStart =
      previous && previous.windowEnd > floor ? previous.windowEnd : floor;

    // A parallel trigger blocks here until the first commits, then claims
    // nothing; if the first rolls back, it claims instead.
    const claimed = await tx
      .insert(pushRoundupRunsTable)
      .values({ roundUpDate: date, windowStart, windowEnd: now })
      .onConflictDoNothing()
      .returning({ roundUpDate: pushRoundupRunsTable.roundUpDate });
    if (claimed.length === 0) return null;

    // Each (follower, cat) with a sighting in the window, its latest one.
    // Not the owner (they had it live), not the spotter who made it, and
    // only followers who already followed before this window opened. A
    // follow counts from the first round-up that starts after it, so the
    // moment someone followed (staggered across phones) can never reveal
    // when a cat was seen: a day, never a time.
    const result = await tx.execute(sql`
      select distinct on (cs.device_id, c.id)
             cs.device_id, pt.token, c.id as cat_id, c.name as cat_name,
             cu.id as cat_update_id, cu.created_at as seen
        from cat_updates cu
        join cats c on c.id = cu.cat_id
        join cat_subscriptions cs
          on cs.cat_id = cu.cat_id and cs.created_at <= ${windowStart.toISOString()}
        left join sightings s on s.id = cu.trigger_sighting_id
        left join push_tokens pt on pt.device_id = cs.device_id
       where cu.update_type = 'sighting'
         and cu.created_at >= ${windowStart.toISOString()}
         and cu.created_at < ${now.toISOString()}
         and cs.device_id not like 'deleted:%'
         and c.owner_device_id is distinct from cs.device_id
         and s.device_id is distinct from cs.device_id
       order by cs.device_id, c.id, cu.created_at desc
    `);
    const rows = result.rows as Row[];

    // §3.3: never a word about a cat recorded as dead since it was seen.
    const deceased = new Set<number>();
    for (const id of new Set(rows.map((r) => r.cat_id))) {
      if (await isResolvedDeceased(id)) deceased.add(id);
    }
    const kept = rows
      .filter((r) => !deceased.has(r.cat_id))
      .sort((a, b) => new Date(b.seen).getTime() - new Date(a.seen).getTime());

    if (kept.length > 0) {
      await tx
        .insert(notificationsTable)
        .values(kept.map((r) => ({ deviceId: r.device_id, catUpdateId: r.cat_update_id })));
    }

    const byDevice: Planned = new Map();
    for (const r of kept) {
      const entry = byDevice.get(r.device_id) ?? { token: r.token, cats: [] };
      entry.cats.push({ id: r.cat_id, name: r.cat_name });
      byDevice.set(r.device_id, entry);
    }
    return byDevice;
  });

  if (planned === null) return { status: "already_sent" };

  let pushes = 0;
  await Promise.all(
    [...planned.values()].map(async ({ token, cats }) => {
      if (!token) return;
      const { title, body } = roundUpText(cats.map((c) => c.name));
      pushes += 1;
      await sendPushNotification(token, title, body, {
        type: "sighting_round_up",
        catIds: cats.map((c) => c.id),
      });
    }),
  );

  await db
    .update(pushRoundupRunsTable)
    .set({ finishedAt: new Date(), devices: planned.size })
    .where(eq(pushRoundupRunsTable.roundUpDate, date))
    .catch((err: unknown) =>
      logger.warn({ err: safeError(err), date }, "round-up: could not record finish"),
    );

  logger.info({ date, devices: planned.size, pushes }, "sighting round-up sent");
  return { status: "sent", devices: planned.size, pushes };
}

let lastTry = 0;
let sentForDate: string | null = null;
const OPPORTUNISTIC_EVERY_MS = 5 * 60_000;

function opportunisticEnabled(): boolean {
  const flag = process.env["ROUND_UP_ON_REQUEST"];
  if (flag === "off") return false;
  if (flag === "on") return true;
  return process.env["NODE_ENV"] !== "test";
}

/**
 * Express middleware, the round-up's second trigger: after any API
 * response in the evening, try the round-up, at most every 5 minutes per
 * server, and not at all once this server knows tonight's has gone. People
 * use the app in the evening, so this fires even when GitHub's schedule
 * doesn't.
 */
export function opportunisticRoundUp(
  _req: unknown,
  res: { on(event: "finish", cb: () => void): unknown },
  next: () => void,
): void {
  if (opportunisticEnabled()) {
    res.on("finish", () => {
      const now = new Date();
      if (now.getTime() - lastTry < OPPORTUNISTIC_EVERY_MS) return;
      const { date, hour } = athensParts(now);
      if (hour < ROUND_UP_HOUR || sentForDate === date) return;
      lastTry = now.getTime();
      void sendDailyRoundUp(now)
        .then((r) => {
          if (r.status !== "not_due") sentForDate = date;
        })
        .catch((err: unknown) =>
          logger.warn({ err: safeError(err) }, "opportunistic round-up failed"),
        );
    });
  }
  next();
}
