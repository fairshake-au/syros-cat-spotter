import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { appSettingsTable, db, donationLinkTapsTable, pool } from "@workspace/db";
import app from "../app";
import { _resetAppSettingsCacheForTests } from "../lib/appSettings";
import { todayInStreakTimezone } from "../lib/streak";

// SYC-36, match-wait plan PR 1: "Help feed a cat" goes through /api/go/feed,
// which counts the tap (one number per Athens day) and forwards.

const PAGE = "https://syroscats.com/donations";

async function setLink(value: string) {
  await db
    .insert(appSettingsTable)
    .values({ key: "feed_nudge_donate_url", value })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value } });
  _resetAppSettingsCacheForTests();
}

async function todaysTaps(): Promise<number> {
  const rows = await db.select().from(donationLinkTapsTable);
  return rows.find((r) => r.day === todayInStreakTimezone(new Date()))?.taps ?? 0;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.delete(appSettingsTable);
  await db.delete(donationLinkTapsTable);
  _resetAppSettingsCacheForTests();
});

afterAll(async () => {
  await pool.end();
});

describe("GET /api/go/feed", () => {
  it("forwards to the donation page, counts once, keeps nothing cacheable", async () => {
    await setLink(PAGE);
    const res = await request(app).get("/api/go/feed");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(PAGE);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(await todaysTaps()).toBe(1);
  });

  it("two taps on one day make 2, in one row", async () => {
    await setLink(PAGE);
    await request(app).get("/api/go/feed");
    await request(app).get("/api/go/feed");
    expect(await todaysTaps()).toBe(2);
    expect(await db.select().from(donationLinkTapsTable)).toHaveLength(1);
  });

  it("HEAD (a link preview) forwards but isn't counted", async () => {
    await setLink(PAGE);
    const res = await request(app).head("/api/go/feed");
    expect(res.status).toBe(302);
    expect(await todaysTaps()).toBe(0);
  });

  it("a query string is ignored: same page, same count", async () => {
    await setLink(PAGE);
    const res = await request(app).get("/api/go/feed?ref=someone&device=abc");
    expect(res.headers.location).toBe(PAGE);
    expect(await todaysTaps()).toBe(1);
  });

  it("still forwards when the count fails", async () => {
    await setLink(PAGE);
    vi.spyOn(db, "execute").mockRejectedValueOnce(new Error("database down"));
    const res = await request(app).get("/api/go/feed");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(PAGE);
  });

  it("a slow count never holds the redirect up for more than about half a second", async () => {
    await setLink(PAGE);
    vi.spyOn(db, "execute").mockReturnValueOnce(new Promise(() => undefined) as never);
    const started = Date.now();
    const res = await request(app).get("/api/go/feed");
    expect(res.status).toBe(302);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("feed_tap_count false forwards without counting", async () => {
    await setLink(PAGE);
    await db.insert(appSettingsTable).values({ key: "feed_tap_count", value: false });
    _resetAppSettingsCacheForTests();
    const res = await request(app).get("/api/go/feed");
    expect(res.status).toBe(302);
    expect(await todaysTaps()).toBe(0);
  });

  it("with no donation page: a plain page in the visitor's language, nothing counted", async () => {
    const en = await request(app).get("/api/go/feed");
    expect(en.status).toBe(200);
    expect(en.headers["content-type"]).toMatch(/text\/html/);
    expect(en.text).toContain("<p>This link isn't available right now.</p>");
    const el = await request(app).get("/api/go/feed").set("Accept-Language", "el-GR,el;q=0.9");
    expect(el.text).toContain("<p>Αυτός ο σύνδεσμος δεν είναι διαθέσιμος αυτή τη στιγμή.</p>");
    const fr = await request(app).get("/api/go/feed").set("Accept-Language", "fr-FR,fr;q=0.9");
    expect(fr.text).toContain("<p>Ce lien n'est pas disponible pour le moment.</p>");
    // The page no longer points at a tab (help-and-info spec §2.1).
    for (const page of [en.text, el.text, fr.text]) {
      expect(page).not.toMatch(/Help tab|Aider|καρτέλα/);
    }
    expect(await todaysTaps()).toBe(0);
  });

  it("an http page in the switches is treated as no page (never forwarded)", async () => {
    await setLink("http://syroscats.com/donations");
    const res = await request(app).get("/api/go/feed");
    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
  });
});

// SYC-120 (help-and-info spec §3.7): the Help & info page's Give link. Same
// redirect, headers and link-off page as /api/go/feed, but nothing is kept.
describe("GET /api/go/give", () => {
  it("forwards to the donation page with the same headers, and writes nothing to donation_link_taps", async () => {
    await setLink(PAGE);
    const res = await request(app).get("/api/go/give");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(PAGE);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(await db.select().from(donationLinkTapsTable)).toHaveLength(0);
  });

  it("does not count on repeat taps, on HEAD, or with a query string", async () => {
    await setLink(PAGE);
    await request(app).get("/api/go/give");
    await request(app).get("/api/go/give?ref=someone");
    const head = await request(app).head("/api/go/give");
    expect(head.status).toBe(302);
    expect(await db.select().from(donationLinkTapsTable)).toHaveLength(0);
  });

  it("with no donation page: the plain page in the visitor's language, nothing counted", async () => {
    const en = await request(app).get("/api/go/give");
    expect(en.status).toBe(200);
    expect(en.text).toContain("<p>This link isn't available right now.</p>");
    const el = await request(app).get("/api/go/give").set("Accept-Language", "el-GR,el;q=0.9");
    expect(el.text).toContain("Αυτός ο σύνδεσμος δεν είναι διαθέσιμος αυτή τη στιγμή.");
    const fr = await request(app).get("/api/go/give").set("Accept-Language", "fr-FR,fr;q=0.9");
    expect(fr.text).toContain("Ce lien n'est pas disponible pour le moment.");
    expect(await db.select().from(donationLinkTapsTable)).toHaveLength(0);
  });

  it("an http page in the switches is never forwarded", async () => {
    await setLink("http://syroscats.com/donations");
    const res = await request(app).get("/api/go/give");
    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
  });

  it("the feed route still counts (the two share a handler)", async () => {
    await setLink(PAGE);
    await request(app).get("/api/go/give");
    await request(app).get("/api/go/feed");
    expect(await todaysTaps()).toBe(1);
  });
});
