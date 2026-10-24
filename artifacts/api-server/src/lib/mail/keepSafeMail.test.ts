/**
 * SYC-3 Slice 1 step 2: the send function switched on for keep-safe mail, the
 * outbox's keep-safe builders, the keyed fingerprint (SYC-179) and the sweep.
 * Plan tests 9b, 14 and 16b.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import {
  db,
  emailConsentEventsTable,
  emailContactsTable,
  emailSuppressionsTable,
  mailOutboxTable,
  mailRequestsTable,
  mailTokensTable,
  pool,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { addressFingerprint, maskAddress, normaliseAddress } from "./fingerprint";
import { keepSafeVerify, restoreLink } from "./keepSafeTemplates";
import { enqueueKeepSafeMail, kickRow, settleOutbox, drainDue } from "./outbox";
import { hashRecipient } from "./send";
import { isKeepSafeSuppressed } from "./suppression";
import { sweepKeepSafe } from "../keepSafe/sweep";
import { installFakeResend, type SentMail } from "../../test/fakeResend";

const saved = { ...process.env };
let sent: SentMail[];
let fail = false;
const outboxIds: number[] = [];

beforeEach(() => {
  fail = false;
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  sent = installFakeResend({ fail: () => fail });
});
afterEach(async () => {
  await settleOutbox();
  vi.unstubAllGlobals();
  process.env = { ...saved };
});
afterAll(async () => {
  if (outboxIds.length) await db.delete(mailOutboxTable).where(inArray(mailOutboxTable.id, outboxIds));
  await pool.end();
});

const address = () => `Parent.${randomBytes(3).toString("hex")}@Example.org `;

async function queue(purpose: "keep_safe_verify" | "restore_link", to: string, expiresInMs = 15 * 60_000) {
  const id = await db.transaction((tx) =>
    enqueueKeepSafeMail(tx, {
      purpose,
      to: normaliseAddress(to),
      token: randomBytes(32).toString("base64url"),
      forgetToken: purpose === "keep_safe_verify" ? randomBytes(32).toString("base64url") : undefined,
      ...(purpose === "restore_link" ? { code: "48291376", askedAt: "14:32" } : {}),
      expiresAt: new Date(Date.now() + expiresInMs),
    }),
  );
  outboxIds.push(id);
  return id;
}

async function outboxRow(id: number) {
  const [row] = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.id, id));
  return row!;
}

async function confirmKeepSafe(to: string) {
  await db.insert(emailContactsTable).values({
    purpose: "keep_safe",
    addressHmac: addressFingerprint("keep_safe", to),
    addressMask: maskAddress(to),
    deviceId: `vitest-ksm-${randomBytes(4).toString("hex")}`,
    status: "confirmed",
    confirmedAt: new Date(),
  });
}

describe("the keyed fingerprint (SYC-179, review A3, test 16b)", () => {
  it("changes with the key, and is never the unkeyed sha256", () => {
    const a = "someone@example.org";
    const first = hashRecipient(a, "restore_link");
    process.env["EMAIL_FINGERPRINT_KEY"] = randomBytes(32).toString("base64url");
    expect(hashRecipient(a, "restore_link")).not.toBe(first);
    expect(first).not.toBe(createHash("sha256").update(a).digest("hex"));
    expect(first).not.toContain(createHash("sha256").update(a).digest("hex").slice(0, 16));
  });

  it("with no key, logs say nokey instead of falling back to an unkeyed hash", () => {
    delete process.env["EMAIL_FINGERPRINT_KEY"];
    expect(hashRecipient("someone@example.org", "welfare_alert")).toBe("nokey");
  });

  it("a keep-safe fingerprint never equals the same address's report, news or all fingerprint", () => {
    const a = "parent@example.org";
    const keepSafe = addressFingerprint("keep_safe", a);
    for (const other of ["report", "news", "all", "team"] as const) {
      expect(addressFingerprint(other, a)).not.toBe(keepSafe);
    }
  });

  it("normalises by trimming and lower-casing only (A8)", () => {
    expect(addressFingerprint("keep_safe", "  A.B+tag@Gmail.COM ")).toBe(addressFingerprint("keep_safe", "a.b+tag@gmail.com"));
    expect(addressFingerprint("keep_safe", "ab@gmail.com")).not.toBe(addressFingerprint("keep_safe", "a.b@gmail.com"));
    expect(maskAddress(" Samuel@Gmail.com")).toBe("s•••@gmail.com");
  });
});

describe("the fixed templates (test 14)", () => {
  it('"is this you?" is the appendix text, carrying only the two links', () => {
    const out = keepSafeVerify({
      confirmUrl: "https://apptest.catspotters.com/api/mail/confirm?t=AAA",
      forgetUrl: "https://apptest.catspotters.com/api/mail/forget?t=BBB",
    });
    expect(out.subject).toBe("Is this you? — Cat Spotters");
    expect(out.text).toContain(
      "Someone using the Cat Spotters app asked to use this address to keep their spots safe. If they lose their phone, this inbox is how they get their spots back.",
    );
    expect(out.text).toContain("Yes, that was me: https://apptest.catspotters.com/api/mail/confirm?t=AAA");
    expect(out.text).toContain("we'll forget it in seven days. To forget it now: https://apptest.catspotters.com/api/mail/forget?t=BBB");
    expect(out.html).toContain(">Forget this address</a>");
  });

  it("the restore email leads with the 8-digit code, then the link (SYC-664)", () => {
    const out = restoreLink({ restoreUrl: "https://apptest.catspotters.com/restore?t=CCC", code: "48291376", askedAt: "14:32" });
    expect(out.subject).toBe("48291376 is your Cat Spotters code");
    for (const body of [out.text, out.html]) {
      expect(body).toContain("48291376");
      expect(body).toContain("You asked for it at 14:32.");
      expect(body).toContain("Type it into Cat Spotters on the phone you asked from. It works once, for 15 minutes.");
      expect(body).toContain("Only type this code in yourself, or give it to your own child for their phone.");
      expect(body).toContain("If you didn");
    }
    expect(out.text).toContain(
      "If anyone else asks you for this code, they're trying to take someone's spots. Don't give it to them.",
    );
    expect(out.text).toContain("Get my spots back: https://apptest.catspotters.com/restore?t=CCC");
    expect(out.text).toContain("Nothing moves until someone types the code or presses the button.");
    expect(out.html).toContain(">Get my spots back</a>");
    expect(out.html).toContain("font-family:monospace");
  });

  it("refuses a code or time that isn't one (nothing typed can reach the body)", () => {
    const restoreUrl = "https://apptest.catspotters.com/restore?t=CCC";
    expect(() => restoreLink({ restoreUrl, code: "4829137", askedAt: "14:32" })).toThrow();
    expect(() => restoreLink({ restoreUrl, code: "<b>", askedAt: "14:32" })).toThrow();
    expect(() => restoreLink({ restoreUrl, code: "482913761", askedAt: "14:32" })).toThrow();
    expect(() => restoreLink({ restoreUrl, code: "48291376", askedAt: "<i>" })).toThrow();
    expect(() => restoreLink({ restoreUrl, code: "48291376" })).toThrow();
  });

  it("refuses a link that isn't one (nothing typed can reach the body)", () => {
    expect(() => restoreLink({ restoreUrl: 'javascript:alert(1)"' })).toThrow();
    expect(() => keepSafeVerify({ confirmUrl: "https://x/<b>", forgetUrl: "https://x" })).toThrow();
  });
});

describe("the outbox's keep-safe rows (review A4, R1, R2; test 16b)", () => {
  it("sends an \"is this you?\" from the transactional identity and clears the address and both tokens", async () => {
    const to = address();
    const id = await queue("keep_safe_verify", to);
    const before = await outboxRow(id);
    expect(JSON.stringify(before.payload)).toContain(normaliseAddress(to));
    expect(before.recipientHash).toBe(addressFingerprint("keep_safe", to));
    kickRow(id);
    await settleOutbox();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(normaliseAddress(to));
    expect(sent[0]!.from).toBe("Cat Spotters <hello@mail.catspotters.com>");
    expect(sent[0]!.text).toContain("https://apptest.catspotters.com/api/mail/confirm?t=");
    const after = await outboxRow(id);
    expect(after.state).toBe("sent");
    expect(after.payload).toEqual({ expiresAt: expect.any(String), cleared: true });
  });

  it("never sends a restore link to an address that isn't confirmed, and clears it on giving up", async () => {
    const to = address();
    const id = await queue("restore_link", to);
    kickRow(id);
    await settleOutbox();
    expect(sent).toHaveLength(0);
    const row = await outboxRow(id);
    expect(row.state).toBe("failed");
    expect(row.lastError).toBe("unverified");
    expect(JSON.stringify(row.payload)).not.toContain("@");
    expect(Object.keys(row.payload as object).sort()).toEqual(["cleared", "expiresAt"]);
  });

  it("sends a restore link to a confirmed address, from mail.", async () => {
    const to = address();
    await confirmKeepSafe(normaliseAddress(to));
    const id = await queue("restore_link", to);
    kickRow(id);
    await settleOutbox();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(/https:\/\/apptest\.catspotters\.com\/restore#t=[A-Za-z0-9_-]{43}/);
    expect((await outboxRow(id)).payload).toEqual({ expiresAt: expect.any(String), cleared: true });
  });

  it("a failed send retries while the link lives, and is given up (and cleared) once it has expired (R1)", async () => {
    const to = address();
    await confirmKeepSafe(normaliseAddress(to));
    const id = await queue("restore_link", to, 2_000);
    fail = true;
    kickRow(id);
    await settleOutbox();
    let row = await outboxRow(id);
    expect(row.state).toBe("queued");
    expect(JSON.stringify(row.payload)).toContain("@");
    // The link expires; the next drain must not send it, even with mail working.
    fail = false;
    await new Promise((r) => setTimeout(r, 2_100));
    await db.update(mailOutboxTable).set({ nextAttemptAt: new Date() }).where(eq(mailOutboxTable.id, id));
    await drainDue(5, id);
    expect(sent).toHaveLength(0);
    row = await outboxRow(id);
    expect(row.state).toBe("failed");
    expect(row.lastError).toBe("token_expired");
    expect(JSON.stringify(row.payload)).not.toContain("@");
  });

  it("the code is in the queued payload, and gone after a send, a give-up and the sweep (SYC-664)", async () => {
    const hasCode = async (id: number) =>
      (await db.execute(sql`select (payload ? 'code') as c, (payload ? 'askedAt') as a from mail_outbox where id = ${id}`)).rows[0] as { c: boolean; a: boolean };
    // Queued: both there.
    const queued = await queue("restore_link", address());
    expect((await outboxRow(queued)).payload).toMatchObject({ code: "48291376", askedAt: "14:32" });
    // Sent.
    const to = address();
    await confirmKeepSafe(normaliseAddress(to));
    const sentId = await queue("restore_link", to);
    kickRow(sentId);
    await settleOutbox();
    expect(sent[0]!.subject).toBe("48291376 is your Cat Spotters code");
    expect((await outboxRow(sentId)).state).toBe("sent");
    expect(await hasCode(sentId)).toEqual({ c: false, a: false });
    // Given up (unconfirmed address).
    const gaveUp = await queue("restore_link", address());
    kickRow(gaveUp);
    await settleOutbox();
    expect((await outboxRow(gaveUp)).state).toBe("failed");
    expect(await hasCode(gaveUp)).toEqual({ c: false, a: false });
    // Swept.
    const swept = await queue("restore_link", address(), -1_000);
    expect(await hasCode(swept)).toEqual({ c: true, a: true });
    await sweepKeepSafe();
    expect(await hasCode(swept)).toEqual({ c: false, a: false });
  });

  it("a restore row missing its code or time is given up, not sent (SYC-664)", async () => {
    const to = address();
    await confirmKeepSafe(normaliseAddress(to));
    const id = await db.transaction((tx) =>
      enqueueKeepSafeMail(tx, {
        purpose: "restore_link",
        to: normaliseAddress(to),
        token: randomBytes(32).toString("base64url"),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      }),
    );
    outboxIds.push(id);
    kickRow(id);
    await settleOutbox();
    expect(sent).toHaveLength(0);
    const row = await outboxRow(id);
    expect(row.state).toBe("failed");
    expect(row.lastError).toBe("nothing_to_send");
    expect(Object.keys(row.payload as object).sort()).toEqual(["cleared", "expiresAt"]);
  });

  it("the sweep clears an expired row no drain reached", async () => {
    const id = await queue("restore_link", address(), -1_000);
    await sweepKeepSafe();
    const row = await outboxRow(id);
    expect(row.state).toBe("failed");
    expect(Object.keys(row.payload as object).sort()).toEqual(["cleared", "expiresAt"]);
  });
});

describe("suppression reasons (review A2, A10; test 8c)", () => {
  it("verify_cap stops further \"is this you?\" emails but never a restore link", async () => {
    const to = normaliseAddress(address());
    await db.insert(emailSuppressionsTable).values({
      addressHmac: addressFingerprint("keep_safe", to),
      reason: "verify_cap",
      scope: "keep_safe",
    });
    expect(await isKeepSafeSuppressed("keep_safe_verify", to)).toBe(true);
    expect(await isKeepSafeSuppressed("restore_link", to)).toBe(false);
  });

  it("forget blocks keep-safe mail; a news or report forget doesn't touch keep-safe", async () => {
    const to = normaliseAddress(address());
    await db.insert(emailSuppressionsTable).values({ addressHmac: addressFingerprint("news", to), reason: "forget", scope: "news" });
    expect(await isKeepSafeSuppressed("restore_link", to)).toBe(false);
    await db.insert(emailSuppressionsTable).values({ addressHmac: addressFingerprint("keep_safe", to), reason: "forget", scope: "keep_safe" });
    expect(await isKeepSafeSuppressed("restore_link", to)).toBe(true);
    expect(await isKeepSafeSuppressed("keep_safe_verify", to)).toBe(true);
  });

  it("a bounce or complaint blocks everything", async () => {
    const to = normaliseAddress(address());
    await db.insert(emailSuppressionsTable).values({ addressHmac: addressFingerprint("all", to), reason: "bounce", scope: "all" });
    expect(await isKeepSafeSuppressed("restore_link", to)).toBe(true);
    expect(await isKeepSafeSuppressed("keep_safe_verify", to)).toBe(true);
  });
});

describe("the sweep (test 9b)", () => {
  const device = () => `vitest-sweep-${randomBytes(4).toString("hex")}`;

  it("removes a pending address after 7 days with its tokens, and keeps only that it expired", async () => {
    const d = device();
    const hmac = addressFingerprint("keep_safe", `${d}@example.org`);
    const [contact] = await db
      .insert(emailContactsTable)
      .values({ purpose: "keep_safe", addressHmac: hmac, addressMask: "v•••@example.org", deviceId: d, createdAt: sql`now() - interval '7 days 1 minute'` })
      .returning();
    const [young] = await db
      .insert(emailContactsTable)
      .values({ purpose: "keep_safe", addressHmac: hmac, addressMask: "v•••@example.org", deviceId: `${d}-young`, createdAt: sql`now() - interval '6 days'` })
      .returning();
    await db.insert(mailTokensTable).values({
      tokenHash: `sweep-${d}`, purpose: "verify", contactId: contact!.id, addressHmac: hmac, deviceId: d,
      expiresAt: new Date(Date.now() + 1000),
    });
    await db.insert(emailConsentEventsTable).values({ contactId: contact!.id, deviceId: d, addressHmac: hmac, purpose: "keep_safe", event: "consented", surface: "settings", wordingVersion: "v1", language: "en" });
    await sweepKeepSafe();
    expect(await db.select().from(emailContactsTable).where(eq(emailContactsTable.id, contact!.id))).toHaveLength(0);
    expect(await db.select().from(emailContactsTable).where(eq(emailContactsTable.id, young!.id))).toHaveLength(1);
    expect(await db.select().from(mailTokensTable).where(eq(mailTokensTable.tokenHash, `sweep-${d}`))).toHaveLength(0);
    const events = await db.select().from(emailConsentEventsTable).where(eq(emailConsentEventsTable.addressHmac, hmac));
    expect(events.map((e) => e.event).sort()).toEqual(["consented", "expired"]);
    for (const e of events) {
      expect(e.deviceId).toBeNull();
      expect(e.contactId).toBeNull();
    }
  });

  it("removes tokens 30 days after use or expiry, keeps a move's fingerprint for 90 days, and request rows after 24 hours", async () => {
    const d = device();
    const base = { addressHmac: "h", deviceId: d, purpose: "restore" as const };
    await db.insert(mailTokensTable).values([
      { ...base, tokenHash: `${d}-old-unused`, expiresAt: sql`now() - interval '31 days'` as unknown as Date },
      { ...base, tokenHash: `${d}-recent`, expiresAt: sql`now() - interval '29 days'` as unknown as Date },
      { ...base, tokenHash: `${d}-moved-89`, expiresAt: sql`now() - interval '89 days'` as unknown as Date, usedAt: sql`now() - interval '89 days'` as unknown as Date, replacedSecretHash: "x" },
      { ...base, tokenHash: `${d}-moved-91`, expiresAt: sql`now() - interval '91 days'` as unknown as Date, usedAt: sql`now() - interval '91 days'` as unknown as Date, replacedSecretHash: "y" },
    ]);
    await db.insert(mailRequestsTable).values([
      { kind: "restore", addressHmac: d, ipHash: "ip", createdAt: sql`now() - interval '25 hours'` as unknown as Date },
      { kind: "restore", addressHmac: d, ipHash: "ip", createdAt: sql`now() - interval '23 hours'` as unknown as Date },
    ]);
    await sweepKeepSafe();
    const left = (await db.select().from(mailTokensTable).where(eq(mailTokensTable.deviceId, d))).map((t) => t.tokenHash).sort();
    expect(left).toEqual([`${d}-moved-89`, `${d}-recent`]);
    expect(await db.select().from(mailRequestsTable).where(eq(mailRequestsTable.addressHmac, d))).toHaveLength(1);
  });
});
