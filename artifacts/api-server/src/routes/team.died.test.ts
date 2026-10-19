import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, like, sql } from "drizzle-orm";
import {
  addPerson,
  catsTable,
  db,
  deviceCredentialsTable,
  markLeft,
  catIdentityTable,
  observationsTable,
  pool,
  pushTokensTable,
  sightingMatchesTable,
  sightingsTable,
} from "@workspace/db";
import { deleteTestSightings } from "../test/sightings";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  sessionCookieFor,
  signInThroughHandoff,
  TEAM_ORIGIN,
} from "../lib/teamAuth/__fixtures__/queueKit";

// SYC-513: "This cat has died" on the team's cat page (docs/specs/
// mark-a-cat-as-died.md, tests per §11). Staff hold every capability today, so `can` is wrapped: `denied.cap`
// is refused to everyone and the rest goes to the real `can`.
// Consonants only: random hex can spell leetspeak ("a55") that the note
// filter rightly refuses, which made this setup flaky.
const safeTag = () => [...randomBytes(4)].map((b) => "bcdfghjkmpqrvwxz"[b % 16]).join("");
const denied = vi.hoisted(() => ({ cap: null as string | null }));
vi.mock("../lib/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/capabilities")>();
  return {
    ...real,
    can: (...args: Parameters<typeof real.can>) =>
      args[1] === denied.cap ? false : real.can(...args),
  };
});

const spies = vi.hoisted(() => ({ logLines: [] as string[] }));
vi.mock("../lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    { level: "trace", redact: actual.REDACT_PATHS, serializers: actual.LOG_SERIALIZERS },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});

vi.mock("../lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notifications")>();
  return { ...actual, notifyCatSpotters: vi.fn(actual.notifyCatSpotters) };
});
vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";
import { sendPushNotification } from "../lib/push";
import { notifyCatSpotters } from "../lib/notifications";
import { writeObservation } from "../lib/observations";
import { blurPosition } from "../lib/blur";
import { _resetClaimLimitForTests } from "../middlewares/rateLimit";
import { teamCatView } from "../lib/teamCatView";
import { renderCatPage } from "../lib/teamPages/catPages";
import { CAPABILITIES, CATALOGUE } from "../lib/capabilities";

const pushMock = vi.mocked(sendPushNotification);
const notifyMock = vi.mocked(notifyCatSpotters);

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-died-${RUN}-`;
const NAME_PREFIX = `VitestDied${RUN}`;
const SUSAN = `vitest-died-susan-${RUN}@example.com`;
const VERA = `vitest-died-vera-${RUN}@example.com`;
const KEY = "vitest-died-key-0123456789abcdef-0123456789abcdef";
const handoffKey = makeKey();
const CAT = { lat: 37.4441, lng: 24.9412 };
const PUBLIC = blurPosition(CAT.lat, CAT.lng);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

let cookie: string;
let volunteerCookie: string;
let susanId: string;
let veraId: string;

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(pushTokensTable).where(like(pushTokensTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await cleanup();
  susanId = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest", roles: ["staff"] })).id;
  cookie = await signInThroughHandoff(app, handoffKey, susanId);
  const vera = await addPerson({ email: VERA, name: "Vera", addedBy: "cli:vitest", roles: ["vet"] });
  veraId = vera.id;
  volunteerCookie = sessionCookieFor(vera.id);
});
beforeEach(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
  pushMock.mockClear();
  notifyMock.mockClear();
  await _resetClaimLimitForTests();
});
afterAll(async () => {
  await cleanup();
  await markLeft(SUSAN, "cli:vitest");
  await markLeft(VERA, "cli:vitest");
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

type Phone = { id: string; secret: string };
function phone(label: string): Phone {
  const tag = randomBytes(4).toString("hex");
  return { id: `${PREFIX}${label}-${tag}`, secret: `${PREFIX}secret-${label}-${tag}` };
}
async function bind(p: Phone) {
  const res = await request(app).get(`/api/profiles/${p.id}/username`).set("X-Device-Secret", p.secret);
  expect(res.status).toBe(200);
}
async function streetCat() {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${randomBytes(4).toString("hex")}`,
      description: "",
      primaryPhotoId: 0,
      lat: CAT.lat,
      lng: CAT.lng,
      discovererDeviceId: `${PREFIX}discoverer`,
    })
    .returning();
  return c!;
}
async function met(catId: number, p: Phone) {
  const [s] = await db
    .insert(sightingsTable)
    .values({ catId, deviceId: p.id, photoId: 0, lat: CAT.lat, lng: CAT.lng, status: "resolved", createdAt: daysAgo(5) })
    .returning();
  await db.insert(sightingMatchesTable).values({
    sightingId: s!.id,
    choice: "suggested",
    chosenCatId: catId,
    chosenAt: daysAgo(5),
    suggestedRank: 1,
  });
  await db.insert(pushTokensTable).values({ deviceId: p.id, token: `tok-${p.id}` }).onConflictDoNothing();
}
const claim = (catId: number, p: Phone, over: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/cats/${catId}/claim`)
    .set("X-Device-Secret", p.secret)
    .send({
      deviceId: p.id,
      livesOnSyros: true,
      livesInMyHome: true,
      homePin: { lat: PUBLIC.lat + 0.00123, lng: PUBLIC.lng + 0.00234 },
      homeNote: "Blue door",
      ...over,
    });
const letGo = (catId: number, p: Phone) =>
  request(app).post(`/api/cats/${catId}/let-go`).set("X-Device-Secret", p.secret).send({ deviceId: p.id });
const detail = (catId: number, p?: Phone) => {
  const r = request(app).get(`/api/cats/${catId}`);
  if (p) r.set("X-Device-Id", p.id).set("X-Device-Secret", p.secret);
  return r;
};
const reload = async (catId: number) => (await db.select().from(catsTable).where(eq(catsTable.id, catId)))[0]!;
const lifeRows = (catId: number) =>
  db
    .select()
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, catId), eq(observationsTable.kind, "life_status")))
    .orderBy(observationsTable.id);
const withdrawals = async (catId: number) =>
  (await lifeRows(catId)).filter((o) => (o.value as { withdrawn?: boolean }).withdrawn === true);
const homed = async (catId: number) =>
  (await lifeRows(catId)).filter((o) => (o.value as { status?: string }).status === "homed");
const teamStatements = async (catId: number) =>
  (await lifeRows(catId)).filter(
    (o) => o.accountId === susanId && (o.value as { withdrawn?: boolean }).withdrawn !== true,
  );

async function ownedCat(label: string) {
  const c = await streetCat();
  const d = phone(label);
  await met(c.id, d);
  await bind(d);
  const note = `Blue door ${safeTag()}`;
  expect((await claim(c.id, d, { homeNote: note })).status).toBe(200);
  const row = await reload(c.id);
  return { c, d, note, row };
}

const form = (path: string, c = cookie) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", c).type("form");
// Yes on the "Are you sure?" page (SYC-362 D1): the confirmed post. The
// unconfirmed form post has its own tests below.
const removeOwner = (catId: number, body: Record<string, unknown> = { reason: "Not their cat" }, c = cookie) =>
  form(`/api/team/cats/${catId}/remove-owner`, c).send({ confirm: "1", ...body });
const page = (catId: number) => request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);


import { recordTeamStatement } from "../lib/teamCorrections";
import { deathObservedAt } from "./teamCorrections";
import { guardianOn, newColony, seedCat, type Signed } from "../test/roleKit";
import { removeTestPerson } from "../test/removeTestPerson";

const susan = () => ({ id: susanId, scopes: [{ role: "staff", colonyId: null }] }) as never;
const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const died = (catId: number | string, body: Record<string, unknown> = { reason: "Found by the harbour" }, c = cookie) =>
  form(`/api/team/cats/${catId}/died`, c).send(body);
const diedJson = (catId: number, body: Record<string, unknown> = { reason: "Found by the harbour" }) =>
  request(app).post(`/api/team/cats/${catId}/died`).set("Origin", TEAM_ORIGIN).set("Cookie", cookie).set("Accept", "application/json").send(body);
const diedPage = (catId: number | string, c = cookie) => request(app).get(`/api/team/cats/${catId}/died`).set("Cookie", c);
const deadRows = async (catId: number) =>
  (await lifeRows(catId)).filter((o) => (o.value as { status?: string }).status === "deceased");
const lifeNow = async (catId: number) => (await detail(catId)).body.cat.lifeStatus as string;
const sayLife = (catId: number, status: string, observedAt: Date) =>
  recordTeamStatement(susan(), { catId, kind: "life_status", value: { status }, reason: "Seen", observedAt });
const owned = async (c: { id: number }) => {
  const r = await reload(c.id);
  return { ownerDeviceId: r.ownerDeviceId, ownerName: r.ownerName, homeDescription: r.homeDescription, homeLat: r.homeLat, homeLng: r.homeLng };
};

describe("the date a death is saved at (spec §4)", () => {
  it("blank, or today's date, is right now, even after midday on Syros", () => {
    const afternoon = new Date("2026-10-18T15:00:00Z");
    expect(deathObservedAt(undefined, afternoon)).toEqual(afternoon);
    expect(deathObservedAt("", afternoon)).toEqual(afternoon);
    expect(deathObservedAt("2026-10-18", afternoon)).toEqual(afternoon);
  });

  it("an earlier date is that day at midday", () => {
    expect(deathObservedAt("2026-10-12", new Date("2026-10-18T15:00:00Z"))).toEqual(new Date("2026-10-12T12:00:00Z"));
  });

  it("through the route: blank and today's date save now, not midday; an earlier date saves that day", async () => {
    const a = await streetCat();
    const t0 = Date.now();
    expect((await died(a.id)).status).toBe(303);
    const [ra] = await deadRows(a.id);
    expect(Math.abs(ra!.observedAt.getTime() - t0)).toBeLessThan(15_000);

    const b = await streetCat();
    const t1 = Date.now();
    expect((await died(b.id, { reason: "x", date: new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Athens" }) })).status).toBe(303);
    const [rb] = await deadRows(b.id);
    expect(Math.abs(rb!.observedAt.getTime() - t1)).toBeLessThan(15_000);

    const c = await streetCat();
    const day = ymd(new Date(Date.now() - 6 * DAY));
    expect((await died(c.id, { reason: "x", date: day })).status).toBe(303);
    const [rc] = await deadRows(c.id);
    expect(rc!.observedAt).toEqual(new Date(`${day}T12:00:00Z`));
  });
});

describe("the page (spec §3, §4)", () => {
  it("opens for a cat with a photo or without, with the words, the date box and the reason box, and no script", async () => {
    const c = await streetCat();
    const res = await diedPage(c.id);
    expect(res.status).toBe(200);
    const html = res.text.replace(/<style[\s\S]*?<\/style>/g, "");
    expect(html).toContain(`${c.name} has died`);
    expect(html).toContain('<div class="nophoto">No photo</div>');
    expect(html).toContain("Date it happened <span");
    expect(html).toContain("(leave blank if you're not sure)");
    expect(html).toContain('type="date"');
    expect(html).toContain("How do you know?");
    expect(html).toContain("For example: found by the harbour");
    expect(html).toContain(`Save: ${c.name} has died`);
    expect(html).toContain(`Back to ${c.name} (nothing changed)`);
    expect(html).toContain("The public will see “No longer with us”");
    expect(html).not.toContain("owner stays");
    expect(html).not.toContain("<script");
    expect(html.replace(/<[^>]*>/g, " ").toLowerCase()).not.toContain("statement");
    expect(await deadRows(c.id)).toHaveLength(0);
  });

  it("says the owner stays, for a cat with an owner", async () => {
    const { c } = await ownedCat("pageowner");
    expect((await diedPage(c.id)).text.replace(/&#39;/g, "'")).toContain(`${c.name}'s owner stays`);
  });

  it("an unknown or bad cat is the usual No such cat page", async () => {
    for (const id of [2_000_000_000, "abc"]) {
      const res = await diedPage(id);
      expect(res.status).toBe(404);
      expect(res.text).toContain("There is no cat with that number");
    }
  });

  it("without set_life_status, or for a volunteer, today's refusal, on the page and on the save", async () => {
    const c = await streetCat();
    denied.cap = "set_life_status";
    for (const res of [await diedPage(c.id), await died(c.id)]) {
      expect([res.status, res.text]).toEqual([403, '{"error":"forbidden"}']);
    }
    denied.cap = null;
    for (const res of [await diedPage(c.id, volunteerCookie), await died(c.id, { reason: "x" }, volunteerCookie)]) {
      expect([res.status, res.text]).toEqual([403, '{"error":"forbidden"}']);
    }
    expect(await deadRows(c.id)).toHaveLength(0);
  });

  it("opening it for a cat already recorded as died goes back to the cat page with the notice", async () => {
    const c = await streetCat();
    expect((await died(c.id)).status).toBe(303);
    const res = await diedPage(c.id);
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toMatch(new RegExp(`^/api/team/cats/${c.id}\\?done=diedAlready$`));
    const landed = await request(app).get(res.headers["location"]!).set("Cookie", cookie);
    expect(landed.text).toContain("already recorded as no longer with us. Nothing was changed.");
  });
});

describe("saving (spec §5)", () => {
  it("records one team 'deceased', lands at the top of the page, and shows the notice", async () => {
    const c = await streetCat();
    const res = await died(c.id, { reason: "Found by the harbour", date: ymd(new Date(Date.now() - 6 * DAY)) });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/cats/${c.id}?done=died`);
    const rows = await deadRows(c.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: susanId, roleAtTime: "staff", supersedesId: null });
    expect(rows[0]!.value).toMatchObject({ status: "deceased", reason: "Found by the harbour" });
    expect(await lifeNow(c.id)).toBe("deceased");
    const html = (await request(app).get(res.headers["location"]!).set("Cookie", cookie)).text;
    expect(html).toContain("Saved. The cat is recorded as no longer with us.");
    expect(html).toContain(`<strong>${c.name} has died</strong>, about `);
    expect(html).toContain("Recorded by Susan on ");
    expect(html).toContain("How we know: Found by the harbour.");
    expect(html).toContain("use <strong>Mark wrong</strong> on it in the history");
    expect(html).toContain(`<a href="#s-${rows[0]!.id}">Go to it</a>`);
    expect(html).toContain(`id="s-${rows[0]!.id}"`);
  });

  it("a death dated today has no 'about' part (same day it was recorded)", async () => {
    const c = await streetCat();
    expect((await died(c.id)).status).toBe(303);
    const html = (await page(c.id)).text;
    expect(html).toContain(`<strong>${c.name} has died</strong>. Recorded by Susan`);
  });

  it("JSON: 201 with the id, then 200 already", async () => {
    const c = await streetCat();
    const a = await diedJson(c.id);
    expect(a.status).toBe(201);
    expect(a.body).toEqual({ id: (await deadRows(c.id))[0]!.id });
    const b = await diedJson(c.id);
    expect([b.status, b.body]).toEqual([200, { already: true }]);
    expect(await deadRows(c.id)).toHaveLength(1);
  });

  it("a second save writes nothing and says so, with or without an owner", async () => {
    const plain = await streetCat();
    const { c: owner } = await ownedCat("second");
    for (const c of [plain, owner]) {
      expect((await died(c.id)).status).toBe(303);
      const again = await died(c.id, { reason: "Again" });
      expect(again.status).toBe(303);
      expect(again.headers["location"]).toBe(`/api/team/cats/${c.id}?done=diedAlready`);
      expect(await deadRows(c.id)).toHaveLength(1);
    }
  });

  it("two saves at once leave exactly one 'deceased', owned or not", async () => {
    const plain = await streetCat();
    const { c: owner } = await ownedCat("race");
    for (const c of [plain, owner]) {
      const both = await Promise.all([died(c.id, { reason: "One" }), died(c.id, { reason: "Two" })]);
      expect(both.map((r) => r.status)).toEqual([303, 303]);
      expect(both.map((r) => r.headers["location"]).sort()).toEqual([
        `/api/team/cats/${c.id}?done=died`,
        `/api/team/cats/${c.id}?done=diedAlready`,
      ]);
      expect(await deadRows(c.id)).toHaveLength(1);
    }
  });

  it("an unknown cat is 404", async () => {
    expect((await died(2_000_000_000)).status).toBe(404);
    expect((await died("abc")).status).toBe(404);
  });

  it("a cat merged into another behaves as the life-status form does: the row lands where that one's does", async () => {
    const [a, b, x, y] = [await streetCat(), await streetCat(), await streetCat(), await streetCat()];
    await db.insert(catIdentityTable).values([
      { catId: a.id, canonicalCatId: b.id, reason: "vitest", createdBy: "cli:vitest" },
      { catId: x.id, canonicalCatId: y.id, reason: "vitest", createdBy: "cli:vitest" },
    ]);
    expect(
      (await form(`/api/team/cats/${x.id}/life-status`).send({ status: "deceased", reason: "x", date: ymd(new Date(Date.now() - DAY)) })).status,
    ).toBe(303);
    expect((await died(a.id)).status).toBe(303);
    const where = async (asked: number, canonical: number) =>
      [(await deadRows(asked)).length, (await deadRows(canonical)).length];
    expect(await where(a.id, b.id)).toEqual(await where(x.id, y.id));
  });
});

describe("when the page says no (spec §4)", () => {
  const notSaved = async (catId: number, body: Record<string, unknown>, expected: string, kept: string[]) => {
    const before = await lifeRows(catId);
    const res = await died(catId, body);
    expect(res.status, JSON.stringify(body)).toBe(400);
    const text = res.text.replace(/&#39;/g, "'");
    expect(text).toContain(expected);
    expect(text).toContain("Nothing was changed.");
    for (const k of kept) expect(text).toContain(k);
    expect(await lifeRows(catId)).toEqual(before);
    return res;
  };

  it("no reason: asks again with the date kept", async () => {
    const c = await streetCat();
    const day = ymd(new Date(Date.now() - 3 * DAY));
    await notSaved(c.id, { reason: "", date: day }, "Say in a few words how we know.", [`value="${day}"`]);
    await notSaved(c.id, { reason: "   " }, "Say in a few words how we know.", []);
  });

  it("a future date: asks again with the reason kept", async () => {
    const c = await streetCat();
    await notSaved(c.id, { reason: "Maria told us", date: "2999-01-01" }, "The date can't be in the future.", ['value="Maria told us"', 'value="2999-01-01"']);
  });

  it("JSON: a bad request is 400 and nothing is written", async () => {
    const c = await streetCat();
    expect((await diedJson(c.id, { reason: "" })).status).toBe(400);
    expect(await lifeRows(c.id)).toHaveLength(0);
  });

  it("a sighting after the date: refused with the sighting's date, nothing written", async () => {
    const c = await streetCat();
    await met(c.id, phone("sighted")); // 5 days ago
    const before = await lifeRows(c.id);
    const sighted = new Date(Date.now() - 5 * DAY).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Athens" });
    const res = await notSaved(
      c.id,
      { reason: "Found her", date: ymd(new Date(Date.now() - 8 * DAY)) },
      `${c.name} was spotted on ${sighted}, after that date.`,
      ['value="Found her"'],
    );
    expect(res.text).toContain("Leave the date blank, or check that sighting in the history first.");
    expect(await lifeRows(c.id)).toEqual(before);
    const json = await diedJson(c.id, { reason: "x", date: ymd(new Date(Date.now() - 8 * DAY)) });
    expect([json.status, json.body.code]).toEqual([409, "SIGHTED_AFTER"]);
    // Leaving the date blank is saved (now is after the sighting).
    expect((await died(c.id)).status).toBe(303);
  });

  it("a newer team status: refused naming who and when, nothing written", async () => {
    const c = await streetCat();
    const newer = new Date(Date.now() - 3 * DAY);
    await sayLife(c.id, "homed", newer);
    const when = newer.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Athens" });
    const res = await notSaved(
      c.id,
      { reason: "Found her", date: ymd(new Date(Date.now() - 6 * DAY)) },
      `Susan recorded “Has a home” on ${when}, after that date, so this wouldn't take effect.`,
      [],
    );
    expect(res.text).toContain("Leave the date blank, or use Mark wrong on that change first.");
    const json = await diedJson(c.id, { reason: "x", date: ymd(new Date(Date.now() - 6 * DAY)) });
    expect([json.status, json.body.code]).toEqual([409, "NEWER_STATUS"]);
    expect(await deadRows(c.id)).toHaveLength(0);
  });

  it("a newer owner claim: refused naming the owner's claim, the owner untouched", async () => {
    const { c, row } = await ownedCat("claimed");
    const before = await lifeRows(c.id);
    const res = await notSaved(
      c.id,
      { reason: "Found her", date: ymd(new Date(Date.now() - 2 * DAY)) },
      `${c.name}'s owner said the cat has a home on `,
      [],
    );
    expect(res.text.replace(/&#39;/g, "'")).toContain("after that date, so this wouldn't take effect. Leave the date blank.");
    expect(await lifeRows(c.id)).toEqual(before);
    expect((await reload(c.id)).ownerDeviceId).toBe(row.ownerDeviceId);
  });
});

describe("the owner is never touched (spec §5)", () => {
  it("link, claim, note and pin are unchanged, and nobody is told", async () => {
    const { c, d } = await ownedCat("untouched");
    await new Promise((r) => setTimeout(r, 150));
    pushMock.mockClear();
    notifyMock.mockClear();
    const before = await owned(c);
    const homedBefore = await homed(c.id);
    const res = await died(c.id, { reason: "Found by the harbour" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/cats/${c.id}?done=died`);
    expect(await owned(c)).toEqual(before);
    expect(before.ownerDeviceId).toBe(d.id);
    expect(await withdrawals(c.id)).toHaveLength(0);
    expect(await homed(c.id)).toEqual(homedBefore);
    expect(await lifeNow(c.id)).toBe("deceased");
    // One page, no "Are you sure?": the redirect landed on the cat page.
    expect((await request(app).get(res.headers["location"]!).set("Cookie", cookie)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    expect(pushMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe("the button (spec §3)", () => {
  const button = '<button type="submit">This cat has died</button>';

  it("shows last in 'Update this cat', as a GET form, for the island-wide team", async () => {
    const c = await streetCat();
    const html = (await page(c.id)).text;
    expect(html).toContain(`<form method="get" action="/api/team/cats/${c.id}/died" class="diedform">${button}</form>`);
    expect(html.indexOf("diedform\"")).toBeGreaterThan(html.indexOf("Remove owner") === -1 ? html.indexOf("Rename the cat") : html.indexOf("Remove owner"));
    expect(html.match(/class="risky"[^>]*>This cat has died/)).toBeNull();
  });

  it("is not shown without set_life_status (render with a may that refuses it)", async () => {
    const c = await streetCat();
    const view = (await teamCatView(c.id))!;
    expect(renderCatPage(view, "X", { may: (cap) => cap !== "set_life_status" })).not.toContain("This cat has died");
    expect(renderCatPage(view, "X", { may: () => true })).toContain(button);
  });

  it("is hidden once the cat is recorded as died, and shown again when a sighting brings the cat back", async () => {
    const c = await streetCat();
    expect((await page(c.id)).text).toContain(button);
    expect((await died(c.id)).status).toBe(303);
    expect((await page(c.id)).text).not.toContain(button);
    // A sighting after the death brings her back: the button returns, no notice.
    const revived = await streetCat();
    await sayLife(revived.id, "deceased", new Date(Date.now() - 10 * DAY));
    expect((await page(revived.id)).text).not.toContain(button);
    await met(revived.id, phone("revive")); // 5 days ago, after the death
    const html = (await page(revived.id)).text;
    expect(html).toContain(button);
    expect(html).not.toContain("has died</strong>");
  });

  it("is shown for a cat only presumed dead after three years", async () => {
    const c = await streetCat();
    const person = { id: susanId, scopes: [{ role: "staff", colonyId: null }] } as never;
    const view = (await teamCatView(c.id, new Date(Date.now() + 4 * 365 * DAY), person))!;
    expect(view.records.lifeStatus.presumedDeceased).toBe(true);
    const html = renderCatPage(view, "Susan", { may: () => true });
    expect(html).toContain(button);
    expect(html).not.toContain("has died</strong>");
  });
});

describe("the notice (spec §6)", () => {
  const eleniCookie = async () => {
    const colony = await newColony("died-notice");
    const g = await guardianOn("died-notice", [colony]);
    guardians.push(g);
    return { g, colony };
  };

  it("a team death shows it, naming who and why", async () => {
    const c = await streetCat();
    expect((await died(c.id, { reason: "Vet told us" })).status).toBe(303);
    const html = (await page(c.id)).text;
    expect(html).toContain(`<strong>${c.name} has died</strong>`);
    expect(html).toContain("How we know: Vet told us.");
  });

  it("a death recorded through Mark wrong or the life-status form shows it too", async () => {
    const c = await streetCat();
    const date = ymd(new Date(Date.now() - 2 * DAY));
    expect((await form(`/api/team/cats/${c.id}/life-status`).send({ status: "deceased", reason: "Old way", date })).status).toBe(303);
    expect((await page(c.id)).text).toContain(`<strong>${c.name} has died</strong>, about `);
  });

  it("a cat guardian's death within 30 days shows only the guardian's notice; after 30 days the new one, naming them", async () => {
    const { g, colony } = await eleniCookie();
    const cat = await seedCat(colony);
    const say = await request(app)
      .post(`/api/team/my/cats/${cat.id}/life-status`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", g.cookie)
      .set("Accept", "application/json")
      .send({ status: "deceased", reason: "Found her" });
    expect(say.status).toBeLessThan(300);
    const html = (await page(cat.id)).text;
    expect(html).toContain("Recently marked as no longer with us by the cat guardian");
    expect(html).not.toContain("has died</strong>");

    const person = { id: susanId, scopes: [{ role: "staff", colonyId: null }] } as never;
    const later = new Date(Date.now() + 31 * DAY);
    // teamCatView takes its own "now" for the 30-day flag, so end the flag the
    // way recentGuardianMark does at +31 days (pinned in
    // team.guardianStatements.test.ts) and check what the page then says.
    const view = { ...(await teamCatView(cat.id, later, person))!, recentGuardianMark: null };
    const after = renderCatPage(view, "Susan", { may: () => true, now: later });
    expect(after).toContain("has died</strong>");
    expect(after).toContain(", cat guardian");
    expect(after).not.toContain("Recently marked");
  });

  it("a cat brought back by a sighting shows neither", async () => {
    const c = await streetCat();
    await sayLife(c.id, "deceased", new Date(Date.now() - 10 * DAY));
    await met(c.id, phone("neither"));
    const html = (await page(c.id)).text;
    expect(html).not.toContain("has died</strong>");
    expect(html).not.toContain("Recently marked");
  });
});

describe("the tidied forms (spec §7)", () => {
  it("'Update where the cat lives' and a live cat's 'Remove owner' no longer list 'No longer with us'", async () => {
    const { c } = await ownedCat("tidy");
    const html = (await page(c.id)).text;
    expect(html).toContain('id="ls-street"');
    expect(html).toContain('id="ls-homed"');
    expect(html).toContain('id="ls-in_care"');
    expect(html).not.toContain('id="ls-deceased"');
    expect(html).not.toContain('id="ro-deceased"');
    expect(html).toContain('id="ro-street"');
    expect(html).toContain("If the cat has died, use “This cat has died” instead.");
    expect(html).not.toContain("needed for");
  });

  it("'Mark wrong' still lists it", async () => {
    const c = await streetCat();
    await sayLife(c.id, "homed", new Date(Date.now() - DAY));
    expect((await page(c.id)).text).toMatch(/id="s-\d+-to-deceased"|-to-deceased"/);
  });

  it("the old routes still accept 'deceased'", async () => {
    const a = await streetCat();
    const date = ymd(new Date(Date.now() - 2 * DAY));
    expect((await form(`/api/team/cats/${a.id}/life-status`).send({ status: "deceased", reason: "x", date })).status).toBe(303);
    const { c } = await ownedCat("oldroute");
    expect((await removeOwner(c.id, { reason: "x", status: "deceased", date })).status).toBe(303);
    expect(await lifeNow(c.id)).toBe("deceased");
  });

  it("a dead cat with an owner offers only 'Still no longer with us', with no date box", async () => {
    const { c } = await ownedCat("deadform");
    expect((await died(c.id)).status).toBe(303);
    const html = (await page(c.id)).text;
    const start = html.indexOf("<summary>Remove owner</summary>");
    expect(start).toBeGreaterThan(-1);
    const form_ = html.slice(start, html.indexOf("</form>", start));
    expect(form_).toContain('id="ro-keep"');
    expect(form_).toContain('value="keep"');
    expect(form_).toContain("Still no longer with us");
    expect(form_).not.toContain('type="date"');
    expect(form_).not.toContain("ro-street");
  });

  it("'keep' on a dead owned cat removes the owner, writes no new status, and the cat stays dead", async () => {
    const { c } = await ownedCat("keep");
    expect((await died(c.id)).status).toBe(303);
    const deathRow = (await deadRows(c.id))[0]!;
    const before = (await lifeRows(c.id)).length;
    const unconfirmed = await form(`/api/team/cats/${c.id}/remove-owner`).send({ status: "keep", reason: "Owner asked" });
    expect(unconfirmed.status).toBe(200);
    expect(unconfirmed.text).toContain(`${c.name} stays recorded as “No longer with us”.`);
    expect(unconfirmed.text).not.toContain("will be saved as");
    const res = await removeOwner(c.id, { reason: "Owner asked", status: "keep" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toMatch(/done=ownerRemovedKept/);
    expect(await reload(c.id)).toMatchObject({ ownerDeviceId: null, homeDescription: null });
    // Only the withdrawal was added: no new status, and the death stands.
    expect((await lifeRows(c.id)).length).toBe(before + 1);
    expect(await deadRows(c.id)).toEqual([deathRow]);
    expect(await lifeNow(c.id)).toBe("deceased");
    expect((await page(c.id)).text).toContain(`<strong>${c.name} has died</strong>`);
  });

  it("'keep' on a live cat is refused and nothing changes", async () => {
    const { c, d } = await ownedCat("keeplive");
    const before = await lifeRows(c.id);
    const res = await removeOwner(c.id, { reason: "x", status: "keep" });
    expect(res.status).toBe(400);
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    expect(await lifeRows(c.id)).toEqual(before);
  });
});

const guardians: Signed[] = [];
afterAll(async () => {
  for (const g of guardians) {
    if (await removeTestPerson(g.email).then(() => true, () => false)) continue;
    await pool.query("delete from person_scopes where person_id = $1", [g.id]);
    await markLeft(g.email, "cli:vitest");
  }
});
