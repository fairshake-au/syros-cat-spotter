import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool, catsTable, sightingsTable } from "@workspace/db";
import { like } from "drizzle-orm";

// Wrap the notifications module so tests can observe fan-out:
// notifyCatSpotters keeps its real implementation (spotter lookup + actor
// exclusion) but is spied on so we can assert it was invoked correctly.
// The actual delivery goes through the notifyDevices console-log stub, which
// we observe via a console.log spy (the internal call can't be mocked because
// it's a module-local binding).
vi.mock("../lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notifications")>();
  return {
    ...actual,
    notifyCatSpotters: vi.fn(actual.notifyCatSpotters),
  };
});

import { notifyCatSpotters } from "../lib/notifications";
import app from "../app";

const notifyCatSpottersMock = vi.mocked(notifyCatSpotters);
const consoleSpy = vi.spyOn(console, "log");

/** Device-id lists logged by the notifyDevices stub since the last mockClear. */
function dispatchedDeviceLists(): string[][] {
  return consoleSpy.mock.calls
    .filter(
      (args) =>
        typeof args[0] === "string" &&
        args[0].startsWith("[notifications] dispatch") &&
        args[1] &&
        Array.isArray((args[1] as { deviceIds?: unknown }).deviceIds),
    )
    .map((args) => (args[1] as { deviceIds: string[] }).deviceIds);
}

// All fixtures share these prefixes so cleanup can never touch real data.
const PREFIX = "vitest-claim-";
const NAME_PREFIX = "VitestClaimCat";

const device = (suffix: string) => `${PREFIX}${suffix}`;
const catName = (suffix: string) => `${NAME_PREFIX}${suffix}`;

async function cleanup() {
  await db.delete(sightingsTable).where(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

beforeEach(() => {
  notifyCatSpottersMock.mockClear();
  consoleSpy.mockClear();
});

async function insertCat(nameSuffix: string, overrides: Partial<typeof catsTable.$inferInsert> = {}) {
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: catName(nameSuffix),
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: device("discoverer"),
      ...overrides,
    })
    .returning();
  return cat!;
}

async function insertResolvedSighting(catId: number, deviceSuffix: string) {
  await db.insert(sightingsTable).values({
    catId,
    deviceId: device(deviceSuffix),
    photoId: 0,
    lat: 37.44,
    lng: 24.9,
    status: "resolved",
  });
}

/** Wait for the fire-and-forget notification fan-out to finish. */
async function waitForFanOut(): Promise<string[]> {
  await vi.waitFor(() => {
    expect(dispatchedDeviceLists().length).toBeGreaterThan(0);
  });
  return dispatchedDeviceLists()[0]!;
}

describe("POST /api/cats/:catId/claim", () => {
  it("lets a resident claim an unclaimed cat", async () => {
    const cat = await insertCat("Free");
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .send({
        deviceId: device("owner1"),
        ownerName: "Maria",
        homeDescription: "Blue door near the port",
      });
    expect(res.status).toBe(200);
    expect(res.body.ownerName).toBe("Maria");
    expect(res.body.homeDescription).toBe("Blue door near the port");
    expect(notifyCatSpottersMock).toHaveBeenCalledWith(
      cat.id,
      device("owner1"),
      expect.objectContaining({
        data: expect.objectContaining({ type: "cat_claimed", catId: cat.id }),
      }),
    );
  });

  it("is idempotent for a re-claim by the same device (no duplicate notification)", async () => {
    const cat = await insertCat("Idem", {
      ownerDeviceId: device("owner2"),
      ownerName: "Nikos",
      homeDescription: "White house",
    });
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .send({
        deviceId: device("owner2"),
        ownerName: "Nikos Again",
        homeDescription: "Different text",
      });
    expect(res.status).toBe(200);
    // Existing ownership details are preserved; the re-claim is a no-op.
    expect(res.body.ownerName).toBe("Nikos");
    expect(res.body.homeDescription).toBe("White house");
    expect(notifyCatSpottersMock).not.toHaveBeenCalled();
  });

  it("returns 409 when another device already claimed the cat", async () => {
    const cat = await insertCat("Taken", {
      ownerDeviceId: device("owner3"),
      ownerName: "Eleni",
      homeDescription: "",
    });
    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .send({
        deviceId: device("intruder"),
        ownerName: "Not The Owner",
        homeDescription: "",
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already claimed/i);
    expect(notifyCatSpottersMock).not.toHaveBeenCalled();
  });

  it("lets only one of two concurrent claims succeed", async () => {
    const cat = await insertCat("Race");
    const claim = (suffix: string) =>
      request(app)
        .post(`/api/cats/${cat.id}/claim`)
        .send({ deviceId: device(suffix), ownerName: suffix, homeDescription: "" });
    const [r1, r2] = await Promise.all([claim("race1"), claim("race2")]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  });

  it("returns 404 for a missing or non-numeric cat id", async () => {
    for (const id of ["999999999", "not-a-number"]) {
      const res = await request(app)
        .post(`/api/cats/${id}/claim`)
        .send({ deviceId: device("x"), ownerName: "X", homeDescription: "" });
      expect(res.status).toBe(404);
    }
  });

  it("notifies every spotter of the cat except the claiming device", async () => {
    const cat = await insertCat("FanOut");
    await insertResolvedSighting(cat.id, "spotterA");
    await insertResolvedSighting(cat.id, "spotterB");
    await insertResolvedSighting(cat.id, "actor"); // the actor also spotted it

    const res = await request(app)
      .post(`/api/cats/${cat.id}/claim`)
      .send({
        deviceId: device("actor"),
        ownerName: "Actor",
        homeDescription: "Home",
      });
    expect(res.status).toBe(200);

    const deviceIds = await waitForFanOut();
    expect([...deviceIds].sort()).toEqual([device("spotterA"), device("spotterB")]);
    expect(deviceIds).not.toContain(device("actor"));
  });
});

describe("PATCH /api/cats/:catId", () => {
  it("lets the owner rename the cat and update home details", async () => {
    const cat = await insertCat("Renameable", {
      ownerDeviceId: device("owner4"),
      ownerName: "Sofia",
      homeDescription: "Old home",
    });
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .send({
        deviceId: device("owner4"),
        name: catName("RenamedNow"),
        homeDescription: "New home by the bakery",
      });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(catName("RenamedNow"));
    expect(res.body.homeDescription).toBe("New home by the bakery");
  });

  it("returns 403 when a non-owner tries to update", async () => {
    const cat = await insertCat("Guarded", {
      ownerDeviceId: device("owner5"),
      ownerName: "Kostas",
      homeDescription: "",
    });
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .send({ deviceId: device("stranger"), name: catName("Hijack") });
    expect(res.status).toBe(403);
    expect(notifyCatSpottersMock).not.toHaveBeenCalled();

    // Name unchanged.
    const detail = await request(app).get(`/api/cats/${cat.id}`);
    expect(detail.body.cat.name).toBe(catName("Guarded"));
  });

  it("returns 403 for an unclaimed cat (no owner yet)", async () => {
    const cat = await insertCat("Unowned");
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .send({ deviceId: device("anyone"), name: catName("Nope") });
    expect(res.status).toBe(403);
  });

  it("notifies spotters (excluding the owner) on a meaningful rename", async () => {
    const cat = await insertCat("NotifyRename", {
      ownerDeviceId: device("owner6"),
      ownerName: "Ana",
      homeDescription: "",
    });
    await insertResolvedSighting(cat.id, "watcher1");
    await insertResolvedSighting(cat.id, "owner6"); // owner also spotted it

    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .send({ deviceId: device("owner6"), name: catName("NotifyRenamed") });
    expect(res.status).toBe(200);

    expect(notifyCatSpottersMock).toHaveBeenCalledWith(
      cat.id,
      device("owner6"),
      expect.objectContaining({
        data: expect.objectContaining({ type: "cat_updated", catId: cat.id }),
      }),
    );
    const deviceIds = await waitForFanOut();
    expect(deviceIds).toEqual([device("watcher1")]);
  });

  it("notifies spotters on a home-description change", async () => {
    const cat = await insertCat("NotifyHome", {
      ownerDeviceId: device("owner7"),
      ownerName: "Petros",
      homeDescription: "Old description",
    });
    await insertResolvedSighting(cat.id, "watcher2");

    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .send({ deviceId: device("owner7"), homeDescription: "Fresh description" });
    expect(res.status).toBe(200);
    expect(notifyCatSpottersMock).toHaveBeenCalledWith(
      cat.id,
      device("owner7"),
      expect.anything(),
    );
    await waitForFanOut();
  });

  it("does not notify when the body contains no changes", async () => {
    const cat = await insertCat("NoChange", {
      ownerDeviceId: device("owner8"),
      ownerName: "Dimitra",
      homeDescription: "",
    });
    const res = await request(app)
      .patch(`/api/cats/${cat.id}`)
      .send({ deviceId: device("owner8") });
    expect(res.status).toBe(200);
    expect(notifyCatSpottersMock).not.toHaveBeenCalled();
  });
});
