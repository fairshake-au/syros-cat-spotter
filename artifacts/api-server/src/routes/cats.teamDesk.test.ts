import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { catsTable, db, photosTable, pool, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";
import { deriveCatStatuses, getProfileStats, PUBLIC_VIEWER, serialiseCat } from "../lib/catHelpers";
import { TEAM_DESK_DEVICE } from "../lib/teamDesk";

// SYC-677 Ruling R22b: a cat Syros Cats made from a vet batch (discoverer
// TEAM_DESK_DEVICE) is credited publicly to "Syros Cats", with no spotter
// code, and counts in nobody's discovered totals or leaderboard.

const RUN = randomBytes(3).toString("hex");
let catId: number;

beforeAll(async () => {
  const [p] = await db
    .insert(photosTable)
    .values({ data: Buffer.from("fake-jpeg").toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [c] = await db
    .insert(catsTable)
    .values({ name: `VtDesk ${RUN}`, primaryPhotoId: p!.id, lat: 37.445, lng: 24.942, discovererDeviceId: TEAM_DESK_DEVICE })
    .returning({ id: catsTable.id });
  catId = c!.id;
  // Even if a profile row ever existed for the desk (none can be made through the app), it stays off the board.
  await db
    .insert(profilesTable)
    .values({ deviceId: TEAM_DESK_DEVICE, nickname: "Not the team", points: 1_000_000 })
    .onConflictDoUpdate({ target: profilesTable.deviceId, set: { nickname: "Not the team", points: 1_000_000 } });
});
afterAll(async () => {
  await db.delete(profilesTable).where(eq(profilesTable.deviceId, TEAM_DESK_DEVICE));
  await pool.end();
});

describe("a batch-made cat's public credit", () => {
  it("GET /cats/:id credits Syros Cats, with no spotter code, in the cat and its timeline", async () => {
    const res = await request(app).get(`/api/cats/${catId}`);
    expect(res.status).toBe(200);
    expect(res.body.cat).toMatchObject({
      discovererNickname: "Syros Cats",
      discovererUsername: null,
      discovererSpotterCode: null,
    });
    const discovered = res.body.careTimeline.find((e: { type: string }) => e.type === "discovered");
    expect(discovered.message).toBe("Syros Cats");
    expect(JSON.stringify(res.body)).not.toContain(TEAM_DESK_DEVICE);
    expect(JSON.stringify(res.body)).not.toContain("Not the team");
  });

  it("the desk is never on the leaderboard and discovers nothing in any totals", async () => {
    const board = await request(app).get("/api/leaderboard");
    expect(board.status).toBe(200);
    expect(JSON.stringify(board.body)).not.toContain("Not the team");
    expect((await getProfileStats(TEAM_DESK_DEVICE)).uniqueCatsDiscovered).toBe(0);
  });

  it("the one serialiser (the sightings resolve answer and every list use it) credits Syros Cats whatever profile is passed", async () => {
    const [cat] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    const derived = (await deriveCatStatuses([{ id: catId, ownerDeviceId: null }])).get(catId)!;
    const out = serialiseCat(
      {
        id: cat!.id,
        name: cat!.name,
        description: cat!.description,
        photoUrl: null,
        lat: cat!.lat,
        lng: cat!.lng,
        ownerDeviceId: null,
        sightingsCount: 0,
        lastSeenAt: cat!.createdAt,
        discovererDeviceId: TEAM_DESK_DEVICE,
        discovererNickname: "Not the team",
        discovererUsername: "not_the_team",
        ownerName: null,
        homeDescription: null,
        homeLat: null,
        homeLng: null,
        derived,
      },
      PUBLIC_VIEWER,
    );
    expect(out).toMatchObject({ discovererNickname: "Syros Cats", discovererUsername: null, discovererSpotterCode: null });
  });
});
