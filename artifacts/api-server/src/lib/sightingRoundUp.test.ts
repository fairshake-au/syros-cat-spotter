/**
 * data-spine.md PR 9, spec §6.4.4 (Q4 = A): news of a sighting reaches the
 * cat's owner live, and everyone else at most once a day, in an evening
 * round-up (in-app row and push together) whose words never carry a time.
 *
 * The plan's three tests: a non-owner gets nothing inside the window; an
 * owner still does; no text contains a time. Plus the review of #89: once
 * per evening under parallel triggers, a failed run leaves the evening
 * unclaimed, the window's upper edge, the spotter and later followers left
 * out, deleted devices and dead cats skipped, and the request trigger.
 *
 * Round-up dates are in 2031 so they never meet a real evening's claim row.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  pool,
  catsTable,
  photosTable,
  pushTokensTable,
  catSubscriptionsTable,
  catUpdatesTable,
  notificationsTable,
  pushRoundupRunsTable,
  sightingsTable,
} from "@workspace/db";
import { and, eq, gte, inArray, like, lte } from "drizzle-orm";
import { writeObservation } from "./observations";

const sendPushNotificationMock = vi.hoisted(() =>
  vi.fn(async (_token: string, _title: string, _body: string, _data?: unknown) => {}),
);
vi.mock("./push", () => ({ sendPushNotification: sendPushNotificationMock }));

// The real deceased check, wrapped so one test can make the run fail midway.
const deceasedSpy = vi.hoisted(() => ({ failNext: false }));
vi.mock("./catHelpers", async (importOriginal) => {
  const real = await importOriginal<typeof import("./catHelpers")>();
  return {
    ...real,
    isResolvedDeceased: async (catId: number) => {
      if (deceasedSpy.failNext) {
        deceasedSpy.failNext = false;
        throw new Error("database went away");
      }
      return real.isResolvedDeceased(catId);
    },
  };
});

import { createUpdateAndFanOut, fanOutNotifications, insertCatUpdate } from "./notificationFanout";
import { opportunisticRoundUp, roundUpText, sendDailyRoundUp } from "./sightingRoundUp";

const NAME_PREFIX = "VitestRoundUp";
const DEVICE_PREFIX = "vitest-roundup";
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

/**
 * Anything that reads as a time of day or an elapsed time: "18:42", "6.15",
 * "7pm", "at 7", "5 minutes ago", "an hour", "o'clock".
 */
const TIME_RE =
  /\b\d{1,2}[:.h]\d{2}\b|\b\d{1,2}\s*(am|pm)\b|\bat \d|\bago\b|\b(second|minute|hour)s?\b|o'clock/i;

const letters = () =>
  Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const device = (role: string) => `${DEVICE_PREFIX}-${role}-${letters()}`;

type Cat = typeof catsTable.$inferSelect;

async function seedCat(opts: { owner?: string; name?: string } = {}): Promise<Cat> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX} ${opts.name ?? "Agatha"} ${letters()}`,
      description: "",
      primaryPhotoId: p!.id,
      lat: 37.4448,
      lng: 24.9425,
      discovererDeviceId: `${DEVICE_PREFIX}-seed`,
      ownerDeviceId: opts.owner ?? null,
    })
    .returning();
  return c!;
}

const tokenOf = (deviceId: string) => `ExponentPushToken[${deviceId}]`;

/** Follow a cat from `since` (default: long before any 2031 sighting). */
async function follow(
  deviceId: string,
  catId: number,
  opts: { token?: boolean; since?: Date } = {},
) {
  await db.insert(catSubscriptionsTable).values({
    deviceId,
    catId,
    createdAt: opts.since ?? new Date("2030-01-01T00:00:00Z"),
  });
  if (opts.token ?? true) {
    await db
      .insert(pushTokensTable)
      .values({ deviceId, token: tokenOf(deviceId) })
      .onConflictDoNothing();
  }
}

/** A sighting of `cat` at `at`, fanned out exactly as resolve does. */
async function sighting(cat: Cat, at: Date, spotter = `${DEVICE_PREFIX}-spotter`) {
  const [s] = await db
    .insert(sightingsTable)
    .values({
      deviceId: spotter,
      photoId: cat.primaryPhotoId,
      catId: cat.id,
      lat: 37.4448,
      lng: 24.9425,
      status: "resolved",
    })
    .returning();
  const update = await insertCatUpdate(db, {
    cat,
    updateType: "sighting",
    message: `${cat.name} was spotted again!`,
    triggerSightingId: s!.id,
    createdAt: at,
  });
  await fanOutNotifications({ cat, update, excludeDeviceId: spotter });
  return update;
}

const pushesTo = (deviceId: string) =>
  sendPushNotificationMock.mock.calls.filter((c) => c[0] === tokenOf(deviceId));
const inAppRows = (deviceId: string) =>
  db
    .select({ catUpdateId: notificationsTable.catUpdateId })
    .from(notificationsTable)
    .where(eq(notificationsTable.deviceId, deviceId));

/** Lets the fan-out's fire-and-forget token lookup finish. */
const settle = () => new Promise((r) => setTimeout(r, 150));

async function cleanup() {
  const cats = await db
    .select({ id: catsTable.id, photoId: catsTable.primaryPhotoId })
    .from(catsTable)
    .where(like(catsTable.name, `${NAME_PREFIX}%`));
  const catIds = cats.map((c) => c.id);
  if (catIds.length > 0) {
    const updates = await db
      .select({ id: catUpdatesTable.id })
      .from(catUpdatesTable)
      .where(inArray(catUpdatesTable.catId, catIds));
    if (updates.length > 0) {
      await db
        .delete(notificationsTable)
        .where(inArray(notificationsTable.catUpdateId, updates.map((u) => u.id)));
    }
    await db.delete(catUpdatesTable).where(inArray(catUpdatesTable.catId, catIds));
    await db.delete(catSubscriptionsTable).where(inArray(catSubscriptionsTable.catId, catIds));
    await db.delete(sightingsTable).where(inArray(sightingsTable.catId, catIds));
    await db.delete(catsTable).where(inArray(catsTable.id, catIds));
    await db.delete(photosTable).where(inArray(photosTable.id, cats.map((c) => c.photoId)));
  }
  await db.delete(pushTokensTable).where(like(pushTokensTable.deviceId, `${DEVICE_PREFIX}%`));
  await db
    .delete(pushRoundupRunsTable)
    .where(
      and(
        gte(pushRoundupRunsTable.roundUpDate, "2031-01-01"),
        lte(pushRoundupRunsTable.roundUpDate, "2031-12-31"),
      ),
    );
}

/** `hh:mm` Athens time on a 2031 date (UTC+2 before the end of March). */
const athens = (day: string, hhmm: string) => new Date(`2031-${day}T${hhmm}:00+02:00`);

beforeAll(cleanup);
beforeEach(() => {
  sendPushNotificationMock.mockClear();
  deceasedSpy.failNext = false;
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("a sighting reaches only the cat's owner straight away (§6.4.4)", () => {
  it("a non-owner follower gets no push and no in-app row; the owner gets both", async () => {
    const owner = device("owner");
    const watcher = device("watcher");
    const cat = await seedCat({ owner });
    await follow(owner, cat.id);
    await follow(watcher, cat.id);

    const update = await createUpdateAndFanOut({
      cat,
      updateType: "sighting",
      message: `${cat.name} was spotted again!`,
      excludeDeviceId: `${DEVICE_PREFIX}-spotter`,
    });
    await settle();

    expect(pushesTo(owner)).toHaveLength(1);
    expect(pushesTo(owner)[0]![2]).toBe(`${cat.name} was spotted again!`);
    expect(pushesTo(watcher)).toHaveLength(0);

    const rows = await db
      .select({ deviceId: notificationsTable.deviceId })
      .from(notificationsTable)
      .where(eq(notificationsTable.catUpdateId, update.id));
    expect(rows.map((r) => r.deviceId)).toEqual([owner]);
  });

  it("a cat with no owner: no follower hears anything straight away", async () => {
    const a = device("a");
    const b = device("b");
    const cat = await seedCat();
    await follow(a, cat.id);
    await follow(b, cat.id);

    await createUpdateAndFanOut({ cat, updateType: "sighting", message: "x" });
    await settle();

    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(await inAppRows(a)).toHaveLength(0);
    expect(await inAppRows(b)).toHaveLength(0);
  });

  it("care updates (not sightings) still reach every follower live", async () => {
    const owner = device("owner");
    const watcher = device("watcher");
    const cat = await seedCat({ owner });
    await follow(owner, cat.id);
    await follow(watcher, cat.id);

    await createUpdateAndFanOut({ cat, updateType: "desexed", message: "sterilised" });
    await settle();

    expect(pushesTo(owner)).toHaveLength(1);
    expect(pushesTo(watcher)).toHaveLength(1);
    expect(await inAppRows(watcher)).toHaveLength(1);
  });
});

describe("the evening round-up", () => {
  it("nothing before 20:00 Athens time; at 20:30 one push and the in-app rows per non-owner; never twice", async () => {
    const owner = device("owner");
    const watcher = device("watcher");
    const street = await seedCat({ name: "Agatha" });
    const homed = await seedCat({ name: "Milo", owner });
    await follow(watcher, street.id);
    await follow(watcher, homed.id);
    await follow(owner, homed.id);

    await sighting(street, athens("03-10", "09:15"));
    const milo1 = await sighting(homed, athens("03-10", "11:00"));
    const milo2 = await sighting(homed, athens("03-10", "18:42"));
    await settle();
    // The owner heard about Milo twice, live; the watcher heard nothing.
    expect(pushesTo(owner)).toHaveLength(2);
    expect(pushesTo(watcher)).toHaveLength(0);
    expect(await inAppRows(watcher)).toHaveLength(0);
    sendPushNotificationMock.mockClear();

    // Inside the window: still nothing for anyone.
    expect(await sendDailyRoundUp(athens("03-10", "19:59"))).toEqual({ status: "not_due" });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(await inAppRows(watcher)).toHaveLength(0);

    const result = await sendDailyRoundUp(athens("03-10", "20:30"));
    expect(result).toMatchObject({ status: "sent", devices: 1, pushes: 1 });

    expect(pushesTo(watcher)).toHaveLength(1);
    const [, title, body, data] = pushesTo(watcher)[0]!;
    // Most recently seen first.
    expect(body).toBe(`${homed.name} and ${street.name} were spotted again.`);
    expect(`${title} ${body}`).not.toMatch(TIME_RE);
    expect(data).toEqual({ type: "sighting_round_up", catIds: [homed.id, street.id] });

    // One in-app row per cat (Milo's latest sighting, not both), written now.
    const rows = (await inAppRows(watcher)).map((r) => r.catUpdateId);
    expect(rows).toHaveLength(2);
    expect(rows).toContain(milo2.id);
    expect(rows).not.toContain(milo1.id);

    // The owner isn't sent their own cat again.
    expect(pushesTo(owner)).toHaveLength(0);

    // Later triggers the same evening send nothing more.
    sendPushNotificationMock.mockClear();
    expect(await sendDailyRoundUp(athens("03-10", "21:00"))).toEqual({ status: "already_sent" });
    expect(await sendDailyRoundUp(athens("03-10", "23:50"))).toEqual({ status: "already_sent" });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(await inAppRows(watcher)).toHaveLength(2);
  });

  it("parallel triggers send each evening's round-up exactly once", async () => {
    const watcher = device("watcher");
    const cat = await seedCat();
    await follow(watcher, cat.id);
    await sighting(cat, athens("03-14", "10:00"));

    const results = await Promise.all(
      [0, 1, 2, 3].map(() => sendDailyRoundUp(athens("03-14", "20:05"))),
    );
    expect(results.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already_sent")).toHaveLength(3);
    expect(pushesTo(watcher)).toHaveLength(1);
    expect(await inAppRows(watcher)).toHaveLength(1);
  });

  it("a run that fails midway leaves the evening unclaimed, and the next trigger sends it", async () => {
    const watcher = device("watcher");
    const cat = await seedCat();
    await follow(watcher, cat.id);
    await sighting(cat, athens("03-16", "10:00"));

    deceasedSpy.failNext = true;
    await expect(sendDailyRoundUp(athens("03-16", "20:05"))).rejects.toThrow("database went away");
    expect(pushesTo(watcher)).toHaveLength(0);
    expect(await inAppRows(watcher)).toHaveLength(0);

    expect(await sendDailyRoundUp(athens("03-16", "20:15"))).toMatchObject({ status: "sent" });
    expect(pushesTo(watcher)).toHaveLength(1);
    expect(await inAppRows(watcher)).toHaveLength(1);
  });

  it("deleted devices, the spotter themself, later followers and dead cats get nothing; no token still gets the in-app row", async () => {
    const deleted = device("deleted");
    const spotter = device("spotter");
    const latecomer = device("late");
    const noToken = device("notoken");
    const watcher = device("watcher");
    const alive = await seedCat({ name: "Agatha" });
    const dead = await seedCat({ name: "Bramble" });
    await follow(deleted, alive.id);
    await follow(spotter, alive.id);
    await follow(latecomer, alive.id, { since: athens("03-18", "12:00") });
    await follow(noToken, alive.id, { token: false });
    await follow(watcher, alive.id);
    await follow(watcher, dead.id);
    await sighting(alive, athens("03-18", "08:00"), spotter);
    await sighting(dead, athens("03-18", "08:30"));
    await writeObservation(db, {
      catId: dead.id,
      kind: "life_status",
      value: { status: "deceased" },
      accountId: "staff-vitest-roundup",
      roleAtTime: "staff",
      observedAt: new Date(),
    });
    // SYC-63's deletion removes the follow and the push token.
    await db.delete(catSubscriptionsTable).where(eq(catSubscriptionsTable.deviceId, deleted));
    await db.delete(pushTokensTable).where(eq(pushTokensTable.deviceId, deleted));

    await sendDailyRoundUp(athens("03-18", "20:10"));

    for (const d of [deleted, spotter, latecomer]) {
      expect(pushesTo(d)).toHaveLength(0);
      expect(await inAppRows(d)).toHaveLength(0);
    }
    expect(await inAppRows(noToken)).toHaveLength(1);
    expect(pushesTo(watcher)).toHaveLength(1);
    expect(pushesTo(watcher)[0]![2]).toBe(`${alive.name} was spotted again.`);
    expect(await inAppRows(watcher)).toHaveLength(1);
  });

  it("a sighting after tonight's round-up waits for tomorrow's; one already sent isn't repeated", async () => {
    const watcher = device("watcher");
    const cat = await seedCat();
    await follow(watcher, cat.id);
    await sighting(cat, athens("03-22", "11:00"));
    await sighting(cat, athens("03-22", "21:30"));
    await sendDailyRoundUp(athens("03-22", "20:00"));
    expect(pushesTo(watcher)).toHaveLength(1);
    expect(await inAppRows(watcher)).toHaveLength(1);

    sendPushNotificationMock.mockClear();
    expect(await sendDailyRoundUp(athens("03-23", "20:00"))).toEqual({
      status: "sent",
      devices: 1,
      pushes: 1,
    });
    expect(pushesTo(watcher)).toHaveLength(1);
    expect(await inAppRows(watcher)).toHaveLength(2);

    sendPushNotificationMock.mockClear();
    expect(await sendDailyRoundUp(athens("03-24", "20:00"))).toEqual({
      status: "sent",
      devices: 0,
      pushes: 0,
    });
  });

  it("any API request in the evening triggers it (the schedule can't be relied on)", async () => {
    const watcher = device("watcher");
    const cat = await seedCat();
    await follow(watcher, cat.id);
    await sighting(cat, athens("03-26", "10:00"));

    const saved = process.env["ROUND_UP_ON_REQUEST"];
    process.env["ROUND_UP_ON_REQUEST"] = "on";
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const finishAt = (at: Date) => {
        vi.setSystemTime(at);
        let onFinish: () => void = () => {};
        opportunisticRoundUp(null, { on: (_e, cb) => (onFinish = cb) }, () => {});
        onFinish();
      };
      finishAt(athens("03-26", "18:00"));
      await new Promise((r) => setTimeout(r, 200));
      expect(pushesTo(watcher)).toHaveLength(0);

      finishAt(athens("03-26", "20:40"));
      await vi.waitFor(async () => expect(await inAppRows(watcher)).toHaveLength(1));
      await vi.waitFor(() => expect(pushesTo(watcher)).toHaveLength(1));
    } finally {
      vi.useRealTimers();
      if (saved === undefined) delete process.env["ROUND_UP_ON_REQUEST"];
      else process.env["ROUND_UP_ON_REQUEST"] = saved;
    }
  });
});

describe("no round-up text contains a time", () => {
  const cases: string[][] = [
    ["Agatha"],
    ["Agatha", "Milo"],
    ["Agatha", "Milo", "Bramble"],
    ["Agatha", "Milo", "Bramble", "Fig", "Olive", "Pip", "Sesame", "Toast", "Kafes", "Loukoumi", "Mavros", "Zorba"],
  ];
  it.each(cases)("for %s", (...names) => {
    const { title, body } = roundUpText(names);
    expect(`${title} ${body}`).not.toMatch(TIME_RE);
    expect(body).toContain(names[0]);
  });

  it("the pattern catches the times it must (guards the guard)", () => {
    for (const s of ["seen at 18:42", "at 7", "6.15", "7pm", "5 minutes ago", "an hour", "8 o'clock", "18h30"]) {
      expect(s).toMatch(TIME_RE);
    }
  });
});
