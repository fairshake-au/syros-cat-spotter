/**
 * SYC-664 Task 3: `POST /api/restore/code` swaps a right 8-digit code, typed
 * on the phone that asked, for a 256-bit handle. Spec "Tests", server half.
 * Every refusal is the same 401 `code_not_valid`, padded to one deadline.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";

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

import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../app";
import { settleOutbox } from "../lib/mail/outbox";
import { normaliseAddress } from "../lib/mail/fingerprint";
import { hashToken } from "../lib/keepSafe/tokens";
import { __setCodeHookForTest, codeCheck } from "../lib/keepSafe/code";
import { __setMoveHookForTest } from "../lib/keepSafe/move";
import { hashSecret } from "../lib/deviceAuth";
import { _resetBucketForTests, addressKey, consume } from "../lib/limits";
import { __setCodeCapForTest, __setCodePadForTest, __setRestorePadForTest } from "./keepSafe";
import { installFakeResend, tokenFrom, type SentMail } from "../test/fakeResend";
import { usernameSafeRun } from "../test/usernameRun";

const RUN = randomBytes(3).toString("hex");
const NAME_RUN = usernameSafeRun(RUN);
const P = `vitest-kc-${RUN}`;
const ORIGIN = "https://apptest.catspotters.com";
const CODE_NOT_VALID = { error: "code_not_valid" };

type Phone = { id: string; secret: string };
let n = 0;
const newPhone = (): Phone => ({ id: `${P}-${++n}`, secret: randomBytes(24).toString("hex") });
let ipN = 0;
const freshIp = () => `203.0.${Math.floor(++ipN / 250)}.${ipN % 250}`;
const newAddress = () => `Code.${RUN}.${++n}@Example.org`;

let sent: SentMail[];
const saved = { ...process.env };

beforeEach(async () => {
  spies.logLines.length = 0;
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  delete process.env["PUBLIC_APP_ORIGIN"];
  sent = installFakeResend();
  __setRestorePadForTest(30);
  __setCodePadForTest(30);
  await _resetBucketForTests("keep_safe_code");
});
afterEach(async () => {
  await settleOutbox();
  __setRestorePadForTest(null);
  __setCodePadForTest(null);
  __setCodeCapForTest(null);
  __setCodeHookForTest(null);
  __setMoveHookForTest(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...saved };
});
afterAll(async () => {
  await db.execute(sql`delete from profiles where device_id like ${P + "%"}`);
  await pool.end();
});

// ── helpers ────────────────────────────────────────────────────────────────

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

const mailTo = (email: string) => sent.filter((m) => m.to === normaliseAddress(email));

/** A spotter with a username and a confirmed keep-safe address. */
async function keptSafe(email: string): Promise<Phone & { username: string }> {
  const phone = newPhone();
  await bind(phone);
  const username = `Kc${NAME_RUN}${++n}`;
  const claim = await request(app)
    .post(`/api/profiles/${phone.id}/username`)
    .set("X-Device-Secret", phone.secret)
    .send({ username });
  expect(claim.status).toBe(200);
  await ageVerifyEmails();
  const add = await request(app)
    .post(`/api/keep-safe/${phone.id}`)
    .set("X-Device-Secret", phone.secret)
    .set("X-Forwarded-For", freshIp())
    .send({ email, language: "en", wordingVersion: "keep_safe.v1", surface: "onboarding" });
  expect(add.status).toBe(200);
  await settleOutbox();
  const confirm = await request(app)
    .post("/api/mail/confirm")
    .set("Origin", ORIGIN)
    .type("form")
    .send({ t: tokenFrom(mailTo(email).at(-1)!, "/api/mail/confirm") });
  expect(confirm.status).toBe(200);
  return { ...phone, username };
}

/** `phone` asks for a restore email for `email`; returns its code and link token. */
async function askForCode(phone: Phone, email: string): Promise<{ code: string; token: string }> {
  const before = mailTo(email).length;
  const res = await request(app)
    .post("/api/restore/request")
    .set("X-Device-Secret", phone.secret)
    .set("X-Forwarded-For", freshIp())
    .send({ deviceId: phone.id, email });
  expect(res.status).toBe(202);
  await settleOutbox();
  const mails = mailTo(email);
  expect(mails.length).toBe(before + 1);
  const mail = mails.at(-1)!;
  const code = /^(\d{8}) is your Cat Spotters code$/.exec(mail.subject)?.[1];
  if (!code) throw new Error("no code in the subject");
  return { code, token: tokenFrom(mail, "/restore") };
}

/** A fresh, bound phone that asked for a code for a kept-safe address. */
async function phoneWithCode() {
  const email = newAddress();
  await keptSafe(email);
  const phone = newPhone();
  await bind(phone);
  return { phone, email, ...(await askForCode(phone, email)) };
}

function sendCode(phone: Phone, code: unknown, secret: string | null = phone.secret) {
  const req = request(app).post("/api/restore/code").set("X-Forwarded-For", freshIp());
  if (secret !== null) req.set("X-Device-Secret", secret);
  return req.send({ deviceId: phone.id, code });
}

/** Swap the phone's code for a handle (Task 3). */
async function handleFor(phone: Phone, code: string): Promise<string> {
  const res = await sendCode(phone, code);
  expect(res.status).toBe(200);
  return res.body.handle as string;
}

// Each from its own address: peek and redeem are limited per IP per hour.
function peek(phone: Phone, token: string) {
  return request(app)
    .post("/api/restore/peek")
    .set("X-Device-Secret", phone.secret)
    .set("X-Forwarded-For", freshIp())
    .send({ deviceId: phone.id, token });
}

function redeem(phone: Phone, token: string, choice: string, extra: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/restore/redeem")
    .set("X-Device-Secret", phone.secret)
    .set("X-Forwarded-For", freshIp())
    .send({ deviceId: phone.id, token, choice, ...extra });
}

async function storedHash(deviceId: string) {
  const res = await db.execute(sql`select secret_hash from device_credentials where device_id = ${deviceId}`);
  return (res.rows[0] as { secret_hash: string } | undefined)?.secret_hash;
}

const wrongFor = (code: string, i = 1) => String((Number(code) + i) % 100_000_000).padStart(8, "0");

async function rowsOf(deviceId: string) {
  const res = await db.execute(sql`
    select token_hash, code_attempts, handle_hash, expires_at <= now() as dead
      from mail_tokens where purpose = 'restore' and device_id = ${deviceId}
     order by created_at
  `);
  return res.rows as { token_hash: string; code_attempts: number; handle_hash: string | null; dead: boolean }[];
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("POST /api/restore/code", () => {
  it("right code → handle: 43 characters, and handle_hash is set on the row", async () => {
    const { phone, code } = await phoneWithCode();
    const res = await sendCode(phone, code);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(typeof res.body.handle).toBe("string");
    expect(res.body.handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await rowsOf(phone.id);
    expect(row!.handle_hash).toBe(hashToken(res.body.handle));
    expect(row!.code_attempts).toBe(0);
    expect(row!.dead).toBe(false);
  });

  it("same code, other phone → code_not_valid, identical to a wrong code", async () => {
    const { phone, code } = await phoneWithCode();
    const other = newPhone();
    await bind(other);
    const fromOther = await sendCode(other, code);
    const wrong = await sendCode(phone, wrongFor(code));
    expect(fromOther.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(fromOther.body).toEqual(CODE_NOT_VALID);
    expect(fromOther.text).toBe(wrong.text);
    // The asking phone still has its code.
    expect((await sendCode(phone, code)).status).toBe(200);
  });

  it("malformed code → the same refusal, and it counts against the phone's hour", async () => {
    const phone = newPhone();
    await bind(phone);
    for (const bad of ["1234", "12345678 ", "abcdefgh", 12345678, null]) {
      const res = await sendCode(phone, bad);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(CODE_NOT_VALID);
    }
    for (let i = 0; i < 5; i++) expect((await sendCode(phone, "00000000")).status).toBe(401);
    const eleventh = await sendCode(phone, "00000000");
    expect(eleventh.status).toBe(429);
  });

  it(
    "unknown vs known address: wrong codes give identical status, body and timing (pad 800 ms)",
    async () => {
      const { phone: known, code } = await phoneWithCode();
      const unknown = newPhone();
      await bind(unknown);
      const ask = await request(app)
        .post("/api/restore/request")
        .set("X-Device-Secret", unknown.secret)
        .set("X-Forwarded-For", freshIp())
        .send({ deviceId: unknown.id, email: newAddress() });
      expect(ask.status).toBe(202);
      __setCodePadForTest(null);

      const results: { status: number; text: string; ms: number; known: boolean }[] = [];
      // Seven each: the known row goes live → at its limit → dead along the way.
      for (let i = 1; i <= 7; i++) {
        for (const phone of [known, unknown]) {
          const started = Date.now();
          const res = await sendCode(phone, wrongFor(code, i));
          results.push({ status: res.status, text: res.text, ms: Date.now() - started, known: phone === known });
        }
      }
      expect(new Set(results.map((r) => r.status))).toEqual(new Set([401]));
      expect(new Set(results.map((r) => r.text))).toEqual(new Set([JSON.stringify(CODE_NOT_VALID)]));
      const times = results.map((r) => r.ms);
      expect(Math.min(...times)).toBeGreaterThanOrEqual(790);
      // Compare the two kinds by their median, not by the single slowest call:
      // a busy machine can stretch one request by 100 ms or more (SYC-597, seen
      // 112 ms), but a real difference between a known and an unknown address
      // moves every call, and so the median.
      const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
      const knownMs = results.filter((r) => r.known).map((r) => r.ms);
      const unknownMs = results.filter((r) => !r.known).map((r) => r.ms);
      expect(Math.abs(median(knownMs) - median(unknownMs))).toBeLessThanOrEqual(100);
    },
    40_000,
  );

  it("five wrong then right → refused, the row is dead and the link no longer peeks", async () => {
    const { phone, code, token } = await phoneWithCode();
    for (let i = 1; i <= 5; i++) expect((await sendCode(phone, wrongFor(code, i))).status).toBe(401);
    const right = await sendCode(phone, code);
    expect(right.status).toBe(401);
    expect(right.body).toEqual(CODE_NOT_VALID);
    const [row] = await rowsOf(phone.id);
    expect(row!.code_attempts).toBe(5);
    expect(row!.dead).toBe(true);
    expect(row!.handle_hash).toBeNull();
    const peek = await request(app)
      .post("/api/restore/peek")
      .set("X-Device-Secret", phone.secret)
      .set("X-Forwarded-For", freshIp())
      .send({ deviceId: phone.id, token });
    expect(peek.status).toBe(401);
    expect(peek.body).toEqual({ error: "link_not_valid" });
  });

  it("20 parallel wrong codes → code_attempts = 5 and at most 5 comparisons", async () => {
    const { phone, code } = await phoneWithCode();
    __setCodeCapForTest(100);
    // Hold the transactions as they begin (all twenty, or as many as the
    // pool lets in within a second), then let them on in REVERSE order, 20 ms
    // apart. The fifth to reach the row, which kills it, then began after
    // every transaction still waiting behind it, so its `expires_at = now()`
    // is later than their now() and can't stop them: only the row's own
    // `code_attempts < 5` can. (Without the reversal the guard's removal only
    // sometimes shows; mutation probe (a), SYC-664 T3.)
    let arrived = 0;
    let released = false;
    const held: (() => void)[] = [];
    const release = () => {
      if (released) return;
      released = true;
      held.reverse().forEach((go, i) => setTimeout(go, i * 20));
    };
    const timer = setTimeout(release, 1000);
    __setCodeHookForTest(
      () =>
        new Promise<void>((go) => {
          arrived++;
          if (released) return go();
          held.push(go);
          if (held.length === 20) release();
        }),
    );
    const compare = vi.spyOn(codeCheck, "matches");
    const answers = await Promise.all(Array.from({ length: 20 }, (_, i) => sendCode(phone, wrongFor(code, i + 1))));
    clearTimeout(timer);
    expect(arrived).toBe(20);
    expect(answers.map((a) => a.status)).toEqual(Array(20).fill(401));
    const [row] = await rowsOf(phone.id);
    expect(row!.code_attempts).toBe(5);
    expect(row!.dead).toBe(true);
    expect(compare.mock.calls.length).toBeGreaterThan(0);
    expect(compare.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("cap: the 11th code in an hour is too_many_tries, for any address", async () => {
    const phone = newPhone();
    await bind(phone);
    for (let i = 0; i < 10; i++) expect((await sendCode(phone, "11111111")).status).toBe(401);
    // A real, live code for a kept-safe address, from the same phone: still capped.
    const email = newAddress();
    await keptSafe(email);
    const { code } = await askForCode(phone, email);
    const eleventh = await sendCode(phone, code);
    expect(eleventh.status).toBe(429);
    expect(eleventh.body).toEqual({ error: "too_many_tries" });
    const [row] = await rowsOf(phone.id);
    expect(row!.code_attempts).toBe(0);
    expect(row!.handle_hash).toBeNull();
  });

  it("network cap: the 61st code in an hour from one network is too_many_tries, before any device check", async () => {
    const ip = "198.51.100.64";
    await _resetBucketForTests("keep_safe_code_ip");
    for (let i = 0; i < 60; i++) await consume("keep_safe_code_ip", addressKey(ip), 60, 60 * 60 * 1000);
    const phone = newPhone();
    await bind(phone);
    const over = await request(app)
      .post("/api/restore/code")
      .set("X-Forwarded-For", ip)
      .set("X-Device-Secret", phone.secret)
      .send({ deviceId: phone.id, code: "11111111" });
    expect(over.status).toBe(429);
    expect(over.body).toEqual({ error: "too_many_tries" });
    // Another network is unaffected.
    expect((await sendCode(phone, "11111111")).status).toBe(401);
    await _resetBucketForTests("keep_safe_code_ip");
  });

  it("cap: requests with the phone's id but no secret get 401 from device auth and spend nothing", async () => {
    const phone = newPhone();
    await bind(phone);
    for (let i = 0; i < 15; i++) {
      const res = await sendCode(phone, "11111111", null);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Device secret required" });
    }
    for (let i = 0; i < 10; i++) expect((await sendCode(phone, "11111111")).status).toBe(401);
    expect((await sendCode(phone, "11111111")).status).toBe(429);
  });

  it("two live rows: one wrong code counts against both, and the right code for either works", async () => {
    const a = newAddress();
    const b = newAddress();
    await keptSafe(a);
    await keptSafe(b);
    const phone = newPhone();
    await bind(phone);
    const first = await askForCode(phone, a);
    const second = await askForCode(phone, b);
    let wrong = "00000000";
    while (wrong === first.code || wrong === second.code) wrong = wrongFor(wrong);
    expect((await sendCode(phone, wrong)).status).toBe(401);
    let rows = await rowsOf(phone.id);
    expect(rows.map((r) => r.code_attempts)).toEqual([1, 1]);

    const r1 = await sendCode(phone, first.code);
    expect(r1.status).toBe(200);
    const r2 = await sendCode(phone, second.code);
    expect(r2.status).toBe(200);
    rows = await rowsOf(phone.id);
    expect(rows[0]!.handle_hash).toBe(hashToken(r1.body.handle));
    expect(rows[1]!.handle_hash).toBe(hashToken(r2.body.handle));
  });

  it("log redaction: no log line holds the code or the handle", async () => {
    const { phone, code } = await phoneWithCode();
    spies.logLines.length = 0;
    expect((await sendCode(phone, wrongFor(code))).status).toBe(401);
    const ok = await sendCode(phone, code);
    expect(ok.status).toBe(200);
    const handle: string = ok.body.handle;
    const logs = spies.logLines.join("\n");
    expect(logs).toContain("restore code");
    expect(logs).not.toContain(code);
    expect(logs).not.toContain(wrongFor(code));
    expect(logs).not.toContain(handle);
    expect(logs).not.toContain(hashToken(handle));
  });

  it("test hooks refuse to run outside NODE_ENV=test", () => {
    const env = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      expect(() => __setCodePadForTest(1)).toThrow("test only");
      expect(() => __setCodeCapForTest(1)).toThrow("test only");
      expect(() => __setCodeHookForTest(null)).toThrow("test only");
    } finally {
      process.env["NODE_ENV"] = env;
    }
  });
});

// SYC-664 Task 4: the handle stands in for the link's token at peek, redeem
// and the same-phone replay.
describe("a handle at peek, redeem and replay", () => {
  it("peek with handle: openedOnAskingPhone, and the same spotters as the link gives", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    const { code, token } = await askForCode(phone, email);
    const handle = await handleFor(phone, code);
    const byHandle = await peek(phone, handle);
    expect(byHandle.status).toBe(200);
    expect(byHandle.body.openedOnAskingPhone).toBe(true);
    expect(byHandle.body.alreadyHere).toBeNull();
    const byLink = await peek(phone, token);
    expect(byLink.status).toBe(200);
    const names = (b: { spotters: { username: string | null }[] }) => b.spotters.map((s) => s.username);
    expect(names(byHandle.body)).toEqual([old.username]);
    expect(names(byHandle.body)).toEqual(names(byLink.body));
  });

  it("redeem with handle moves the spots, and the link's token then answers link_not_valid at peek", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    const { code, token } = await askForCode(phone, email);
    const handle = await handleFor(phone, code);
    const p = await peek(phone, handle);
    const r = await redeem(phone, handle, p.body.spotters[0].choice);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ deviceId: old.id, username: old.username });
    expect(await storedHash(old.id)).toBe(hashSecret(phone.secret));
    // The old phone is told it moved: replaced_secret_hash was written on the row.
    const stale = await request(app).get(`/api/profiles/${old.id}`).set("X-Device-Secret", old.secret);
    expect(stale.body).toEqual({ error: "device_moved" });
    // One row, one spend: the link is used up too (peeked from a fresh phone,
    // since the old one now answers device_moved and the new one is retired).
    const third = newPhone();
    await bind(third);
    const linkPeek = await peek(third, token);
    expect(linkPeek.status).toBe(401);
    expect(linkPeek.body).toEqual({ error: "link_not_valid" });
  });

  it("a superseded handle at peek: link_not_valid; only the newest handle works (final review I2)", async () => {
    const { phone, code } = await phoneWithCode();
    const first = await handleFor(phone, code);
    const second = await handleFor(phone, code);
    expect(second).not.toBe(first);
    const old = await peek(phone, first);
    expect(old.status).toBe(401);
    expect(old.body).toEqual({ error: "link_not_valid" });
    expect((await peek(phone, second)).status).toBe(200);
  });

  it("a spent handle at peek: link_not_valid, even for the phone it moved to (final review I2)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    const { code } = await askForCode(phone, email);
    const handle = await handleFor(phone, code);
    const p = await peek(phone, handle);
    expect((await redeem(phone, handle, p.body.spotters[0].choice)).status).toBe(200);
    // The phone is now the restored spotter: its own secret under the spotter's id.
    const again = await peek({ id: old.id, secret: phone.secret }, handle);
    expect(again.status).toBe(401);
    expect(again.body).toEqual({ error: "link_not_valid" });
  });

  it("redeem with handle from another phone: allowed, like the link it stands in for (Decision 12)", async () => {
    // A handle is a link-equivalent secret that only the asking phone was
    // given, so another phone holding it is treated exactly as another phone
    // opening the link: the spots go to the phone that presses.
    const email = newAddress();
    const old = await keptSafe(email);
    const asker = newPhone();
    await bind(asker);
    const { code } = await askForCode(asker, email);
    const handle = await handleFor(asker, code);
    const other = newPhone();
    await bind(other);
    const p = await peek(other, handle);
    expect(p.status).toBe(200);
    expect(p.body.openedOnAskingPhone).toBe(false);
    const r = await redeem(other, handle, p.body.spotters[0].choice);
    expect(r.status).toBe(200);
    expect(r.body.deviceId).toBe(old.id);
    expect(await storedHash(old.id)).toBe(hashSecret(other.secret));
    expect(await storedHash(asker.id)).toBe(hashSecret(asker.secret));
  });

  it("Delete Nikos via handle, first reply dropped: the retry 1.5 s later is replayed and the phone is the restored spotter (not 410)", async () => {
    const email = newAddress();
    const old = await keptSafe(email);
    const phone = newPhone();
    await bind(phone);
    const nikos = `Nikos${NAME_RUN}${++n}`;
    const claim = await request(app)
      .post(`/api/profiles/${phone.id}/username`)
      .set("X-Device-Secret", phone.secret)
      .send({ username: nikos });
    expect(claim.status).toBe(200);
    const { code } = await askForCode(phone, email);
    const handle = await handleFor(phone, code);
    const p = await peek(phone, handle);
    expect(p.status).toBe(200);
    const choice: string = p.body.spotters[0].choice;

    let moves = 0;
    __setMoveHookForTest(async () => {
      moves++;
    });
    // The first redeem succeeds on the server; the phone never sees the reply.
    const lost = await redeem(phone, handle, choice, { abandonCurrent: true, deleteCurrent: true });
    expect(lost.status).toBe(200);
    expect(moves).toBe(1);
    await new Promise((r) => setTimeout(r, 1500));

    const retry = await redeem(phone, handle, choice, { abandonCurrent: true, deleteCurrent: true });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ deviceId: old.id, username: old.username });
    expect(moves).toBe(1); // nothing moved twice
    expect(await storedHash(old.id)).toBe(hashSecret(phone.secret));
    // Acting as the restored spotter works with the phone's own secret.
    const me = await request(app).get(`/api/profiles/${old.id}`).set("X-Device-Secret", phone.secret);
    expect(me.status).toBe(200);
  });
});
