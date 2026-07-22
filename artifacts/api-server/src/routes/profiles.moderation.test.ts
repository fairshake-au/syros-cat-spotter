import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, profilesTable } from "@workspace/db";
import { like } from "drizzle-orm";
import app from "../app";
import { containsOffensiveLanguage } from "../lib/moderation";

const PREFIX = "vitest-modn-";
const device = (suffix: string) => `${PREFIX}${suffix}`;

async function cleanup() {
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("containsOffensiveLanguage", () => {
  it.each([
    "fuck", "FuCk", "f u c k", "sh1t", "b!tch", "a$$hole",
    "μαλάκας", "ΜΑΛΑΚΑΣ", "malakas", "πουτάνα", "poutana", "μουνί",
    "putain", "salope", "connard", "enculé", "m3rde",
    "CoolFucker99", "le petit connard",
  ])("flags %s", (bad) => {
    expect(containsOffensiveLanguage(bad)).toBe(true);
  });

  it.each([
    "Cat Lover", "Scunthorpe Fan", "Nikos", "Marie-Claire",
    "Γάτα της Σύρου", "Chasseur de chats", "Dickens Reader", "Spotter42",
    "class act", "passion",
  ])("allows %s", (ok) => {
    expect(containsOffensiveLanguage(ok)).toBe(false);
  });
});

describe("PATCH /api/profiles/:deviceId nickname moderation", () => {
  it("rejects an offensive nickname with 400 and code offensive_nickname", async () => {
    const res = await request(app)
      .patch(`/api/profiles/${device("a")}`)
      .send({ nickname: "malakas123" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("offensive_nickname");
  });

  it("rejects a disguised offensive nickname", async () => {
    const res = await request(app)
      .patch(`/api/profiles/${device("a")}`)
      .send({ nickname: "f u c k cats" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("offensive_nickname");
  });

  it("accepts a friendly nickname", async () => {
    const res = await request(app)
      .patch(`/api/profiles/${device("a")}`)
      .send({ nickname: "Cat Friend" });
    expect(res.status).toBe(200);
    expect(res.body.nickname).toBe("Cat Friend");
  });
});
