/**
 * SYC-532 / SYC-531: telling the team when the look-alike check fails, and
 * listing the cats named while it was down. Failures are the rows the app
 * already keeps (sighting_matches.matcher_failed); the only new state is the
 * newest matcher_alert row in the mail outbox.
 */
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { catsTable, db, profilesTable, mailOutboxTable, photosTable, sightingMatchesTable, sightingsTable } from "@workspace/db";
import { deleteTestSightings } from "../test/sightings";
import {
  matcherStatus,
  newCatsAfterFailedCheck,
  OUTAGE_FAILURES,
  OUTAGE_WINDOW_MINUTES,
  recentFailures,
  reviewMatcherHealth,
} from "./matcherHealth";
import { buildMatcherDown, buildMatcherUp } from "./matcherAlertEmail";
import { claimDue, drainDue } from "./mail/outbox";
import { blurPosition } from "./blur";
import app from "../app";

const { matchCatPhoto } = vi.hoisted(() => ({ matchCatPhoto: vi.fn() }));
vi.mock("./matching", () => ({ matchCatPhoto }));
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("./mail/outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mail/outbox")>()),
  kickRow: vi.fn(),
}));

const DEVICE = "vitest-matcherhealth-device";
const photoIds: number[] = [];
const catIds: number[] = [];
const sightingIds: number[] = [];
let seq = 0;
// A clock far in the future: other test files leave failed checks at real
// time in the shared database, and rows after the window's end never count.
const NOW = new Date(Date.now() + 400 * 86_400_000);
const min = (m: number) => new Date(NOW.getTime() - m * 60_000);

async function seedSighting(opts: { failed: boolean; at: Date; choice?: "new_cat"; cat?: boolean }) {
  const [p] = await db.insert(photosTable).values({ data: "", mime: "image/jpeg" }).returning({ id: photosTable.id });
  photoIds.push(p!.id);
  let catId: number | null = null;
  if (opts.cat) {
    const [c] = await db
      .insert(catsTable)
      .values({ name: `VitestMatcherHealthCat${++seq}x`, primaryPhotoId: p!.id, lat: 37.3, lng: 25.9, discovererDeviceId: DEVICE })
      .returning({ id: catsTable.id });
    catId = c!.id;
    catIds.push(catId);
  }
  const [s] = await db
    .insert(sightingsTable)
    .values({ deviceId: DEVICE, photoId: p!.id, lat: 37.3, lng: 25.9, catId, status: catId ? "resolved" : "pending" })
    .returning({ id: sightingsTable.id });
  sightingIds.push(s!.id);
  await db.insert(sightingMatchesTable).values({
    sightingId: s!.id,
    matcherFailed: opts.failed,
    matchedAt: opts.at,
    // As resolve records it: the cat the spotter made is the chosen cat.
    ...(opts.choice ? { choice: opts.choice, chosenAt: opts.at, chosenCatId: catId } : {}),
  });
  return { sightingId: s!.id, catId };
}

const failures = (n: number, at = min(1)) => Promise.all(Array.from({ length: n }, () => seedSighting({ failed: true, at })));
const alerts = () => db.select().from(mailOutboxTable).where(eq(mailOutboxTable.purpose, "matcher_alert"));

async function cleanup() {
  await db.delete(mailOutboxTable).where(eq(mailOutboxTable.purpose, "matcher_alert"));
  if (sightingIds.length) {
    await db.delete(sightingMatchesTable).where(inArray(sightingMatchesTable.sightingId, sightingIds));
    await deleteTestSightings(inArray(sightingsTable.id, sightingIds));
  }
  if (catIds.length) await db.delete(catsTable).where(inArray(catsTable.id, catIds));
  if (photoIds.length) await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  sightingIds.length = catIds.length = photoIds.length = 0;
}

const saved = process.env["MATCHER_ALERT_TO"];
beforeAll(cleanup);
beforeEach(async () => {
  await cleanup();
  process.env["MATCHER_ALERT_TO"] = "samuel@example.org";
});
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  if (saved === undefined) delete process.env["MATCHER_ALERT_TO"];
  else process.env["MATCHER_ALERT_TO"] = saved;
});

describe("counting failures", () => {
  it("counts only failed checks inside the window", async () => {
    await failures(2, min(1));
    await seedSighting({ failed: true, at: min(OUTAGE_WINDOW_MINUTES + 5) });
    await seedSighting({ failed: false, at: min(1) });
    expect(await recentFailures(NOW)).toBe(2);
  });

  it("is 'failing' at the threshold and not below it", async () => {
    await failures(OUTAGE_FAILURES - 1);
    expect((await matcherStatus(NOW)).failing).toBe(false);
    await failures(1);
    expect(await matcherStatus(NOW)).toEqual({ failing: true, failed: OUTAGE_FAILURES, windowMinutes: OUTAGE_WINDOW_MINUTES });
  });
});

describe("the alert", () => {
  it("sends nothing below the threshold", async () => {
    await failures(OUTAGE_FAILURES - 1);
    expect(await reviewMatcherHealth(NOW)).toBe("none");
    expect(await alerts()).toHaveLength(0);
  });

  it("queues one 'failing' email at the threshold, and not another while it stays open", async () => {
    await failures(OUTAGE_FAILURES);
    expect(await reviewMatcherHealth(NOW)).toBe("down");
    expect(await reviewMatcherHealth(NOW)).toBe("none");
    await failures(3);
    expect(await reviewMatcherHealth(NOW)).toBe("none");
    const rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ kind: "down", failed: OUTAGE_FAILURES, windowMinutes: OUTAGE_WINDOW_MINUTES });
  });

  it("does not say 'working again' while failures are still in the window", async () => {
    await failures(OUTAGE_FAILURES);
    await reviewMatcherHealth(NOW);
    expect(await reviewMatcherHealth(NOW)).toBe("none");
    expect(await alerts()).toHaveLength(1);
  });

  it("queues one 'working again' email once the window is quiet, then can alert again", async () => {
    await failures(OUTAGE_FAILURES);
    await reviewMatcherHealth(NOW);
    // The failures age out of the window.
    await db.update(sightingMatchesTable).set({ matchedAt: min(OUTAGE_WINDOW_MINUTES + 5) }).where(inArray(sightingMatchesTable.sightingId, sightingIds));
    expect(await reviewMatcherHealth(NOW)).toBe("up");
    expect(await reviewMatcherHealth(NOW)).toBe("none");
    expect((await alerts()).map((r) => (r.payload as { kind: string }).kind)).toEqual(["down", "up"]);
    await failures(OUTAGE_FAILURES);
    expect(await reviewMatcherHealth(NOW)).toBe("down");
  });

  it("doesn't say 'working again' within 15 minutes of the alert, even with no failures counted", async () => {
    const [down] = await db
      .insert(mailOutboxTable)
      .values({ purpose: "matcher_alert", recipientHash: "x", payload: { kind: "down" }, state: "sent", createdAt: min(5) })
      .returning({ id: mailOutboxTable.id });
    expect(await reviewMatcherHealth(NOW)).toBe("none");
    await db.update(mailOutboxTable).set({ createdAt: min(20) }).where(eq(mailOutboxTable.id, down!.id));
    expect(await reviewMatcherHealth(NOW)).toBe("up");
  });

  it("a queued alert older than an hour is given up, never sent late", async () => {
    const [row] = await db
      .insert(mailOutboxTable)
      .values({ purpose: "matcher_alert", recipientHash: "x", payload: { kind: "down", failed: 5, windowMinutes: 15 }, createdAt: new Date(Date.now() - 2 * 3_600_000) })
      .returning({ id: mailOutboxTable.id });
    await drainDue(25, row!.id);
    const [after] = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.id, row!.id));
    expect(after).toMatchObject({ state: "failed", lastError: "stale" });
  });

  it("closes with a few stray failures left, once the alert is a window old", async () => {
    await db.insert(mailOutboxTable).values({ purpose: "matcher_alert", recipientHash: "x", payload: { kind: "down" }, state: "sent", createdAt: min(20) });
    await failures(OUTAGE_FAILURES - 1);
    expect(await reviewMatcherHealth(NOW)).toBe("up");
  });

  it("a 'failing' email that was given up on isn't an open alert, and is retried at most hourly", async () => {
    await db.insert(mailOutboxTable).values({ purpose: "matcher_alert", recipientHash: "x", payload: { kind: "down" }, state: "failed", createdAt: min(20) });
    await failures(OUTAGE_FAILURES);
    // Closed (nothing was sent), no "working again" for it, and no new one within the hour of the last.
    expect(await reviewMatcherHealth(NOW)).toBe("none");
    await db.update(mailOutboxTable).set({ createdAt: min(90) }).where(eq(mailOutboxTable.purpose, "matcher_alert"));
    expect(await reviewMatcherHealth(NOW)).toBe("down");
  });

  it("with no recipient set it queues nothing (the banner still shows)", async () => {
    delete process.env["MATCHER_ALERT_TO"];
    await failures(OUTAGE_FAILURES);
    expect(await reviewMatcherHealth(NOW)).toBe("none");
    expect(await alerts()).toHaveLength(0);
    expect((await matcherStatus(NOW)).failing).toBe(true);
  });

  it("the queued rows are claimable and name no photo, cat, person or position", async () => {
    await failures(OUTAGE_FAILURES);
    await reviewMatcherHealth(NOW);
    const claimed = await claimDue(5);
    expect(claimed.map((r) => r.purpose)).toContain("matcher_alert");
    const row = (await alerts())[0]!;
    expect(JSON.stringify(row.payload)).not.toMatch(/photo|cat|device|lat|lng/i);
    const down = buildMatcherDown(5, 15);
    expect(down.text + down.html).not.toMatch(/lat|lng|device/i);
    expect(down.subject).toBe("Look-alike check is failing");
    expect(buildMatcherUp().subject).toBe("Look-alike check is working again");
  });
});

describe("new cats to check (SYC-531)", () => {
  it("lists a cat named new after a failed check, and no other", async () => {
    const failedNew = await seedSighting({ failed: true, at: min(10), choice: "new_cat", cat: true });
    await seedSighting({ failed: false, at: min(10), choice: "new_cat", cat: true });
    await seedSighting({ failed: true, at: min(10), cat: true });
    const list = await newCatsAfterFailedCheck(NOW);
    expect(list.map((c) => c.catId)).toEqual([failedNew.catId]);
    expect(list[0]!.photoUrl).toMatch(/^\/api\/team\/photos\//);
  });

  it("leaves out choices older than 14 days", async () => {
    await seedSighting({ failed: true, at: new Date(NOW.getTime() - 15 * 86_400_000), choice: "new_cat", cat: true });
    expect(await newCatsAfterFailedCheck(NOW)).toEqual([]);
  });
});

// SYC-532 through the real route. In this file (not its own) so the two never
// share the outbox at the same moment: the alert state is one newest row.
describe("failed checks on POST /api/sightings reach the team", () => {
  const SECRET = "vitest-matcherhealth-secret-0123456789ab";
  const JPEG =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
  let n = 0;
  const send = () => {
    const at = blurPosition(37.2, 25.9 + ++n * 0.06);
    return request(app)
      .post("/api/sightings")
      .set("X-Device-Secret", SECRET)
      .send({
        deviceId: `vitest-matcherhealth-route-${n}`,
        lat: at.lat,
        lng: at.lng,
        photoBase64: JPEG,
        capturedAt: new Date(Date.now() - 300_000 + n * 1000).toISOString(),
      });
  };
  afterEach(async () => {
    const rows = await db
      .select({ id: sightingsTable.id, photoId: sightingsTable.photoId })
      .from(sightingsTable)
      .where(like(sightingsTable.deviceId, "vitest-matcherhealth-route-%"));
    if (rows.length) await db.delete(sightingMatchesTable).where(inArray(sightingMatchesTable.sightingId, rows.map((r) => r.id)));
    await deleteTestSightings(like(sightingsTable.deviceId, "vitest-matcherhealth-route-%"));
    if (rows.length) await db.delete(photosTable).where(inArray(photosTable.id, rows.map((r) => r.photoId)));
    await db.delete(profilesTable).where(like(profilesTable.deviceId, "vitest-matcherhealth-route-%"));
  });

  it("the fifth failure queues one email; the spotter still gets the plain 'failed' answer", async () => {
    matchCatPhoto.mockReset();
    matchCatPhoto.mockRejectedValue(new Error("Connection error."));
    for (let i = 1; i < OUTAGE_FAILURES; i++) {
      expect((await send()).body).toMatchObject({ matchCheck: "failed", canRecheck: true });
    }
    const fifth = await send();
    expect(fifth.status).toBe(201);
    expect(fifth.body).toMatchObject({ matchCheck: "failed", candidates: [] });
    expect(await alerts()).toHaveLength(1);
    await send();
    expect(await alerts()).toHaveLength(1);
  });
});
