/**
 * data-spine.md PR 9, spec §6.4.4 (Q4 = A): "Agatha was spotted again!"
 * reaches the cat's owner live, and everyone else at most once a day, in an
 * evening round-up whose words never carry a time.
 *
 * The plan's three tests: a non-owner gets no push inside the window; an
 * owner still does; no text contains a time. Plus: the round-up sends once
 * per evening even under parallel drains, and skips deleted devices (no push
 * token, SYC-63) and cats recorded as dead (§3.3).
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
} from "@workspace/db";
import { and, eq, gte, inArray, like, lte } from "drizzle-orm";
import { writeObservation } from "./observations";

const sendPushNotificationMock = vi.hoisted(() =>
  vi.fn(async (_token: string, _title: string, _body: string, _data?: unknown) => {}),
);
vi.mock("./push", () => ({ sendPushNotification: sendPushNotificationMock }));

import { createUpdateAndFanOut, fanOutNotifications, insertCatUpdate } from "./notificationFanout";
import { roundUpText, sendDailyRoundUp } from "./sightingRoundUp";

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

async function seedCat(opts: { owner?: string; name?: string } = {}) {
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

async function follow(deviceId: string, catId: number, token = true) {
  await db.insert(catSubscriptionsTable).values({ deviceId, catId });
  if (token) {
    await db
      .insert(pushTokensTable)
      .values({ deviceId, token: `ExponentPushToken[${deviceId}]` })
      .onConflictDoNothing();
  }
}

/** A sighting of `cat` at `at`, fanned out exactly as resolve does. */
async function sighting(cat: typeof catsTable.$inferSelect, at: Date) {
  const update = await insertCatUpdate(db, {
    cat,
    updateType: "sighting",
    message: `${cat.name} was spotted again!`,
    createdAt: at,
  });
  await fanOutNotifications({ cat, update, excludeDeviceId: `${DEVICE_PREFIX}-spotter` });
}

const tokenOf = (deviceId: string) => `ExponentPushToken[${deviceId}]`;
const pushesTo = (deviceId: string) =>
  sendPushNotificationMock.mock.calls.filter((c) => c[0] === tokenOf(deviceId));

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
beforeEach(() => sendPushNotificationMock.mockClear());
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("live sighting pushes go to the cat's owner only (§6.4.4)", () => {
  it("a non-owner follower gets no live push for a sighting, but keeps the in-app row; the owner gets the push", async () => {
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
    expect(rows.map((r) => r.deviceId).sort()).toEqual([owner, watcher].sort());
  });

  it("a cat with no owner: no follower gets a live sighting push", async () => {
    const a = device("a");
    const b = device("b");
    const cat = await seedCat();
    await follow(a, cat.id);
    await follow(b, cat.id);

    await createUpdateAndFanOut({ cat, updateType: "sighting", message: "x" });
    await settle();

    expect(sendPushNotificationMock).not.toHaveBeenCalled();
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
  });
});

describe("the evening round-up", () => {
  it("nothing before 20:00 Athens time; at 20:30 one push per non-owner naming every cat; never twice", async () => {
    const owner = device("owner");
    const watcher = device("watcher");
    const street = await seedCat({ name: "Agatha" });
    const homed = await seedCat({ name: "Milo", owner });
    await follow(watcher, street.id);
    await follow(watcher, homed.id);
    await follow(owner, homed.id);

    await sighting(street, athens("03-10", "09:15"));
    await sighting(homed, athens("03-10", "18:42"));
    await settle();
    // The owner had their live push about Milo; the watcher had nothing.
    expect(pushesTo(owner)).toHaveLength(1);
    expect(pushesTo(watcher)).toHaveLength(0);
    sendPushNotificationMock.mockClear();

    // Inside the window: still nothing for anyone.
    expect(await sendDailyRoundUp(athens("03-10", "19:59"))).toEqual({ status: "not_due" });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();

    const result = await sendDailyRoundUp(athens("03-10", "20:30"));
    expect(result).toMatchObject({ status: "sent" });

    expect(pushesTo(watcher)).toHaveLength(1);
    const [, title, body, data] = pushesTo(watcher)[0]!;
    expect(body).toContain(homed.name);
    expect(body).toContain(street.name);
    expect(`${title} ${body}`).not.toMatch(TIME_RE);
    expect(data).toEqual({
      type: "sighting_round_up",
      catIds: expect.arrayContaining([street.id, homed.id]),
    });
    // The owner isn't sent their own cat again.
    expect(pushesTo(owner)).toHaveLength(0);

    // Later drains the same evening send nothing more.
    sendPushNotificationMock.mockClear();
    expect(await sendDailyRoundUp(athens("03-10", "21:00"))).toEqual({ status: "already_sent" });
    expect(await sendDailyRoundUp(athens("03-10", "23:50"))).toEqual({ status: "already_sent" });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("parallel drains send each evening's round-up exactly once", async () => {
    const watcher = device("watcher");
    const cat = await seedCat();
    await follow(watcher, cat.id);
    await sighting(cat, athens("03-14", "10:00"));
    await settle();

    const results = await Promise.all(
      [0, 1, 2, 3].map(() => sendDailyRoundUp(athens("03-14", "20:05"))),
    );
    expect(results.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already_sent")).toHaveLength(3);
    expect(pushesTo(watcher)).toHaveLength(1);
  });

  it("a deleted device (no push token, SYC-63) and a cat recorded as dead get nothing", async () => {
    const gone = device("deleted");
    const watcher = device("watcher");
    const alive = await seedCat({ name: "Agatha" });
    const dead = await seedCat({ name: "Bramble" });
    await follow(gone, alive.id, false);
    await follow(watcher, alive.id);
    await follow(watcher, dead.id);
    await sighting(alive, athens("03-18", "08:00"));
    await sighting(dead, athens("03-18", "08:30"));
    await writeObservation(db, {
      catId: dead.id,
      kind: "life_status",
      value: { status: "deceased" },
      accountId: "staff-vitest-roundup",
      roleAtTime: "staff",
      observedAt: new Date(),
    });

    await sendDailyRoundUp(athens("03-18", "20:10"));

    expect(sendPushNotificationMock.mock.calls.every((c) => !String(c[0]).includes(gone))).toBe(true);
    expect(pushesTo(watcher)).toHaveLength(1);
    const body = pushesTo(watcher)[0]![2];
    expect(body).toContain(alive.name);
    expect(body).not.toContain(dead.name);
  });

  it("a sighting from an earlier evening's window is not repeated", async () => {
    const watcher = device("watcher");
    const cat = await seedCat();
    await follow(watcher, cat.id);
    await sighting(cat, athens("03-22", "11:00"));
    await sendDailyRoundUp(athens("03-22", "20:00"));
    expect(pushesTo(watcher)).toHaveLength(1);

    sendPushNotificationMock.mockClear();
    const next = await sendDailyRoundUp(athens("03-23", "20:00"));
    expect(next).toEqual({ status: "sent", devices: 0, pushes: 0 });
    expect(pushesTo(watcher)).toHaveLength(0);
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
