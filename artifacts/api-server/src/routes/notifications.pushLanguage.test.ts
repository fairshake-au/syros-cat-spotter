import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { db, pool, deviceCredentialsTable, pushTokensTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import app from "../app";

// SYC-706: the app registers its language with the push token so the Monday
// weekly push arrives in it.
const PREFIX = "vitest-pushlang-";
const device = (suffix: string) => `${PREFIX}${suffix}`;
const SECRET = "vitest-secret-pushlang-0123456789";

async function cleanup() {
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
  await db.delete(pushTokensTable).where(like(pushTokensTable.deviceId, `${PREFIX}%`));
}

const put = (suffix: string, body: object) =>
  request(app)
    .put(`/api/profile/${device(suffix)}/push-token`)
    .set("X-Device-Secret", SECRET)
    .send(body);

const languageOf = async (suffix: string) =>
  (await db.select().from(pushTokensTable).where(eq(pushTokensTable.deviceId, device(suffix))))[0]?.language;

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("PUT push-token language", () => {
  it("stores en, el and fr", async () => {
    for (const language of ["en", "el", "fr"]) {
      const res = await put(`ok-${language}`, { token: `ExponentPushToken[${language}]`, language });
      expect(res.status).toBe(200);
      expect(await languageOf(`ok-${language}`)).toBe(language);
    }
  });

  it("an old build sends no language: stored as null", async () => {
    expect((await put("old", { token: "ExponentPushToken[old]" })).status).toBe(200);
    expect(await languageOf("old")).toBeNull();
  });

  it("a later registration without a language keeps the stored one; with one, changes it", async () => {
    await put("change", { token: "ExponentPushToken[c1]", language: "el" });
    await put("change", { token: "ExponentPushToken[c2]" });
    expect(await languageOf("change")).toBe("el");
    await put("change", { token: "ExponentPushToken[c2]", language: "fr" });
    expect(await languageOf("change")).toBe("fr");
  });

  it("rejects an unknown language and stores nothing", async () => {
    const res = await put("bad", { token: "ExponentPushToken[bad]", language: "de" });
    expect(res.status).toBe(400);
    expect(await languageOf("bad")).toBeUndefined();
  });
});
