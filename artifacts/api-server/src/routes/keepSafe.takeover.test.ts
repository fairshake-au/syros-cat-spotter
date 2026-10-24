/**
 * SYC-3 Slice 1: "keep my spots safe" and "get your spots back", end to end
 * through the real app. Plan tests 1–12 and 16 (the takeover attempts first).
 * Every (M) test has a mutation check recorded in the PR.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

import {
  db,
  catSubscriptionsTable,
  catUnfollowsTable,
  catsTable,
  deviceCredentialsTable,
  emailConsentEventsTable,
  emailContactsTable,
  mailTokensTable,
  pool,
  profilesTable,
  pushTokensTable,
  sightingsTable,
  welfareReportsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import app from "../app";
import { settleOutbox } from "../lib/mail/outbox";
import { addressFingerprint, deviceFingerprint, normaliseAddress } from "../lib/mail/fingerprint";
import { __setMoveHookForTest } from "../lib/keepSafe/move";
import { severKeepSafe } from "../lib/keepSafe/sever";
import { hashSecret } from "../lib/deviceAuth";
import { __setRestorePadForTest, SENT_IF_KNOWN } from "./keepSafe";
import { installFakeResend, tokenFrom, type SentMail } from "../test/fakeResend";

const here = path.dirname(fileURLToPath(import.meta.url));
const RUN = randomBytes(3).toString("hex");
const P = `vitest-ks-${RUN}`;
const ORIGIN = "https://apptest.catspotters.com";

type Phone = { id: string; secret: string };
let n = 0;
const newPhone = (): Phone => ({ id: `${P}-${++n}`, secret: randomBytes(24).toString("hex") });
let ipN = 0;
const freshIp = () => `198.51.${Math.floor(++ipN / 250)}.${ipN % 250}`;
const newAddress = () => `Parent.${RUN}.${++n}@Example.org`;

let sent: SentMail[];
let mailDelayMs = 0;
const saved = { ...process.env };

beforeEach(() => {
  spies.logLines.length = 0;
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  delete process.env["PUBLIC_APP_ORIGIN"];
  mailDelayMs = 0;
  sent = installFakeResend();
  const fake = globalThis.fetch;
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
    if (mailDelayMs) await new Promise((r) => setTimeout(r, mailDelayMs));
    return fake(...args);
  });
  __setRestorePadForTest(30);
});
afterEach(async () => {
  await settleOutbox();
  __setMoveHookForTest(null);
  __setRestorePadForTest(null);
  vi.unstubAllGlobals();
  process.env = { ...saved };
});
afterAll(async () => {
  // Leave no named spotters or cats behind: later files read the leaderboard.
  await db.execute(sql`delete from cats where discoverer_device_id like ${P + "%"} or owner_device_id like ${P + "%"}`);
  await db.execute(sql`delete from profiles where device_id like ${P + "%"}`);
  await db.execute(sql`delete from push_tokens where device_id like ${P + "%"}`);
  await pool.end();
});

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Age every "is this you?" event by 25 hours, so the next add for an address
 * may send again (§4.4's one-per-24-hours). The consent table is append-only,
 * so the test switches its trigger off for the one statement.
 */
async function ageVerifyEmails() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`alter table email_consent_events disable trigger email_consent_events_append_only`);
    await tx.execute(sql`update email_consent_events set occurred_at = occurred_at - interval '25 hours' where event = 'verify_sent'`);
    await tx.execute(sql`alter table email_consent_events enable trigger email_consent_events_append_only`);
  });
}

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

function add(phone: Phone, email: string, ip = freshIp()) {
  return request(app)
    .post(`/api/keep-safe/${phone.id}`)
    .set("X-Device-Secret", phone.secret)
    .set("X-Forwarded-For", ip)
    .send({ email, language: "en", wordingVersion: "keep_safe.v1", surface: "onboarding" });
}

const mailTo = (email: string) => sent.filter((m) => m.to === normaliseAddress(email));

function postMailPage(action: "confirm" | "forget", token: string, origin = ORIGIN) {
  return request(app).post(`/api/mail/${action}`).set("Origin", origin).type("form").send({ t: token });
}

/** A spotter with a username and a confirmed keep-safe address. */
async function keptSafe(email: string, username = `Ks${RUN}${++n}`): Promise<Phone & { username: string }> {
  const phone = newPhone();
  await bind(phone);
  await claim(phone, username);
  await ageVerifyEmails();
  expect((await add(phone, email)).status).toBe(200);
  await settleOutbox();
  const mail = mailTo(email).at(-1)!;
  expect((await postMailPage("confirm", tokenFrom(mail, "/api/mail/confirm"))).status).toBe(200);
  return { ...phone, username };
}

function ask(phone: Phone, email: string, ip = freshIp(), host?: string) {
  const req = request(app).post("/api/restore/request").set("X-Device-Secret", phone.secret).set("X-Forwarded-For", ip);
  if (host) req.set("Host", host);
  return req.send({ deviceId: phone.id, email });
}

async function askAndGetToken(phone: Phone, email: string): Promise<string> {
  const before = mailTo(email).length;
  expect((await ask(phone, email)).status).toBe(202);
  await settleOutbox();
  const mails = mailTo(email);
  expect(mails.length).toBe(before + 1);
  return tokenFrom(mails.at(-1)!, "/restore");
}

// Each from its own address: peek and redeem are limited to 30 per IP per hour.
function peek(phone: Phone, token: string) {
  return request(app)
    .post("/api/restore/peek")
    .set("X-Device-Secret", phone.secret)
    .set("X-Forwarded-For", freshIp())
    .send({ deviceId: phone.id, token });
}

function redeem(phone: Phone, token: string, spotterDeviceId: string, extra: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/restore/redeem")
    .set("X-Device-Secret", phone.secret)
    .set("X-Forwarded-For", freshIp())
    .send({ deviceId: phone.id, token, spotterDeviceId, ...extra });
}

async function storedHash(deviceId: string) {
  const [row] = await db.select().from(deviceCredentialsTable).where(eq(deviceCredentialsTable.deviceId, deviceId));
  return row?.secretHash;
}

/** A brand-new phone that asked for a link for `email`, and the link's token. */
async function newPhoneWithLink(email: string) {
  const phone = newPhone();
  await bind(phone);
  return { phone, token: await askAndGetToken(phone, email) };
}

// ── the happy path ─────────────────────────────────────────────────────────

describe("the round trip", () => {
  it("add → confirm → a new phone asks → peek → redeem: the new phone is the spotter, the old one is told it moved", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    await db.insert(pushTokensTable).values({ deviceId: old.id, token: "ExponentPushToken[old]" });
    const { phone, token } = await newPhoneWithLink(email);

    const p = await peek(phone, token);
    expect(p.status).toBe(200);
    // Decision 12: an opaque choice id, never the spotter's device id.
    expect(p.body).toEqual({
      spotters: [{ choice: expect.stringMatching(/^[0-9a-f]{24}$/), username: old.username }],
      openedOnAskingPhone: true,
      alreadyHere: null,
    });
    expect(JSON.stringify(p.body)).not.toContain(old.id);

    const r = await redeem(phone, token, old.id);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ deviceId: old.id, username: old.username });

    // The new phone keeps its own secret and now acts as the spotter.
    const profile = await request(app).get(`/api/profiles/${old.id}`).set("X-Device-Secret", phone.secret);
    expect(profile.status).toBe(200);
    expect(profile.body.username).toBe(old.username);
    // The old phone's next request.
    const stale = await request(app).get(`/api/profiles/${old.id}`).set("X-Device-Secret", old.secret);
    expect(stale.status).toBe(403);
    expect(stale.body).toEqual({ error: "device_moved" });
    // Its push token is gone; the new phone's starter id is retired, not deleted.
    expect(await db.select().from(pushTokensTable).where(eq(pushTokensTable.deviceId, old.id))).toHaveLength(0);
    expect(await storedHash(phone.id)).toBe("retired");
    // Still kept safe on the new phone.
    const ks = await request(app).get(`/api/keep-safe/${old.id}`).set("X-Device-Secret", phone.secret);
    expect(ks.body).toMatchObject({ status: "confirmed", addressMask: expect.stringMatching(/^p•••@example\.org$/) });
  });
  it("SYC-624 B7: follows and unfollow records made under the spotter's id still apply on the new phone, with no code", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const mk = async (name: string) =>
      (await db.insert(catsTable).values({ name: `${P}-${name}`, primaryPhotoId: 0, lat: 37.4, lng: 24.9, discovererDeviceId: `${P}-other` }).returning())[0]!;
    const followed = await mk("followed");
    const unfollowed = await mk("unfollowed");
    await db.insert(catSubscriptionsTable).values({ deviceId: old.id, catId: followed.id });
    await db.insert(catUnfollowsTable).values({ deviceId: old.id, catId: unfollowed.id });
    const { phone, token } = await newPhoneWithLink(email);
    expect((await redeem(phone, token, old.id)).status).toBe(200);

    const page = (catId: number, secret: string) =>
      request(app).get(`/api/cats/${catId}`).set("X-Device-Id", old.id).set("X-Device-Secret", secret);
    const a = await page(followed.id, phone.secret);
    expect(a.status).toBe(200);
    expect(a.body.isFollowing).toBe(true);
    const b = await page(unfollowed.id, phone.secret);
    expect(b.body.isFollowing).toBe(false);
    // The unfollow record is still there, so spotting the cat again won't re-follow it.
    const rows = await db.select().from(catUnfollowsTable).where(eq(catUnfollowsTable.deviceId, old.id));
    expect(rows.map((r) => r.catId)).toEqual([unfollowed.id]);
  });
});

// ── takeover attempts ──────────────────────────────────────────────────────

describe("1. a username restores nothing", () => {
  it("no restore route takes a username; a link for A's address can't move B, even naming B (M)", async () => {
    const emailA = newAddress();
    const a = await keptSafe(emailA);
    const b = await keptSafe(newAddress());
    const { phone, token } = await newPhoneWithLink(emailA);

    const byName = await request(app)
      .post("/api/restore/redeem")
      .set("X-Device-Secret", phone.secret)
      .send({ deviceId: phone.id, token, username: b.username });
    expect(byName.status).toBe(401);
    expect(byName.body).toEqual({ error: "link_not_valid" });

    const r = await redeem(phone, token, b.id, { username: b.username });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "link_not_valid" });
    expect(await storedHash(b.id)).toBe(hashSecret(b.secret));
    expect(await storedHash(a.id)).toBe(hashSecret(a.secret));
    // And the link still works for A (a refusal didn't spend it).
    expect((await redeem(phone, token, a.id)).status).toBe(200);
  });

  it("a restore request carrying only a username sends nothing", async () => {
    const a = await keptSafe(newAddress());
    const phone = newPhone();
    await bind(phone);
    const before = sent.length;
    const res = await request(app)
      .post("/api/restore/request")
      .set("X-Device-Secret", phone.secret)
      .send({ deviceId: phone.id, username: a.username });
    expect(res.status).toBe(400);
    await settleOutbox();
    expect(sent.length).toBe(before);
  });
});

describe("2. a replayed link", () => {
  it("the same phone within the replay window gets the same answer and nothing moves twice; after it, it's refused (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    const first = await redeem(phone, token, old.id);
    expect(first.status).toBe(200);
    const hashAfter = await storedHash(old.id);
    const again = await redeem(phone, token, old.id);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await storedHash(old.id)).toBe(hashAfter);
    const [tok] = await db.select().from(mailTokensTable).where(eq(mailTokensTable.restoredDeviceId, old.id));
    expect(tok!.replacedSecretHash).toBe(hashSecret(old.secret));

    await db.execute(sql`update mail_tokens set used_at = now() - interval '15 minutes 1 second' where restored_device_id = ${old.id}`);
    const late = await redeem(phone, token, old.id);
    // Refused: the phone's starter id was retired by the move.
    expect([401, 403]).toContain(late.status);
    expect(await storedHash(old.id)).toBe(hashAfter);
  });

  it("SYC-664 ship N-1: replayOnly with no move behind it is refused and moves (or deletes) nothing; the link still works after (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const nikos = await keptSafe(newAddress());
    const token = await askAndGetToken(nikos, email);
    const r = await redeem(nikos, token, old.id, { replayOnly: true, abandonCurrent: true, deleteCurrent: true });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "link_not_valid" });
    expect(await storedHash(old.id)).toBe(hashSecret(old.secret));
    expect(await storedHash(nikos.id)).toBe(hashSecret(nikos.secret));
    const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.deviceId, nikos.id));
    expect(profile?.username).toBe(nikos.username);
    const [tok] = await db.select().from(mailTokensTable).where(eq(mailTokensTable.deviceId, nikos.id));
    expect(tok?.usedAt ?? null).toBeNull();
    // Not spent: the person can still move with it.
    expect((await redeem(nikos, token, old.id, { abandonCurrent: true })).status).toBe(200);
  });

  it("SYC-664 ship N-1: replayOnly from the phone that made the move gets the same answer", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    const first = await redeem(phone, token, old.id);
    expect(first.status).toBe(200);
    const again = await redeem(phone, token, old.id, { replayOnly: true });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
  });

  it("SYC-664 ship F2: the same phone's retry is answered at 14 minutes and refused at 16 (the 15-minute replay window) (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    const first = await redeem(phone, token, old.id);
    expect(first.status).toBe(200);
    const hashAfter = await storedHash(old.id);

    await db.execute(sql`update mail_tokens set used_at = now() - interval '14 minutes' where restored_device_id = ${old.id}`);
    const at14 = await redeem(phone, token, old.id);
    expect(at14.status).toBe(200);
    expect(at14.body).toEqual(first.body);

    await db.execute(sql`update mail_tokens set used_at = now() - interval '16 minutes' where restored_device_id = ${old.id}`);
    const at16 = await redeem(phone, token, old.id);
    expect([401, 403]).toContain(at16.status);
    expect(await storedHash(old.id)).toBe(hashAfter);
  });

  it("SYC-664 ship F1: the same phone's retry is answered even when its network's redeem allowance is used up (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    const ip = freshIp();
    const fromIp = (body: Record<string, unknown>, secret = phone.secret) =>
      request(app).post("/api/restore/redeem").set("X-Device-Secret", secret).set("X-Forwarded-For", ip).send(body);
    const first = await fromIp({ deviceId: phone.id, token, spotterDeviceId: old.id });
    expect(first.status).toBe(200);
    // Use up the rest of this network's hour (30 a hour).
    for (let i = 0; i < 30; i++) await fromIp({ deviceId: `${P}-junk`, token: "x" }, "junk-secret-junk-secret");
    const blocked = await fromIp({ deviceId: `${P}-junk`, token: "x" }, "junk-secret-junk-secret");
    expect(blocked.status).toBe(429);
    const again = await fromIp({ deviceId: phone.id, token, spotterDeviceId: old.id });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
  });

  it("a used link can't move a second spotter, even within the replay window", async () => {
    const email = newAddress();
    const one = await keptSafe(email);
    const two = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    expect((await redeem(phone, token, one.id)).status).toBe(200);
    expect([401, 403]).toContain((await redeem(phone, token, two.id)).status);
    expect(await storedHash(two.id)).toBe(hashSecret(two.secret));
  });

  it("two simultaneous redeems: exactly one wins", async () => {
    const email = newAddress();
    const one = await keptSafe(email);
    const two = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    const results = await Promise.all([redeem(phone, token, one.id), redeem(phone, token, two.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    const moved = [await storedHash(one.id), await storedHash(two.id)].filter((h) => h === hashSecret(phone.secret));
    expect(moved).toHaveLength(1);
  });
});

describe("3. the link on a second device (Decision 12, Samuel 11–12 Oct 2026)", () => {
  it("3′. a phone other than the one that asked can use the link: the spots move to the phone that presses, never to the phone that asked (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone: asker, token } = await newPhoneWithLink(email);
    const opener = newPhone();
    await bind(opener);
    const p = await peek(opener, token);
    expect(p.status).toBe(200);
    expect(p.body.openedOnAskingPhone).toBe(false);
    const r = await redeem(opener, token, "", { choice: p.body.spotters[0].choice });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ deviceId: old.id, username: old.username });
    expect(await storedHash(old.id)).toBe(hashSecret(opener.secret));
    // The phone that asked got nothing, and is untouched.
    expect(await storedHash(asker.id)).toBe(hashSecret(asker.secret));
    // The old phone is told it moved.
    const stale = await request(app).get(`/api/profiles/${old.id}`).set("X-Device-Secret", old.secret);
    expect(stale.body).toEqual({ error: "device_moved" });
  });

  it("3″. a caller that already is the spotter is told it's already here, and nothing moves", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { token } = await newPhoneWithLink(email);
    const p = await peek(old, token);
    expect(p.status).toBe(200);
    expect(p.body).toEqual({ spotters: [], openedOnAskingPhone: false, alreadyHere: { username: old.username } });
    const r = await redeem(old, token, old.id);
    expect(r.status).toBe(401);
    expect(await storedHash(old.id)).toBe(hashSecret(old.secret));
  });

  it("3″. \"already here\" never masks an address that keeps nobody safe (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    // The address is forgotten after the link went out: nobody is kept safe now.
    await db.execute(sql`delete from email_contacts where device_id = ${old.id}`);
    const p = await peek(phone, token);
    expect(p.status).toBe(401);
    expect(p.body).toEqual({ error: "link_not_valid" });
  });

  it("a picker choice moves exactly that spotter; a made-up choice, or one from another link, is refused without using the link up (M)", async () => {
    const email = newAddress();
    const lili = await keptSafe(email);
    const nikos = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    const p = await peek(phone, token);
    const pick = (name: string) => p.body.spotters.find((s: { username: string }) => s.username === name).choice as string;
    // A choice from another link for the same address.
    const other = await newPhoneWithLink(email);
    const otherPick = (await peek(other.phone, other.token)).body.spotters.find((s: { username: string }) => s.username === nikos.username).choice;
    for (const bad of ["0".repeat(24), otherPick]) {
      const r = await redeem(phone, token, "", { choice: bad });
      expect(r.status).toBe(401);
    }
    // The link still works, and moves exactly the spotter picked.
    const r = await redeem(phone, token, "", { choice: pick(nikos.username) });
    expect(r.status).toBe(200);
    expect(r.body.deviceId).toBe(nikos.id);
    expect(await storedHash(nikos.id)).toBe(hashSecret(phone.secret));
    expect(await storedHash(lili.id)).toBe(hashSecret(lili.secret));
  });

  it("a phone can't \"restore\" onto itself, even saying abandonCurrent: refused, nothing changed (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { token } = await newPhoneWithLink(email);
    const r = await redeem(old, token, old.id, { abandonCurrent: true });
    expect(r.status).toBe(401);
    expect(await storedHash(old.id)).toBe(hashSecret(old.secret));
    // And the link wasn't used up.
    const [tok] = (await db.execute(sql`select used_at from mail_tokens where token_hash = encode(sha256(${token}::bytea), 'hex')`)).rows as { used_at: Date | null }[];
    expect(tok?.used_at ?? null).toBeNull();
  });

  it("a third phone replaying a used link within the replay window gets link_not_valid and no name (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    expect((await redeem(phone, token, old.id)).status).toBe(200);
    const third = newPhone();
    await bind(third);
    const r = await redeem(third, token, old.id);
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.body)).not.toContain(old.username);
  });

  it("deleting the phone that asked keeps someone else's old phone told \"moved\" (Decision 12 review, finding 6)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone: asker, token } = await newPhoneWithLink(email);
    const opener = newPhone();
    await bind(opener);
    expect((await redeem(opener, token, old.id)).status).toBe(200);
    await db.transaction((tx) => severKeepSafe(tx, asker.id, "deleted by the person"));
    const stale = await request(app).get(`/api/profiles/${old.id}`).set("X-Device-Secret", old.secret);
    expect(stale.body).toEqual({ error: "device_moved" });
    // And the asker's raw id survives nowhere on the link.
    const rows = await db.execute(sql`select 1 from mail_tokens where device_id = ${asker.id}`);
    expect(rows.rows).toHaveLength(0);
  });
});

/**
 * Every route that acts as a spotter. A source scan below fails if a route
 * file gains a device-secret check this list doesn't cover.
 */
type Probe = { name: string; file: string; call: (id: string, secret: string, ctx: { sightingId: number; catId: number; publicId: string }) => request.Test };
const PROBES: Probe[] = [
  { name: "GET /profiles/:id", file: "profiles.ts", call: (id, s) => request(app).get(`/api/profiles/${id}`).set("X-Device-Secret", s) },
  { name: "PATCH /profiles/:id", file: "profiles.ts", call: (id, s) => request(app).patch(`/api/profiles/${id}`).set("X-Device-Secret", s).send({ nickname: "x" }) },
  { name: "GET /profiles/:id/username", file: "profiles.ts", call: (id, s) => request(app).get(`/api/profiles/${id}/username`).set("X-Device-Secret", s) },
  { name: "POST /profiles/:id/username", file: "profiles.ts", call: (id, s) => request(app).post(`/api/profiles/${id}/username`).set("X-Device-Secret", s).send({ username: "Anything" }) },
  // SYC-63: an old phone whose spotter moved can't delete the spotter who now
  // lives on the new phone; it gets device_moved like every other route.
  { name: "DELETE /me", file: "profiles.ts", call: (id, s) => request(app).delete("/api/me").set("X-Device-Id", id).set("X-Device-Secret", s) },
  { name: "GET /notifications/:id", file: "notifications.ts", call: (id, s) => request(app).get(`/api/notifications/${id}`).set("X-Device-Secret", s) },
  { name: "POST /notifications/:id/read-all", file: "notifications.ts", call: (id, s) => request(app).post(`/api/notifications/${id}/read-all`).set("X-Device-Secret", s) },
  { name: "POST /notifications/:id/:n/read", file: "notifications.ts", call: (id, s) => request(app).post(`/api/notifications/${id}/1/read`).set("X-Device-Secret", s) },
  { name: "PUT /profile/:id/push-token", file: "notifications.ts", call: (id, s) => request(app).put(`/api/profile/${id}/push-token`).set("X-Device-Secret", s).send({ token: "ExponentPushToken[x]" }) },
  // SYC-36: the match-wait resident signals (a moved phone is told so, like everywhere else).
  { name: "GET /app-settings/:id/signals", file: "appSettings.ts", call: (id, s) => request(app).get(`/api/app-settings/${id}/signals`).set("X-Device-Secret", s) },
  { name: "POST /sightings", file: "sightings.ts", call: (id, s) => request(app).post("/api/sightings").set("X-Device-Secret", s).set("X-Forwarded-For", freshIp()).send({ deviceId: id, lat: 37.44, lng: 24.9, photoBase64: "AAAA" }) },
  { name: "POST /sightings/:id/resolve", file: "sightings.ts", call: (id, s, c) => request(app).post(`/api/sightings/${c.sightingId}/resolve`).set("X-Device-Secret", s).send({ deviceId: id, newCatName: "Anything" }) },
  // SYC-503: "Check again" after a failed look-alike check.
  { name: "POST /sightings/:id/recheck", file: "sightings.ts", call: (id, s, c) => request(app).post(`/api/sightings/${c.sightingId}/recheck`).set("X-Device-Secret", s).set("X-Forwarded-For", freshIp()).send({ deviceId: id }) },
  { name: "POST /sightings/:id/answers", file: "sightings.ts", call: (id, s, c) => request(app).post(`/api/sightings/${c.sightingId}/answers`).set("X-Device-Secret", s).send({ deviceId: id }) },
  { name: "GET /profiles/:id/cats/:c/open-sightings", file: "sightings.ts", call: (id, s, c) => request(app).get(`/api/profiles/${id}/cats/${c.catId}/open-sightings`).set("X-Device-Secret", s) },
  { name: "POST /cats/:id/claim", file: "cats.ts", call: (id, s, c) => request(app).post(`/api/cats/${c.catId}/claim`).set("X-Device-Secret", s).send({ deviceId: id, livesOnSyros: true, livesInMyHome: true, homePin: { lat: 37.44, lng: 24.9 } }) },
  { name: "POST /cats/:id/let-go", file: "cats.ts", call: (id, s, c) => request(app).post(`/api/cats/${c.catId}/let-go`).set("X-Device-Secret", s).send({ deviceId: id }) },
  // follow and unfollow share one handler, so one device-secret check and one probe.
  { name: "POST /cats/:id/follow", file: "cats.ts", call: (id, s, c) => request(app).post(`/api/cats/${c.catId}/follow`).set("X-Device-Secret", s).send({ deviceId: id }) },
  { name: "PATCH /cats/:id", file: "cats.ts", call: (id, s, c) => request(app).patch(`/api/cats/${c.catId}`).set("X-Device-Secret", s).send({ deviceId: id, name: "Anything" }) },
  { name: "POST /reports/draft", file: "reports.ts", call: (id, s) => request(app).post("/api/reports/draft").set("X-Device-Secret", s).set("X-Forwarded-For", freshIp()).send({ deviceId: id, clientRef: `ref-${randomBytes(6).toString("hex")}`, severity: "attention", lat: 37.44, lng: 24.9, language: "en" }) },
  { name: "POST /issues", file: "issues.ts", call: (id, s, ctx) => request(app).post("/api/issues").set("X-Device-Secret", s).set("X-Forwarded-For", freshIp()).send({ deviceId: id, clientRef: `ref-${randomBytes(6).toString("hex")}`, reason: "cat_died", catId: ctx.catId, language: "en" }) },
  { name: "POST /reports", file: "reports.ts", call: (id, s) => request(app).post("/api/reports").set("X-Device-Secret", s).set("X-Forwarded-For", freshIp()).send({ deviceId: id, clientRef: `ref-${randomBytes(6).toString("hex")}`, severity: "urgent", isLitter: false, lat: 37.44, lng: 24.9, language: "en", hasPhoto: false }) },
  { name: "PUT /reports/:id/photo", file: "reports.ts", call: (id, s, c) => request(app).put(`/api/reports/${c.publicId}/photo`).set("X-Device-Secret", s).send({ deviceId: id, photoBase64: "AAAA" }) },
  { name: "GET /keep-safe/:id", file: "keepSafe.ts", call: (id, s) => request(app).get(`/api/keep-safe/${id}`).set("X-Device-Secret", s) },
  { name: "POST /keep-safe/:id", file: "keepSafe.ts", call: (id, s) => request(app).post(`/api/keep-safe/${id}`).set("X-Device-Secret", s).send({ email: "x@example.org", language: "en", wordingVersion: "v1", surface: "settings" }) },
  { name: "DELETE /keep-safe/:id", file: "keepSafe.ts", call: (id, s) => request(app).delete(`/api/keep-safe/${id}`).set("X-Device-Secret", s) },
  { name: "POST /restore/request", file: "keepSafe.ts", call: (id, s) => request(app).post("/api/restore/request").set("X-Device-Secret", s).send({ deviceId: id, email: "x@example.org" }) },
  { name: "POST /restore/peek", file: "keepSafe.ts", call: (id, s) => request(app).post("/api/restore/peek").set("X-Device-Secret", s).send({ deviceId: id, token: "A".repeat(43) }) },
  { name: "POST /restore/redeem", file: "keepSafe.ts", call: (id, s) => request(app).post("/api/restore/redeem").set("X-Device-Secret", s).send({ deviceId: id, token: "A".repeat(43), spotterDeviceId: "x" }) },
  // SYC-664: the code box answers about the phone first, like every other route.
  { name: "POST /restore/code", file: "keepSafe.ts", call: (id, s) => request(app).post("/api/restore/code").set("X-Device-Secret", s).send({ deviceId: id, code: "12345678" }) },
];

describe("4. the old phone carrying on", () => {
  it("the probe list covers every device-secret check in routes/*.ts", () => {
    const files = fs.readdirSync(here).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const file of files) {
      const source = fs.readFileSync(path.join(here, file), "utf8");
      const checks = (source.match(/(?:requireDeviceAuth|verifyDeviceSecret)\(req/g) ?? []).length;
      const probes = PROBES.filter((p) => p.file === file).length;
      expect(probes, `${file}: ${checks} device-secret checks, ${probes} probes`).toBe(checks);
    }
  });

  it("after a move, every route acting as the spotter answers 403 device_moved to the old secret (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    // Things the old phone might act on.
    const [sighting] = await db.insert(sightingsTable).values({ deviceId: old.id, photoId: 0, lat: 37.44, lng: 24.9 }).returning();
    const [report] = await db
      .insert(welfareReportsTable)
      .values({ publicId: `pub-${RUN}-${n}`, severity: "urgent", lat: 37.44, lng: 24.9, reporterDevice: old.id, clientRef: `ref-${RUN}-${n}` })
      .returning();
    const [cat] = await db
      .insert(catsTable)
      .values({ name: `Kscat${RUN}${n}`, description: "", primaryPhotoId: 0, lat: 37.44, lng: 24.9, discovererDeviceId: old.id })
      .returning();
    const ctx = { sightingId: sighting!.id, catId: cat!.id, publicId: report!.publicId };

    const { phone, token } = await newPhoneWithLink(email);
    expect((await redeem(phone, token, old.id)).status).toBe(200);

    for (const probe of PROBES) {
      const res = await probe.call(old.id, old.secret, ctx);
      expect({ route: probe.name, status: res.status, body: res.body }).toEqual({
        route: probe.name,
        status: 403,
        body: { error: "device_moved" },
      });
    }
    // A wrong guess still gets the ordinary refusal.
    const guess = await request(app).get(`/api/profiles/${old.id}`).set("X-Device-Secret", randomBytes(24).toString("hex"));
    expect(guess.status).toBe(403);
    expect(guess.body).toEqual({ error: "Device secret does not match" });
  });
});

describe("5. no gap for first-use binding", () => {
  it("a request racing the move, carrying the id with another secret, can never bind itself (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    const intruder = randomBytes(24).toString("hex");
    let during: request.Response | undefined;
    __setMoveHookForTest(async () => {
      during = await request(app).get(`/api/profiles/${old.id}/username`).set("X-Device-Secret", intruder);
    });
    const r = await redeem(phone, token, old.id);
    expect(during?.status).toBe(403);
    expect(r.status).toBe(200);
    expect(await storedHash(old.id)).toBe(hashSecret(phone.secret));
    const after = await request(app).get(`/api/profiles/${old.id}/username`).set("X-Device-Secret", intruder);
    expect(after.status).toBe(403);
  });
});

describe("6. unconfirmed and forgotten addresses restore nothing", () => {
  it("pending: no link is sent, and nothing can be redeemed", async () => {
    const email = newAddress();
    const spotter = newPhone();
    await bind(spotter);
    await claim(spotter, `Ksp${RUN}${++n}`);
    await add(spotter, email);
    await settleOutbox();
    const before = mailTo(email).length;
    const phone = newPhone();
    await bind(phone);
    expect((await ask(phone, email)).status).toBe(202);
    await settleOutbox();
    expect(mailTo(email).length).toBe(before);
    expect(await db.select().from(mailTokensTable).where(eq(mailTokensTable.deviceId, phone.id))).toHaveLength(0);
  });

  it("forgotten: no mail of any kind, and an existing link stops working", async () => {
    const email = newAddress();
    const spotter = newPhone();
    await bind(spotter);
    await add(spotter, email);
    await settleOutbox();
    const verify = mailTo(email).at(-1)!;
    expect((await postMailPage("forget", tokenFrom(verify, "/api/mail/forget"))).status).toBe(200);
    expect(await db.select().from(emailContactsTable).where(eq(emailContactsTable.deviceId, spotter.id))).toHaveLength(0);
    // The confirm link from the same email is dead too.
    expect((await postMailPage("confirm", tokenFrom(verify, "/api/mail/confirm"))).status).toBe(410);
    const before = mailTo(email).length;
    const again = newPhone();
    await bind(again);
    await add(again, email);
    await ask(again, email);
    await settleOutbox();
    expect(mailTo(email).length).toBe(before);
  });
});

describe("7. opening a link changes nothing", () => {
  it("GET on /api/mail/confirm and /api/mail/forget leaves the database as it was, and the POST still works (M)", async () => {
    const email = newAddress();
    const spotter = newPhone();
    await bind(spotter);
    await add(spotter, email);
    await settleOutbox();
    const mail = mailTo(email).at(-1)!;
    const confirm = tokenFrom(mail, "/api/mail/confirm");
    const forget = tokenFrom(mail, "/api/mail/forget");
    const snapshot = async () =>
      JSON.stringify([
        await db.select().from(emailContactsTable).where(eq(emailContactsTable.deviceId, spotter.id)),
        await db.select().from(mailTokensTable).where(eq(mailTokensTable.deviceId, spotter.id)),
      ]);
    const before = await snapshot();
    for (const [p, t] of [["confirm", confirm], ["forget", forget]] as const) {
      const page = await request(app).get(`/api/mail/${p}`).query({ t });
      expect(page.status).toBe(200);
      // same-origin, not no-referrer: no-referrer makes browsers send Origin: null on the POST.
      expect(page.headers["referrer-policy"]).toBe("same-origin");
      expect(page.text).toContain('<form method="post">');
    }
    expect(await snapshot()).toBe(before);
    expect((await postMailPage("confirm", confirm)).status).toBe(200);
    const [row] = await db.select().from(emailContactsTable).where(eq(emailContactsTable.deviceId, spotter.id));
    expect(row!.status).toBe("confirmed");
  });

  it("peek doesn't spend the restore link", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    expect((await peek(phone, token)).status).toBe(200);
    expect((await peek(phone, token)).status).toBe(200);
    expect((await redeem(phone, token, old.id)).status).toBe(200);
  });

  it("a POST from another origin, or with no origin, is refused", async () => {
    const email = newAddress();
    const spotter = newPhone();
    await bind(spotter);
    await add(spotter, email);
    await settleOutbox();
    const t = tokenFrom(mailTo(email).at(-1)!, "/api/mail/confirm");
    expect((await postMailPage("confirm", t, "https://evil.example")).status).toBe(403);
    expect((await request(app).post("/api/mail/confirm").type("form").send({ t })).status).toBe(403);
    expect((await postMailPage("confirm", t)).status).toBe(200);
  });
});

describe("8. the form reveals nothing", () => {
  async function fourKinds() {
    const known = newAddress();
    await keptSafe(known);
    const pending = newAddress();
    const p = newPhone();
    await bind(p);
    await add(p, pending);
    const suppressed = newAddress();
    const s = newPhone();
    await bind(s);
    await add(s, suppressed);
    await settleOutbox();
    await postMailPage("forget", tokenFrom(mailTo(suppressed).at(-1)!, "/api/mail/forget"));
    return { known, unknown: newAddress(), pending, suppressed };
  }

  const fingerprint = (res: request.Response) =>
    JSON.stringify([res.status, res.text, res.headers["content-type"], res.headers["content-length"], res.headers["cache-control"]]);

  it("known, unknown, pending and suppressed get byte-identical replies, and the times overlap (M)", async () => {
    const kinds = await fourKinds();
    __setRestorePadForTest(null); // the real 800 ms pad
    mailDelayMs = 1_500; // a slow mail provider must not show in the reply time
    const phone = newPhone();
    await bind(phone);
    const replies: request.Response[] = [];
    const times: number[] = [];
    for (const email of [kinds.known, kinds.unknown, kinds.pending, kinds.suppressed]) {
      const t0 = Date.now();
      replies.push(await ask(phone, email));
      times.push(Date.now() - t0);
    }
    expect(replies[0]!.body).toEqual(SENT_IF_KNOWN);
    expect(new Set(replies.map(fingerprint)).size).toBe(1);
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(790);
      expect(t).toBeLessThan(1_300);
    }
    await settleOutbox();
    expect(mailTo(kinds.known).filter((m) => m.subject.endsWith("is your Cat Spotters code"))).toHaveLength(1);
  });

  it("8b. every limit is hit by known and unknown addresses alike; the replies stay identical; an unknown address uses up the per-IP limit (M)", async () => {
    const known = newAddress();
    await keptSafe(known);
    const phone = newPhone();
    await bind(phone);
    const ip = freshIp();
    // 20 requests from one IP, all for unknown addresses…
    for (let i = 0; i < 20; i++) expect((await ask(phone, newAddress(), ip)).status).toBe(202);
    // …use up the IP's allowance: the known address gets no link from it.
    const res = await ask(phone, known, ip);
    expect(fingerprint(res)).toBe(fingerprint(await ask(phone, newAddress(), ip)));
    await settleOutbox();
    expect(mailTo(known).filter((m) => m.subject.endsWith("is your Cat Spotters code"))).toHaveLength(0);
    // From a fresh IP it works.
    await ask(phone, known, freshIp());
    await settleOutbox();
    expect(mailTo(known).filter((m) => m.subject.endsWith("is your Cat Spotters code"))).toHaveLength(1);
  });

  it("8c. a stranger using up an address's three \"is this you?\" emails can't stop its restore link (M)", async () => {
    const email = newAddress();
    // The owner adds their address; the first "is this you?" arrives.
    const owner = newPhone();
    await bind(owner);
    await claim(owner, `Own${RUN}${++n}`);
    await ageVerifyEmails();
    await add(owner, email);
    await settleOutbox();
    const ownersEmail = mailTo(email).at(-1)!;
    // Before they tap it, a stranger adds the same address from more phones,
    // until the lifetime cap suppresses further "is this you?" emails.
    for (let i = 0; i < 3; i++) {
      await ageVerifyEmails();
      const stranger = newPhone();
      await bind(stranger);
      await add(stranger, email);
    }
    await settleOutbox();
    expect(mailTo(email).filter((m) => m.subject.startsWith("Is this you?"))).toHaveLength(3);
    const [contact] = await db.select().from(emailContactsTable).where(eq(emailContactsTable.deviceId, owner.id));
    const caps = await db.execute(
      sql`select 1 from email_suppressions where reason = 'verify_cap' and address_hmac = ${contact!.addressHmac}`,
    );
    expect(caps.rows).toHaveLength(1);
    // The owner confirms with their own email, and can still get their spots back.
    expect((await postMailPage("confirm", tokenFrom(ownersEmail, "/api/mail/confirm"))).status).toBe(200);
    const { phone, token } = await newPhoneWithLink(email);
    expect((await redeem(phone, token, owner.id)).status).toBe(200);
  });
});

describe("9. expiry", () => {
  it("a restore link is refused at 15 minutes and 1 second", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    await db.execute(sql`update mail_tokens set expires_at = now() - interval '1 second' where device_id = ${phone.id}`);
    expect((await peek(phone, token)).status).toBe(401);
    expect((await redeem(phone, token, old.id)).status).toBe(401);
    expect(await storedHash(old.id)).toBe(hashSecret(old.secret));
  });

  it("links last 15 minutes and confirm links 7 days", async () => {
    const email = newAddress();
    const spotter = newPhone();
    await bind(spotter);
    await add(spotter, email);
    const [verify] = await db
      .select({ life: sql<number>`extract(epoch from expires_at - created_at)::int` })
      .from(mailTokensTable)
      .where(eq(mailTokensTable.deviceId, spotter.id));
    expect(verify!.life).toBeGreaterThanOrEqual(7 * 86400 - 5);
    expect(verify!.life).toBeLessThanOrEqual(7 * 86400 + 5);
    await settleOutbox();
    const t = tokenFrom(mailTo(email).at(-1)!, "/api/mail/confirm");
    await db.execute(sql`update mail_tokens set expires_at = now() - interval '1 second' where device_id = ${spotter.id}`);
    expect((await postMailPage("confirm", t)).status).toBe(410);
    expect((await request(app).get("/api/mail/confirm").query({ t })).status).toBe(410);
  });

  it("device_moved stops after 90 days", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    expect((await redeem(phone, token, old.id)).status).toBe(200);
    await db.execute(sql`update mail_tokens set used_at = now() - interval '91 days' where restored_device_id = ${old.id}`);
    const res = await request(app).get(`/api/profiles/${old.id}`).set("X-Device-Secret", old.secret);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Device secret does not match" });
  });
});

describe("10. limits", () => {
  it("3 restore requests per phone per 15 minutes, counted in Postgres, so the same phone's requests to another server count too", async () => {
    const email = newAddress();
    await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    // Another server took two requests from this phone for this address.
    const hmac = addressFingerprint("keep_safe", email);
    const requester = deviceFingerprint(phone.id);
    await db.execute(sql`
      insert into mail_requests (kind, address_hmac, ip_hash, requester_hash)
      values ('restore', ${hmac}, 'another-server', ${requester}), ('restore', ${hmac}, 'another-server', ${requester})
    `);
    for (let i = 0; i < 3; i++) expect((await ask(phone, email)).status).toBe(202);
    await settleOutbox();
    expect(mailTo(email).filter((m) => m.subject.endsWith("is your Cat Spotters code"))).toHaveLength(1);
  });

  it("finding 2 (Samuel, 8 Oct: per phone): a stranger asking again and again can't stop the family's own phone getting its link (M)", async () => {
    const email = newAddress();
    const lili = await keptSafe(email);
    const stranger = newPhone();
    await bind(stranger);
    for (let i = 0; i < 6; i++) await ask(stranger, email);
    await settleOutbox();
    const { phone, token } = await newPhoneWithLink(email);
    expect((await redeem(phone, token, lili.id)).status).toBe(200);
  });

  it("at most 3 live links per address: the oldest expires to make room", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    const tokens: string[] = [];
    for (let i = 0; i < 3; i++) {
      await ask(phone, email);
      await settleOutbox();
      tokens.push(tokenFrom(mailTo(email).at(-1)!, "/restore"));
      await db.execute(sql`update mail_requests set created_at = created_at - interval '16 minutes' where kind = 'restore'`);
    }
    await ask(phone, email);
    await settleOutbox();
    tokens.push(tokenFrom(mailTo(email).at(-1)!, "/restore"));
    expect(new Set(tokens).size).toBe(4);
    expect((await peek(phone, tokens[0]!)).status).toBe(401);
    for (const t of tokens.slice(1)) expect((await peek(phone, t)).status).toBe(200);
    expect((await redeem(phone, tokens[3]!, old.id)).status).toBe(200);
  });

  it("one \"is this you?\" per address per 24 hours, three in its lifetime, then suppression", async () => {
    const email = newAddress();
    const verifies = () => mailTo(email).filter((m) => m.subject.startsWith("Is this you?")).length;
    for (let i = 0; i < 5; i++) {
      const p = newPhone();
      await bind(p);
      await add(p, email);
      await add(newPhone(), email).then(() => undefined, () => undefined);
      await settleOutbox();
      expect(verifies()).toBe(Math.min(i + 1, 3));
      await ageVerifyEmails();
    }
  });

  it("the global daily ceiling fails closed and logs", async () => {
    process.env["KEEP_SAFE_RESTORE_DAILY_CEILING"] = "0";
    const email = newAddress();
    await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    expect((await ask(phone, email)).status).toBe(202);
    await settleOutbox();
    expect(mailTo(email).filter((m) => m.subject.endsWith("is your Cat Spotters code"))).toHaveLength(0);
    expect(spies.logLines.some((l) => l.includes("global_ceiling") && l.includes('"level":50'))).toBe(true);
  });
});

describe("11. the target must be empty, unless the person chose to leave it (Decision 7)", () => {
  it("a phone that already has a spotter is refused without abandonCurrent (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    await claim(phone, `Nikos${RUN}${++n}`);
    const token = await askAndGetToken(phone, email);
    const r = await redeem(phone, token, old.id);
    expect(r.status).toBe(401);
    expect(await storedHash(old.id)).toBe(hashSecret(old.secret));
  });

  it("with abandonCurrent, the move happens and the abandoned spotter's rows are all unchanged", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    const nikos = `Nikos${RUN}${++n}`;
    await claim(phone, nikos);
    await db.insert(sightingsTable).values({ deviceId: phone.id, photoId: 0, lat: 37.44, lng: 24.9 });
    await db.insert(pushTokensTable).values({ deviceId: phone.id, token: "ExponentPushToken[nikos]" });
    const rows = async () =>
      JSON.stringify([
        await db.select().from(profilesTable).where(eq(profilesTable.deviceId, phone.id)),
        await db.select().from(sightingsTable).where(eq(sightingsTable.deviceId, phone.id)),
      ]);
    const before = await rows();
    const token = await askAndGetToken(phone, email);
    expect((await redeem(phone, token, old.id, { abandonCurrent: true })).status).toBe(200);
    expect(await rows()).toBe(before);
    expect(await storedHash(phone.id)).toBe("retired");
    expect(await db.select().from(pushTokensTable).where(eq(pushTokensTable.deviceId, phone.id))).toHaveLength(0);
    // The retired id can't be re-bound on first use (A6).
    const rebind = await request(app).get(`/api/profiles/${phone.id}/username`).set("X-Device-Secret", randomBytes(24).toString("hex"));
    expect(rebind.status).toBe(403);
  });
});

describe("11b. \"Delete Nikos\" (SYC-266, Samuel 10 Oct 2026)", () => {
  // Every text-like column of every public table, so tables added later are
  // covered too (as in me.delete.test.ts).
  async function columnsHolding(needle: string): Promise<string[]> {
    const cols = (
      await db.execute(sql`
        select table_name, column_name from information_schema.columns
         where table_schema = 'public'
           and data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
      `)
    ).rows as { table_name: string; column_name: string }[];
    const hits: string[] = [];
    for (const c of cols) {
      const r = await db.execute(
        sql`select 1 from ${sql.identifier(c.table_name)} where ${sql.identifier(c.column_name)}::text like ${`%${needle}%`} limit 1`,
      );
      if (r.rows.length) hits.push(`${c.table_name}.${c.column_name}`);
    }
    return hits;
  }

  // Its own address per call: redeem is limited to 30 per IP per hour, and
  // the rest of this file leans on that allowance.
  const redeemFrom = (phone: Phone, token: string, spotterDeviceId: string, extra: Record<string, unknown>) =>
    redeem(phone, token, spotterDeviceId, extra).set("X-Forwarded-For", freshIp());

  async function phoneWithNikos(email: string) {
    const phone = newPhone();
    await bind(phone);
    const nikos = `Nikos${RUN}${++n}`;
    await claim(phone, nikos);
    await db.insert(sightingsTable).values({ deviceId: phone.id, photoId: 0, lat: 37.44, lng: 24.9 });
    await db.insert(pushTokensTable).values({ deviceId: phone.id, token: "ExponentPushToken[nikos]" });
    const token = await askAndGetToken(phone, email);
    return { phone, nikos, token };
  }

  it("Decision 12: Nikos's phone opens a link another phone asked for, deletes Nikos, and the old phone is still told it moved; no trace of Nikos", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { token } = await newPhoneWithLink(email); // asked from a different phone
    const phone = newPhone();
    await bind(phone);
    const nikos = `Nikos${RUN}${++n}`;
    await claim(phone, nikos);
    const r = await redeemFrom(phone, token, old.id, { abandonCurrent: true, deleteCurrent: true });
    expect(r.status).toBe(200);
    const stale = await request(app).get(`/api/profiles/${old.id}`).set("X-Device-Secret", old.secret);
    expect(stale.body).toEqual({ error: "device_moved" });
    // A double tap within the replay window gets the same answer.
    const again = await redeemFrom(phone, token, old.id, { abandonCurrent: true, deleteCurrent: true });
    expect(again.status).toBe(200);
    expect(again.body.deviceId).toBe(old.id);
    expect(await columnsHolding(phone.id)).toEqual([]);
    expect(await columnsHolding(nikos)).toEqual([]);
  });

  it("deletes Nikos in the move: no trace of Nikos anywhere, spots kept without a name, the name free (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, nikos, token } = await phoneWithNikos(email);
    const r = await redeemFrom(phone, token, old.id, { abandonCurrent: true, deleteCurrent: true });
    expect(r.status).toBe(200);
    expect(r.body.deviceId).toBe(old.id);
    // The phone is the old spotter now.
    expect(await storedHash(old.id)).toBe(hashSecret(phone.secret));
    // Nikos is gone, as "Delete my data" would leave it.
    expect(await columnsHolding(phone.id)).toEqual([]);
    expect(await columnsHolding(nikos)).toEqual([]);
    const spots = await db.execute(sql`select count(*)::int as c from sightings where device_id is null and redaction_reason = 'deleted by the person' and lat = 37.44 and lng = 24.9`);
    expect((spots.rows[0] as { c: number }).c).toBeGreaterThanOrEqual(1);
    const free = await request(app).get(`/api/profiles/username-availability?name=${encodeURIComponent(nikos)}`);
    expect(free.body).toEqual({ available: true });
    // Nikos's id answers 410 for ever, and can't be bound again.
    const gone = await request(app).get(`/api/profiles/${phone.id}/username`).set("X-Device-Secret", randomBytes(24).toString("hex"));
    expect(gone.status).toBe(410);
  });

  it("the link survives: the old phone is still told it moved, and a double tap gets the same answer (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await phoneWithNikos(email);
    const first = await redeemFrom(phone, token, old.id, { abandonCurrent: true, deleteCurrent: true });
    expect(first.status).toBe(200);
    const again = await redeemFrom(phone, token, old.id, { abandonCurrent: true, deleteCurrent: true });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    const stale = await request(app).get(`/api/profiles/${old.id}`).set("X-Device-Secret", old.secret);
    expect(stale.status).toBe(403);
    expect(stale.body).toEqual({ error: "device_moved" });
  });

  it("is refused without abandonCurrent, and nothing moves or is deleted", async () => {
    // A phone with no name (so no warning, and no abandonCurrent) but a spot
    // of its own: only the deleteCurrent guard stops it being deleted.
    const email = newAddress();
    const old = await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    await db.insert(sightingsTable).values({ deviceId: phone.id, photoId: 0, lat: 37.44, lng: 24.9 });
    const token = await askAndGetToken(phone, email);
    const r = await redeemFrom(phone, token, old.id, { deleteCurrent: true });
    expect(r.status).toBe(401);
    expect(await storedHash(old.id)).toBe(hashSecret(old.secret));
    expect(await storedHash(phone.id)).toBe(hashSecret(phone.secret));
    expect(await db.select().from(sightingsTable).where(eq(sightingsTable.deviceId, phone.id))).toHaveLength(1);
  });

  it("all or nothing: if deleting Nikos fails, the spotter doesn't move and Nikos is untouched", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, nikos, token } = await phoneWithNikos(email);
    const fn = `refuse_nikos_${RUN}_${n}`.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    await db.execute(sql.raw(`
      create function ${fn}() returns trigger language plpgsql as $$
      begin
        if old.device_id = '${phone.id}' then raise exception 'refused for the test'; end if;
        return old;
      end $$;
      create trigger ${fn} before delete on profiles for each row execute function ${fn}();
    `));
    try {
      const r = await redeemFrom(phone, token, old.id, { abandonCurrent: true, deleteCurrent: true });
      expect(r.status).toBeGreaterThanOrEqual(400);
    } finally {
      await db.execute(sql.raw(`drop trigger ${fn} on profiles; drop function ${fn}();`));
    }
    expect(await storedHash(old.id)).toBe(hashSecret(old.secret));
    expect(await storedHash(phone.id)).toBe(hashSecret(phone.secret));
    const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.deviceId, phone.id));
    expect(profile?.username).toBe(nikos);
    const linked = await db.select().from(sightingsTable).where(eq(sightingsTable.deviceId, phone.id));
    expect(linked).toHaveLength(1);
    const [tok] = await db.select().from(mailTokensTable).where(eq(mailTokensTable.deviceId, phone.id));
    expect(tok?.usedAt).toBeNull();
  });
});

describe("12. links point at the right place", () => {
  it("a request with Host: evil.example still emails an apptest.catspotters.com link (M)", async () => {
    const email = newAddress();
    await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    await ask(phone, email, freshIp(), "evil.example");
    await settleOutbox();
    const mail = mailTo(email).at(-1)!;
    // The token rides in the fragment, which no browser sends to any server (Decision 12).
    expect(mail.text).toMatch(/https:\/\/apptest\.catspotters\.com\/restore#t=[A-Za-z0-9_-]{43}/);
    expect(mail.text + mail.html).not.toMatch(/restore\?t=/);
    expect(mail.text + mail.html).not.toContain("evil.example");
  });
});

describe("13. tokens and addresses never appear in a log line; only the masked form is returned", () => {
  it("through a whole round trip", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    const p = await peek(phone, token);
    await redeem(phone, token, old.id);
    const confirmTokens = sent.flatMap((m) => [...m.text.matchAll(/t=([A-Za-z0-9_-]{43})/g)].map((x) => x[1]!));
    expect(confirmTokens.length).toBeGreaterThan(1);
    const logs = spies.logLines.join("\n");
    for (const t of confirmTokens) expect(logs).not.toContain(t);
    expect(logs.toLowerCase()).not.toContain(normaliseAddress(email));
    expect(JSON.stringify(p.body)).not.toContain("@");
    const state = await request(app).get(`/api/keep-safe/${old.id}`).set("X-Device-Secret", phone.secret);
    expect(JSON.stringify(state.body)).not.toContain(normaliseAddress(email));
  });
});

describe("16. deletion (joint with SYC-63)", () => {
  it("removes the keep-safe row, its tokens and the identifying parts of its consent events", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    await db.transaction((tx) => severKeepSafe(tx, old.id, "deleted by the person"));
    expect(await db.select().from(emailContactsTable).where(eq(emailContactsTable.deviceId, old.id))).toHaveLength(0);
    expect(await db.select().from(mailTokensTable).where(eq(mailTokensTable.deviceId, old.id))).toHaveLength(0);
    expect(await db.select().from(emailConsentEventsTable).where(eq(emailConsentEventsTable.deviceId, old.id))).toHaveLength(0);
  });

  it("a deleted spotter can't be restored: the move finds no credential and refuses", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    // SYC-63's deletion: the credential row goes (a marker under another key replaces it).
    await db.delete(deviceCredentialsTable).where(eq(deviceCredentialsTable.deviceId, old.id));
    const r = await redeem(phone, token, old.id);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "link_not_valid" });
    expect(await storedHash(old.id)).toBeUndefined();
    expect(await storedHash(phone.id)).toBe(hashSecret(phone.secret));
  });
});

describe("Samuel's decisions, 8 Oct 2026", () => {
  const verifies = (email: string) => mailTo(email).filter((m) => m.subject.startsWith("Is this you?"));

  it("SYC-261: a parent adding a second child the same evening gets the email at once, and both can be restored (M)", async () => {
    const email = newAddress();
    const lili = await keptSafe(email);
    const before = verifies(email).length;
    // No waiting a day: the address is already confirmed for Lili.
    const nikos = newPhone();
    await bind(nikos);
    await claim(nikos, `Nikos${RUN}${++n}`);
    expect((await add(nikos, email)).status).toBe(200);
    await settleOutbox();
    expect(verifies(email)).toHaveLength(before + 1);
    expect((await postMailPage("confirm", tokenFrom(verifies(email).at(-1)!, "/api/mail/confirm"))).status).toBe(200);
    const { phone, token } = await newPhoneWithLink(email);
    const p = await peek(phone, token);
    const nikosName = (await db.select().from(profilesTable).where(eq(profilesTable.deviceId, nikos.id)))[0]!.username;
    expect(p.body.spotters.map((s: { username: string }) => s.username).sort()).toEqual([lili.username, nikosName].sort());
  });

  it("SYC-261: an address nobody has confirmed still gets at most one \"is this you?\" a day", async () => {
    const email = newAddress();
    for (let i = 0; i < 2; i++) {
      const p = newPhone();
      await bind(p);
      await add(p, email);
    }
    await settleOutbox();
    expect(verifies(email)).toHaveLength(1);
  });

  it("Samuel, 8 Oct: a confirmed address gets at most 3 \"is this you?\" emails a day (M)", async () => {
    const email = newAddress();
    await keptSafe(email);
    await ageVerifyEmails();
    for (let i = 0; i < 5; i++) {
      const p = newPhone();
      await bind(p);
      await add(p, email);
    }
    await settleOutbox();
    const today = verifies(email).length - 1; // minus the first child's own email
    expect(today).toBe(3);
  });

  it("SYC-261: once confirmed, the automatic three-email cap no longer blocks a sibling's email", async () => {
    const email = newAddress();
    const owner = newPhone();
    await bind(owner);
    await add(owner, email);
    await settleOutbox();
    const ownersEmail = verifies(email).at(-1)!;
    for (let i = 0; i < 3; i++) {
      await ageVerifyEmails();
      const stranger = newPhone();
      await bind(stranger);
      await add(stranger, email);
    }
    await settleOutbox();
    expect(verifies(email)).toHaveLength(3);
    await postMailPage("confirm", tokenFrom(ownersEmail, "/api/mail/confirm"));
    const sibling = newPhone();
    await bind(sibling);
    await add(sibling, email);
    await settleOutbox();
    expect(verifies(email)).toHaveLength(4);
  });

  it("SYC-262: \"Forget this address\" in a stranger-triggered email cancels only that request; the family's restore still works (M)", async () => {
    const email = newAddress();
    const lili = await keptSafe(email);
    const stranger = newPhone();
    await bind(stranger);
    await add(stranger, email);
    await settleOutbox();
    const surprise = verifies(email).at(-1)!;
    const page = await postMailPage("forget", tokenFrom(surprise, "/api/mail/forget"));
    expect(page.status).toBe(200);
    expect(page.text).toContain("cancelled that request");
    expect(await db.select().from(emailContactsTable).where(eq(emailContactsTable.deviceId, stranger.id))).toHaveLength(0);
    // No more "is this you?" emails to this address…
    const before = verifies(email).length;
    const another = newPhone();
    await bind(another);
    await add(another, email);
    await settleOutbox();
    expect(verifies(email)).toHaveLength(before);
    // …but Lili's spots can still come back.
    const { phone, token } = await newPhoneWithLink(email);
    expect((await redeem(phone, token, lili.id)).status).toBe(200);
  });

  it("SYC-262: Forget on an address that keeps nobody else safe still forgets it fully", async () => {
    const email = newAddress();
    const p = newPhone();
    await bind(p);
    await add(p, email);
    await settleOutbox();
    const page = await postMailPage("forget", tokenFrom(verifies(email).at(-1)!, "/api/mail/forget"));
    expect(page.text).toContain("We've forgotten this address");
    const [row] = (
      await db.execute(sql`select reason from email_suppressions where address_hmac = ${addressFingerprint("keep_safe", email)}`)
    ).rows as { reason: string }[];
    expect(row!.reason).toBe("forget");
  });
});

describe("adversarial review of #106: fixes", () => {
  const links = (email: string) => mailTo(email).filter((m) => m.subject.endsWith("is your Cat Spotters code"));

  it("finding 1: requests for made-up addresses can't use up the daily restore ceiling (M)", async () => {
    const [{ n: issued }] = (
      await db.execute(sql`select count(*)::int as n from mail_tokens where purpose = 'restore' and created_at > now() - interval '1 day'`)
    ).rows as { n: number }[];
    process.env["KEEP_SAFE_RESTORE_DAILY_CEILING"] = String(issued + 1);
    const email = newAddress();
    await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    for (let i = 0; i < 6; i++) await ask(phone, newAddress(), freshIp());
    await ask(phone, email, freshIp());
    await settleOutbox();
    expect(links(email)).toHaveLength(1);
    // The ceiling itself still holds: the next real link is refused.
    await ask(phone, email, freshIp());
    await settleOutbox();
    expect(links(email)).toHaveLength(1);
  });

  it("finding 4: a pending address changed before it's confirmed keeps no trace of the spotter", async () => {
    const phone = newPhone();
    await bind(phone);
    const typo = newAddress();
    await add(phone, typo);
    await ageVerifyEmails();
    await add(phone, newAddress());
    const typoEvents = await db
      .select()
      .from(emailConsentEventsTable)
      .where(eq(emailConsentEventsTable.addressHmac, addressFingerprint("keep_safe", typo)));
    expect(typoEvents.length).toBeGreaterThan(0);
    for (const e of typoEvents) {
      expect(e.deviceId).toBeNull();
      expect(e.contactId).toBeNull();
    }
  });

  it("finding 5: deletion also drops the spotter's queued keep-safe email (address and token)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const fail = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fail);
    const p = newPhone();
    await bind(p);
    await ask(p, email);
    await settleOutbox();
    const queued = async () =>
      (
        await db.execute(sql`select count(*)::int as n from mail_outbox where purpose = 'restore_link' and payload ? 'to'`)
      ).rows[0] as { n: number };
    expect((await queued()).n).toBeGreaterThan(0);
    await db.transaction((tx) => severKeepSafe(tx, p.id, "deleted by the person"));
    await db.transaction((tx) => severKeepSafe(tx, old.id, "deleted by the person"));
    expect((await queued()).n).toBe(0);
  });

  it("finding 6: the same-phone replay needs the phone's secret, not just the ids (M)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const { phone, token } = await newPhoneWithLink(email);
    expect((await redeem(phone, token, old.id)).status).toBe(200);
    const imposter = { id: phone.id, secret: randomBytes(24).toString("hex") };
    const r = await redeem(imposter, token, old.id);
    expect(r.status).not.toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(old.username);
  });

  it("one phone redeeming two links for two spotters at the same moment becomes only one of them", async () => {
    const email = newAddress();
    const one = await keptSafe(email);
    const two = await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    const t1 = await askAndGetToken(phone, email);
    const t2 = await askAndGetToken(phone, email);
    const results = await Promise.all([redeem(phone, t1, one.id), redeem(phone, t2, two.id)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const moved = [await storedHash(one.id), await storedHash(two.id)].filter((h) => h === hashSecret(phone.secret));
    expect(moved).toHaveLength(1);
  });

  it("a provider 4xx gives the email up at once and clears the address", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "invalid" }), { status: 422 })));
    const p = newPhone();
    await bind(p);
    await add(p, newAddress());
    await settleOutbox();
    const [row] = (
      await db.execute(sql`select state, payload from mail_outbox where purpose = 'keep_safe_verify' order by id desc limit 1`)
    ).rows as { state: string; payload: Record<string, unknown> }[];
    expect(row!.state).toBe("failed");
    expect(row!.payload["to"]).toBeUndefined();
  });
});

// ── SYC-664: a request issues a code ───────────────────────────────────────

describe("SYC-664: asking for a restore issues a code", () => {
  it("a known address gets a row with a code hash and a queued payload that carries the code; unknown addresses get neither", async () => {
    const email = newAddress();
    await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    expect((await ask(phone, email)).status).toBe(202);
    const hmac = addressFingerprint("keep_safe", normaliseAddress(email));
    const rows = await db.select().from(mailTokensTable).where(eq(mailTokensTable.addressHmac, hmac));
    const row = rows.find((r) => r.purpose === "restore")!;
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeAttempts).toBe(0);
    await settleOutbox();
    const mail = mailTo(email).at(-1)!;
    const code = mail.subject.split(" ")[0]!;
    expect(code).toMatch(/^\d{8}$/);
    expect(mail.subject).toBe(`${code} is your Cat Spotters code`);
    expect(mail.text).toMatch(/You asked for it at \d{2}:\d{2}\./);
    const { codeHash } = await import("../lib/keepSafe/tokens");
    expect(row.codeHash).toBe(codeHash(row.tokenHash, code));
    // Nothing raw left behind after sending.
    const left = await db.execute(sql`select count(*)::int as n from mail_outbox where payload::text like ${"%" + code + "%"}`);
    expect((left.rows[0] as { n: number }).n).toBe(0);
    // Unknown address: no token row at all.
    const stranger = newAddress();
    expect((await ask(phone, stranger)).status).toBe(202);
    const none = await db.select().from(mailTokensTable).where(eq(mailTokensTable.addressHmac, addressFingerprint("keep_safe", normaliseAddress(stranger))));
    expect(none).toHaveLength(0);
  });

  it("Decision B: the three-live-links cap is per asking phone, so a second phone's link never expires the first's", async () => {
    __setRestorePadForTest(0);
    const email = newAddress();
    await keptSafe(email);
    const hmac = addressFingerprint("keep_safe", normaliseAddress(email));
    const a = newPhone();
    const b = newPhone();
    await bind(a);
    await bind(b);
    const live = async (deviceId: string) =>
      (await db.select().from(mailTokensTable).where(eq(mailTokensTable.addressHmac, hmac)))
        .filter((r) => r.purpose === "restore" && r.deviceId === deviceId && r.expiresAt > new Date())
        .length;
    // The per-phone request limit allows 3 in 15 minutes (a 4th is refused), so age A's
    // requests to let a 4th through while its first three links are still live.
    for (let i = 0; i < 3; i++) expect((await ask(a, email)).status).toBe(202);
    expect(await live(a.id)).toBe(3);
    await db.execute(sql`update mail_requests set created_at = created_at - interval '20 minutes' where address_hmac = ${hmac}`);
    expect((await ask(a, email)).status).toBe(202);
    // A's own oldest expired to make room: still three live, not four.
    expect(await live(a.id)).toBe(3);
    expect((await ask(b, email)).status).toBe(202);
    expect(await live(b.id)).toBe(1);
    // B's link did not cost A one.
    expect(await live(a.id)).toBe(3);
    await settleOutbox();
  });
});
