import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  catSubscriptionsTable,
  catUpdatesTable,
  deviceCredentialsTable,
  notificationsTable,
  observationsTable,
  profilesTable,
  pushTokensTable,
  sightingMatchesTable,
  sightingsTable,
  welfareReportsTable,
  emailContactsTable,
  mailTokensTable,
  emailConsentEventsTable,
  mailOutboxTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

// SYC-63 plan §8.1: "the cat's data survives and the person is gone".

const spies = vi.hoisted(() => ({ logLines: [] as string[] }));

// The logging test captures every line, with production's redaction.
vi.mock("../lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    {
      level: "trace",
      redact: actual.REDACT_PATHS,
      serializers: actual.LOG_SERIALIZERS,
    },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});

vi.mock("../lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

// The per-address cap on DELETE /me (10 per 15 min) isn't what these tests
// are about, and this file deletes more often than that from one address.
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  deleteMeLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";
import { sendPushNotification } from "../lib/push";
import { notifyCatSpotters } from "../lib/notifications";
import { createUpdateAndFanOut } from "../lib/notificationFanout";
import { deletedMarkerKey } from "../lib/deviceAuth";
import { enqueueKeepSafeMail } from "../lib/mail/outbox";
import { addressFingerprint } from "../lib/mail/fingerprint";
import { _resetNewDeviceLimitForTests } from "../middlewares/newDeviceLimit";
import { _resetClaimLimitForTests } from "../middlewares/rateLimit";
import { blurPosition } from "../lib/blur";
import { teamCatView } from "../lib/teamCatView";
import { renderCatPage } from "../lib/teamPages/catPages";

const pushMock = vi.mocked(sendPushNotification);

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

// The real keyed fingerprint, so sent emails (payload cleared, only
// recipient_hash left) are matched the way production matches them.
const savedFingerprintKey = process.env["EMAIL_FINGERPRINT_KEY"];
process.env["EMAIL_FINGERPRINT_KEY"] = randomBytes(32).toString("base64url");

// Keep-safe emails this file queued. Tests that delete nothing (a wrong
// secret, an unbound id) leave theirs queued, and the outbox drain in other
// files (reports.test.ts) would pick them up.
const seededFingerprints: string[] = [];

afterAll(async () => {
  if (seededFingerprints.length) {
    await db.delete(mailOutboxTable).where(inArray(mailOutboxTable.recipientHash, seededFingerprints));
  }
  if (savedFingerprintKey === undefined) delete process.env["EMAIL_FINGERPRINT_KEY"];
  else process.env["EMAIL_FINGERPRINT_KEY"] = savedFingerprintKey;
  await pool.end();
});

type Person = {
  deviceId: string;
  secret: string;
  username: string;
  nickname: string;
};

function person(label: string): Person {
  const tag = randomBytes(4).toString("hex");
  return {
    deviceId: `vitest-sever-${label}-${tag}`,
    secret: `vitest-sever-secret-${label}-${tag}`,
    username: `sever${label}${tag}`,
    nickname: `Nick${label}${tag}`,
  };
}

const deleteMe = (p: { deviceId: string; secret?: string }) => {
  const req = request(app).delete("/api/me").set("X-Device-Id", p.deviceId);
  if (p.secret) req.set("X-Device-Secret", p.secret);
  return req;
};

/** Binds the person's secret (trust on first use) and gives them a profile. */
async function signUp(p: Person, points = 0) {
  const res = await request(app)
    .get(`/api/profiles/${p.deviceId}`)
    .set("X-Device-Secret", p.secret);
  expect(res.status).toBe(200);
  await db
    .update(profilesTable)
    .set({ username: p.username, nickname: p.nickname, points })
    .where(eq(profilesTable.deviceId, p.deviceId));
}

type World = Awaited<ReturnType<typeof seedWorld>>;

/**
 * Person P has everything the plan lists; Q has a sighting of the same cat.
 * Every row is unique to this call, so tests never see each other's data.
 */
async function seedWorld() {
  const P = person("P");
  const Q = person("Q");
  await signUp(P, 42);
  await signUp(Q, 7);
  const tag = randomBytes(4).toString("hex");
  const ownerName = `Owner Name ${tag}`;

  const [discovered] = await db
    .insert(catsTable)
    .values({
      name: `SeverFound${tag}`,
      description: "Ginger, loud",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.94,
      discovererDeviceId: P.deviceId,
    })
    .returning();
  const [claimed] = await db
    .insert(catsTable)
    .values({
      name: `SeverHome${tag}`,
      primaryPhotoId: 0,
      lat: 37.45,
      lng: 24.95,
      discovererDeviceId: Q.deviceId,
      ownerDeviceId: P.deviceId,
      ownerName,
      homeDescription: "The blue house by the church",
    })
    .returning();

  const sighting = (
    deviceId: string,
    catId: number | null,
    status: string,
  ) => ({
    deviceId,
    catId,
    status,
    photoId: 0,
    lat: 37.44,
    lng: 24.94,
  });
  await db
    .insert(sightingsTable)
    .values([
      sighting(P.deviceId, discovered!.id, "resolved"),
      sighting(P.deviceId, claimed!.id, "resolved"),
      sighting(P.deviceId, null, "pending"),
      sighting(Q.deviceId, discovered!.id, "resolved"),
    ]);

  const obs = (catId: number, kind: string, value: unknown, extra = {}) => ({
    catId,
    kind,
    value,
    deviceId: P.deviceId,
    observedAt: new Date(),
    ...extra,
  });
  await db
    .insert(observationsTable)
    .values([
      obs(discovered!.id, "note", { text: `I live at number 4, ${tag}` }),
      obs(discovered!.id, "ear_tip", { clipped: true, side: "left" }),
      obs(discovered!.id, "name", {
        name: discovered!.name,
        normalised: discovered!.name.toLowerCase(),
      }),
      obs(
        claimed!.id,
        "life_status",
        { status: "homed" },
        { authorityScope: "owner_of_this_cat" },
      ),
    ]);

  await db
    .insert(catSubscriptionsTable)
    .values({ deviceId: P.deviceId, catId: discovered!.id });
  const [update] = await db
    .insert(catUpdatesTable)
    .values({
      catId: discovered!.id,
      updateType: "general",
      message: "Fed today",
    })
    .returning();
  await db.insert(notificationsTable).values([
    { deviceId: P.deviceId, catUpdateId: update!.id },
    { deviceId: P.deviceId, catUpdateId: update!.id, read: true },
  ]);
  await db
    .insert(pushTokensTable)
    .values({ deviceId: P.deviceId, token: `token-${P.deviceId}` });
  await db
    .insert(pushTokensTable)
    .values({ deviceId: Q.deviceId, token: `token-${Q.deviceId}` });
  await db
    .insert(catSubscriptionsTable)
    .values({ deviceId: Q.deviceId, catId: discovered!.id });

  const [report] = await db
    .insert(welfareReportsTable)
    .values({
      publicId: `sever-${tag}`,
      severity: "attention",
      lat: 37.44,
      lng: 24.94,
      reporterDevice: P.deviceId,
      catId: discovered!.id,
      clientRef: `ref-${tag}`,
    })
    .returning();
  // SYC-44 PR 4.1 (T4-7): a "Report an issue" row from the same device, with
  // no position.
  const [contentReport] = await db
    .insert(welfareReportsTable)
    .values({
      publicId: `sever-c-${tag}`,
      kind: "content",
      reason: "other",
      severity: "attention",
      reporterDevice: P.deviceId,
      catId: discovered!.id,
      clientRef: `ref-c-${tag}`,
      photoState: "none",
    })
    .returning();

  // "Keep my spots safe" (SYC-3): a confirmed keep-safe contact, its verify
  // and forget link tokens, a used restore token that moved P, consent
  // events, a queued verify email that still holds the address, a sent one
  // that holds only its fingerprint, and a report contact (finding 7 of the
  // #97 review: contacts of any purpose can name the device).
  const email = `p-${tag}@example.com`;
  const hmac = addressFingerprint("keep_safe", email);
  seededFingerprints.push(hmac);
  const token = `tok-${tag}`;
  const forgetToken = `fgt-${tag}`;
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");
  const [contact] = await db
    .insert(emailContactsTable)
    .values({ purpose: "keep_safe", addressHmac: hmac, addressMask: "p•••@example.com", deviceId: P.deviceId, status: "confirmed", confirmedAt: new Date() })
    .returning();
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await db.insert(mailTokensTable).values([
    { tokenHash: sha(token), purpose: "verify", contactId: contact!.id, addressHmac: hmac, deviceId: P.deviceId, expiresAt },
    { tokenHash: sha(forgetToken), purpose: "forget", contactId: contact!.id, addressHmac: hmac, deviceId: P.deviceId, expiresAt },
    { tokenHash: sha(`restore-${tag}`), purpose: "restore", addressHmac: hmac, deviceId: `asker-${tag}`, restoredDeviceId: P.deviceId, usedAt: new Date(), expiresAt },
  ]);
  await db.insert(emailConsentEventsTable).values([
    { contactId: contact!.id, deviceId: P.deviceId, addressHmac: hmac, purpose: "keep_safe", event: "consented", surface: "onboarding", wordingVersion: "v1", language: "en" },
    { contactId: contact!.id, deviceId: P.deviceId, addressHmac: hmac, purpose: "keep_safe", event: "verified" },
  ]);
  await db.transaction((tx) =>
    enqueueKeepSafeMail(tx, { purpose: "keep_safe_verify", to: email, token, forgetToken, expiresAt }),
  );
  const sentId = await db.transaction((tx) =>
    enqueueKeepSafeMail(tx, { purpose: "keep_safe_verify", to: email, token: `old-${tag}`, forgetToken: `oldf-${tag}`, expiresAt }),
  );
  // As the outbox leaves it once sent (outbox.ts markSent): payload cleared.
  await db
    .update(mailOutboxTable)
    .set({ state: "sent", payload: { expiresAt: expiresAt.toISOString(), cleared: true } })
    .where(eq(mailOutboxTable.id, sentId));
  await db.insert(emailContactsTable).values({
    purpose: "report", address: email, addressHmac: addressFingerprint("report", email),
    addressMask: "p•••@example.com", deviceId: P.deviceId, status: "confirmed", confirmedAt: new Date(),
  });

  return {
    P,
    Q,
    email,
    hmac,
    ownerName,
    discovered: discovered!,
    claimed: claimed!,
    report: report!,
    contentReport: contentReport!,
  };
}

/** Every text-like column of every public table, found afresh each time. */
async function columnsHolding(needle: string): Promise<string[]> {
  const cols = await db.execute<{
    table_name: string;
    column_name: string;
  }>(sql`
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and t.table_type = 'BASE TABLE'
       and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
  `);
  const hits: string[] = [];
  for (const { table_name, column_name } of cols.rows) {
    const r = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table_name)}
          where ${sql.identifier(column_name)}::text like ${"%" + needle + "%"}`,
    );
    if (r.rows[0]!.n > 0) hits.push(`${table_name}.${column_name}`);
  }
  return hits;
}

async function catPage(catId: number) {
  const res = await request(app).get(`/api/cats/${catId}`);
  expect(res.status).toBe(200);
  return res.body as {
    cat: Record<string, unknown>;
    fansCount: number;
    careTimeline: { type: string; message: string }[];
    sightings: { spotterCode: string | null; spotterUsername: string | null }[];
  };
}

/** The parts of a cat page that belong to the cat, not to any person. */
function catOnly(page: Awaited<ReturnType<typeof catPage>>) {
  const {
    discovererSpotterCode: _code,
    discovererNickname: _nick,
    discovererUsername: _user,
    ownerName: _owner,
    ...cat
  } = page.cat;
  return { cat, sightings: page.sightings.length };
}

beforeEach(async () => {
  pushMock.mockClear();
  // Every seeded world registers new phones from one test address; the
  // per-address cap (SYC-195) is not what these tests are about.
  await _resetNewDeviceLimitForTests();
});

describe("DELETE /api/me: the cat's data survives and the person is gone", () => {
  let w: World;
  let before: {
    discovered: Awaited<ReturnType<typeof catPage>>;
    claimed: Awaited<ReturnType<typeof catPage>>;
  };
  let obsCountBefore: number;

  it("deletes, with 204", async () => {
    w = await seedWorld();
    before = {
      discovered: await catPage(w.discovered.id),
      claimed: await catPage(w.claimed.id),
    };
    expect(before.claimed.cat).toMatchObject({
      hasHome: true,
      lifeStatus: "homed",
    });
    const [n] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(observationsTable);
    obsCountBefore = n!.n;
    // Sanity: before deletion the scan does find P everywhere.
    expect(await columnsHolding(w.P.deviceId)).toContain("profiles.device_id");

    const res = await deleteMe(w.P);
    expect(res.status).toBe(204);
  });

  it("1. leaves no trace of P in any column of any table", async () => {
    for (const needle of [
      w.P.deviceId,
      w.P.username,
      w.P.nickname,
      w.ownerName,
      // SYC-3: the keep-safe address (only ever in the queued email) and
      // the address fingerprint on the contact, tokens and consent events.
      w.email,
      w.hmac,
    ]) {
      expect(await columnsHolding(needle), needle).toEqual([]);
    }
  });

  it("2. leaves the cats unchanged, the claimed one still homed with its home note", async () => {
    const discovered = await catPage(w.discovered.id);
    const claimed = await catPage(w.claimed.id);
    expect(catOnly(discovered)).toEqual(catOnly(before.discovered));
    expect(catOnly(claimed)).toEqual(catOnly(before.claimed));
    // SYC-130 D9: the home note is never in the public payload, before or
    // after deletion; D13: it stays on the cat, for Syros Cats.
    expect(claimed.cat).toMatchObject({
      hasHome: true,
      lifeStatus: "homed",
      ownerName: null,
      homeDescription: null,
    });
    const [row] = await db
      .select()
      .from(catsTable)
      .where(eq(catsTable.id, w.claimed.id));
    expect(row!.ownerDeviceId).toBeNull();
    expect(row!.ownerName).toBeNull();
    expect(row!.homeDescription).toBe("The blue house by the church");
    const [found] = await db
      .select()
      .from(catsTable)
      .where(eq(catsTable.id, w.discovered.id));
    expect(found).toMatchObject({
      discovererDeviceId: null,
      redactionReason: "deleted by the person",
      name: w.discovered.name,
    });
    expect(found!.redactedAt).not.toBeNull();
  });

  it("3. empties the note, keeps every observation row and every other value", async () => {
    const [n] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(observationsTable);
    expect(n!.n).toBe(obsCountBefore);
    const rows = await db
      .select()
      .from(observationsTable)
      .where(eq(observationsTable.catId, w.discovered.id));
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
    expect(byKind["note"]!.value).toEqual({});
    expect(byKind["ear_tip"]!.value).toEqual({ clipped: true, side: "left" });
    expect(byKind["name"]!.value).toMatchObject({ name: w.discovered.name });
    for (const r of rows) {
      expect(r.deviceId).toBeNull();
      expect(r.redactionReason).toBe("deleted by the person");
    }
  });

  it("4. leaves Q untouched", async () => {
    const [q] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.deviceId, w.Q.deviceId));
    expect(q).toMatchObject({ username: w.Q.username, points: 7 });
    const qs = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, w.Q.deviceId));
    expect(qs).toHaveLength(1);
    expect(qs[0]!.redactedAt).toBeNull();
    const [claimed] = await db
      .select()
      .from(catsTable)
      .where(eq(catsTable.id, w.claimed.id));
    expect(claimed!.discovererDeviceId).toBe(w.Q.deviceId);
  });

  it("5. shows P as nobody: null codes, the fixed marker, one fan fewer", async () => {
    const page = await catPage(w.discovered.id);
    expect(page.cat).toMatchObject({
      discovererSpotterCode: null,
      discovererUsername: null,
      discovererNickname: null,
    });
    expect(
      page.careTimeline.find((e) => e.type === "discovered")!.message,
    ).toBeNull();
    expect(page.sightings.filter((s) => s.spotterCode === null)).toHaveLength(
      1,
    );
    expect(page.sightings.filter((s) => s.spotterCode !== null)).toHaveLength(
      1,
    );
    // Decision C: P stops counting.
    expect(page.fansCount).toBe(before.discovered.fansCount - 1);
    const board = await request(app).get("/api/leaderboard");
    expect(JSON.stringify(board.body)).not.toContain(w.P.username);
  });

  it("5b. keeps the welfare report and its cat, with nobody on it", async () => {
    const [r] = await db
      .select()
      .from(welfareReportsTable)
      .where(eq(welfareReportsTable.id, w.report.id));
    expect(r).toMatchObject({
      reporterDevice: null,
      catId: w.discovered.id,
      severity: "attention",
    });
  });

  it("T4-7 (SYC-44). clears the device from a 'Report an issue' row too: severPerson has no kind filter", async () => {
    const [r] = await db
      .select()
      .from(welfareReportsTable)
      .where(eq(welfareReportsTable.id, w.contentReport.id));
    expect(r).toMatchObject({
      kind: "content",
      reporterDevice: null,
      catId: w.discovered.id,
    });
    // Both kinds are gone from the reporter column.
    const left = await db
      .select({ id: welfareReportsTable.id })
      .from(welfareReportsTable)
      .where(eq(welfareReportsTable.reporterDevice, w.P.deviceId));
    expect(left).toEqual([]);
  });

  it("5c. keeps P's consent records, with who they were about removed (SYC-3)", async () => {
    const rows = await db
      .select()
      .from(emailConsentEventsTable)
      .where(eq(emailConsentEventsTable.redactionReason, "deleted by the person"));
    const ps = rows.filter((r) => r.wordingVersion === "v1" || r.event === "verified");
    expect(ps.length).toBeGreaterThanOrEqual(2);
    for (const r of ps) {
      expect(r).toMatchObject({ deviceId: null, contactId: null, addressHmac: null });
      expect(r.redactedAt).not.toBeNull();
    }
    const contacts = await db.select().from(emailContactsTable).where(eq(emailContactsTable.addressHmac, w.hmac));
    expect(contacts).toEqual([]);
    const tokens = await db.select().from(mailTokensTable).where(eq(mailTokensTable.addressHmac, w.hmac));
    expect(tokens).toEqual([]);
    // The sent email kept only the fingerprint: it goes too (#97 review, finding 2).
    const mail = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.recipientHash, w.hmac));
    expect(mail).toEqual([]);
  });

  it("5d. leaves a sibling's queued email to the same address alone", async () => {
    // Siblings can share a parent's address (SYC-3 Decision 3): only P's own
    // tokens and P's finished emails are matched, never a queued one by address.
    const s = await seedWorld();
    const siblingId = await db.transaction((tx) =>
      enqueueKeepSafeMail(tx, {
        purpose: "keep_safe_verify", to: s.email, token: `sib-${s.hmac.slice(0, 8)}`,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      }),
    );
    const res = await deleteMe(s.P);
    expect(res.status).toBe(204);
    const left = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.recipientHash, s.hmac));
    expect(left.map((r) => r.id)).toEqual([siblingId]);
    await db.delete(mailOutboxTable).where(eq(mailOutboxTable.id, siblingId));
  });

  it("5e. never binds: an id with no secret yet gets 403 and keeps its data", async () => {
    const s = await seedWorld();
    // An old spotter whose phone never sent a secret: no credential row.
    await db.delete(deviceCredentialsTable).where(eq(deviceCredentialsTable.deviceId, s.P.deviceId));
    const res = await deleteMe(s.P);
    expect(res.status).toBe(403);
    const creds = await db.select().from(deviceCredentialsTable).where(eq(deviceCredentialsTable.deviceId, s.P.deviceId));
    expect(creds).toEqual([]);
    const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.deviceId, s.P.deviceId));
    expect(profile).toBeTruthy();
  });

  it("6. a second call returns 204 and changes nothing", async () => {
    const snapshot = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.catId, w.discovered.id));
    const res = await deleteMe(w.P);
    expect(res.status).toBe(204);
    // Even without the secret: the marker alone answers.
    expect((await deleteMe({ deviceId: w.P.deviceId })).status).toBe(204);
    expect(
      await db
        .select()
        .from(sightingsTable)
        .where(eq(sightingsTable.catId, w.discovered.id)),
    ).toEqual(snapshot);
    expect(await columnsHolding(w.P.deviceId)).toEqual([]);
  });

  it("7. the old id gets 410 everywhere, with or without the secret, and nothing comes back", async () => {
    const P = w.P;
    const withSecret = [
      request(app)
        .get(`/api/profiles/${P.deviceId}`)
        .set("X-Device-Secret", P.secret),
      request(app)
        .get(`/api/notifications/${P.deviceId}`)
        .set("X-Device-Secret", P.secret),
      request(app)
        .put(`/api/profile/${P.deviceId}/push-token`)
        .set("X-Device-Secret", P.secret)
        .send({ token: "ExponentPushToken[x]" }),
      request(app)
        .post(`/api/profiles/${P.deviceId}/username`)
        .set("X-Device-Secret", P.secret)
        .send({ username: `again${randomBytes(3).toString("hex")}` }),
      request(app)
        .post("/api/sightings")
        .set("X-Device-Secret", P.secret)
        .send({
          deviceId: P.deviceId,
          lat: 37.44,
          lng: 24.9,
          photoBase64: TINY_JPEG_B64,
        }),
    ];
    const withSecretLabels = [
      "GET profile",
      "GET notifications",
      "PUT push token",
      "POST username",
      "POST /sightings",
    ];
    for (const [i, res] of (await Promise.all(withSecret)).entries()) {
      expect(res.status, withSecretLabels[i]).toBe(410);
      expect(res.body.code).toBe("IDENTITY_DELETED");
    }
    // The cat routes, with the old id and no secret at all (§4.3).
    // POST /api/cats has been removed (SYC-130 D7).
    const noSecret = [
      request(app)
        .post("/api/cats")
        .send({
          deviceId: P.deviceId,
          name: `SeverGhost${randomBytes(3).toString("hex")}`,
          lat: 37.44,
          lng: 24.9,
          ownerName: "Ghost",
          homeDescription: "",
        }),
      request(app)
        .post(`/api/cats/${w.discovered.id}/claim`)
        .send({
          deviceId: P.deviceId,
          livesOnSyros: true,
          livesInMyHome: true,
          homePin: { lat: 37.44, lng: 24.9 },
        }),
      request(app)
        .patch(`/api/cats/${w.claimed.id}`)
        .send({ deviceId: P.deviceId, name: "Ghost" }),
    ];
    const noSecretLabels = ["POST /cats (removed, 404)", "POST claim", "PATCH cat"];
    const expectedStatuses = [404, 410, 410];
    for (const [i, res] of (await Promise.all(noSecret)).entries()) {
      expect(res.status, noSecretLabels[i]).toBe(expectedStatuses[i]);
    }
    const creds = await db
      .select()
      .from(deviceCredentialsTable)
      .where(eq(deviceCredentialsTable.deviceId, P.deviceId));
    expect(creds).toEqual([]);
    expect(await columnsHolding(P.deviceId)).toEqual([]);
    // Only the one-way marker remains.
    const markers = await db
      .select()
      .from(deviceCredentialsTable)
      .where(eq(deviceCredentialsTable.deviceId, deletedMarkerKey(P.deviceId)));
    expect(markers).toHaveLength(1);
  });

  it("refuses an id that pretends to be a marker", async () => {
    const res = await deleteMe({
      deviceId: deletedMarkerKey(w.P.deviceId),
      secret: w.P.secret,
    });
    expect(res.status).toBe(400);
    const profile = await request(app)
      .get(
        `/api/profiles/${encodeURIComponent(deletedMarkerKey(w.P.deviceId))}`,
      )
      .set("X-Device-Secret", w.P.secret);
    expect(profile.status).toBe(400);
  });

  it("9. later news about the cat reaches Q and never P", async () => {
    await createUpdateAndFanOut({
      cat: w.discovered,
      updateType: "general",
      message: "Spotted again",
    });
    await notifyCatSpotters(w.discovered.id, "someone-else", {
      title: "t",
      body: "b",
    });
    const tokens = pushMock.mock.calls.map(([token]) => token);
    expect(tokens).toContain(`token-${w.Q.deviceId}`);
    expect(tokens).not.toContain(`token-${w.P.deviceId}`);
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(eq(notificationsTable.deviceId, w.P.deviceId));
    expect(rows[0]!.n).toBe(0);
  });
});

describe("DELETE /api/me: refusals", () => {
  it("8. a wrong secret gets 403 and deletes nothing", async () => {
    const w = await seedWorld();
    const res = await deleteMe({
      deviceId: w.P.deviceId,
      secret: "not-the-secret-at-all-xx",
    });
    expect(res.status).toBe(403);
    expect(await columnsHolding(w.P.deviceId)).toEqual(
      expect.arrayContaining([
        "profiles.device_id",
        "sightings.device_id",
        "observations.device_id",
      ]),
    );
  });

  it("needs the device id header and a secret", async () => {
    expect((await request(app).delete("/api/me")).status).toBe(400);
    const w = await seedWorld();
    expect((await deleteMe({ deviceId: w.P.deviceId })).status).toBe(401);
  });

  it("10. is one transaction: a failure part-way redacts nothing", async () => {
    const w = await seedWorld();
    // Make the profile delete fail, after the redactions have run.
    await db.execute(sql`
      create or replace function vitest_refuse_profile_delete() returns trigger
      language plpgsql as $$ begin raise exception 'vitest: refused'; end $$`);
    await db.execute(sql`
      create trigger vitest_refuse_profile_delete before delete on profiles
      for each row execute function vitest_refuse_profile_delete()`);
    try {
      const res = await deleteMe(w.P);
      expect(res.status).toBe(500);
    } finally {
      await db.execute(
        sql`drop trigger vitest_refuse_profile_delete on profiles`,
      );
      await db.execute(sql`drop function vitest_refuse_profile_delete()`);
    }
    const sightings = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, w.P.deviceId));
    expect(sightings).toHaveLength(3);
    const redacted = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(observationsTable)
      .where(
        and(
          eq(observationsTable.catId, w.discovered.id),
          sql`${observationsTable.redactedAt} is not null`,
        ),
      );
    expect(redacted[0]!.n).toBe(0);
    const [cat] = await db
      .select()
      .from(catsTable)
      .where(eq(catsTable.id, w.claimed.id));
    expect(cat!.ownerName).toBe(w.ownerName);
    // And it then succeeds once the fault is gone.
    expect((await deleteMe(w.P)).status).toBe(204);
  });
});

describe("SYC-235: a deleted discoverer is a blank, never a stand-in word", () => {
  it("a live spotter named \"a spotter\" is still shown by name", async () => {
    const w = await seedWorld();
    await db
      .update(profilesTable)
      .set({ username: "a spotter" })
      .where(eq(profilesTable.deviceId, w.P.deviceId));
    const before = await catPage(w.discovered.id);
    expect(
      before.careTimeline.find((e) => e.type === "discovered")!.message,
    ).toBe("a spotter");
    expect((await deleteMe(w.P)).status).toBe(204);
    const after = await catPage(w.discovered.id);
    expect(
      after.careTimeline.find((e) => e.type === "discovered")!.message,
    ).toBeNull();
  });
});

describe("DELETE /api/me: logging", () => {
  it("never logs the device id or the secret", async () => {
    const w = await seedWorld();
    spies.logLines.length = 0;
    expect((await deleteMe(w.P)).status).toBe(204);
    const text = spies.logLines.join("\n");
    expect(text).toContain("/api/me");
    expect(text).not.toContain(w.P.deviceId);
    expect(text).not.toContain(w.P.secret);
  });
});

// SYC-130 Task 9 (claiming-a-cat.md D13, §5; data spine §8.3): deleting your
// data ends the owner link and the name, and keeps what helps the team find
// the cat's home: the note and the pin. The claim is made through the real
// route, so the test sees what really happens.
describe("DELETE /api/me: a claimed cat keeps its home note and pin for the team (D13)", () => {
  const CAT = { lat: 37.4451, lng: 24.9462 };
  const PUBLIC = blurPosition(CAT.lat, CAT.lng);
  const PIN = { lat: PUBLIC.lat + 0.001, lng: PUBLIC.lng + 0.001 };

  /** A sighting of the cat, matched by confirming the suggestion (§3 rule 2). */
  async function meet(catId: number, p: Person) {
    const [s] = await db
      .insert(sightingsTable)
      .values({ catId, deviceId: p.deviceId, photoId: 0, lat: CAT.lat, lng: CAT.lng, status: "resolved" })
      .returning();
    await db
      .insert(sightingMatchesTable)
      .values({ sightingId: s!.id, choice: "suggested", chosenCatId: catId, chosenAt: new Date(), suggestedRank: 1 });
  }
  const claimAs = (catId: number, p: Person, over: Record<string, unknown> = {}) =>
    request(app)
      .post(`/api/cats/${catId}/claim`)
      .set("X-Device-Secret", p.secret)
      .send({ deviceId: p.deviceId, livesOnSyros: true, livesInMyHome: true, homePin: PIN, homeNote: "x", ...over });

  it("clears the owner link and name, keeps the note and pin, and shows them only to the team", async () => {
    await _resetClaimLimitForTests();
    const P = person("CO");
    const R = person("CR");
    await signUp(P, 3);
    await signUp(R, 1);
    const tag = randomBytes(4).toString("hex");
    const note = `The green gate, ${tag}`;
    const [cat] = await db
      .insert(catsTable)
      .values({
        name: `SeverClaim${tag}`,
        description: "",
        primaryPhotoId: 0,
        lat: CAT.lat,
        lng: CAT.lng,
        discovererDeviceId: R.deviceId,
      })
      .returning();
    const catId = cat!.id;
    await meet(catId, P);
    await meet(catId, R);

    // Through the real route.
    const claimed = await claimAs(catId, P, { homeNote: note });
    expect(claimed.status).toBe(200);
    // No route sets owner_name any more (POST /cats is gone); owners
    // registered before it was removed still carry one, so give this owner
    // the same, so the test can see it cleared.
    const ownerName = `Owner Name ${tag}`;
    await db.update(catsTable).set({ ownerName }).where(eq(catsTable.id, catId));
    const [mine] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    expect(mine!.ownerDeviceId).toBe(P.deviceId);
    expect(mine!.ownerName).toBe(ownerName);
    expect(mine!.homeDescription).toBe(note);
    expect(mine!.homeLat).not.toBeNull();
    expect(mine!.homeLng).not.toBeNull();
    const pin = { lat: mine!.homeLat!, lng: mine!.homeLng! };

    expect((await deleteMe(P)).status).toBe(204);

    // Cleared: the link and the name. Kept: the note and the pin.
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, catId));
    expect(row!.ownerDeviceId).toBeNull();
    expect(row!.ownerName).toBeNull();
    expect(row!.homeDescription).toBe(note);
    expect(row!.homeLat).toBe(pin.lat);
    expect(row!.homeLng).toBe(pin.lng);

    // The public payload, detail and list, has neither.
    const detail = await request(app).get(`/api/cats/${catId}`);
    const list = await request(app).get("/api/cats").query({ pageSize: 100, lat: CAT.lat, lng: CAT.lng });
    expect(detail.status).toBe(200);
    expect(list.status).toBe(200);
    expect(detail.body.cat).toMatchObject({ hasHome: true, homeDescription: null, homePin: null, ownerName: null });
    const inList = (list.body.cats as { id: number }[]).find((c) => c.id === catId);
    expect(inList).toBeDefined();
    for (const text of [JSON.stringify(detail.body), JSON.stringify(inList)]) {
      expect(text).not.toContain(note);
      expect(text).not.toContain(ownerName);
      expect(text).not.toContain(String(pin.lat));
      expect(text).not.toContain(String(pin.lng));
    }

    // The team: the note to anyone on the team, the pin only with
    // view_exact_location (the volunteer role lacks it; staff has it).
    const volunteer = { id: "vitest-sever-volunteer", scopes: [{ role: "volunteer" as const, colonyId: null }] };
    const staff = { id: "vitest-sever-staff", scopes: [{ role: "staff" as const, colonyId: null }] };
    const noPin = (await teamCatView(catId, new Date(), volunteer))!;
    expect(noPin.owner.homeDescription).toBe(note);
    expect(noPin.owner.homePin).toBeNull();
    const withPin = (await teamCatView(catId, new Date(), staff))!;
    expect(withPin.owner.homeDescription).toBe(note);
    expect(withPin.owner.homePin).toEqual(pin);
    expect((await teamCatView(catId))!.owner.homePin).toBeNull();
    const lacking = renderCatPage(noPin, "Vera", { may: () => false });
    expect(lacking).toContain(note);
    expect(lacking).not.toContain(String(pin.lat));
    const full = renderCatPage(withPin, "Susan", { may: () => true });
    expect(full).toContain(note);
    expect(full).toContain(`${pin.lat}, ${pin.lng}`);

    // The cat still has a home, so another phone that met it is refused.
    const statusNow = detail.body.cat.lifeStatus;
    const late = await claimAs(catId, R);
    expect({ derived: statusNow, status: late.status, code: late.body.code }).toEqual({
      derived: "homed",
      status: 409,
      code: "ALREADY_HOMED",
    });
    expect((await db.select().from(catsTable).where(eq(catsTable.id, catId)))[0]!.ownerDeviceId).toBeNull();

    // And nothing anywhere names the deleted phone.
    expect(await columnsHolding(P.deviceId)).toEqual([]);
    expect(await columnsHolding(ownerName)).toEqual([]);
  });
});
