import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app";
import {
  catIdentityTable,
  catSubscriptionsTable,
  catUpdatesTable,
  catsTable,
  db,
  deviceCredentialsTable,
  observationsTable,
  pool,
  pushTokensTable,
  sightingsTable,
} from "@workspace/db";
import { like } from "drizzle-orm";
import { deleteTestSightings } from "../test/sightings";

vi.mock("../lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notifications")>();
  return { ...actual, notifyCatFollowers: vi.fn(actual.notifyCatFollowers) };
});
import { notifyCatFollowers } from "../lib/notifications";

// SYC-410 PR 1.2, spec test 15 for two readers on routes/cats.ts: the care
// timeline (cat_updates by cat) and the first-claim count ("has a home!" goes
// out on a cat's first claim only, and a claim on a cat merged into this one
// counts). Each claim phase uses a fresh pair (a claim can't be repeated).

const PREFIX = "vitest-cats-merge-";
const NAME_PREFIX = "VitestCatsMerge";
const SECRET = "vitest-cats-merge-device-secret";
const notifyMock = vi.mocked(notifyCatFollowers);
const LETTERS = "bcdfghjkmpqrvwxz";
let counter = 0;
const tag = () => {
  counter += 1;
  let n = counter;
  let out = "";
  do {
    out = LETTERS[n % 16] + out;
    n = Math.floor(n / 16);
  } while (n > 0);
  return out;
};

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(pushTokensTable).where(like(pushTokensTable.deviceId, `${PREFIX}%`));
  await db.delete(catSubscriptionsTable).where(like(catSubscriptionsTable.deviceId, `${PREFIX}%`));
  await db.delete(catUpdatesTable).where(like(catUpdatesTable.message, `${NAME_PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});
beforeEach(() => notifyMock.mockClear());

async function cat(label: string) {
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}${label}${tag()}`, description: "", primaryPhotoId: 0, lat: 37.44, lng: 24.9, discovererDeviceId: `${PREFIX}discoverer` })
    .returning();
  return c!;
}

const merge = async (from: number, into: number) =>
  (await db.insert(catIdentityTable).values({ catId: from, canonicalCatId: into, reason: "vitest cats merge" }).returning({ id: catIdentityTable.id }))[0]!.id;
const undo = (mergeId: number, catId: number) =>
  db.insert(catIdentityTable).values({ catId, canonicalCatId: catId, supersedesId: mergeId, reason: "vitest cats merge undo" });

describe("GET /api/cats/:catId: the care timeline", () => {
  it("a care update on Mimi shows on Agatha's page while they are merged, and not before or after", async () => {
    const mimi = await cat("Mimi");
    const agatha = await cat("Agatha");
    await db.insert(catUpdatesTable).values({ catId: mimi.id, updateType: "desexed", message: `${NAME_PREFIX}care` });
    const messages = async () => {
      const res = await request(app).get(`/api/cats/${agatha.id}`);
      expect(res.status).toBe(200);
      return (res.body.careTimeline as { message: string }[]).map((e) => e.message).filter((m) => m.startsWith(NAME_PREFIX));
    };
    expect(await messages()).toEqual([]);
    const m = await merge(mimi.id, agatha.id);
    expect(await messages()).toEqual([`${NAME_PREFIX}care`]);
    await undo(m, mimi.id);
    expect(await messages()).toEqual([]);
  });
});

describe("POST /api/cats/:catId/claim: the first claim of the animal", () => {
  /** A fresh pair where Mimi had an owner once (since removed); Agatha is then claimed. */
  async function claimAgatha(how: "alone" | "merged" | "merged then undone") {
    const mimi = await cat("Mimi");
    const agatha = await cat("Agatha");
    const owner = `${PREFIX}${tag()}owner`;
    const claimer = `${PREFIX}${tag()}claimer`;
    const [homed] = await db
      .insert(observationsTable)
      .values({
        catId: mimi.id,
        kind: "life_status",
        value: { status: "homed" },
        deviceId: owner,
        roleAtTime: "public",
        authorityScope: "owner_of_this_cat",
        observedAt: new Date(Date.now() - 20 * 86_400_000),
        createdAt: new Date(Date.now() - 20 * 86_400_000),
      })
      .returning({ id: observationsTable.id });
    await db.insert(observationsTable).values({
      catId: mimi.id,
      kind: "life_status",
      value: { withdrawn: true },
      accountId: "vitest-cats-merge-staff",
      roleAtTime: "staff",
      supersedesId: homed!.id,
      observedAt: new Date(Date.now() - 19 * 86_400_000),
      createdAt: new Date(Date.now() - 19 * 86_400_000),
    });
    if (how !== "alone") {
      const m = await merge(mimi.id, agatha.id);
      if (how === "merged then undone") await undo(m, mimi.id);
    }
    // The claimer has met Agatha, and follows her.
    await db.insert(sightingsTable).values({ catId: agatha.id, deviceId: claimer, photoId: 0, lat: 37.44, lng: 24.9, status: "resolved" });
    await db.insert(pushTokensTable).values({ deviceId: claimer, token: claimer }).onConflictDoNothing();
    await db.insert(catSubscriptionsTable).values({ deviceId: claimer, catId: agatha.id }).onConflictDoNothing();
    notifyMock.mockClear();
    const res = await request(app)
      .post(`/api/cats/${agatha.id}/claim`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: claimer, livesOnSyros: true, livesInMyHome: true, homePin: { lat: 37.44, lng: 24.9 }, homeNote: "" });
    return { status: res.status, announced: notifyMock.mock.calls.some(([id]) => id === agatha.id) };
  }

  it("announces 'has a home!' when it is the animal's first claim", async () => {
    expect(await claimAgatha("alone")).toEqual({ status: 200, announced: true });
  });

  it("does not announce it again when a cat merged into her had an owner before", async () => {
    expect(await claimAgatha("merged")).toEqual({ status: 200, announced: false });
  });

  it("announces it again once the merge is undone", async () => {
    expect(await claimAgatha("merged then undone")).toEqual({ status: 200, announced: true });
  });
});
