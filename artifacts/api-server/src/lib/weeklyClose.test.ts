/**
 * SYC-706 Task 9: the weekly close freezes last week's top three once, gives
 * Podium and Champion, queues a celebration and a bell entry for each, and the
 * Monday push goes out once, between 08:00 and 20:00 Athens, on the Monday the
 * week closed and never otherwise.
 *
 * Closed weeks are in 2032 (and one in 2000), so they never meet a real week's
 * claim row. Every device shares PREFIX so cleanup never touches real data.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  badgeMomentsTable,
  notificationsTable,
  pointsLedgerTable,
  profilesTable,
  pushTokensTable,
  spotterBadgesTable,
  weeklyResultsTable,
} from "@workspace/db";
import { and, eq, like, sql } from "drizzle-orm";

const sendPushNotificationMock = vi.hoisted(() =>
  vi.fn(async (_token: string, _title: string, _body: string, _data?: unknown) => {}),
);
vi.mock("./push", () => ({ sendPushNotification: sendPushNotificationMock }));

import app from "../app";
import { SEED_AREAS } from "./areas/namedAreas";
import { severPerson } from "./severPerson";
import { deletedMarkerKey } from "./deviceAuth";
import { athensDay, weekStartAthens } from "./weeks";
import {
  closeWeekIfDue,
  firstEligibleWeek,
  sendWeeklyPushesIfDue,
  weekResultText,
} from "./weeklyClose";

const PREFIX = "vitest-wclose-";
const dev = (s: string) => `${PREFIX}${s}`;
const SECRET = "vitest-secret-wclose-0123456789";

// Athens is UTC+2 through every date used here (summer time starts late March).
const athens = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+02:00`);

let sightingSeq = 1_950_000_000;

async function cleanup() {
  await db.delete(pointsLedgerTable).where(like(pointsLedgerTable.deviceId, `${PREFIX}%`));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${PREFIX}%`));
  await db.delete(weeklyResultsTable).where(like(weeklyResultsTable.deviceId, `${PREFIX}%`));
  await db.delete(spotterBadgesTable).where(like(spotterBadgesTable.deviceId, `${PREFIX}%`));
  await db.delete(badgeMomentsTable).where(like(badgeMomentsTable.deviceId, `${PREFIX}%`));
  await db.delete(notificationsTable).where(like(notificationsTable.deviceId, `${PREFIX}%`));
  await db.delete(pushTokensTable).where(like(pushTokensTable.deviceId, `${PREFIX}%`));
  await db.execute(sql`delete from device_credentials where device_id like ${`${PREFIX}%`}`);
  await db.execute(sql`delete from device_credentials where device_id = ${deletedMarkerKey(dev("gone"))}`);
  await db.execute(sql`
    delete from weekly_closes
    where week_start between '2032-01-01' and '2032-12-31'
       or week_start between '1999-01-01' and '2000-12-31'`);
  await db.execute(sql`
    delete from weekly_results
    where week_start between '2032-01-01' and '2032-12-31'
       or week_start between '1999-01-01' and '2000-12-31'`);
}

async function profile(suffix: string, names: { username?: string | null; nickname?: string | null } = {}) {
  await db.insert(profilesTable).values({
    deviceId: dev(suffix),
    username: names.username === undefined ? `WClose${suffix}` : names.username,
    nickname: names.nickname ?? null,
  });
}

async function ledger(suffix: string, points: number, earnedAt: Date, source = "live") {
  const sightingId = sightingSeq++;
  await db.insert(pointsLedgerTable).values({
    deviceId: dev(suffix),
    sightingId,
    catId: sightingId,
    points,
    athensDay: athensDay(earnedAt),
    weekStart: weekStartAthens(earnedAt),
    earnedAt,
    source,
  });
}

async function token(suffix: string) {
  await db.insert(pushTokensTable).values({
    deviceId: dev(suffix),
    token: `ExponentPushToken[${suffix}]`,
  });
}

async function results(weekStart: string) {
  const r = await db.execute<{ place: number; device_id: string; display_name: string | null; points: number }>(sql`
    select place, device_id, display_name, points from weekly_results
    where week_start = ${weekStart}::date order by place, id`);
  return r.rows.map((x) => ({ ...x, place: Number(x.place), points: Number(x.points) }));
}

async function badgesOf(suffix: string) {
  const rows = await db
    .select({ id: spotterBadgesTable.badgeId, source: spotterBadgesTable.source })
    .from(spotterBadgesTable)
    .where(eq(spotterBadgesTable.deviceId, dev(suffix)));
  return rows.map((r) => r.id).sort();
}

async function momentsOf(suffix: string) {
  return db
    .select()
    .from(badgeMomentsTable)
    .where(and(eq(badgeMomentsTable.deviceId, dev(suffix)), eq(badgeMomentsTable.kind, "week_result")));
}

async function bellOf(suffix: string) {
  return db
    .select()
    .from(notificationsTable)
    .where(and(eq(notificationsTable.deviceId, dev(suffix)), eq(notificationsTable.kind, "week_result")));
}

const pushesTo = (suffix: string) =>
  sendPushNotificationMock.mock.calls.filter((c) => c[0] === `ExponentPushToken[${suffix}]`);

beforeEach(async () => {
  await cleanup();
  sendPushNotificationMock.mockClear();
  // The new version went live in 2031, so every 2032 week is eligible.
  await ledger("anchor", 0, athens("2031-11-05", "12:00"));
});
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("closeWeekIfDue", () => {
  it("not due before the first eligible week", async () => {
    // A history row long before is ignored: only the first live row counts.
    await ledger("hist", 0, athens("1999-06-02", "12:00"), "history");
    // The first live row is in the week of Mon 3 Jan 2000, so the first week
    // to close is the full week after: Mon 10 Jan 2000.
    await ledger("first", 25, athens("2000-01-05", "12:00"));
    expect(await firstEligibleWeek()).toBe("2000-01-10");

    // Monday 10 Jan: last week (3 Jan) is the launch week, never closed.
    expect(await closeWeekIfDue(athens("2000-01-10", "09:00"))).toBe("not_due");
    expect(await results("2000-01-03")).toHaveLength(0);
    const claimed = await db.execute(sql`select 1 from weekly_closes where week_start = '2000-01-03'`);
    expect(claimed.rows).toHaveLength(0);

    // Monday 17 Jan: the week of 10 Jan is the first that closes.
    expect(await closeWeekIfDue(athens("2000-01-17", "09:00"))).toBe("closed");
  });

  it("closes last week once and freezes the top three with ties", async () => {
    // Week of Mon 2 Feb 2032, closed on Mon 9 Feb.
    for (const s of ["a", "b", "c", "e"]) await profile(s);
    await profile("d", { username: null, nickname: "Dee" });
    await ledger("a", 25, athens("2032-02-03", "10:00"));
    await ledger("a", 25, athens("2032-02-03", "11:00"));
    await ledger("b", 50, athens("2032-02-04", "10:00")); // level with a, later
    await ledger("c", 25, athens("2032-02-05", "10:00"));
    await ledger("c", 15, athens("2032-02-05", "11:00"));
    await ledger("d", 40, athens("2032-02-06", "10:00")); // level with c, later
    await ledger("e", 30, athens("2032-02-06", "10:00")); // 5th: not placed
    // Neither counts towards this week: a history row and a row the week after.
    await ledger("e", 0, athens("2032-02-04", "10:00"), "history");
    await ledger("e", 100, athens("2032-02-09", "00:30"));

    expect(await closeWeekIfDue(athens("2032-02-09", "09:00"))).toBe("closed");

    expect(await results("2032-02-02")).toEqual([
      { place: 1, device_id: dev("a"), display_name: "WClosea", points: 50 },
      { place: 1, device_id: dev("b"), display_name: "WCloseb", points: 50 },
      { place: 3, device_id: dev("c"), display_name: "WClosec", points: 40 },
      { place: 3, device_id: dev("d"), display_name: "Dee", points: 40 },
    ]);
    expect(await badgesOf("a")).toEqual(["champion", "podium"]);
    expect(await badgesOf("b")).toEqual(["champion", "podium"]);
    expect(await badgesOf("c")).toEqual(["podium"]);
    expect(await badgesOf("d")).toEqual(["podium"]);
    expect(await badgesOf("e")).toEqual([]);

    const [ma] = await momentsOf("a");
    expect(ma).toMatchObject({ badgeIds: ["podium", "champion"], place: 1, weekPoints: 50 });
    expect(String(ma!.weekStart)).toContain("2032-02-02");
    const [md] = await momentsOf("d");
    expect(md).toMatchObject({ badgeIds: ["podium"], place: 3, weekPoints: 40 });
    expect(await momentsOf("e")).toHaveLength(0);

    for (const s of ["a", "b", "c", "d"]) expect(await bellOf(s)).toHaveLength(1);
    expect(await bellOf("e")).toHaveLength(0);

    // Running again changes nothing.
    expect(await closeWeekIfDue(athens("2032-02-09", "10:00"))).toBe("already_closed");
    expect(await results("2032-02-02")).toHaveLength(4);
    expect(await momentsOf("a")).toHaveLength(1);
    expect(await bellOf("a")).toHaveLength(1);
  });

  it("two closes at once close the week once", async () => {
    // Week of Mon 9 Feb 2032, closed on Mon 16 Feb.
    await profile("p");
    await profile("q");
    await ledger("p", 25, athens("2032-02-10", "10:00"));
    await ledger("q", 15, athens("2032-02-11", "10:00"));

    const now = athens("2032-02-16", "09:00");
    const outcomes = await Promise.all([closeWeekIfDue(now), closeWeekIfDue(now)]);
    expect(outcomes.sort()).toEqual(["already_closed", "closed"]);
    expect(await results("2032-02-09")).toHaveLength(2);
    expect(await momentsOf("p")).toHaveLength(1);
    expect(await momentsOf("q")).toHaveLength(1);
    expect(await bellOf("p")).toHaveLength(1);
  });

  it("a winner who deletes their account while the close waits is dropped, not frozen", async () => {
    // Week of Mon 1 Mar 2032, closed on Mon 8 Mar. "gone" tops the board, then
    // deletes themselves in a transaction that has not committed when the
    // close has already read the board and is waiting for their badges lock.
    await profile("gone");
    await profile("stay");
    await ledger("gone", 50, athens("2032-03-02", "10:00"));
    await ledger("stay", 25, athens("2032-03-03", "10:00"));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const deleting = db.transaction(async (tx) => {
      await severPerson(tx, { deviceId: dev("gone"), reason: "deleted by the person" });
      await gate;
    });

    const closing = closeWeekIfDue(athens("2032-03-08", "09:00"));
    // Wait until the close is queued behind the deletion's lock (a lock wait
    // is visible in pg_locks), so it has certainly read the board already.
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      const r = await db.execute(sql`
        select 1 from pg_locks where locktype = 'advisory' and not granted`);
      waiting = r.rows.length > 0;
      if (!waiting) await new Promise((r2) => setTimeout(r2, 50));
    }
    release(); // always, so a failing run can't leave the deletion open
    await deleting;
    expect(waiting).toBe(true);
    expect(await closing).toBe("closed");

    expect(await results("2032-03-01")).toEqual([
      { place: 2, device_id: dev("stay"), display_name: "WClosestay", points: 25 },
    ]);
    expect(await badgesOf("gone")).toEqual([]);
    expect(await momentsOf("gone")).toHaveLength(0);
    expect(await bellOf("gone")).toHaveLength(0);
    expect(await badgesOf("stay")).toEqual(["podium"]);
  });

  it("a quiet week with one spotter on 15 points still awards champion", async () => {
    // Week of Mon 16 Feb 2032, closed on Mon 23 Feb.
    await profile("solo");
    await ledger("solo", 15, athens("2032-02-18", "10:00"));

    expect(await closeWeekIfDue(athens("2032-02-23", "09:00"))).toBe("closed");
    expect(await results("2032-02-16")).toEqual([
      { place: 1, device_id: dev("solo"), display_name: "WClosesolo", points: 15 },
    ]);
    expect(await badgesOf("solo")).toEqual(["champion", "podium"]);
  });

  it("already-held podium still queues a week_result moment", async () => {
    // Week of Mon 23 Feb 2032, closed on Mon 1 Mar.
    await profile("top");
    await profile("again");
    await db.insert(spotterBadgesTable).values({ deviceId: dev("again"), badgeId: "podium", source: "week" });
    await ledger("top", 50, athens("2032-02-24", "10:00"));
    await ledger("again", 25, athens("2032-02-25", "10:00"));

    expect(await closeWeekIfDue(athens("2032-03-01", "09:00"))).toBe("closed");
    const moments = await momentsOf("again");
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ badgeIds: ["podium"], place: 2, weekPoints: 25 });
    // Earned once: still one Podium row, from before.
    const rows = await db
      .select()
      .from(spotterBadgesTable)
      .where(eq(spotterBadgesTable.deviceId, dev("again")));
    expect(rows).toHaveLength(1);
  });
});

describe("sendWeeklyPushesIfDue", () => {
  it("push goes out at 08:05 Monday Athens, not at 07:55", async () => {
    // Week of Mon 1 Mar 2032, closed early on Mon 8 Mar.
    await profile("gold");
    await profile("silver");
    await profile("bronze");
    await profile("silent"); // placed, but no push token
    await token("gold");
    await token("silver");
    await token("bronze");
    await ledger("gold", 75, athens("2032-03-02", "10:00"));
    await ledger("silver", 50, athens("2032-03-03", "10:00"));
    await ledger("bronze", 40, athens("2032-03-04", "10:00"));
    await ledger("silent", 40, athens("2032-03-05", "10:00"));

    expect(await closeWeekIfDue(athens("2032-03-08", "00:10"))).toBe("closed");
    expect(await sendWeeklyPushesIfDue(athens("2032-03-08", "00:10"))).toBe("outside_window");
    expect(await sendWeeklyPushesIfDue(athens("2032-03-08", "07:55"))).toBe("outside_window");
    expect(sendPushNotificationMock).not.toHaveBeenCalled();

    expect(await sendWeeklyPushesIfDue(athens("2032-03-08", "08:05"))).toBe("sent");
    expect(sendPushNotificationMock).toHaveBeenCalledTimes(3);
    const [gold] = pushesTo("gold");
    expect(gold!.slice(1)).toEqual([
      weekResultText(1).title,
      weekResultText(1).body,
      { type: "weekly_result", weekStart: "2032-03-01" },
    ]);
    expect(pushesTo("silver")[0]![2]).toBe(weekResultText(2).body);
    expect(pushesTo("bronze")[0]![2]).toBe(weekResultText(3).body);

    // Once only.
    expect(await sendWeeklyPushesIfDue(athens("2032-03-08", "09:00"))).toBe("already_sent");
    expect(sendPushNotificationMock).toHaveBeenCalledTimes(3);
  });

  it("a close at 21:00 Monday sends no push", async () => {
    // Week of Mon 8 Mar 2032; the server was down until Mon 15 Mar, 21:00.
    await profile("late");
    await token("late");
    await ledger("late", 25, athens("2032-03-09", "10:00"));

    expect(await closeWeekIfDue(athens("2032-03-15", "21:00"))).toBe("closed");
    expect(await sendWeeklyPushesIfDue(athens("2032-03-15", "21:00"))).toBe("outside_window");
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    // The celebration and the bell entry are still there.
    expect(await momentsOf("late")).toHaveLength(1);
    expect(await bellOf("late")).toHaveLength(1);
  });

  it("a Tuesday run sends no push", async () => {
    // Week of Mon 15 Mar 2032; nothing ran until Tue 23 Mar.
    await profile("tue");
    await token("tue");
    await ledger("tue", 25, athens("2032-03-16", "10:00"));

    expect(await closeWeekIfDue(athens("2032-03-23", "10:00"))).toBe("closed");
    expect(await sendWeeklyPushesIfDue(athens("2032-03-23", "10:00"))).toBe("not_due");
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });
});

describe("the bell", () => {
  it("the bell lists a weekly result without a cat", async () => {
    // Week of Mon 26 Jan 2032, closed on Mon 2 Feb.
    await profile("bell");
    await ledger("bell", 25, athens("2032-01-27", "10:00"));
    expect(await closeWeekIfDue(athens("2032-02-02", "09:00"))).toBe("closed");

    const res = await request(app)
      .get(`/api/notifications/${dev("bell")}`)
      .set("X-Device-Secret", SECRET);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      catId: null,
      catUpdateId: null,
      catName: null,
      catPhotoUrl: null,
      message: weekResultText(1).body,
      read: false,
    });
  });

  it("push and bell text never contain an area name", async () => {
    const names = SEED_AREAS.map((a) => a.name);
    const texts: string[] = [];
    for (const place of [1, 2, 3]) {
      const { title, body } = weekResultText(place);
      texts.push(title, body);
    }
    // And what a real close wrote to the bell. Week of Mon 19 Jan 2032.
    await profile("words1");
    await profile("words2");
    await profile("words3");
    await ledger("words1", 50, athens("2032-01-20", "10:00"));
    await ledger("words2", 40, athens("2032-01-20", "10:00"));
    await ledger("words3", 25, athens("2032-01-20", "10:00"));
    expect(await closeWeekIfDue(athens("2032-01-26", "09:00"))).toBe("closed");
    for (const s of ["words1", "words2", "words3"]) {
      const [row] = await bellOf(s);
      texts.push(row!.message!);
    }
    expect(texts).toHaveLength(9);
    for (const text of texts) {
      for (const name of names) {
        expect(text).not.toMatch(new RegExp(`\\b${name}\\b`, "i"));
      }
    }
  });
});
