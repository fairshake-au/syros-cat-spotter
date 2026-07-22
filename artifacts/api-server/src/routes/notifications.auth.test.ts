import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  deviceCredentialsTable,
  pushTokensTable,
  notificationsTable,
} from "@workspace/db";
import { like } from "drizzle-orm";
import app from "../app";

// All fixtures share this prefix so cleanup can never touch real data.
const PREFIX = "vitest-devauth-";
const device = (suffix: string) => `${PREFIX}${suffix}`;
const SECRET_A = "vitest-secret-alpha-0123456789";
const SECRET_B = "vitest-secret-bravo-0123456789";

async function cleanup() {
  await db
    .delete(deviceCredentialsTable)
    .where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
  await db
    .delete(pushTokensTable)
    .where(like(pushTokensTable.deviceId, `${PREFIX}%`));
  await db
    .delete(notificationsTable)
    .where(like(notificationsTable.deviceId, `${PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("device auth on notification endpoints", () => {
  it("rejects notification reads without a device secret", async () => {
    const res = await request(app).get(`/api/notifications/${device("a")}`);
    expect(res.status).toBe(401);
  });

  it("rejects read-all without a device secret", async () => {
    const res = await request(app).post(
      `/api/notifications/${device("a")}/read-all`,
    );
    expect(res.status).toBe(401);
  });

  it("rejects push-token registration without a device secret", async () => {
    const res = await request(app)
      .put(`/api/profile/${device("a")}/push-token`)
      .send({ token: "ExponentPushToken[vitest]" });
    expect(res.status).toBe(401);
  });

  it("rejects secrets that are too short", async () => {
    const res = await request(app)
      .get(`/api/notifications/${device("a")}`)
      .set("X-Device-Secret", "short");
    expect(res.status).toBe(401);
  });

  it("binds the secret on first use and allows the owner afterwards", async () => {
    const first = await request(app)
      .get(`/api/notifications/${device("b")}`)
      .set("X-Device-Secret", SECRET_A);
    expect(first.status).toBe(200);

    const again = await request(app)
      .post(`/api/notifications/${device("b")}/read-all`)
      .set("X-Device-Secret", SECRET_A);
    expect(again.status).toBe(200);
  });

  it("rejects a different secret for an already-bound device id", async () => {
    const res = await request(app)
      .get(`/api/notifications/${device("b")}`)
      .set("X-Device-Secret", SECRET_B);
    expect(res.status).toBe(403);
  });

  it("rejects mark-single-read without a device secret", async () => {
    const res = await request(app).post(
      `/api/notifications/${device("a")}/1/read`,
    );
    expect(res.status).toBe(401);
  });

  it("rejects mark-single-read with a wrong secret", async () => {
    // device("b") was bound to SECRET_A in an earlier test.
    const res = await request(app)
      .post(`/api/notifications/${device("b")}/1/read`)
      .set("X-Device-Secret", SECRET_B);
    expect(res.status).toBe(403);
  });

  it("allows the owner to mark a single notification read", async () => {
    const res = await request(app)
      .post(`/api/notifications/${device("b")}/999999/read`)
      .set("X-Device-Secret", SECRET_A);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 0 });
  });

  it("rejects a non-numeric notification id", async () => {
    const res = await request(app)
      .post(`/api/notifications/${device("b")}/abc/read`)
      .set("X-Device-Secret", SECRET_A);
    expect(res.status).toBe(400);
  });

  it("blocks push-token hijacking with a wrong secret", async () => {
    // Victim registers their token with their secret.
    const victim = await request(app)
      .put(`/api/profile/${device("c")}/push-token`)
      .set("X-Device-Secret", SECRET_A)
      .send({ token: "ExponentPushToken[victim]" });
    expect(victim.status).toBe(200);

    // Attacker knows the device id but not the secret.
    const attacker = await request(app)
      .put(`/api/profile/${device("c")}/push-token`)
      .set("X-Device-Secret", SECRET_B)
      .send({ token: "ExponentPushToken[attacker]" });
    expect(attacker.status).toBe(403);

    const rows = await db
      .select()
      .from(pushTokensTable)
      .where(like(pushTokensTable.deviceId, device("c")));
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe("ExponentPushToken[victim]");
  });
});
