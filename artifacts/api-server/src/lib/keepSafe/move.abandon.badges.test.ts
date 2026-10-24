/**
 * SYC-706: a phone that leaves its own spotter behind through "get your spots
 * back" (abandonCurrent, no delete) keeps that spotter's badges, points and
 * podium place, since the credential is retired and nothing can read them.
 * Waiting celebrations can never be played, so they go.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import {
  db,
  badgeMomentsTable,
  pointsLedgerTable,
  pool,
  spotterBadgesTable,
  weeklyResultsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import app from "../../app";
import { settleOutbox } from "../mail/outbox";
import { normaliseAddress } from "../mail/fingerprint";
import { __setRestorePadForTest } from "../../routes/keepSafe";
import { installFakeResend, tokenFrom, type SentMail } from "../../test/fakeResend";

const RUN = randomBytes(3).toString("hex");
const P = `vitest-mvbadge-${RUN}`;
type Phone = { id: string; secret: string };
let n = 0;
const newPhone = (): Phone => ({ id: `${P}-${++n}`, secret: randomBytes(24).toString("hex") });
let ipN = 0;
const freshIp = () => `198.52.${Math.floor(++ipN / 250)}.${ipN % 250}`;
const newAddress = () => `Parent.${RUN}.${++n}@Example.org`;

let sent: SentMail[];
const saved = { ...process.env };
const ledgerIds: number[] = [];
const resultIds: number[] = [];

beforeEach(() => {
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  delete process.env["PUBLIC_APP_ORIGIN"];
  sent = installFakeResend();
  __setRestorePadForTest(30);
});
afterEach(async () => {
  await settleOutbox();
  __setRestorePadForTest(null);
  vi.unstubAllGlobals();
  process.env = { ...saved };
});
afterAll(async () => {
  for (const id of ledgerIds) await db.delete(pointsLedgerTable).where(eq(pointsLedgerTable.sightingId, id));
  for (const id of resultIds) await db.delete(weeklyResultsTable).where(eq(weeklyResultsTable.id, id));
  await db.execute(sql`delete from spotter_badges where device_id like ${P + "%"}`);
  await db.execute(sql`delete from badge_moments where device_id like ${P + "%"}`);
  await db.execute(sql`delete from profiles where device_id like ${P + "%"}`);
  await pool.end();
});

const mailTo = (email: string) => sent.filter((m) => m.to === normaliseAddress(email));

async function bind(phone: Phone) {
  const res = await request(app).get(`/api/profiles/${phone.id}/username`).set("X-Device-Secret", phone.secret);
  expect(res.status).toBe(200);
}
async function claim(phone: Phone, username: string) {
  const res = await request(app)
    .post(`/api/profiles/${phone.id}/username`)
    .set("X-Device-Secret", phone.secret)
    .send({ username });
  expect(res.status).toBe(200);
}

/** A spotter with a username and a confirmed keep-safe address. */
async function keptSafe(email: string): Promise<Phone & { username: string }> {
  const phone = newPhone();
  await bind(phone);
  const username = `Ks${RUN}${++n}`;
  await claim(phone, username);
  const add = await request(app)
    .post(`/api/keep-safe/${phone.id}`)
    .set("X-Device-Secret", phone.secret)
    .set("X-Forwarded-For", freshIp())
    .send({ email, language: "en", wordingVersion: "keep_safe.v1", surface: "onboarding" });
  expect(add.status).toBe(200);
  await settleOutbox();
  const mail = mailTo(email).at(-1)!;
  const confirm = await request(app)
    .post("/api/mail/confirm")
    .set("Origin", "https://apptest.catspotters.com")
    .type("form")
    .send({ t: tokenFrom(mail, "/api/mail/confirm") });
  expect(confirm.status).toBe(200);
  return { ...phone, username };
}

async function askAndGetToken(phone: Phone, email: string): Promise<string> {
  const before = mailTo(email).length;
  const res = await request(app)
    .post("/api/restore/request")
    .set("X-Device-Secret", phone.secret)
    .set("X-Forwarded-For", freshIp())
    .send({ deviceId: phone.id, email });
  expect(res.status).toBe(202);
  await settleOutbox();
  expect(mailTo(email).length).toBe(before + 1);
  return tokenFrom(mailTo(email).at(-1)!, "/restore");
}

describe("abandoning a spotter by getting your spots back", () => {
  it("keeps its badges, points and podium place, and drops its waiting celebrations", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const nikos = newPhone();
    await bind(nikos);
    await claim(nikos, `Nikos${RUN}${++n}`);

    const sightingId = 2_000_000_000 + Math.floor(Math.random() * 100_000_000);
    ledgerIds.push(sightingId);
    await db.insert(pointsLedgerTable).values({
      deviceId: nikos.id, sightingId, catId: 1, points: 15,
      athensDay: "2001-01-03", weekStart: "2001-01-01", source: "live",
    });
    await db.insert(spotterBadgesTable).values({ deviceId: nikos.id, badgeId: "weeks_2", source: "live" });
    await db.insert(badgeMomentsTable).values([
      { deviceId: nikos.id, kind: "badges", badgeIds: ["weeks_2"] },
      { deviceId: nikos.id, kind: "week_result", badgeIds: [], weekStart: "2001-01-01", place: 1, weekPoints: 15 },
    ]);
    const [podium] = await db
      .insert(weeklyResultsTable)
      .values({ weekStart: "2001-01-01", place: 1, deviceId: nikos.id, displayName: "Nikos", points: 15 })
      .returning();
    resultIds.push(podium!.id);

    const token = await askAndGetToken(nikos, email);
    const r = await request(app)
      .post("/api/restore/redeem")
      .set("X-Device-Secret", nikos.secret)
      .set("X-Forwarded-For", freshIp())
      .send({ deviceId: nikos.id, token, spotterDeviceId: old.id, abandonCurrent: true });
    expect(r.status).toBe(200);

    expect(await db.select().from(badgeMomentsTable).where(eq(badgeMomentsTable.deviceId, nikos.id))).toEqual([]);
    expect(await db.select().from(spotterBadgesTable).where(eq(spotterBadgesTable.deviceId, nikos.id))).toHaveLength(1);
    expect(await db.select().from(pointsLedgerTable).where(eq(pointsLedgerTable.sightingId, sightingId))).toMatchObject([
      { deviceId: nikos.id, points: 15 },
    ]);
    expect(await db.select().from(weeklyResultsTable).where(eq(weeklyResultsTable.id, podium!.id))).toMatchObject([
      { deviceId: nikos.id, displayName: "Nikos" },
    ]);
  });
});
