import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, deviceCredentialsTable, pool, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";
import { TEAM_DESK_DEVICE, TEAM_DESK_SECRET_HASH } from "../lib/teamDesk";

// SYC-677 Ruling R22a: "syros-cats-team" is the discoverer of every cat the
// team makes from a vet batch. Nobody may bind a secret to it, or they would
// take over that credit (and its leaderboard line). Migration 0045 seeds its
// device_credentials row with a hash no secret can match, and
// verifyDeviceSecret refuses the id by name as well.

const FRESH = "a-fresh-secret-0123456789abcdef";

afterAll(async () => {
  await pool.end();
});

const credential = async () =>
  db.select().from(deviceCredentialsTable).where(eq(deviceCredentialsTable.deviceId, TEAM_DESK_DEVICE));

describe("the team desk's device id can't be bound", () => {
  it("the migration seeds its credential with a hash no secret can match", async () => {
    expect(TEAM_DESK_DEVICE).toBe("syros-cats-team");
    const rows = await credential();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.secretHash).toBe(TEAM_DESK_SECRET_HASH);
    expect(TEAM_DESK_SECRET_HASH).not.toMatch(/^[0-9a-f]{64}$/);
  });

  it("POST /profiles/syros-cats-team/username with a fresh secret is refused and binds nothing", async () => {
    const res = await request(app)
      .post(`/api/profiles/${TEAM_DESK_DEVICE}/username`)
      .set("X-Device-Secret", FRESH)
      .send({ username: "Syros Cats" });
    expect(res.status).toBe(403);
    const rows = await credential();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.secretHash).toBe(TEAM_DESK_SECRET_HASH);
    const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.deviceId, TEAM_DESK_DEVICE));
    expect(profile?.username ?? null).toBeNull();
  });

  it("every device-secret route refuses it (the profile read too)", async () => {
    const res = await request(app).get(`/api/profiles/${TEAM_DESK_DEVICE}`).set("X-Device-Secret", FRESH);
    expect(res.status).toBe(403);
    expect(res.body.points).toBeUndefined();
    expect((await credential())[0]!.secretHash).toBe(TEAM_DESK_SECRET_HASH);
  });
});
