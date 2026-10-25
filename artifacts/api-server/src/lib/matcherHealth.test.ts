/**
 * SYC-532 / SYC-531: telling the team when the look-alike check fails, and
 * listing the cats named while it was down. Failures are the rows the app
 * already keeps (sighting_matches.matcher_failed); the only new state is the
 * newest matcher_alert row in the mail outbox.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { catsTable, db, mailOutboxTable, photosTable, sightingMatchesTable, sightingsTable } from "@workspace/db";
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
import { claimDue } from "./mail/outbox";

vi.mock("./mail/outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mail/outbox")>()),
  kickRow: vi.fn(),
}));

const DEVICE = "vitest-matcherhealth-device";
const photoIds: number[] = [];
const catIds: number[] = [];
const sightingIds: number[] = [];
let seq = 0;
const min = (m: number) => new Date(Date.now() - m * 60_000);

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
    ...(opts.choice ? { choice: opts.choice, chosenAt: opts.at } : {}),
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
    expect(await recentFailures()).toBe(2);
  });

  it("is 'failing' at the threshold and not below it", async () => {
    await failures(OUTAGE_FAILURES - 1);
    expect((await matcherStatus()).failing).toBe(false);
    await failures(1);
    expect(await matcherStatus()).toEqual({ failing: true, failed: OUTAGE_FAILURES, windowMinutes: OUTAGE_WINDOW_MINUTES });
  });
});

describe("the alert", () => {
  it("sends nothing below the threshold", async () => {
    await failures(OUTAGE_FAILURES - 1);
    expect(await reviewMatcherHealth()).toBe("none");
    expect(await alerts()).toHaveLength(0);
  });

  it("queues one 'failing' email at the threshold, and not another while it stays open", async () => {
    await failures(OUTAGE_FAILURES);
    expect(await reviewMatcherHealth()).toBe("down");
    expect(await reviewMatcherHealth()).toBe("none");
    await failures(3);
    expect(await reviewMatcherHealth()).toBe("none");
    const rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ kind: "down", failed: OUTAGE_FAILURES, windowMinutes: OUTAGE_WINDOW_MINUTES });
  });

  it("does not say 'working again' while failures are still in the window", async () => {
    await failures(OUTAGE_FAILURES);
    await reviewMatcherHealth();
    expect(await reviewMatcherHealth()).toBe("none");
    expect(await alerts()).toHaveLength(1);
  });

  it("queues one 'working again' email once the window is quiet, then can alert again", async () => {
    await failures(OUTAGE_FAILURES);
    await reviewMatcherHealth();
    // The failures age out of the window.
    await db.update(sightingMatchesTable).set({ matchedAt: min(OUTAGE_WINDOW_MINUTES + 5) }).where(inArray(sightingMatchesTable.sightingId, sightingIds));
    expect(await reviewMatcherHealth()).toBe("up");
    expect(await reviewMatcherHealth()).toBe("none");
    expect((await alerts()).map((r) => (r.payload as { kind: string }).kind)).toEqual(["down", "up"]);
    await failures(OUTAGE_FAILURES);
    expect(await reviewMatcherHealth()).toBe("down");
  });

  it("with no recipient set it queues nothing (the banner still shows)", async () => {
    delete process.env["MATCHER_ALERT_TO"];
    await failures(OUTAGE_FAILURES);
    expect(await reviewMatcherHealth()).toBe("none");
    expect(await alerts()).toHaveLength(0);
    expect((await matcherStatus()).failing).toBe(true);
  });

  it("the queued rows are claimable and name no photo, cat, person or position", async () => {
    await failures(OUTAGE_FAILURES);
    await reviewMatcherHealth();
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
    const list = await newCatsAfterFailedCheck();
    expect(list.map((c) => c.catId)).toEqual([failedNew.catId]);
    expect(list[0]!.photoUrl).toMatch(/^\/api\/team\/photos\//);
  });

  it("leaves out choices older than 14 days", async () => {
    await seedSighting({ failed: true, at: new Date(Date.now() - 15 * 86_400_000), choice: "new_cat", cat: true });
    expect(await newCatsAfterFailedCheck()).toEqual([]);
  });
});
