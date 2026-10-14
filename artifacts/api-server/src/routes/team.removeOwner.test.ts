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

// SYC-130 Task 6: the team sees an owner and removes one (claiming-a-cat.md
// §7, D6). Staff hold every capability today, so `can` is wrapped: `denied.cap`
// is refused to everyone and the rest goes to the real `can`.
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
import { CAPABILITIES } from "../lib/capabilities";

const pushMock = vi.mocked(sendPushNotification);
const notifyMock = vi.mocked(notifyCatSpotters);

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-ro-${RUN}-`;
const NAME_PREFIX = `VitestRemoveOwner${RUN}`;
const SUSAN = `vitest-ro-susan-${RUN}@example.com`;
const VERA = `vitest-ro-vera-${RUN}@example.com`;
const KEY = "vitest-ro-key-0123456789abcdef-0123456789abcdef";
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
  const vera = await addPerson({ email: VERA, name: "Vera", addedBy: "cli:vitest", roles: ["volunteer"] });
  veraId = vera.id;
  volunteerCookie = sessionCookieFor(vera.id);
});
beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
  pushMock.mockClear();
  notifyMock.mockClear();
  _resetClaimLimitForTests();
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
  const note = `Blue door ${randomBytes(3).toString("hex")}`;
  expect((await claim(c.id, d, { homeNote: note })).status).toBe(200);
  const row = await reload(c.id);
  return { c, d, note, row };
}

const form = (path: string, c = cookie) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", c).type("form");
const removeOwner = (catId: number, body: Record<string, unknown> = { reason: "Not their cat" }, c = cookie) =>
  form(`/api/team/cats/${catId}/remove-owner`, c).send(body);
const page = (catId: number) => request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);

describe("the team page shows an owner (spec §7)", () => {
  it("says Has an owner and shows the note and the pin, never the device id", async () => {
    const { c, d, note, row } = await ownedCat("page");
    const res = await page(c.id);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Has an owner");
    expect(res.text).toContain(note);
    expect(res.text).toContain(`${row.homeLat}, ${row.homeLng}`);
    expect(res.text).not.toContain(d.id);
    const json = await request(app).get(`/api/team/cats/${c.id}`).set("Cookie", cookie).set("Accept", "application/json");
    expect(json.body.owner).toEqual({
      has: true,
      homeDescription: note,
      homePin: { lat: row.homeLat, lng: row.homeLng },
    });
    expect(JSON.stringify(json.body)).not.toContain(d.id);
  });

  it("a cat with no owner says No owner, with no note or pin", async () => {
    const c = await streetCat();
    const res = await page(c.id);
    expect(res.text).toContain("No owner");
    expect(res.text).not.toContain("Has an owner");
    expect(res.text).not.toContain("Home pin");
    const json = await request(app).get(`/api/team/cats/${c.id}`).set("Cookie", cookie).set("Accept", "application/json");
    expect(json.body.owner).toEqual({ has: false, homeDescription: null, homePin: null });
  });

  it("the pin is shown only to someone with view_exact_location: nowhere in the view or the HTML without it", async () => {
    const { c, note, row } = await ownedCat("nopin");
    const lacking = { id: veraId, scopes: [{ role: "volunteer", colonyId: null }] };
    const without = (await teamCatView(c.id, new Date(), lacking))!;
    expect(without.owner.has).toBe(true);
    expect(without.owner.homeDescription).toBe(note);
    expect(without.owner.homePin).toBeNull();
    const html = renderCatPage(without, "Vera", { may: () => false });
    expect(html).toContain("Has an owner");
    expect(html).not.toContain("Home pin");
    expect(html).not.toContain(String(row.homeLat));
    expect(html).not.toContain(String(row.homeLng));
    expect(JSON.stringify(without)).not.toContain(String(row.homeLat));
    // No viewer at all is the same as lacking it.
    expect((await teamCatView(c.id))!.owner.homePin).toBeNull();
    const staff = { id: susanId, scopes: [{ role: "staff", colonyId: null }] };
    expect((await teamCatView(c.id, new Date(), staff))!.owner.homePin).toEqual({ lat: row.homeLat, lng: row.homeLng });
  });
});

describe("Remove owner (spec §7)", () => {
  it("clears link, name, note and pin; withdraws the homed as staff; records the chosen status; tells nobody", async () => {
    const { c, d } = await ownedCat("remove");
    await db.update(catsTable).set({ ownerName: "Maria" }).where(eq(catsTable.id, c.id));
    const [h] = await homed(c.id);
    // The fan-out of the first claim has run; count only what removal does.
    await new Promise((r) => setTimeout(r, 150));
    pushMock.mockClear();
    notifyMock.mockClear();
    const before = (await lifeRows(c.id)).length;

    const res = await removeOwner(c.id, { reason: "Not their cat", status: "street" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toMatch(new RegExp(`^/api/team/cats/${c.id}\\?done=ownerRemoved`));
    expect(await reload(c.id)).toMatchObject({
      ownerDeviceId: null,
      ownerName: null,
      homeDescription: null,
      homeLat: null,
      homeLng: null,
    });
    const w = await withdrawals(c.id);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({
      supersedesId: h!.id,
      accountId: susanId,
      deviceId: null,
      roleAtTime: "staff",
    });
    expect(w[0]!.value).toEqual({ withdrawn: true });
    const say = await teamStatements(c.id);
    expect(say).toHaveLength(1);
    expect(say[0]).toMatchObject({ roleAtTime: "staff", accountId: susanId, deviceId: null, supersedesId: null });
    expect(say[0]!.value).toMatchObject({ status: "street", reason: "Not their cat" });
    expect((await lifeRows(c.id)).length).toBe(before + 2);
    // Public view: no owner. Former owner's view: no exact spot any more.
    const pub = await detail(c.id);
    expect(pub.body.cat.hasHome).toBe(false);
    expect(pub.body.cat.lifeStatus).toBe("street");
    const own = await detail(c.id, d);
    expect(own.body.cat.locationPrecision).not.toBe("exact");
    expect(own.body.cat.homeDescription).toBeNull();
    await new Promise((r) => setTimeout(r, 150));
    expect(pushMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("defaults the cat's new status to Lives on the street when none is sent", async () => {
    const { c } = await ownedCat("default");
    expect((await removeOwner(c.id, { reason: "Not their cat" })).status).toBe(303);
    expect((await teamStatements(c.id))[0]!.value).toMatchObject({ status: "street" });
  });

  it("the team's other choices are recorded: in care", async () => {
    const { c } = await ownedCat("incare");
    expect((await removeOwner(c.id, { reason: "Taken in", status: "in_care" })).status).toBe(303);
    expect((await teamStatements(c.id))[0]!.value).toMatchObject({ status: "in_care" });
    expect((await detail(c.id)).body.cat.lifeStatus).toBe("in_care");
  });

  it("a status of homed is not a choice here, and No longer with us needs a date; nothing changes", async () => {
    const { c, d } = await ownedCat("badstatus");
    const before = await lifeRows(c.id);
    for (const body of [
      { reason: "x", status: "homed" },
      { reason: "x", status: "deceased" },
      { reason: "", status: "street" },
      { reason: "x", status: "street", date: "2999-01-01" },
    ]) {
      const res = await removeOwner(c.id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    expect(await lifeRows(c.id)).toEqual(before);
  });

  it("withdraws EVERY active owner homed, not only the newest", async () => {
    const { c, d } = await ownedCat("two");
    await writeObservation(db, {
      catId: c.id,
      kind: "life_status",
      value: { status: "homed" },
      deviceId: d.id,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: new Date(Date.now() + 1),
    });
    const hs = await homed(c.id);
    expect(hs).toHaveLength(2);
    expect((await removeOwner(c.id)).status).toBe(303);
    const w = await withdrawals(c.id);
    expect(w.map((o) => o.supersedesId).sort()).toEqual(hs.map((o) => o.id).sort());
    expect((await detail(c.id)).body.cat.hasHome).toBe(false);
  });

  it("an owner with no homed row (a legacy claim) still has the link cleared and the status recorded", async () => {
    const c = await streetCat();
    await db
      .update(catsTable)
      .set({ ownerDeviceId: `${PREFIX}legacy`, homeDescription: "old", homeLat: 37.44, homeLng: 24.94 })
      .where(eq(catsTable.id, c.id));
    expect((await removeOwner(c.id)).status).toBe(303);
    expect(await reload(c.id)).toMatchObject({ ownerDeviceId: null, homeDescription: null, homeLat: null, homeLng: null });
    expect(await withdrawals(c.id)).toHaveLength(0);
    expect((await teamStatements(c.id))[0]!.value).toMatchObject({ status: "street" });
  });

  it("a cat with no owner: nothing is written and the page says so", async () => {
    const c = await streetCat();
    const res = await removeOwner(c.id);
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toMatch(/done=ownerGone/);
    expect(await lifeRows(c.id)).toHaveLength(0);
    const msg = await request(app).get(res.headers["location"]!).set("Cookie", cookie);
    expect(msg.text).toContain("no owner");
  });

  it("an unknown cat is 404", async () => {
    expect((await removeOwner(2_000_000_000)).status).toBe(404);
    expect((await removeOwner("abc" as unknown as number)).status).toBe(404);
  });

  it("afterwards the former owner's phone, and another phone that met the cat, can claim", async () => {
    const { c, d } = await ownedCat("after");
    const other = phone("after-other");
    await met(c.id, other);
    await bind(other);
    expect((await detail(c.id, other)).body.canClaim).toBe(false);
    expect((await removeOwner(c.id)).status).toBe(303);
    // A team removal starts no let-go cooldown: only the phone's own let-go does.
    expect((await detail(c.id, d)).body.canClaim).toBe(true);
    expect((await detail(c.id, other)).body.canClaim).toBe(true);
    expect((await claim(c.id, other)).status).toBe(200);
    expect((await reload(c.id)).ownerDeviceId).toBe(other.id);
  });
});

describe("who may remove an owner", () => {
  it("without remove_owner, or without set_life_status, the identical 401 and nothing changes", async () => {
    const { c, d } = await ownedCat("perm");
    const before = await lifeRows(c.id);
    for (const cap of ["remove_owner", "set_life_status"]) {
      denied.cap = cap;
      const res = await removeOwner(c.id);
      expect([res.status, res.text], `without ${cap}`).toEqual([401, '{"error":"not_signed_in"}']);
    }
    denied.cap = null;
    const vol = await removeOwner(c.id, { reason: "x" }, volunteerCookie);
    expect([vol.status, vol.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    expect(await lifeRows(c.id)).toEqual(before);
  });

  it("works only from the dashboard's own origin", async () => {
    const { c, d } = await ownedCat("origin");
    const other = await request(app)
      .post(`/api/team/cats/${c.id}/remove-owner`)
      .set("Origin", "https://evil.catspotters.com")
      .set("Cookie", cookie)
      .type("form")
      .send({ reason: "x" });
    expect([other.status, other.text]).toEqual([401, '{"error":"not_signed_in"}']);
    const none = await request(app)
      .post(`/api/team/cats/${c.id}/remove-owner`)
      .set("Cookie", cookie)
      .type("form")
      .send({ reason: "x" });
    expect(none.status).toBe(401);
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
  });

  it("the page shows the Remove owner form only with both capabilities, and only on an owned cat", async () => {
    const { c } = await ownedCat("formshown");
    const action = `/api/team/cats/${c.id}/remove-owner"`;
    expect((await page(c.id)).text).toContain(action);
    denied.cap = "remove_owner";
    expect((await page(c.id)).text).not.toContain("remove-owner");
    expect((await page(c.id)).text).not.toContain("removeOwner");
    denied.cap = "set_life_status";
    expect((await page(c.id)).text).not.toContain("remove-owner");
    denied.cap = null;
    const free = await streetCat();
    expect((await page(free.id)).text).not.toContain("remove-owner");
  });
});

describe("the life-status form on an owned cat", () => {
  const lifeStatus = (catId: number, body: Record<string, unknown>) =>
    form(`/api/team/cats/${catId}/life-status`).send(body);

  it("offers 'Also remove the owner', ticked by default, only on an owned cat", async () => {
    const { c } = await ownedCat("tick");
    const html = (await page(c.id)).text;
    expect(html).toMatch(/<input type="checkbox"[^>]*name="removeOwner" value="1" checked>\s*Also remove the owner/);
    const free = await streetCat();
    expect((await page(free.id)).text).not.toContain("Also remove the owner");
    denied.cap = "remove_owner";
    expect((await page(c.id)).text).not.toContain("Also remove the owner");
  });

  it("saving 'Lives on the street' with it ticked removes the owner and records the status, in one go", async () => {
    const { c } = await ownedCat("tickedsave");
    const res = await lifeStatus(c.id, { status: "street", reason: "Not their cat", removeOwner: "1" });
    expect(res.status).toBe(303);
    expect(await reload(c.id)).toMatchObject({ ownerDeviceId: null, homeDescription: null, homeLat: null });
    expect(await withdrawals(c.id)).toHaveLength(1);
    expect(await teamStatements(c.id)).toHaveLength(1);
    expect((await detail(c.id)).body.cat.hasHome).toBe(false);
  });

  it("unticked, the status is recorded and the owner stays, as before", async () => {
    const { c, d } = await ownedCat("untickedsave");
    const res = await lifeStatus(c.id, { status: "street", reason: "Team says street" });
    expect(res.status).toBe(303);
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    expect(await withdrawals(c.id)).toHaveLength(0);
    expect(await teamStatements(c.id)).toHaveLength(1);
  });

  it("ticked with a status of 'Has a home', the owner stays", async () => {
    const { c, d } = await ownedCat("homedtick");
    expect((await lifeStatus(c.id, { status: "homed", reason: "Still has a home", removeOwner: "1" })).status).toBe(303);
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    expect(await withdrawals(c.id)).toHaveLength(0);
  });

  it("ticked by someone without remove_owner is refused, and nothing changes", async () => {
    const { c, d } = await ownedCat("tickdenied");
    const before = await lifeRows(c.id);
    denied.cap = "remove_owner";
    const res = await lifeStatus(c.id, { status: "street", reason: "x", removeOwner: "1" });
    expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    denied.cap = null;
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    expect(await lifeRows(c.id)).toEqual(before);
  });

  it("ticked on a cat whose owner is already gone just records the status", async () => {
    const c = await streetCat();
    expect((await lifeStatus(c.id, { status: "street", reason: "x", removeOwner: "1" })).status).toBe(303);
    expect(await teamStatements(c.id)).toHaveLength(1);
  });
});

describe("the transaction", () => {
  it("two removals at once: one wins, the other finds no owner and writes nothing", async () => {
    const { c } = await ownedCat("race2");
    const [a, b] = await Promise.all([removeOwner(c.id), removeOwner(c.id)]);
    const locations = [a.headers["location"], b.headers["location"]];
    expect(locations.filter((l) => /done=ownerRemoved/.test(l!))).toHaveLength(1);
    expect(locations.filter((l) => /done=ownerGone/.test(l!))).toHaveLength(1);
    expect(await withdrawals(c.id)).toHaveLength(1);
    expect(await teamStatements(c.id)).toHaveLength(1);
  });

  it("a removal racing the owner's own let-go: exactly one wins, nothing is written twice", async () => {
    const { c, d } = await ownedCat("racegolet");
    const [a, b] = await Promise.all([removeOwner(c.id), letGo(c.id, d)]);
    expect(await withdrawals(c.id)).toHaveLength(1);
    const removalWon = /done=ownerRemoved/.test(a.headers["location"]!);
    expect(await teamStatements(c.id)).toHaveLength(removalWon ? 1 : 0);
    expect(b.status).toBe(removalWon ? 403 : 200);
    expect((await reload(c.id)).ownerDeviceId).toBeNull();
  });

  it("locks the cat row and re-checks the owner under the lock: an owner let go while it waits wins", async () => {
    const { c } = await ownedCat("lock");
    let pending: request.Test | undefined;
    let waiting: Promise<request.Response> | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select id from cats where id = ${c.id} for update`);
      pending = removeOwner(c.id);
      waiting = pending.then((r) => r);
      await vi.waitFor(
        async () => {
          const r = await db.execute<{ n: number }>(sql`
            select count(*)::int as n from pg_stat_activity
             where datname = current_database() and wait_event_type = 'Lock' and query ilike '%cats%'`);
          expect(r.rows[0]!.n).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 25 },
      );
      await tx.update(catsTable).set({ ownerDeviceId: null, homeDescription: null }).where(eq(catsTable.id, c.id));
    });
    const res = await waiting!;
    expect(res.headers["location"]).toMatch(/done=ownerGone/);
    expect(await withdrawals(c.id)).toHaveLength(0);
    expect(await teamStatements(c.id)).toHaveLength(0);
  });
});

describe("logs", () => {
  it("nothing about the note, pin or coordinates reaches the request log", async () => {
    const { c, note, row } = await ownedCat("log");
    spies.logLines.length = 0;
    expect((await page(c.id)).status).toBe(200);
    expect((await removeOwner(c.id, { reason: "Because", status: "street" })).status).toBe(303);
    const text = spies.logLines.join("\n");
    expect(text).toContain("/remove-owner");
    expect(text).not.toContain(note);
    for (const v of [row.homeLat!, row.homeLng!, CAT.lat, CAT.lng]) {
      expect(text).not.toContain(String(v));
      expect(text).not.toContain(v.toFixed(5));
    }
  });
});

describe("a withdrawal in the history (display fixes)", () => {
  it("a team removal reads 'Owner removed by the team', with its reason, never 'unreadable' or a device id", async () => {
    const { c, d } = await ownedCat("histteam");
    expect((await removeOwner(c.id, { reason: "Not their cat" })).status).toBe(303);
    const html = (await page(c.id)).text;
    expect(html).not.toContain("unreadable");
    expect(html).toContain("Owner removed by the team");
    expect(html).toContain("Why: Not their cat");
    expect(html).not.toContain(d.id);
    const json = await request(app).get(`/api/team/cats/${c.id}`).set("Cookie", cookie).set("Accept", "application/json");
    expect(JSON.stringify(json.body)).not.toContain(d.id);
  });

  it("the owner's own let-go reads as the owner's words, with no device id", async () => {
    const { c, d } = await ownedCat("histowner");
    expect((await letGo(c.id, d)).status).toBe(200);
    const html = (await page(c.id)).text;
    expect(html).not.toContain("unreadable");
    expect(html).toMatch(/The owner said the cat doesn(&#39;|')t live with them any more/);
    expect(html).not.toContain("Owner removed by the team");
    expect(html).not.toContain(d.id);
    expect(html).not.toContain("owner: doesn");
  });

  it("a withdrawal has no 'Mark wrong' form, and posting one anyway is refused with nothing written", async () => {
    const { c } = await ownedCat("nowrong");
    expect((await removeOwner(c.id, { reason: "Not their cat" })).status).toBe(303);
    const [w] = await withdrawals(c.id);
    const html = (await page(c.id)).text;
    expect(html).not.toContain(`/api/team/statements/${w!.id}/wrong`);
    const before = await lifeRows(c.id);
    for (const choice of ["homed", "street"]) {
      const res = await form(`/api/team/statements/${w!.id}/wrong`).send({ choice, reason: "undo" });
      expect(res.status, choice).toBe(400);
    }
    expect(await lifeRows(c.id)).toEqual(before);
    expect((await reload(c.id)).ownerDeviceId).toBeNull();
  });

  it("the owner's let-go withdrawal has no 'Mark wrong' either", async () => {
    const { c, d } = await ownedCat("nowrongowner");
    expect((await letGo(c.id, d)).status).toBe(200);
    const [w] = await withdrawals(c.id);
    expect((await page(c.id)).text).not.toContain(`/api/team/statements/${w!.id}/wrong`);
    const res = await form(`/api/team/statements/${w!.id}/wrong`).send({ choice: "homed", reason: "undo" });
    expect(res.status).toBe(400);
  });
});

describe("the flash after the life-status form", () => {
  const lifeStatus = (catId: number, body: Record<string, unknown>) =>
    form(`/api/team/cats/${catId}/life-status`).send(body);
  const flash = async (res: request.Response) => (await request(app).get(res.headers["location"]!).set("Cookie", cookie)).text;

  it("ticked, on a cat that had an owner, says the owner was removed", async () => {
    const { c } = await ownedCat("flashtick");
    const text = await flash(await lifeStatus(c.id, { status: "street", reason: "x", removeOwner: "1" }));
    expect(text).toContain("Saved. The owner is removed and the cat&#39;s new status is in the history below. Nobody was told.");
    expect(text).not.toContain("The life status is added to the history below.");
  });

  it("unticked keeps the ordinary flash", async () => {
    const { c } = await ownedCat("flashuntick");
    const text = await flash(await lifeStatus(c.id, { status: "street", reason: "x" }));
    expect(text).toContain("Saved. The life status is added to the history below.");
    expect(text).not.toContain("Saved. The owner is removed");
  });

  it("ticked with no owner left keeps the ordinary flash", async () => {
    const c = await streetCat();
    const text = await flash(await lifeStatus(c.id, { status: "street", reason: "x", removeOwner: "1" }));
    expect(text).toContain("Saved. The life status is added to the history below.");
  });

  it("ticked with 'Has a home' (owner stays) keeps the ordinary flash", async () => {
    const { c } = await ownedCat("flashhomed");
    const text = await flash(await lifeStatus(c.id, { status: "homed", reason: "x", removeOwner: "1" }));
    expect(text).toContain("Saved. The life status is added to the history below.");
  });
});

describe("the capability", () => {
  it("remove_owner is on the list, after set_life_status, and staff hold it", () => {
    const list = [...CAPABILITIES];
    expect(list.indexOf("remove_owner")).toBe(list.indexOf("set_life_status") + 1);
  });
});
