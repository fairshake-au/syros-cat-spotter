import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { like } from "drizzle-orm";
import { catUpdatesTable, db, deviceCredentialsTable, notificationsTable, pool } from "@workspace/db";
import { ListNotificationsResponse } from "@workspace/api-zod";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { daysAgo, moveKit } from "../test/moveKit";

// SYC-221 PR 3: the bell list carries `wording` and `wordingDay` from
// cat_updates so the app can word cat news in its own language. Staff text,
// old rows and weekly results carry null. Cat names are letters only (SYC-709).

const SECRET = "vitest-wording-secret-0123456789abcdef";
const kit = moveKit("VitestBellWording");

beforeAll(async () => {
  await kit.cleanup();
});
afterAll(async () => {
  await kit.cleanup();
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${kit.devicePrefix}%`));
  await pool.end();
});

describe("GET /notifications/:deviceId wording", () => {
  it("returns wording and wordingDay for labelled rows, and nulls for staff text, old rows and a weekly result", async () => {
    const cat = await kit.cat(daysAgo(60));
    const d = kit.device();
    expect((await request(app).get(`/api/profiles/${d}/username`).set("X-Device-Secret", SECRET)).status).toBe(200);

    const mk = async (message: string, extra: Partial<typeof catUpdatesTable.$inferInsert>, ago: number) => {
      const [u] = await db.insert(catUpdatesTable).values({ catId: cat, updateType: "sighting", message, ...extra }).returning();
      await db.insert(notificationsTable).values({ deviceId: d, catUpdateId: u!.id, kind: "cat", createdAt: daysAgo(ago) });
      return u!.id;
    };
    const seen = await mk("seen", { wording: "seen_weekday", wordingDay: "2026-10-27" }, 1);
    const ster = await mk("ster", { updateType: "desexed", wording: "sterilised" }, 2);
    const staff = await mk("A staff note", { updateType: "general" }, 3);
    await db.insert(notificationsTable).values({ deviceId: d, kind: "week_result", message: "Week", place: 2, weekPoints: 5, createdAt: daysAgo(4) });

    const res = await request(app).get(`/api/notifications/${d}`).set("X-Device-Secret", SECRET);
    expect(res.status).toBe(200);
    const rows = res.body as Record<string, unknown>[];
    expect(rows.find((r) => r.catUpdateId === seen)).toMatchObject({ wording: "seen_weekday", wordingDay: "2026-10-27" });
    expect(rows.find((r) => r.catUpdateId === ster)).toMatchObject({ wording: "sterilised", wordingDay: null });
    expect(rows.find((r) => r.catUpdateId === staff)).toMatchObject({ wording: null, wordingDay: null, message: "A staff note" });
    const week = rows.find((r) => r.message === "Week")!;
    expect(week.wording ?? null).toBeNull();
    expect(week.wordingDay ?? null).toBeNull();
    expect(ListNotificationsResponse.safeParse(res.body).success).toBe(true);
  });
});
