/**
 * SYC-221 PR 1 (news-in-your-language.md §3.1): every push is worded in the
 * language the phone registered with. For each sender: a phone registered
 * with `el` is sent Greek, `fr` French, and a phone with no language (an old
 * build) English. The stored in-app words stay English, and staff-typed news
 * is pushed as typed, whatever the phone's language.
 *
 * No wall clock: the round-up runs at a fixed instant in 2033 and the
 * sighting pushes use a photo's age only to pick "fresh" or "three days old".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  catUpdatesTable,
  catSubscriptionsTable,
  deviceCredentialsTable,
  notificationsTable,
  photosTable,
  pushRoundupRunsTable,
  pushTokensTable,
  sightingsTable,
} from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import { deleteTestSightings } from "../test/sightings";
import { nameTag } from "../test/nameTag";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));
const sendPushNotificationMock = vi.hoisted(() =>
  vi.fn(async (_token: string, _title: string, _body: string, _data?: unknown) => {}),
);
vi.mock("../lib/push", () => ({ sendPushNotification: sendPushNotificationMock }));

import app from "../app";
import { insertCatUpdate } from "../lib/notificationFanout";
import { newsText, roundUpWords, weekdayWord, type NewsLanguage, type NewsPush } from "../lib/newsWords";
import { sendDailyRoundUp } from "../lib/sightingRoundUp";

const PREFIX = "vitest-pushlang-";
const NAME_PREFIX = "Vtpushlang";
const SECRET = "vitest-pushlang-secret-0123456789abcd";
const OWNER_SECRET = "vitest-pushlang-owner-secret";
const HOUR = 3_600_000;

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

/** The three phones every sender is checked against. */
const PHONES: { suffix: string; language: string | null; words: NewsLanguage }[] = [
  { suffix: "el", language: "el", words: "el" },
  { suffix: "fr", language: "fr", words: "fr" },
  { suffix: "old", language: null, words: "en" },
];

const tokenOf = (deviceId: string) => `ExponentPushToken[${deviceId}]`;
const device = (s: string) => `${PREFIX}${s}`;
const pushesTo = (deviceId: string) =>
  sendPushNotificationMock.mock.calls.filter((c) => c[0] === tokenOf(deviceId));
const wordsSentTo = (deviceId: string) => pushesTo(deviceId).map((c) => ({ title: c[1], body: c[2] }));

async function insertPhoto(): Promise<number> {
  const [p] = await db.insert(photosTable).values({ data: TINY_JPEG_B64, mime: "image/jpeg" }).returning();
  return p!.id;
}

async function seedCat(owner: string | null = null) {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${nameTag()}`,
      description: "",
      primaryPhotoId: await insertPhoto(),
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: device("discoverer"),
      ownerDeviceId: owner,
    })
    .returning();
  return c!;
}

/** A phone with a push token (and a language) that follows the cat. */
async function follower(deviceId: string, catId: number, language: string | null, followedSince = new Date("2033-01-01T00:00:00Z")) {
  await db
    .insert(pushTokensTable)
    .values({ deviceId, token: tokenOf(deviceId), language })
    .onConflictDoNothing();
  await db.insert(catSubscriptionsTable).values({ deviceId, catId, createdAt: followedSince }).onConflictDoNothing();
}

async function insertSighting(deviceId: string, createdAt: Date, status: "pending" | "resolved" = "pending", catId?: number) {
  const [s] = await db
    .insert(sightingsTable)
    .values({ deviceId, photoId: await insertPhoto(), lat: 37.44, lng: 24.9, status, createdAt, ...(catId ? { catId } : {}) })
    .returning();
  return s!.id;
}

const athensDate = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(at);

const ROUND_UP_NOW = new Date("2033-03-10T19:00:00Z"); // 21:00 in Athens
const ROUND_UP_DATE = "2033-03-10";

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
      await db.delete(notificationsTable).where(
        inArray(
          notificationsTable.catUpdateId,
          updates.map((u) => u.id),
        ),
      );
    }
    await db.delete(catUpdatesTable).where(inArray(catUpdatesTable.catId, catIds));
    await db.delete(catSubscriptionsTable).where(inArray(catSubscriptionsTable.catId, catIds));
  }
  const rows = await db
    .select({ photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${PREFIX}%`));
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  for (const r of rows) await db.delete(photosTable).where(eq(photosTable.id, r.photoId));
  if (catIds.length > 0) {
    await db.delete(catsTable).where(inArray(catsTable.id, catIds));
    for (const c of cats) await db.delete(photosTable).where(eq(photosTable.id, c.photoId));
  }
  await db.delete(catSubscriptionsTable).where(like(catSubscriptionsTable.deviceId, `${PREFIX}%`));
  await db.delete(pushTokensTable).where(like(pushTokensTable.deviceId, `${PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
  await db.delete(pushRoundupRunsTable).where(eq(pushRoundupRunsTable.roundUpDate, ROUND_UP_DATE));
}

beforeAll(async () => {
  process.env["OWNER_SECRET"] = OWNER_SECRET;
  await cleanup();
});
beforeEach(() => sendPushNotificationMock.mockClear());
afterAll(async () => {
  await cleanup();
  delete process.env["OWNER_SECRET"];
  await pool.end();
});

/** Every phone got exactly one push, worded for its language. */
async function expectEachPhoneInItsLanguage(cat: string, push: NewsPush, suffix = "") {
  await vi.waitFor(() => {
    for (const p of PHONES) expect(pushesTo(device(`${cat}-${p.suffix}${suffix}`))).toHaveLength(1);
  });
  for (const p of PHONES) {
    expect(wordsSentTo(device(`${cat}-${p.suffix}${suffix}`))).toEqual([newsText(push, p.words)]);
  }
  // The three languages really are different words.
  expect(newsText(push, "el")).not.toEqual(newsText(push, "en"));
  expect(newsText(push, "fr")).not.toEqual(newsText(push, "en"));
}

describe("owner-driven pushes to a cat's followers", () => {
  it("a claim: 'has a home' in each phone's language", async () => {
    const claimer = device("claimer");
    const cat = await seedCat();
    await insertSighting(claimer, new Date("2033-03-01T10:00:00Z"), "resolved", cat.id);
    for (const p of PHONES) await follower(device(`claim-${p.suffix}`), cat.id, p.language);

    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: claimer, livesOnSyros: true, livesInMyHome: true, homePin: { lat: 37.44, lng: 24.9 }, homeNote: "" });
    expect(res.status).toBe(200);

    await expectEachPhoneInItsLanguage("claim", { kind: "home", name: cat.name });
    expect(wordsSentTo(device("claim-el"))[0]!.title).toBe(`Η γάτα ${cat.name} βρήκε σπίτι!`);
  });

  it("a rename: old and new name, in each phone's language", async () => {
    const owner = device("renamer");
    const cat = await seedCat(owner);
    for (const p of PHONES) await follower(device(`rename-${p.suffix}`), cat.id, p.language);
    const newName = `${NAME_PREFIX}${nameTag()}`;

    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: owner, name: newName });
    expect(res.status).toBe(200);

    await expectEachPhoneInItsLanguage("rename", { kind: "rename", oldName: cat.name, newName });
    expect(wordsSentTo(device("rename-old"))[0]!.title).toBe(`${cat.name} is now ${newName}!`);
  });

  it("changed home details: in each phone's language", async () => {
    const owner = device("detailer");
    const cat = await seedCat(owner);
    for (const p of PHONES) await follower(device(`details-${p.suffix}`), cat.id, p.language);

    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: owner, homeDescription: "A blue door by the harbour" });
    expect(res.status).toBe(200);

    await expectEachPhoneInItsLanguage("details", { kind: "home_details", name: cat.name });
  });
});

describe("the owner's live push for a sighting", () => {
  async function resolveFor(spotter: string, sightingAt: Date, catId: number) {
    const res = await request(app)
      .post(`/api/sightings/${await insertSighting(spotter, sightingAt)}/resolve`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: spotter, catId });
    expect(res.status).toBe(200);
  }

  it("spotted again (a fresh photo), seen on a weekday and seen on a date (older ones), per language", async () => {
    // A fixed "now" (Date only, so timers and the database stay real): no wall clock.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-28T12:00:00Z") });
    try {
    const spotter = device("spotter");
    for (const p of PHONES) {
      const owner = device(`own-${p.suffix}`);
      const cat = await seedCat(owner);
      await follower(owner, cat.id, p.language);
      const threeDaysAgo = new Date(Date.now() - 72 * HOUR);
      const tenDaysAgo = new Date(Date.now() - 240 * HOUR);

      await resolveFor(spotter, new Date(Date.now() - 1 * HOUR), cat.id);
      await resolveFor(spotter, threeDaysAgo, cat.id);
      await resolveFor(spotter, tenDaysAgo, cat.id);

      await vi.waitFor(() => expect(pushesTo(owner)).toHaveLength(3));
      const expected = [
        newsText({ kind: "spotted_again", name: cat.name }, p.words),
        newsText({ kind: "seen_weekday", name: cat.name, day: athensDate(threeDaysAgo) }, p.words),
        newsText({ kind: "seen_date", name: cat.name, day: athensDate(tenDaysAgo) }, p.words),
      ];
      expect(wordsSentTo(owner)).toEqual(expect.arrayContaining(expected));
      if (p.words === "el") {
        expect(wordsSentTo(owner).map((w) => w.body)).toContain(
          `Η γάτα ${cat.name} εντοπίστηκε ${weekdayWord(athensDate(threeDaysAgo), "el")}`,
        );
      }
      // SYC-221 PR 2: each piece of news stores its kind, and the Syros day for "seen on...".
      const labels = await db
        .select({ wording: catUpdatesTable.wording, day: catUpdatesTable.wordingDay })
        .from(catUpdatesTable)
        .where(eq(catUpdatesTable.catId, cat.id));
      expect(labels).toEqual(
        expect.arrayContaining([
          { wording: "spotted_again", day: null },
          { wording: "seen_weekday", day: athensDate(threeDaysAgo) },
          { wording: "seen_date", day: athensDate(tenDaysAgo) },
        ]),
      );
      expect(labels).toHaveLength(3);
      // The words stored for the bell stay English whatever the phone speaks.
      const stored = await db.select({ message: catUpdatesTable.message }).from(catUpdatesTable).where(eq(catUpdatesTable.catId, cat.id));
      expect(stored.map((s) => s.message)).toContain(`${cat.name} was spotted again!`);
    }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the evening round-up", () => {
  it("one cat and two cats, per language", async () => {
    const catA = await seedCat();
    const catB = await seedCat();
    // A was seen first, B later: the round-up names the newest first.
    await insertCatUpdate(db, { cat: catA, updateType: "sighting", message: "x", createdAt: new Date("2033-03-10T08:00:00Z") });
    await insertCatUpdate(db, { cat: catB, updateType: "sighting", message: "x", createdAt: new Date("2033-03-10T09:00:00Z") });
    for (const p of PHONES) {
      await follower(device(`one-${p.suffix}`), catA.id, p.language);
      await follower(device(`two-${p.suffix}`), catA.id, p.language);
      await follower(device(`two-${p.suffix}`), catB.id, p.language);
    }

    const result = await sendDailyRoundUp(ROUND_UP_NOW);
    expect(result.status).toBe("sent");

    for (const p of PHONES) {
      expect(wordsSentTo(device(`one-${p.suffix}`))).toEqual([roundUpWords([catA.name], p.words)]);
      expect(wordsSentTo(device(`two-${p.suffix}`))).toEqual([roundUpWords([catB.name, catA.name], p.words)]);
    }
    expect(wordsSentTo(device("one-el"))[0]!.body).toBe(`Η γάτα ${catA.name} εντοπίστηκε ξανά.`);
    expect(wordsSentTo(device("two-fr"))[0]!.body).toBe(`${catB.name} et ${catA.name} ont été revus.`);
    expect(wordsSentTo(device("two-old"))[0]!.title).toBe("Cats you follow");
  });
});

describe("staff-typed news", () => {
  it("is pushed as typed, to a Greek phone too", async () => {
    const cat = await seedCat();
    await follower(device("staff-el"), cat.id, "el");
    await follower(device("staff-fr"), cat.id, "fr");

    const res = await request(app)
      .post(`/api/cats/${cat.id}/updates`)
      .set("Authorization", `Bearer ${OWNER_SECRET}`)
      .send({ updateType: "general", message: "Seen at the vet today" });
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(pushesTo(device("staff-el"))).toHaveLength(1));
    await vi.waitFor(() => expect(pushesTo(device("staff-fr"))).toHaveLength(1));
    for (const s of ["staff-el", "staff-fr"]) {
      expect(wordsSentTo(device(s))).toEqual([{ title: cat.name, body: "Seen at the vet today" }]);
    }
  });
});
