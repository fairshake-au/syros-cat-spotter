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
import { recordedMerge, recordedUndo } from "../test/merges";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  sessionCookieFor,
  signInThroughHandoff,
  TEAM_ORIGIN,
} from "../lib/teamAuth/__fixtures__/queueKit";

// SYC-130 Task 6: the team sees an owner and removes one (claiming-a-cat.md
// §7, D6). Staff hold every capability today, so `can` is wrapped: `denied.cap`
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
  return { ...actual, notifyCatFollowers: vi.fn(actual.notifyCatFollowers) };
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
import { notifyCatFollowers } from "../lib/notifications";
import { writeObservation } from "../lib/observations";
import { blurPosition } from "../lib/blur";
import { _resetClaimLimitForTests } from "../middlewares/rateLimit";
import { teamCatView } from "../lib/teamCatView";
import { renderCatPage } from "../lib/teamPages/catPages";
import { CAPABILITIES, CATALOGUE } from "../lib/capabilities";

const pushMock = vi.mocked(sendPushNotification);
const notifyMock = vi.mocked(notifyCatFollowers);

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

describe("the team page shows an owner (spec §7)", () => {
  it("says Has an owner and shows the note and the pin, never the device id", async () => {
    const { c, d, note, row } = await ownedCat("page");
    const res = await page(c.id);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Has an owner");
    expect(res.text).toContain(note);
    // The pin is words, never numbers (SYC-517).
    expect(res.text).toMatch(/Home pin: Pinned, in [^<\d]+<\/span>/);
    expect(res.text).not.toContain(`${row.homeLat}, ${row.homeLng}`);
    expect(res.text).not.toContain(d.id);
    const json = await request(app).get(`/api/team/cats/${c.id}`).set("Cookie", cookie).set("Accept", "application/json");
    expect(json.body.owner).toEqual({
      has: true,
      orphanedHome: false,
      homeDescription: note,
      homePin: { lat: row.homeLat, lng: row.homeLng },
    });
    expect(JSON.stringify(json.body)).not.toContain(d.id);
  });

  it("a cat with no owner says No owner, with no note or pin", async () => {
    const c = await streetCat();
    const res = await page(c.id);
    expect(res.text).not.toContain("<dt>Owner</dt>");
    expect(res.text).not.toContain("Has an owner");
    expect(res.text).not.toContain("Home pin");
    const json = await request(app).get(`/api/team/cats/${c.id}`).set("Cookie", cookie).set("Accept", "application/json");
    expect(json.body.owner).toEqual({ has: false, orphanedHome: false, homeDescription: null, homePin: null });
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

  it("afterwards another phone that met the cat can claim; the removed phone waits 30 days", async () => {
    const { c, d } = await ownedCat("after");
    const other = phone("after-other");
    await met(c.id, other);
    await bind(other);
    expect((await detail(c.id, other)).body.canClaim).toBe(false);
    expect((await removeOwner(c.id)).status).toBe(303);
    // A team removal blocks that phone for that cat for 30 days (Samuel, 14 Oct 2026).
    expect((await detail(c.id, d)).body.canClaim).toBe(false);
    expect((await claim(c.id, d)).status).toBe(429);
    expect((await detail(c.id, other)).body.canClaim).toBe(true);
    expect((await claim(c.id, other)).status).toBe(200);
    expect((await reload(c.id)).ownerDeviceId).toBe(other.id);
  });
});

describe("who may remove an owner", () => {
  it("without remove_owner, or without set_life_status, the 403 (signed in, so not the sign-in 401; SYC-53 PR 0.5) and nothing changes", async () => {
    const { c, d } = await ownedCat("perm");
    const before = await lifeRows(c.id);
    for (const cap of ["remove_owner", "set_life_status"]) {
      denied.cap = cap;
      const res = await removeOwner(c.id);
      expect([res.status, res.text], `without ${cap}`).toEqual([403, '{"error":"forbidden"}']);
    }
    denied.cap = null;
    const vol = await removeOwner(c.id, { reason: "x" }, volunteerCookie);
    expect([vol.status, vol.text]).toEqual([403, '{"error":"forbidden"}']);
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

describe("the life-status form on an owned cat (SYC-362 D2: no box; asks first)", () => {
  const lifeStatus = (catId: number, body: Record<string, unknown>, c = cookie) =>
    form(`/api/team/cats/${catId}/life-status`, c).send(body);

  it("has no 'Also remove the owner' box at all; an owned cat says it will ask first", async () => {
    const { c } = await ownedCat("nobox");
    const html = (await page(c.id)).text;
    expect(html).not.toContain('name="removeOwner"');
    expect(html).not.toMatch(/<input type="checkbox"[^>]* checked/);
    expect(html).toContain("This cat has an owner. Saving anything but “Has a home” asks you first");
    const free = await streetCat();
    expect((await page(free.id)).text).not.toContain("This cat has an owner.");
  });

  it("a team member saving 'Lives on the street' gets the 'Are you sure?' page, and nothing is written", async () => {
    const { c, d } = await ownedCat("asks");
    const before = await lifeRows(c.id);
    const res = await lifeStatus(c.id, { status: "street", reason: "Not their cat", date: "" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("owner too?</h1>");
    expect(res.text).toContain("also removes the owner");
    expect(res.text).toContain("The owner is not told.");
    expect(res.text).toContain(`action="/api/team/cats/${c.id}/life-status"`);
    expect(res.text).toContain('<input type="hidden" name="status" value="street">');
    expect(res.text).toContain('<input type="hidden" name="reason" value="Not their cat">');
    expect(res.text).toContain('<input type="hidden" name="confirm" value="1">');
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    expect(await lifeRows(c.id)).toEqual(before);
  });

  it("an old form's removeOwner=1 still asks first: only Yes removes an owner", async () => {
    const { c, d } = await ownedCat("oldbox");
    const res = await lifeStatus(c.id, { status: "street", reason: "x", removeOwner: "1" });
    expect(res.status).toBe(200);
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    expect(await withdrawals(c.id)).toHaveLength(0);
  });

  it("Yes removes the owner and records the status, in one go", async () => {
    const { c } = await ownedCat("yes");
    const res = await lifeStatus(c.id, { status: "street", reason: "Not their cat", confirm: "1" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toContain("done=ownerRemoved");
    expect(await reload(c.id)).toMatchObject({ ownerDeviceId: null, homeDescription: null, homeLat: null });
    expect(await withdrawals(c.id)).toHaveLength(1);
    expect(await teamStatements(c.id)).toHaveLength(1);
    expect((await detail(c.id)).body.cat.hasHome).toBe(false);
  });

  it("Yes twice (a refresh) finds no owner the second time and only records the status again", async () => {
    const { c } = await ownedCat("yestwice");
    await lifeStatus(c.id, { status: "street", reason: "x", confirm: "1" });
    const again = await lifeStatus(c.id, { status: "street", reason: "x", confirm: "1" });
    expect(again.status).toBe(303);
    expect(again.headers["location"]).toContain("done=life");
    expect(await withdrawals(c.id)).toHaveLength(1);
  });

  it("'Has a home' never asks, and the owner stays", async () => {
    const { c, d } = await ownedCat("homed");
    const res = await lifeStatus(c.id, { status: "homed", reason: "Still has a home" });
    expect(res.status).toBe(303);
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    expect(await withdrawals(c.id)).toHaveLength(0);
  });

  it("a cat with no owner never asks", async () => {
    const c = await streetCat();
    const res = await lifeStatus(c.id, { status: "deceased", reason: "x", date: "2026-10-01" });
    expect(res.status).toBe(303);
    expect(await teamStatements(c.id)).toHaveLength(1);
  });

  it("someone who can't remove owners (a cat guardian) saves, keeps the owner, and is told so", async () => {
    const { c, d } = await ownedCat("guardian");
    denied.cap = "remove_owner";
    const res = await lifeStatus(c.id, { status: "street", reason: "Seen on the street" });
    denied.cap = null;
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toContain("done=lifeOwnerKept");
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    expect(await teamStatements(c.id)).toHaveLength(1);
    const text = (await request(app).get(res.headers["location"]!).set("Cookie", cookie)).text;
    expect(text).toContain("Saved. This cat still has an owner. Ask the team if the owner should be removed.");
  });

  it("someone who can't remove owners can't force it with confirm=1 either", async () => {
    const { c, d } = await ownedCat("guardianyes");
    denied.cap = "remove_owner";
    const res = await lifeStatus(c.id, { status: "street", reason: "x", confirm: "1" });
    denied.cap = null;
    expect(res.status).toBe(303);
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    expect(await withdrawals(c.id)).toHaveLength(0);
  });

  it("JSON is unchanged: removeOwner removes, without it the owner stays, and nothing asks", async () => {
    const { c: a } = await ownedCat("jsonrm");
    const json = (catId: number, body: Record<string, unknown>) =>
      request(app).post(`/api/team/cats/${catId}/life-status`).set("Origin", TEAM_ORIGIN).set("Cookie", cookie).send(body);
    expect((await json(a.id, { status: "street", reason: "x", removeOwner: "1" })).status).toBe(201);
    expect((await reload(a.id)).ownerDeviceId).toBeNull();
    const { c: b, d } = await ownedCat("jsonkeep");
    expect((await json(b.id, { status: "street", reason: "x" })).status).toBe(201);
    expect((await reload(b.id)).ownerDeviceId).toBe(d.id);
  });
});

describe("Remove owner asks first (SYC-362 D1)", () => {
  const unconfirmed = (catId: number, body: Record<string, unknown> = { reason: "Not their cat", status: "in_care" }) =>
    form(`/api/team/cats/${catId}/remove-owner`).send(body);

  it("the form post shows the 'Are you sure?' page carrying every field, and writes nothing", async () => {
    const { c, d } = await ownedCat("sure");
    const before = await lifeRows(c.id);
    const res = await unconfirmed(c.id, { reason: 'Not "theirs" <b>', status: "deceased", date: "2026-10-01" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("owner?</h1>");
    expect(res.text).toContain("The owner is not told.");
    expect(res.text).toContain("will be saved as “No longer with us”.");
    expect(res.text).toContain('<input type="hidden" name="status" value="deceased">');
    expect(res.text).toContain('<input type="hidden" name="date" value="2026-10-01">');
    expect(res.text).toContain('<input type="hidden" name="reason" value="Not &quot;theirs&quot; &lt;b&gt;">');
    expect(res.text).toContain('<button type="submit" class="risky">Yes, remove the owner</button>');
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    expect(await lifeRows(c.id)).toEqual(before);
  });

  it("a bad form is refused before any 'Are you sure?' page", async () => {
    const { c } = await ownedCat("surebad");
    const res = await unconfirmed(c.id, { reason: "", status: "street" });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('name="confirm"');
  });

  it("no owner any more: straight to 'nothing to remove', no question", async () => {
    const c = await streetCat();
    const res = await unconfirmed(c.id);
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toContain("done=ownerGone");
  });

  it("Yes from the dashboard's own origin acts once; a second Yes writes nothing", async () => {
    const { c } = await ownedCat("sureyes");
    const first = await removeOwner(c.id);
    expect(first.headers["location"]).toContain("done=ownerRemoved");
    const second = await removeOwner(c.id);
    expect(second.headers["location"]).toContain("done=ownerGone");
    expect(await withdrawals(c.id)).toHaveLength(1);
  });

  it("Yes from another origin is refused, and nothing changes", async () => {
    const { c, d } = await ownedCat("sureorigin");
    const res = await request(app)
      .post(`/api/team/cats/${c.id}/remove-owner`)
      .set("Origin", "https://evil.catspotters.com")
      .set("Cookie", cookie)
      .type("form")
      .send({ reason: "x", confirm: "1" });
    expect(res.status).toBe(401);
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
  });

  it("without the capability, the question isn't even asked", async () => {
    const { c } = await ownedCat("surecap");
    denied.cap = "remove_owner";
    const res = await unconfirmed(c.id);
    denied.cap = null;
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("Are you sure");
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
    const { c, d } = await ownedCat("lock");
    const [h] = await homed(c.id);
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
      // The owner lets go meanwhile (as the let-go route does): their homed is
      // withdrawn and the link cleared.
      await writeObservation(tx, {
        catId: c.id, kind: "life_status", value: { withdrawn: true }, allowWithdrawal: true, deviceId: d.id,
        roleAtTime: "public", authorityScope: "owner_of_this_cat", observedAt: new Date(), supersedesId: h!.id,
      });
      await tx.update(catsTable).set({ ownerDeviceId: null, homeDescription: null }).where(eq(catsTable.id, c.id));
    });
    const res = await waiting!;
    expect(res.headers["location"]).toMatch(/done=ownerGone/);
    expect(await withdrawals(c.id)).toHaveLength(1);
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

// ── Final review fixes ─────────────────────────────────────────────────────

const jsonSupersede = (id: number, value: unknown, reason = "r") =>
  request(app)
    .post(`/api/team/observations/${id}/supersede`)
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", cookie)
    .send({ value, reason });
const deleteMe = (p: Phone) =>
  request(app).delete("/api/me").set("X-Device-Id", p.id).set("X-Device-Secret", p.secret);

describe("final review 1: a withdrawal only ever comes from a let-go or Remove owner", () => {
  it("the supersede API refuses {withdrawn:true} against an owner's homed, and nothing changes", async () => {
    const { c, d } = await ownedCat("fr1owner");
    const [h] = await homed(c.id);
    const before = await lifeRows(c.id);
    const res = await jsonSupersede(h!.id, { withdrawn: true });
    expect(res.status).toBe(400);
    expect(await lifeRows(c.id)).toEqual(before);
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
  });

  it("nor against a team-written homed", async () => {
    const c = await streetCat();
    const h = await writeObservation(db, {
      catId: c.id, kind: "life_status", value: { status: "homed" }, accountId: susanId, roleAtTime: "staff", observedAt: daysAgo(2),
    });
    const res = await jsonSupersede(h.id, { withdrawn: true });
    expect(res.status).toBe(400);
    expect(await withdrawals(c.id)).toHaveLength(0);
  });

  it("the fresh-statement API and the Mark wrong form can't write one either", async () => {
    const { c } = await ownedCat("fr1fresh");
    const [h] = await homed(c.id);
    const before = await lifeRows(c.id);
    const fresh = await request(app)
      .post("/api/team/observations")
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ catId: c.id, kind: "life_status", value: { withdrawn: true }, reason: "r" });
    expect(fresh.status).toBe(400);
    const formRes = await form(`/api/team/statements/${h!.id}/wrong`).send({ choice: "withdrawn", reason: "r" });
    expect(formRes.status).toBe(400);
    expect(await lifeRows(c.id)).toEqual(before);
  });
});

describe("final review 2: an owner's homed is ended only by Remove owner", () => {
  it("offers no Mark wrong on it, but points to Remove owner", async () => {
    const { c } = await ownedCat("fr2page");
    const [h] = await homed(c.id);
    const html = (await page(c.id)).text;
    expect(html).not.toContain(`/api/team/statements/${h!.id}/wrong`);
    expect(html).toContain("To end this claim, use Remove owner");
  });

  it("the form route and the supersede API both refuse it, with nothing written", async () => {
    const { c, d } = await ownedCat("fr2route");
    const [h] = await homed(c.id);
    const before = await lifeRows(c.id);
    const a = await form(`/api/team/statements/${h!.id}/wrong`).send({ choice: "street", reason: "x" });
    expect(a.status).toBe(400);
    const b = await jsonSupersede(h!.id, { status: "street" });
    expect(b.status).toBe(400);
    expect(await lifeRows(c.id)).toEqual(before);
    expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
  });

  it("a team-written homed can still be marked wrong", async () => {
    const c = await streetCat();
    const h = await writeObservation(db, {
      catId: c.id, kind: "life_status", value: { status: "homed" }, accountId: susanId, roleAtTime: "staff", observedAt: daysAgo(2),
    });
    expect((await page(c.id)).text).toContain(`/api/team/statements/${h.id}/wrong`);
    expect((await form(`/api/team/statements/${h.id}/wrong`).send({ choice: "street", reason: "x" })).status).toBe(303);
  });
});

describe("final review 3: a home whose owner deleted their data can be removed", () => {
  it("D13 path: delete, then the page says so and Remove owner clears it, then another phone can claim", async () => {
    const { c, d, note } = await ownedCat("fr3");
    const other = phone("fr3-other");
    await met(c.id, other);
    await bind(other);
    expect((await deleteMe(d)).status).toBe(204);
    const gone = await reload(c.id);
    expect(gone.ownerDeviceId).toBeNull();
    expect(gone.homeDescription).toBe(note);
    // Stuck for everyone until the team acts.
    expect((await claim(c.id, other)).status).toBe(409);

    const html = (await page(c.id)).text;
    expect(html).toContain("Has a home, but the owner deleted their data");
    expect(html).toContain(`/api/team/cats/${c.id}/remove-owner"`);
    expect(html).toContain("This cat has an owner. Saving anything but “Has a home” asks you first");

    const res = await removeOwner(c.id, { reason: "Owner deleted their data" });
    expect(res.headers["location"]).toMatch(/done=ownerRemoved/);
    expect(await withdrawals(c.id)).toHaveLength(1);
    expect(await reload(c.id)).toMatchObject({ ownerDeviceId: null, homeDescription: null, homeLat: null, homeLng: null });
    expect((await teamStatements(c.id))[0]!.value).toMatchObject({ status: "street" });
    expect((await detail(c.id)).body.cat.hasHome).toBe(false);
    expect((await detail(c.id, other)).body.canClaim).toBe(true);
    expect((await claim(c.id, other)).status).toBe(200);
    // The page no longer says the home is orphaned.
    expect((await page(c.id)).text).not.toContain("owner deleted their data");
  });

  it("the life-status form asks first on such a cat too, and Yes removes the home", async () => {
    const { c, d } = await ownedCat("fr3tick");
    expect((await deleteMe(d)).status).toBe(204);
    const ask = await form(`/api/team/cats/${c.id}/life-status`).send({ status: "street", reason: "x" });
    expect(ask.status).toBe(200);
    expect(ask.text).toContain("also removes the owner");
    const res = await form(`/api/team/cats/${c.id}/life-status`).send({ status: "street", reason: "x", confirm: "1" });
    expect(res.headers["location"]).toMatch(/done=ownerRemoved/);
    expect(await withdrawals(c.id)).toHaveLength(1);
    expect((await detail(c.id)).body.cat.hasHome).toBe(false);
  });

  it("a cat that is simply not homed still says there is nothing to remove", async () => {
    const c = await streetCat();
    expect((await removeOwner(c.id)).headers["location"]).toMatch(/done=ownerGone/);
    expect((await page(c.id)).text).not.toContain("/remove-owner");
  });
});

describe("final review 4: a let-go stays the owner's after they delete their data", () => {
  it("still reads as the owner's words and keeps the internal note out", async () => {
    const { c, d } = await ownedCat("fr4");
    expect((await letGo(c.id, d)).status).toBe(200);
    expect((await deleteMe(d)).status).toBe(204);
    const html = (await page(c.id)).text;
    expect(html).toMatch(/The owner said the cat doesn(&#39;|')t live with them any more/);
    expect(html).not.toContain("Owner removed by the team");
    expect(html).not.toContain("owner: doesn");
  });
});

describe("ship review 2: a merged-in cat's owner claim is not this cat's", () => {
  it("the canonical cat shows no orphaned home or Remove owner for it, and its own page still does", async () => {
    const a = await streetCat();
    const { c: b, d } = await ownedCat("mergedin");
    const [h] = await homed(b.id);
    expect((await deleteMe(d)).status).toBe(204);
    // The merge route refuses this now (an owner's "has a home" still
    // standing on the merged-away cat: OWNER_MUST_STAY, PR 4.1), so this is
    // data from before that rule: a recorded merge, with B's sightings moved
    // to A, written by the test.
    const mergeId = await recordedMerge(b.id, a.id, undefined, "vitest");
    try {
      const staff = { id: susanId, scopes: [{ role: "staff", colonyId: null }] };
      const view = (await teamCatView(a.id, new Date(), staff))!;
      // The merged-in cat's records are folded in, so its homed is in the history…
      expect(view.history.some((s) => s.id === h!.id)).toBe(true);
      // …but it is not this cat's claim: Remove owner (scoped to this cat) couldn't end it.
      expect(view.owner.orphanedHome).toBe(false);
      expect(view.history.find((s) => s.id === h!.id)!.ownerClaim).toBe(false);
      const html = (await page(a.id)).text;
      expect(html).not.toContain("owner deleted their data");
      expect(html).not.toContain(`/api/team/cats/${a.id}/remove-owner"`);
      // The merged-in cat's own view still holds the claim…
      expect((await teamCatView(b.id, new Date(), staff))!.owner.orphanedHome).toBe(true);
      // …and its own page (SYC-59 PR 4.2) says it was merged into A. It draws no write form: every
      // team correction acts on the cat a cat is part of now (`catOf`), so Remove owner posted from
      // here would look for the owner on A and find none. (A claim on a merged-away cat is data from
      // before the merge route refused it, OWNER_MUST_STAY; it is ended by undoing the merge.)
      const merged = (await page(b.id)).text;
      expect(merged).toContain("was merged into");
      expect(merged).not.toContain(`/api/team/cats/${b.id}/remove-owner"`);
    } finally {
      // cat_identity is append-only: undo the merge (a row that supersedes it, and its moves back).
      await recordedUndo(mergeId);
    }
  });
});

describe("the capability", () => {
  it("remove_owner is on the list, island-only, and the team holds it (SYC-53 PR 0.5 catalogue)", () => {
    expect([...CAPABILITIES]).toContain("remove_owner");
    expect(CATALOGUE.remove_owner).toEqual({ kind: "island", roles: ["staff", "management"] });
  });
});
