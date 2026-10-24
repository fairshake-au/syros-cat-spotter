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
import { codeCheck } from "../lib/keepSafe/code";
import { _resetBucketForTests } from "../lib/limits";
import { __setCodeCapForTest, __setCodePadForTest, __setRestorePadForTest } from "./keepSafe";
import { installFakeResend, tokenFrom, type SentMail } from "../test/fakeResend";

const RUN = randomBytes(3).toString("hex");
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
async function keptSafe(email: string) {
  const phone = newPhone();
  await bind(phone);
  const claim = await request(app)
    .post(`/api/profiles/${phone.id}/username`)
    .set("X-Device-Secret", phone.secret)
    .send({ username: `Kc${RUN}${++n}` });
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
  return phone;
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

      const results: { status: number; text: string; ms: number }[] = [];
      // Seven each: the known row goes live → at its limit → dead along the way.
      for (let i = 1; i <= 7; i++) {
        for (const phone of [known, unknown]) {
          const started = Date.now();
          const res = await sendCode(phone, wrongFor(code, i));
          results.push({ status: res.status, text: res.text, ms: Date.now() - started });
        }
      }
      expect(new Set(results.map((r) => r.status))).toEqual(new Set([401]));
      expect(new Set(results.map((r) => r.text))).toEqual(new Set([JSON.stringify(CODE_NOT_VALID)]));
      const times = results.map((r) => r.ms);
      expect(Math.min(...times)).toBeGreaterThanOrEqual(790);
      expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(100);
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
    const compare = vi.spyOn(codeCheck, "matches");
    const answers = await Promise.all(Array.from({ length: 20 }, (_, i) => sendCode(phone, wrongFor(code, i + 1))));
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
    } finally {
      process.env["NODE_ENV"] = env;
    }
  });
});
