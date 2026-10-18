import crypto from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../schema";
import {
  ANONYMISED_NAME,
  PeopleError,
  inviteRecipient,
  managersToNotify,
  peopleStore,
  personState,
  recordInviteDelivered,
  type PlacementInput,
} from "../people";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";
import { truncateWithGuardsOff } from "./truncatePeople";

// SYC-53 PR 1.1 (roles-and-invites.md §4, §8.1, §9, §10.1–10.2, §11.1): the
// people functions for inviting, accepting, withdrawing and leaving, on a
// throwaway database built from the real migrations. Plan tests T9 (the
// finders), T10, T18, T19, T20, T21 (extended to every new kind) and T30's
// core. The API halves (routes, mail, the actions layer) are in api-server.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");
const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `invitations_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
let d: import("../people").PeopleDb;
let store: ReturnType<typeof peopleStore>;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, readMigrations(defaultMigrationsFolder()));
  d = drizzle(c, { schema });
  store = peopleStore(d);
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

beforeEach(async () => {
  await truncateWithGuardsOff(c, "person_scopes, people, mail_outbox");
});

// ── helpers ────────────────────────────────────────────────────────────────

const newColony = async (label = `Vaporia ${crypto.randomBytes(3).toString("hex")}`) =>
  (
    await c.query(
      `insert into colonies (name, normalised_name) values ($1, lower($1)) returning id`,
      [label],
    )
  ).rows[0].id as number;

/** A joined manager (added, then given management). */
async function manager(label: string) {
  const email = `${label}@example.com`;
  const p = await store.addPerson({ email, name: label, addedBy: "cli:t" });
  await store.setRoles({ email, add: "management", by: "cli:t" });
  return { id: p.id, email };
}

async function staff(label: string) {
  const email = `${label}@example.com`;
  const p = await store.addPerson({ email, name: label, addedBy: "cli:t" });
  return { id: p.id, email };
}

const STAFF: PlacementInput[] = [{ role: "staff" }];

async function invite(by: string, label: string, placements: PlacementInput[] = STAFF) {
  return store.invitePerson(by, {
    email: `${label}@example.com`,
    name: label,
    placements,
    language: "el",
    languageUsed: "en",
  });
}

/** As the outbox does when the message is delivered. */
const deliver = (id: string, kind: "invite_sent" | "invite_resent" = "invite_sent") =>
  d.transaction((tx) => recordInviteDelivered(tx, id, kind, "system:outbox"));

const row = async (id: string) =>
  (await c.query(`select * from people where id = $1`, [id])).rows[0] as Record<string, unknown> & {
    email: string;
    name: string;
    left_at: Date | null;
    left_by: string | null;
    accepted_at: Date | null;
    invite_sent_at: Date | null;
    invite_expires_at: Date | null;
    session_version: number;
    language: string;
  };

const events = async (id: string) =>
  (
    await c.query(`select kind, by, detail from person_events where person_id = $1 order by id`, [id])
  ).rows as { kind: string; by: string; detail: Record<string, unknown> | null }[];
const kinds = async (id: string) => (await events(id)).map((e) => e.kind);
const eventCount = async () =>
  (await c.query(`select count(*)::int as n from person_events`)).rows[0].n as number;

const expireInvite = (id: string) =>
  c.query(`update people set invite_expires_at = now() - interval '1 second' where id = $1`, [id]);

/** Two real connections, so two transactions really overlap. */
async function racing(run: (s: ReturnType<typeof peopleStore>) => Promise<unknown>[]) {
  const pool = new pg.Pool({ connectionString: url(name), max: 4 });
  try {
    return await Promise.allSettled(run(peopleStore(drizzle(pool, { schema }))));
  } finally {
    await pool.end();
  }
}

// ── the states ─────────────────────────────────────────────────────────────

describe("personState: the state table (spec §10.1), from the row, in order", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const before = new Date("2026-10-15T11:59:59Z");
  const after = new Date("2026-10-15T12:00:01Z");
  const base = { leftAt: null, acceptedAt: null, inviteSentAt: null, inviteExpiresAt: null };
  it("Left beats everything; then Joined; then Not sent yet, Invited, Expired", () => {
    expect(personState({ ...base, leftAt: before, acceptedAt: before }, now)).toBe("left");
    expect(personState({ ...base, acceptedAt: before }, now)).toBe("joined");
    expect(personState({ ...base, inviteExpiresAt: after }, now)).toBe("not_sent");
    expect(personState({ ...base, inviteSentAt: before, inviteExpiresAt: after }, now)).toBe("invited");
    expect(personState({ ...base, inviteSentAt: before, inviteExpiresAt: before }, now)).toBe("expired");
    // The exact moment of expiry is already expired.
    expect(personState({ ...base, inviteSentAt: before, inviteExpiresAt: now }, now)).toBe("expired");
  });

  it("an invitation that failed to send is Not sent yet, never Invited, whatever its expiry", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    const r = await row(p.id);
    expect(r.invite_sent_at).toBeNull();
    expect(personState({
      leftAt: r.left_at, acceptedAt: r.accepted_at,
      inviteSentAt: r.invite_sent_at, inviteExpiresAt: r.invite_expires_at,
    }, new Date())).toBe("not_sent");
    expect(await store.findInvitee(p.id)).toBeNull();
  });
});

// ── inviting ───────────────────────────────────────────────────────────────

describe("invitePerson", () => {
  it("makes a pending person with her placements, 14 days to run, and an `invited` event with the language asked for and used", async () => {
    const m = await manager("susan");
    const colony = await newColony();
    const p = await store.invitePerson(m.id, {
      email: " Eleni@Example.com ",
      name: "  Eleni  ",
      placements: [{ role: "guardian", colonyId: colony, relationship: "feeds" }],
      language: "el",
      languageUsed: "en",
    });
    const r = await row(p.id);
    expect(r).toMatchObject({ email: "eleni@example.com", name: "Eleni", accepted_at: null, invite_sent_at: null, left_at: null, language: "el", added_by: m.id });
    const days = ((r.invite_expires_at as Date).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    const scopes = (await c.query(`select role, reach, colony_id, relationship, granted_by from person_scopes where person_id = $1`, [p.id])).rows;
    expect(scopes).toEqual([{ role: "guardian", reach: "colony", colony_id: colony, relationship: "feeds", granted_by: m.id }]);
    expect(await events(p.id)).toEqual([
      { kind: "invited", by: m.id, detail: { roles: ["guardian"], colonyIds: [colony], language: "el", languageUsed: "en" } },
    ]);
    // Not on the list, by either finder.
    expect(await store.findPersonById(p.id)).toBeNull();
    expect(await store.findAllowedPerson("eleni@example.com")).toBeNull();
  });

  it("refuses a guardian with no colony, a vet, an address already on the list or invited, and one that has left", async () => {
    const m = await manager("susan");
    await expect(invite(m.id, "a", [{ role: "guardian" }])).rejects.toThrow(/needs a colony/);
    await expect(invite(m.id, "b", [{ role: "vet" }])).rejects.toThrow(/can't be given/);
    await expect(invite(m.id, "c", [])).rejects.toThrow(/at least one role/);
    await expect(invite(m.id, "c2", [{ role: "staff", colonyId: 3 }])).rejects.toThrow(/Only a cat guardian/);
    await invite(m.id, "d");
    await expect(invite(m.id, "d")).rejects.toThrow(/already on the list, or already invited/);
    await expect(invite(m.id, "susan")).rejects.toThrow(/already on the list/);
    const s = await staff("gone");
    await store.markLeft(s.email, "cli:t");
    await expect(invite(m.id, "gone")).rejects.toThrow(/Bring them back instead/);
    await expect(
      store.invitePerson(m.id, { email: "x@example.com", name: "<b>".repeat(40), placements: STAFF, language: "en", languageUsed: "en" }),
    ).rejects.toThrow(/at most 100/);
  });

  it("can invite management and the team as well as a cat guardian (T15, database half)", async () => {
    const m = await manager("susan");
    const colony = await newColony();
    const team = await invite(m.id, "t", [{ role: "staff" }]);
    const mgmt = await invite(m.id, "mg", [{ role: "management" }]);
    const g = await invite(m.id, "g", [{ role: "guardian", colonyId: colony }]);
    for (const p of [team, mgmt, g]) expect(await kinds(p.id)).toEqual(["invited"]);
  });
});

// ── T9: the finders ────────────────────────────────────────────────────────

describe("T9 (finders): findInvitee means Invited and not expired, with no placements; the other finders never see her", () => {
  it("only once the message went out, only until it expires, never after accepting or leaving", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    expect(await store.findInvitee(p.id)).toBeNull(); // not sent yet
    await deliver(p.id);
    const found = await store.findInvitee(p.id);
    expect(found).toEqual({ id: p.id, name: "eleni", sessionVersion: 1, language: "el" });
    expect(found).not.toHaveProperty("scopes");
    expect(await store.findInviteeByEmail("ELENI@example.com")).toEqual(found);
    // Never a CapabilityHolder.
    expect(await store.findPersonById(p.id)).toBeNull();
    expect(await store.findAllowedPerson("eleni@example.com")).toBeNull();
    await expireInvite(p.id);
    expect(await store.findInvitee(p.id)).toBeNull();
    expect(await store.findInviteeByEmail("eleni@example.com")).toBeNull();
  });

  it("not after accepting (then the other finders do), and not after withdrawal", async () => {
    const m = await manager("susan");
    const a = await invite(m.id, "a");
    await deliver(a.id);
    await store.acceptInvitation(a.id, "A", "promises-v1");
    expect(await store.findInvitee(a.id)).toBeNull();
    expect(await store.findPersonById(a.id)).not.toBeNull();
    const b = await invite(m.id, "b");
    await deliver(b.id);
    await store.withdrawInvitation(m.id, b.id);
    expect(await store.findInvitee(b.id)).toBeNull();
    expect(await store.findInviteeByEmail("b@example.com")).toBeNull();
  });
});

// ── T10: accepting ─────────────────────────────────────────────────────────

describe("T10: accepting is one conditional update with exactly one winner", () => {
  it("accept sets accepted_at, clears the expiry, raises the session version, takes the name, records the promises version", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    await deliver(p.id);
    const r = await store.acceptInvitation(p.id, "  Eléni  Π. ", "promises-v1");
    expect(r).toEqual({ id: p.id, sessionVersion: 2 });
    const after = await row(p.id);
    expect(after.accepted_at).not.toBeNull();
    expect(after.invite_expires_at).toBeNull();
    expect(after.name).toBe("Eléni Π.");
    const last = (await events(p.id)).at(-1);
    expect(last).toEqual({ kind: "accepted", by: "self", detail: { promisesVersion: "promises-v1" } });
  });

  it("pressing twice changes nothing the second time, and writes no second event", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    await deliver(p.id);
    await store.acceptInvitation(p.id, "Eleni", "promises-v1");
    const before = await row(p.id);
    const n = await eventCount();
    expect(await store.acceptInvitation(p.id, "Someone else", "promises-v1")).toBeNull();
    expect(await row(p.id)).toEqual(before);
    expect(await eventCount()).toBe(n);
  });

  it("an empty name keeps the one she was invited with; an unknown promises version is refused", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    await deliver(p.id);
    await expect(store.acceptInvitation(p.id, "x", "promises-latest")).rejects.toBeInstanceOf(PeopleError);
    await store.acceptInvitation(p.id, "   ", "promises-v1");
    expect((await row(p.id)).name).toBe("eleni");
  });

  it("accept after expiry loses: nothing changes", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    await deliver(p.id);
    await expireInvite(p.id);
    const before = await row(p.id);
    expect(await store.acceptInvitation(p.id, "Eleni", "promises-v1")).toBeNull();
    expect(await row(p.id)).toEqual(before);
    expect(await kinds(p.id)).toEqual(["invited", "invite_sent"]);
  });

  it("accept before the message went out (Not sent yet) loses too", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    expect(await store.acceptInvitation(p.id, "Eleni", "promises-v1")).toBeNull();
  });

  it("accept and withdraw at the same moment: exactly one wins, every time", async () => {
    const m = await manager("susan");
    for (let i = 0; i < 6; i++) {
      const p = await invite(m.id, `race${i}`);
      await deliver(p.id);
      const [acc, wd] = await racing((s) => [
        s.acceptInvitation(p.id, "R", "promises-v1"),
        s.withdrawInvitation(m.id, p.id),
      ]);
      expect(acc!.status).toBe("fulfilled");
      expect(wd!.status).toBe("fulfilled");
      const accepted = (acc as PromiseFulfilledResult<unknown>).value !== null;
      const withdrawn = (wd as PromiseFulfilledResult<unknown>).value !== null;
      expect({ i, winners: Number(accepted) + Number(withdrawn) }).toEqual({ i, winners: 1 });
      const r = await row(p.id);
      if (accepted) {
        expect(r.accepted_at).not.toBeNull();
        expect(r.left_at).toBeNull();
        expect(await kinds(p.id)).toEqual(["invited", "invite_sent", "accepted"]);
      } else {
        expect(r.accepted_at).toBeNull();
        expect(r.left_at).not.toBeNull();
        expect(await kinds(p.id)).toEqual(["invited", "invite_sent", "invite_withdrawn", "anonymised"]);
      }
    }
  });

  it("rejoining sets accepted_at back to null: she is pending and must accept again", async () => {
    const m = await manager("susan");
    const s = await staff("jacky");
    await store.markLeftById(m.id, s.id);
    await store.rejoinPerson(m.id, s.id, STAFF, "fr", "en");
    const r = await row(s.id);
    expect(r.accepted_at).toBeNull();
    expect(r.left_at).toBeNull();
    expect(r.invite_sent_at).toBeNull();
    expect(r.language).toBe("fr");
    expect(await store.findPersonById(s.id)).toBeNull();
    await deliver(s.id);
    expect(await store.acceptInvitation(s.id, "Jacky", "promises-v1")).not.toBeNull();
    expect(await store.findPersonById(s.id)).not.toBeNull();
  });
});

// ── declining, withdrawing, anonymising ────────────────────────────────────

describe("T20: withdrawing never deletes a row; a never-joined invitee is anonymised, a person who ever joined never is", () => {
  it("withdraw marks her left, keeps the row, replaces address and name, and the anonymised event holds no address", async () => {
    const m = await manager("susan");
    const colony = await newColony();
    const p = await invite(m.id, "stranger", [{ role: "guardian", colonyId: colony }]);
    await deliver(p.id);
    const r = await store.withdrawInvitation(m.id, p.id);
    expect(r).toEqual({ id: p.id, anonymised: true });
    const after = await row(p.id);
    expect(after.email).toBe(`withdrawn-${p.id}@invalid`);
    expect(after.name).toBe(ANONYMISED_NAME);
    expect(after.left_at).not.toBeNull();
    expect(after.left_by).toBe(m.id);
    expect((await c.query(`select count(*)::int as n from people where id = $1`, [p.id])).rows[0].n).toBe(1);
    const evs = await events(p.id);
    expect(evs.map((e) => e.kind)).toEqual(["invited", "invite_sent", "invite_withdrawn", "anonymised"]);
    expect(evs[2]).toEqual({ kind: "invite_withdrawn", by: m.id, detail: { reason: "withdrawn" } });
    expect(evs[3]).toEqual({ kind: "anonymised", by: m.id, detail: { reason: "invitation_withdrawn" } });
    expect(JSON.stringify(evs)).not.toContain("stranger@example.com");
    // The address is free for a fresh invitation.
    await expect(invite(m.id, "stranger")).resolves.toMatchObject({ email: "stranger@example.com" });
  });

  it("declining does the same, by `self`", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    await deliver(p.id);
    expect(await store.declineInvitation(p.id)).toEqual({ id: p.id, anonymised: true });
    const evs = await events(p.id);
    expect(evs.slice(2)).toEqual([
      { kind: "invite_withdrawn", by: "self", detail: { reason: "declined" } },
      { kind: "anonymised", by: "self", detail: { reason: "invitation_withdrawn" } },
    ]);
    expect((await row(p.id)).left_by).toBe("self");
    // Twice: nothing more.
    expect(await store.declineInvitation(p.id)).toBeNull();
    expect(await kinds(p.id)).toHaveLength(4);
  });

  it("someone brought back who never re-accepted did join once: withdrawing keeps her address and name", async () => {
    const m = await manager("susan");
    const s = await staff("jacky");
    await store.markLeftById(m.id, s.id);
    await store.rejoinPerson(m.id, s.id, STAFF, "en", "en");
    expect(await store.withdrawInvitation(m.id, s.id)).toEqual({ id: s.id, anonymised: false });
    const r = await row(s.id);
    expect(r.email).toBe("jacky@example.com");
    expect(r.name).toBe("jacky");
    expect(await kinds(s.id)).not.toContain("anonymised");
  });

  it("a backfilled `added` counts as joined too", async () => {
    const m = await manager("susan");
    const id = (await c.query(
      `insert into people (email, name, added_by, accepted_at, invite_expires_at) values ('old@example.com', 'Old', 'cli:t', null, now() + interval '1 day') returning id`,
    )).rows[0].id as string;
    await c.query(`insert into person_events (person_id, kind, by, detail) values ($1, 'added', 'system:migration', '{"backfilled": true}')`, [id]);
    expect(await store.withdrawInvitation(m.id, id)).toEqual({ id, anonymised: false });
    expect((await row(id)).email).toBe("old@example.com");
  });

  it("an invitation that merely expires is not anonymised (nobody withdrew it)", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    await deliver(p.id);
    await expireInvite(p.id);
    expect(await store.findInvitee(p.id)).toBeNull();
    const r = await row(p.id);
    expect(r.email).toBe("eleni@example.com");
    expect(r.left_at).toBeNull();
    expect(await kinds(p.id)).toEqual(["invited", "invite_sent"]);
  });

  it("withdrawing a joined person is refused (nothing pending), and nothing is deleted by any of it", async () => {
    const m = await manager("susan");
    const s = await staff("jacky");
    expect(await store.withdrawInvitation(m.id, s.id)).toBeNull();
    expect((await row(s.id)).left_at).toBeNull();
  });
});

// ── resend ─────────────────────────────────────────────────────────────────

describe("resend: at most one message per person per 24 hours; the fresh 14 days come with delivery", () => {
  it("refused within 24 hours of a message, and while one is still waiting in the outbox; allowed after", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    // Not sent yet, nothing waiting: allowed.
    await expect(store.resendInvitation(m.id, p.id)).resolves.toEqual({ id: p.id, email: "eleni@example.com" });
    // A message waiting in the outbox: refused.
    await c.query(
      `insert into mail_outbox (purpose, recipient_hash, payload) values ('person_invite', 'h', $1)`,
      [JSON.stringify({ personId: p.id })],
    );
    await expect(store.resendInvitation(m.id, p.id)).rejects.toThrow(/still on its way/);
    await c.query(`update mail_outbox set state = 'sent'`);
    await deliver(p.id);
    await expect(store.resendInvitation(m.id, p.id)).rejects.toThrow(/less than 24 hours ago/);
    await c.query(`update people set invite_sent_at = now() - interval '24 hours 1 second', invite_expires_at = now() + interval '1 day' where id = $1`, [p.id]);
    const before = (await row(p.id)).invite_expires_at;
    await store.resendInvitation(m.id, p.id);
    // Review minor 1: asking to resend moves nothing; delivery gives the 14 days.
    expect((await row(p.id)).invite_expires_at).toEqual(before);
  });

  it("refused for someone who joined or whose invitation was withdrawn", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    await store.withdrawInvitation(m.id, p.id);
    await expect(store.resendInvitation(m.id, p.id)).rejects.toThrow(/isn't open any more/);
    await expect(store.resendInvitation(m.id, m.id)).rejects.toThrow(/isn't open any more/);
  });

  it("review minor 1: resending an Expired invitation leaves it Expired until a message is delivered", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    await deliver(p.id);
    await c.query(`update people set invite_sent_at = now() - interval '15 days', invite_expires_at = now() - interval '1 day' where id = $1`, [p.id]);
    await store.resendInvitation(m.id, p.id);
    const r = await row(p.id);
    expect(personState({ leftAt: r.left_at, acceptedAt: r.accepted_at, inviteSentAt: r.invite_sent_at, inviteExpiresAt: r.invite_expires_at }, new Date())).toBe("expired");
    expect(await store.findInvitee(p.id)).toBeNull();
    // An ordinary re-check refuses her; a resend's delivery may go.
    expect(await inviteRecipient(d, p.id)).toBeNull();
    expect(await inviteRecipient(d, p.id, { resend: true })).not.toBeNull();
    await deliver(p.id, "invite_resent");
    expect(await store.findInvitee(p.id)).not.toBeNull();
  });

  it("delivery writes invite_sent, then invite_resent, and only while she is pending", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "eleni");
    expect(await deliver(p.id)).toBe(true);
    expect(await deliver(p.id, "invite_resent")).toBe(true);
    expect(await kinds(p.id)).toEqual(["invited", "invite_sent", "invite_resent"]);
    await store.withdrawInvitation(m.id, p.id);
    expect(await deliver(p.id, "invite_resent")).toBe(false);
    expect((await kinds(p.id)).filter((k) => k === "invite_resent")).toHaveLength(1);
  });
});

// ── setPlacements ──────────────────────────────────────────────────────────

describe("setPlacements: management changes someone's roles", () => {
  it("never your own; writes roles_changed with before and after", async () => {
    const m = await manager("susan");
    const s = await staff("jacky");
    await expect(store.setPlacements(m.id, m.id, [{ role: "staff" }])).rejects.toThrow(/your own roles/);
    const colony = await newColony();
    const r = await store.setPlacements(m.id, s.id, [{ role: "staff" }, { role: "guardian", colonyId: colony }]);
    expect(r).toEqual({ id: s.id, before: ["staff"], after: [`guardian:${colony}`, "staff"] });
    expect((await events(s.id)).at(-1)).toEqual({
      kind: "roles_changed",
      by: m.id,
      detail: { before: ["staff"], after: [`guardian:${colony}`, "staff"] },
    });
    await expect(store.setPlacements(m.id, s.id, [{ role: "staff" }, { role: "guardian", colonyId: colony }])).rejects.toThrow(/already hold exactly that/);
  });

  it("putting a guardian back on a colony she once held updates her old row: end cleared, who and when recorded", async () => {
    const m = await manager("susan");
    const other = await manager("jacky");
    const colony = await newColony();
    const colony2 = await newColony();
    const s = await staff("eleni");
    await store.setPlacements(m.id, s.id, [{ role: "guardian", colonyId: colony }]);
    const first = (await c.query(`select id from person_scopes where person_id = $1 and colony_id = $2`, [s.id, colony])).rows[0].id;
    // Moved to another colony: the old placement is ended, not deleted.
    await store.setPlacements(m.id, s.id, [{ role: "guardian", colonyId: colony2 }]);
    const ended = (await c.query(`select expires_at from person_scopes where id = $1`, [first])).rows[0];
    expect(ended.expires_at).not.toBeNull();
    await c.query(`update person_scopes set granted_at = now() - interval '1 day' where id = $1`, [first]);
    // Back again, by another manager.
    await store.setPlacements(other.id, s.id, [{ role: "guardian", colonyId: colony, relationship: "covering", endsAt: new Date(Date.now() + 86_400_000) }]);
    const back = (await c.query(`select id, expires_at, granted_by, granted_at > now() - interval '1 minute' as fresh, relationship from person_scopes where person_id = $1 and colony_id = $2`, [s.id, colony])).rows;
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: first, granted_by: other.id, fresh: true, relationship: "covering" });
    expect(back[0].expires_at).not.toBeNull();
    const p = await store.findPersonById(s.id);
    expect(p!.scopes.map((x) => x.colonyId)).toEqual([colony]);
  });

  it("refuses someone who has left", async () => {
    const m = await manager("susan");
    const s = await staff("jacky");
    await store.markLeftById(m.id, s.id);
    await expect(store.setPlacements(m.id, s.id, STAFF)).rejects.toThrow(/Bring them back/);
  });
});

// ── T18: the last manager ──────────────────────────────────────────────────

describe("T18: the last management person can't be removed, demoted or signed out everywhere", () => {
  it("each refused while she is the only one, each allowed once another manager exists", async () => {
    const samuel = await manager("samuel");
    const s = await staff("jacky");
    // Only samuel holds management. jacky (staff) can't act on samuel through
    // management functions in real life, but the guard is in the function.
    await expect(store.markLeftById(s.id, samuel.id)).rejects.toThrow(/last person with management/);
    await expect(store.setPlacements(s.id, samuel.id, STAFF)).rejects.toThrow(/last person with management/);
    await expect(store.signOutEverywhereById(samuel.id, samuel.id)).rejects.toThrow(/last person with management/);
    await expect(store.stopHelping(samuel.id)).rejects.toThrow(/last person with management/);
    expect((await row(samuel.id)).left_at).toBeNull();
    expect((await row(samuel.id)).session_version).toBe(1);
    // A pending invitee or an ended management row doesn't count as another.
    const pending = await invite(samuel.id, "mgmt-to-be", [{ role: "management" }]);
    await deliver(pending.id);
    await expect(store.markLeftById(s.id, samuel.id)).rejects.toThrow(/last person/);
    const jacky = await manager("jackym");
    await c.query(`update person_scopes set expires_at = now() - interval '1 second' where person_id = $1`, [jacky.id]);
    await expect(store.markLeftById(s.id, samuel.id)).rejects.toThrow(/last person/);
    await c.query(`update person_scopes set expires_at = null where person_id = $1`, [jacky.id]);
    // Now there are two.
    await store.signOutEverywhereById(jacky.id, samuel.id);
    await store.setPlacements(jacky.id, samuel.id, [{ role: "staff" }]);
    await store.setPlacements(jacky.id, samuel.id, [{ role: "management" }]);
    await store.markLeftById(jacky.id, samuel.id);
    expect((await row(samuel.id)).left_at).not.toBeNull();
  });

  it("review M-1: an end date or a label is refused on management and the team; only a guardian's placement takes one", async () => {
    const a = await manager("a");
    const b = await manager("b");
    const tomorrow = new Date(Date.now() + 86_400_000);
    await expect(store.setPlacements(a.id, b.id, [{ role: "management", endsAt: tomorrow }])).rejects.toThrow(/Only a cat guardian's placement/);
    await expect(store.setPlacements(a.id, b.id, [{ role: "staff", relationship: "feeds" }])).rejects.toThrow(/Only a cat guardian's placement/);
    await expect(invite(a.id, "x", [{ role: "management", endsAt: tomorrow }])).rejects.toThrow(/Only a cat guardian's placement/);
    expect((await c.query(`select count(*)::int as n from person_scopes where expires_at is not null`)).rows[0].n).toBe(0);
  });

  it("review M-1: mutual end dates on management (written by any path) leave the guard holding", async () => {
    const a = await manager("a");
    const b = await manager("b");
    // b's management runs out tomorrow: b no longer counts as another manager.
    await c.query(`update person_scopes set expires_at = now() + interval '1 day' where person_id = $1 and role = 'management'`, [b.id]);
    await expect(store.setPlacements(b.id, a.id, [{ role: "staff" }])).rejects.toThrow(/last person with management/);
    await expect(store.markLeftById(b.id, a.id)).rejects.toThrow(/last person with management/);
    expect((await row(a.id)).left_at).toBeNull();
  });

  it("review M-1: an end date on the other manager, then stop helping, is refused", async () => {
    const a = await manager("a");
    const b = await manager("b");
    await c.query(`update person_scopes set expires_at = now() + interval '1 day' where person_id = $1 and role = 'management'`, [b.id]);
    await expect(store.stopHelping(a.id)).rejects.toThrow(/last person with management/);
    await expect(store.signOutEverywhereById(a.id, a.id)).rejects.toThrow(/last person with management/);
    expect((await row(a.id)).left_at).toBeNull();
  });

  it("review minor 6: the people command's mark-left on someone who never joined withdraws and anonymises, like withdrawInvitation", async () => {
    const m = await manager("susan");
    const p = await invite(m.id, "stranger");
    await deliver(p.id);
    const r = await store.markLeft("stranger@example.com", "cli:t");
    expect(r).toMatchObject({ id: p.id, invitationWithdrawn: true, withdrawnInvitations: 0 });
    const after = await row(p.id);
    expect(after.email).toBe(`withdrawn-${p.id}@invalid`);
    expect(after.name).toBe(ANONYMISED_NAME);
    expect(after.left_by).toBe("cli:t");
    expect(await kinds(p.id)).toEqual(["invited", "invite_sent", "invite_withdrawn", "anonymised"]);
  });

  it("the people command's markLeft shares the guard and keeps --force as the break-glass", async () => {
    const samuel = await manager("samuel");
    await expect(store.markLeft(samuel.email, "cli:t")).rejects.toThrow(/last person with management/);
    const r = await store.markLeft(samuel.email, "cli:t", { force: true });
    expect(r).toMatchObject({ id: samuel.id, withdrawnInvitations: 0 });
  });

  it("two managers marking each other as left at the same moment: exactly one succeeds, every time", async () => {
    for (let i = 0; i < 5; i++) {
      await truncateWithGuardsOff(c, "person_scopes, people, mail_outbox");
      const a = await manager(`a${i}`);
      const b = await manager(`b${i}`);
      const results = await racing((s) => [s.markLeftById(a.id, b.id), s.markLeftById(b.id, a.id)]);
      expect({ i, ok: results.filter((r) => r.status === "fulfilled").length }).toEqual({ i, ok: 1 });
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(PeopleError);
      expect(String(refused.reason.message)).toMatch(/last person with management/);
      const stillHere = (await c.query(`select count(*)::int as n from people where left_at is null`)).rows[0].n;
      expect(stillHere).toBe(1);
    }
  });

  it("demoting each other at the same moment: exactly one succeeds; a sign-out racing a departure never leaves nobody in charge", async () => {
    for (let i = 0; i < 3; i++) {
      await truncateWithGuardsOff(c, "person_scopes, people, mail_outbox");
      const a = await manager(`a${i}`);
      const b = await manager(`b${i}`);
      const results = await racing((s) => [s.setPlacements(a.id, b.id, STAFF), s.setPlacements(b.id, a.id, STAFF)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    }
    for (let i = 0; i < 3; i++) {
      await truncateWithGuardsOff(c, "person_scopes, people, mail_outbox");
      const a = await manager(`c${i}`);
      const b = await manager(`d${i}`);
      // b is marked as left while a signs herself out everywhere. Both may
      // succeed (a sign-out first leaves a still a manager), but a sign-out
      // that comes after the departure must see it and be refused: either
      // way a manager is still on the list, and any refusal is the guard's.
      const results = await racing((s) => [s.markLeftById(a.id, b.id), s.signOutEverywhereById(a.id, a.id)]);
      for (const r of results) {
        if (r.status === "rejected") expect(String(r.reason.message)).toMatch(/last person with management/);
      }
      const managers = await c.query(
        `select count(distinct p.id)::int as n from people p join person_scopes s on s.person_id = p.id
          where s.role = 'management' and p.left_at is null and p.accepted_at is not null`,
      );
      expect(managers.rows[0].n).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── T19: leaving withdraws the leaver's pending invitations ────────────────

describe("review minor 2: one lock order, so a departure and a change to the leaver's invitee can't deadlock", () => {
  it("marking a manager as left while another manager changes one of her invitees' roles, at the same moment: never a deadlock", async () => {
    for (let i = 0; i < 6; i++) {
      await truncateWithGuardsOff(c, "person_scopes, people, mail_outbox");
      const a = await manager(`a${i}`);
      const b = await manager(`b${i}`);
      const invitees: { id: string }[] = [];
      for (let j = 0; j < 3; j++) invitees.push(await invite(a.id, `inv${i}-${j}`));
      const results = await racing((s) => [
        s.markLeftById(b.id, a.id),
        ...invitees.map((p) => s.setPlacements(b.id, p.id, [{ role: "management" }])),
      ]);
      for (const r of results) {
        if (r.status === "rejected") {
          // A change that lost the race is refused in words, never a deadlock.
          expect({ i, code: (r.reason as { code?: string }).code, people: r.reason instanceof PeopleError }).toEqual({ i, code: undefined, people: true });
        }
      }
      expect(results[0]!.status).toBe("fulfilled");
    }
  });
});

describe("T19: leaving withdraws every pending invitation the leaver sent, in the same transaction", () => {
  it("pending ones (sent, not sent, expired) are withdrawn and anonymised; joined ones and other people's stay", async () => {
    const samuel = await manager("samuel");
    const susan = await manager("susan");
    const colony = await newColony();
    const sentG = await invite(susan.id, "g1", [{ role: "guardian", colonyId: colony }]);
    await deliver(sentG.id);
    const notSent = await invite(susan.id, "t1");
    const expired = await invite(susan.id, "t2");
    await deliver(expired.id);
    await expireInvite(expired.id);
    const joined = await invite(susan.id, "j1");
    await deliver(joined.id);
    await store.acceptInvitation(joined.id, "J", "promises-v1");
    const samuels = await invite(samuel.id, "s1");
    const r = await store.markLeftById(samuel.id, susan.id);
    expect(r).toMatchObject({ id: susan.id, withdrawnInvitations: 3 });
    for (const p of [sentG, notSent, expired]) {
      const after = await row(p.id);
      expect(after.left_at).not.toBeNull();
      expect(after.name).toBe(ANONYMISED_NAME);
      const evs = await events(p.id);
      expect(evs.find((e) => e.kind === "invite_withdrawn")).toEqual({
        kind: "invite_withdrawn",
        by: samuel.id,
        detail: { reason: "sender_left", sender: susan.id },
      });
    }
    expect((await row(joined.id)).left_at).toBeNull();
    expect((await row(samuels.id)).left_at).toBeNull();
    expect((await events(susan.id)).at(-1)).toMatchObject({ kind: "left", by: samuel.id, detail: { roles: ["management", "staff"], colonyIds: [] } });
  });

  it("someone brought back counts as invited by whoever brought her back", async () => {
    const samuel = await manager("samuel");
    const susan = await manager("susan");
    const s = await staff("jacky");
    await store.markLeftById(samuel.id, s.id);
    await store.rejoinPerson(susan.id, s.id, STAFF, "en", "en");
    const r = await store.markLeftById(samuel.id, susan.id);
    expect(r.withdrawnInvitations).toBe(1);
    expect((await row(s.id)).left_at).not.toBeNull();
    expect((await row(s.id)).email).toBe("jacky@example.com"); // joined once: never anonymised
  });

  it("stopping helping withdraws them too, recorded as `self`; the manager list for notices never includes the actor or a leaver", async () => {
    const samuel = await manager("samuel");
    const susan = await manager("susan");
    const p = await invite(susan.id, "x");
    const r = await store.stopHelping(susan.id);
    expect(r.withdrawnInvitations).toBe(1);
    expect((await events(susan.id)).at(-1)).toMatchObject({ kind: "left", by: "self" });
    expect((await row(p.id)).left_by).toBe("self");
    const jacky = await manager("jacky");
    expect((await managersToNotify(d, samuel.id)).map((x) => x.id)).toEqual([jacky.id]);
  });

  it("marking as left is never for yourself, and never for someone who hasn't joined", async () => {
    const samuel = await manager("samuel");
    await manager("susan");
    await expect(store.markLeftById(samuel.id, samuel.id)).rejects.toThrow(/Stop helping/);
    const p = await invite(samuel.id, "x");
    await expect(store.markLeftById(samuel.id, p.id)).rejects.toThrow(/Withdraw the invitation/);
  });
});

// ── review minor 7: ended placements ───────────────────────────────────────

describe("review minor 7: the readers that list placements tell ended ones apart", () => {
  it("listPeople marks an ended placement as ended", async () => {
    const m = await manager("susan");
    const c1 = await newColony();
    const c2 = await newColony();
    const s = await staff("eleni");
    await store.setPlacements(m.id, s.id, [{ role: "guardian", colonyId: c1 }, { role: "guardian", colonyId: c2 }]);
    await c.query(`update person_scopes set expires_at = now() - interval '1 second' where person_id = $1 and colony_id = $2`, [s.id, c1]);
    const listed = (await store.listPeople()).find((p) => p.id === s.id)!;
    expect(listed.roles.sort()).toEqual([`guardian:${c1} (ended)`, `guardian:${c2}`].sort());
  });

  it("the `left` event records only what was in force when they left", async () => {
    const m = await manager("susan");
    const c1 = await newColony();
    const c2 = await newColony();
    const s = await staff("eleni");
    await store.setPlacements(m.id, s.id, [{ role: "staff" }, { role: "guardian", colonyId: c1 }, { role: "guardian", colonyId: c2 }]);
    await c.query(`update person_scopes set expires_at = now() - interval '1 second' where person_id = $1 and colony_id = $2`, [s.id, c1]);
    await store.markLeftById(m.id, s.id);
    expect((await events(s.id)).at(-1)).toEqual({ kind: "left", by: m.id, detail: { roles: ["guardian", "staff"], colonyIds: [c2] } });
  });
});

// ── rejoin ─────────────────────────────────────────────────────────────────

describe("rejoinPerson (bring back)", () => {
  it("writes rejoined then invited, new placements, a new session version; refuses someone on the list and an anonymised row", async () => {
    const m = await manager("susan");
    const s = await staff("jacky");
    await expect(store.rejoinPerson(m.id, s.id, STAFF, "en", "en")).rejects.toThrow(/haven't left/);
    await store.markLeftById(m.id, s.id);
    const before = (await row(s.id)).session_version;
    const colony = await newColony();
    await store.rejoinPerson(m.id, s.id, [{ role: "guardian", colonyId: colony }], "el", "en");
    expect((await row(s.id)).session_version).toBe(before + 1);
    expect((await events(s.id)).slice(-2)).toEqual([
      { kind: "rejoined", by: m.id, detail: { roles: ["guardian"], colonyIds: [colony] } },
      { kind: "invited", by: m.id, detail: { roles: ["guardian"], colonyIds: [colony], language: "el", languageUsed: "en" } },
    ]);
    // Staff was taken away (roles chosen afresh).
    const rec = await inviteRecipient(d, s.id);
    expect(rec).toMatchObject({ roles: ["guardian"], colonies: [{ id: colony }] });
    const p = await invite(m.id, "gone");
    await store.withdrawInvitation(m.id, p.id);
    await expect(store.rejoinPerson(m.id, p.id, STAFF, "en", "en")).rejects.toThrow(/withdrawn invitation/);
  });
});

// ── the mail path's re-check ───────────────────────────────────────────────

describe("inviteRecipient: the address only while pending, unexpired and not anonymised", () => {
  it("answers for a pending person (sent or not), never after expiry, withdrawal, anonymising or accepting", async () => {
    const m = await manager("susan");
    const colony = await newColony("Vaporia — Eleni's");
    const p = await invite(m.id, "eleni", [{ role: "guardian", colonyId: colony }]);
    expect(await inviteRecipient(d, p.id)).toEqual({
      id: p.id,
      email: "eleni@example.com",
      language: "el",
      inviteSentAt: null,
      roles: ["guardian"],
      colonies: [{ id: colony, name: "Vaporia — Eleni's" }],
      // SYC-439: placed on a colony, so not "no colony yet".
      starting: false,
    });
    await expireInvite(p.id);
    expect(await inviteRecipient(d, p.id)).toBeNull();
    const q = await invite(m.id, "q");
    await store.withdrawInvitation(m.id, q.id);
    expect(await inviteRecipient(d, q.id)).toBeNull();
    const a = await invite(m.id, "a");
    await deliver(a.id);
    await store.acceptInvitation(a.id, "A", "promises-v1");
    expect(await inviteRecipient(d, a.id)).toBeNull();
    // An anonymised row that somehow became pending again still gets nothing.
    await c.query(`update people set left_at = null, invite_expires_at = now() + interval '1 day' where id = $1`, [q.id]);
    expect(await inviteRecipient(d, q.id)).toBeNull();
  });
});

// ── T30 core: createColonyWithPlacement ────────────────────────────────────

describe("T30 (core): a colony made by a cat guardian places her on it, all or nothing", () => {
  const colonies = async () => (await c.query(`select count(*)::int as n from colonies`)).rows[0].n as number;
  // A pool, not the one client (review minor 5): with one client, a write
  // made outside the transaction would still land inside it, and a test of
  // "all or nothing" couldn't see the difference.
  let poolStore: ReturnType<typeof peopleStore>;
  let tPool: pg.Pool;
  beforeAll(() => {
    tPool = new pg.Pool({ connectionString: url(name), max: 4 });
    poolStore = peopleStore(drizzle(tPool, { schema }));
  });
  afterAll(async () => {
    await tPool.end();
  });

  it("a guardian: the colony (created_by her), her placement (granted by herself) and roles_changed, in one transaction", async () => {
    const m = await manager("susan");
    const first = await newColony();
    const g = await invite(m.id, "eleni", [{ role: "guardian", colonyId: first }]);
    await deliver(g.id);
    await store.acceptInvitation(g.id, "Eleni", "promises-v1");
    const r = await poolStore.createColonyWithPlacement({ id: g.id }, { name: "Kato Chora — Eleni's" });
    expect(r.placed).toBe(true);
    const col = (await c.query(`select name, normalised_name, created_by from colonies where id = $1`, [r.colonyId])).rows[0];
    expect(col).toMatchObject({ name: "Kato Chora — Eleni's", created_by: g.id });
    const scope = (await c.query(`select role, reach, granted_by from person_scopes where person_id = $1 and colony_id = $2`, [g.id, r.colonyId])).rows;
    expect(scope).toEqual([{ role: "guardian", reach: "colony", granted_by: g.id }]);
    expect((await events(g.id)).at(-1)).toEqual({
      kind: "roles_changed",
      by: g.id,
      detail: { before: [`guardian:${first}`], after: [`guardian:${first}`, `guardian:${r.colonyId}`].sort(), createdColony: r.colonyId },
    });
  });

  it("a team member: the colony only", async () => {
    const s = await staff("jacky");
    const n = await eventCount();
    const r = await poolStore.createColonyWithPlacement({ id: s.id }, { name: "Ano Syros" });
    expect(r.placed).toBe(false);
    expect((await c.query(`select count(*)::int as n from person_scopes where person_id = $1`, [s.id])).rows[0].n).toBe(1);
    expect(await eventCount()).toBe(n);
  });

  it("a failed placement leaves no colony behind; so does a failed event; a pending or left person makes nothing", async () => {
    const m = await manager("susan");
    const first = await newColony();
    const g = await invite(m.id, "eleni", [{ role: "guardian", colonyId: first }]);
    await deliver(g.id);
    await store.acceptInvitation(g.id, "Eleni", "promises-v1");
    const n = await colonies();
    await c.query(`
      create function refuse_scope() returns trigger language plpgsql as $$ begin raise exception 'scope refused'; end $$;
      create trigger refuse_scope before insert on person_scopes for each row execute function refuse_scope();`);
    try {
      await expect(poolStore.createColonyWithPlacement({ id: g.id }, { name: "Never" })).rejects.toThrow();
    } finally {
      await c.query(`drop trigger refuse_scope on person_scopes; drop function refuse_scope();`);
    }
    expect(await colonies()).toBe(n);
    await c.query(`
      create function refuse_person_event() returns trigger language plpgsql as $$ begin raise exception 'event refused'; end $$;
      create trigger refuse_person_event before insert on person_events for each row execute function refuse_person_event();`);
    try {
      await expect(poolStore.createColonyWithPlacement({ id: g.id }, { name: "Never either" })).rejects.toThrow();
    } finally {
      await c.query(`drop trigger refuse_person_event on person_events; drop function refuse_person_event();`);
    }
    expect(await colonies()).toBe(n);
    expect((await c.query(`select count(*)::int as n from person_scopes where person_id = $1`, [g.id])).rows[0].n).toBe(1);
    const pending = await invite(m.id, "p", [{ role: "guardian", colonyId: first }]);
    await expect(poolStore.createColonyWithPlacement({ id: pending.id }, { name: "No" })).rejects.toThrow(/isn't on the list/);
    expect(await colonies()).toBe(n);
  });
});

// ── T21, extended: one event per operation, standing or falling with it ────

describe("T21 (extended): each new operation writes its events in its own transaction", () => {
  const breakEvents = () =>
    c.query(`
      create function refuse_person_event() returns trigger language plpgsql as
        $$ begin raise exception 'event refused'; end $$;
      create trigger refuse_person_event before insert on person_events
        for each row execute function refuse_person_event();`);
  const fixEvents = () =>
    c.query(`drop trigger refuse_person_event on person_events; drop function refuse_person_event();`);
  async function withBrokenEvents(run: () => Promise<unknown>) {
    await breakEvents();
    try {
      await expect(run()).rejects.toThrow();
    } finally {
      await fixEvents();
    }
  }
  const snapshot = async () =>
    (await c.query(`select p.*, (select json_agg(s order by s.id) from person_scopes s where s.person_id = p.id) as scopes from people p order by p.id`)).rows;

  it("every kind the record holds is written by some operation, each exactly once per change", async () => {
    const m = await manager("samuel");
    await manager("susan");
    const colony = await newColony();
    const p = await invite(m.id, "eleni", [{ role: "guardian", colonyId: colony }]);
    await deliver(p.id);
    await deliver(p.id, "invite_resent");
    await store.acceptInvitation(p.id, "Eleni", "promises-v1");
    await store.setPlacements(m.id, p.id, [{ role: "staff" }]);
    await store.signOutEverywhereById(m.id, p.id);
    await store.markLeftById(m.id, p.id);
    await store.rejoinPerson(m.id, p.id, STAFF, "en", "en");
    expect(await kinds(p.id)).toEqual([
      "invited", "invite_sent", "invite_resent", "accepted", "roles_changed",
      "signed_out_everywhere", "left", "rejoined", "invited",
    ]);
    const q = await invite(m.id, "q");
    await store.declineInvitation(q.id);
    expect(await kinds(q.id)).toEqual(["invited", "invite_withdrawn", "anonymised"]);
  });

  it("with the event refused, each change is undone with it", async () => {
    const m = await manager("samuel");
    await manager("susan");
    const colony = await newColony();
    const s = await staff("jacky");
    const pending = await invite(m.id, "pending");
    await deliver(pending.id);
    const left = await staff("left");
    await store.markLeftById(m.id, left.id);
    const before = await snapshot();
    await withBrokenEvents(() => invite(m.id, "eleni"));
    await withBrokenEvents(() => store.acceptInvitation(pending.id, "P", "promises-v1"));
    await withBrokenEvents(() => store.declineInvitation(pending.id));
    await withBrokenEvents(() => store.withdrawInvitation(m.id, pending.id));
    await withBrokenEvents(() => store.setPlacements(m.id, s.id, [{ role: "guardian", colonyId: colony }]));
    await withBrokenEvents(() => store.markLeftById(m.id, s.id));
    await withBrokenEvents(() => store.signOutEverywhereById(m.id, s.id));
    await withBrokenEvents(() => store.stopHelping(s.id));
    await withBrokenEvents(() => store.rejoinPerson(m.id, left.id, STAFF, "en", "en"));
    await withBrokenEvents(() => d.transaction((tx) => recordInviteDelivered(tx, pending.id, "invite_resent", "x")));
    expect(await snapshot()).toEqual(before);
  });

  it("a hook that throws undoes the change too (a change can't happen without its notice)", async () => {
    const m = await manager("samuel");
    const n = await eventCount();
    await expect(
      store.invitePerson(m.id, { email: "e@example.com", name: "E", placements: STAFF, language: "en", languageUsed: "en" }, {
        inTransaction: async () => {
          throw new Error("queue failed");
        },
      }),
    ).rejects.toThrow(/queue failed/);
    expect(await eventCount()).toBe(n);
    expect((await c.query(`select count(*)::int as n from people where email = 'e@example.com'`)).rows[0].n).toBe(0);
  });
});
