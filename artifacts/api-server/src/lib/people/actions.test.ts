import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findPersonById, pool, type PersonWithScopes } from "@workspace/db";
import { installFakeResend, type SentMail } from "../../test/fakeResend";
import {
  cleanUpPeople,
  emailFor,
  eventKinds,
  invited,
  joined,
  otherManagerEmails,
  personRow,
  remember,
} from "../../test/inviteKit";
import { newColony } from "../../test/roleKit";
import { settleOutbox } from "../mail/outbox";
import { hashRecipient, MAIL_PURPOSES } from "../mail/send";
import {
  ActionRefused,
  bringBack,
  changeRoles,
  invite,
  INVITES_PER_INVITER_PER_DAY,
  markLeft,
  RACED,
  resend,
  run,
  signOutEverywhere,
  withdraw,
} from "./actions";

// SYC-53 PR 1.1: the actions layer (roles-and-invites.md §8.1, §8.3, §8.5,
// §9). Plan tests T15 (one manager alone, each change with its event,
// emailing every other manager and never the actor; no approval anywhere),
// T19 (leaving withdraws invitations and emails the managers, a guardian's
// invitation, change and removal included) and the limits half of T22. Mail
// goes to a fake Resend: nothing leaves the machine.

let sent: SentMail[];
let fail = false;
let colony: number;
let susan: PersonWithScopes & { cookie: string };
let jacky: PersonWithScopes & { cookie: string };
let samuel: PersonWithScopes & { cookie: string };

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = "vitest-actions-key-0123456789abcdef-0123456789";
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  sent = installFakeResend({ fail: () => fail });
  colony = await newColony("actions");
  susan = await joined("susan", ["staff", "management"]);
  jacky = await joined("jacky", ["staff", "management"]);
  samuel = await joined("samuel", ["management"]);
});

beforeEach(async () => {
  await settleOutbox();
  sent.length = 0;
  fail = false;
});

afterAll(async () => {
  await settleOutbox();
  await cleanUpPeople();
  delete process.env["RESEND_API_KEY"];
  delete process.env["TEAM_SESSION_KEYS"];
});

const noticesTo = () => sent.filter((m) => m.subject.startsWith("A change to who can use")).map((m) => m.to).sort();
const invitationsTo = () => sent.filter((m) => m.subject === "Syros Cats has invited you to help").map((m) => m.to);

describe("T15: one management member alone, each change at once, each with its event, each emailing every other manager and never the actor", () => {
  it("invites the team, management and a cat guardian", async () => {
    for (const [label, placements, role] of [
      ["t15-team", [{ role: "staff" }], "a member of the Syros Cats team"],
      ["t15-mgmt", [{ role: "management" }], "a member of Syros Cats management"],
      ["t15-guard", [{ role: "guardian", colonyId: colony }], "a cat guardian for"],
    ] as const) {
      sent.length = 0;
      const p = await invited(susan, label, [...placements]);
      expect(await eventKinds(p.id)).toEqual(["invited", "invite_sent"]);
      expect((await personRow(p.id)).invite_sent_at).not.toBeNull();
      expect(invitationsTo()).toEqual([p.email]);
      expect(noticesTo()).toEqual(await otherManagerEmails(susan.id));
      expect(noticesTo()).not.toContain(susan.email);
      expect(noticesTo()).toContain(jacky.email);
      const notice = sent.find((m) => m.to === jacky.email)!;
      expect(notice.text).toContain(`Vt susan invited Vt ${label} as ${role}`);
    }
  });

  it("changes roles, brings someone back and marks a manager or a guardian as left", async () => {
    const g = await joined("t15-g", ["guardian"], colony);
    sent.length = 0;
    await changeRoles(susan, g.id, [{ role: "staff" }, { role: "guardian", colonyId: colony }]);
    await settleOutbox();
    expect(noticesTo()).toEqual(await otherManagerEmails(susan.id));
    expect(sent.find((m) => m.to === jacky.email)!.text).toMatch(/changed what Vt t15-g can do\. Before: a cat guardian for .*\. Now: a member of the Syros Cats team, and a cat guardian for/);
    expect((await eventKinds(g.id)).at(-1)).toBe("roles_changed");

    sent.length = 0;
    await markLeft(susan, g.id);
    await settleOutbox();
    expect(noticesTo()).toEqual(await otherManagerEmails(susan.id));
    expect((await eventKinds(g.id)).at(-1)).toBe("left");

    sent.length = 0;
    await bringBack(susan, g.id, [{ role: "guardian", colonyId: colony }], "el");
    await settleOutbox();
    expect((await eventKinds(g.id)).slice(-3)).toEqual(["rejoined", "invited", "invite_sent"]);
    expect(invitationsTo()).toEqual([g.email]);
    expect(sent.find((m) => m.to === jacky.email)!.text).toContain("brought Vt t15-g back as a cat guardian for");

    const m2 = await joined("t15-m2", ["management"]);
    sent.length = 0;
    await markLeft(susan, m2.id);
    await settleOutbox();
    expect(noticesTo()).toEqual(await otherManagerEmails(susan.id));
    expect(noticesTo()).not.toContain(m2.email);
    expect((await personRow(m2.id)).left_at).not.toBeNull();
  });

  it("signing out everywhere tells the other managers; the person may do it to herself", async () => {
    const t = await joined("t15-so");
    sent.length = 0;
    await signOutEverywhere(susan, t.id);
    await settleOutbox();
    expect(noticesTo()).toEqual(await otherManagerEmails(susan.id));
    await signOutEverywhere(t, t.id);
    expect((await eventKinds(t.id)).filter((k) => k === "signed_out_everywhere")).toHaveLength(2);
  });

  it("a team-only member is refused every action, and nothing is queued", async () => {
    const t = await joined("t15-teamonly");
    const before = (await pool.query(`select count(*)::int as n from mail_outbox`)).rows[0].n;
    const p = await joined("t15-target");
    for (const call of [
      () => invite(t, { email: emailFor("nope"), name: "N", placements: [{ role: "staff" }], language: "en" }),
      () => changeRoles(t, p.id, [{ role: "management" }]),
      () => markLeft(t, p.id),
      () => signOutEverywhere(t, p.id),
      () => bringBack(t, p.id, [{ role: "staff" }], "en"),
      () => resend(t, p.id),
      () => withdraw(t, p.id),
    ]) {
      await expect(call()).rejects.toMatchObject({ reason: "forbidden" });
    }
    expect((await pool.query(`select count(*)::int as n from mail_outbox`)).rows[0].n).toBe(before);
  });

  it("never on yourself: your own roles, marking yourself as left", async () => {
    await expect(changeRoles(susan, susan.id, [{ role: "staff" }])).rejects.toMatchObject({ reason: "refused" });
    await expect(markLeft(susan, susan.id)).rejects.toThrow(/Stop helping/);
  });

  it("source test: there is no approve_access capability and no approval item anywhere (Decision 11)", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist") continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(name) && !name.endsWith(".test.ts")) {
          if (/approve_access|approval_item|access_approval/i.test(readFileSync(full, "utf8"))) hits.push(full);
        }
      }
    };
    walk(path.join(root, "src"));
    walk(path.join(root, "../../lib/db/src"));
    expect(hits).toEqual([]);
  });
});

describe("T19: leaving withdraws the leaver's pending invitations and emails the other managers", () => {
  it("a guardian's invitation from a manager who is marked as left is withdrawn and never delivered again; the managers hear of the departure", async () => {
    const leaver = await joined("t19-leaver", ["staff", "management"]);
    fail = true; // the invitation can't go out yet
    const r = await invite(leaver, { email: emailFor("t19-g"), name: "G", placements: [{ role: "guardian", colonyId: colony }], language: "en" });
    remember(r.personId);
    await settleOutbox();
    fail = false;
    sent.length = 0;
    const left = await markLeft(susan, leaver.id);
    expect(left.withdrawnInvitations).toBe(1);
    await settleOutbox();
    expect(noticesTo()).toEqual(await otherManagerEmails(susan.id));
    expect(sent.find((m) => m.to === jacky.email)!.text).toContain("Invitations Vt t19-leaver had sent that were still open were withdrawn: 1.");
    expect((await personRow(r.personId)).left_at).not.toBeNull();
    // The queued invitation is cancelled at delivery, never sent.
    await pool.query(`update mail_outbox set next_attempt_at = now() where payload->>'personId' = $1`, [r.personId]);
    const { drainDue } = await import("../mail/outbox");
    await drainDue(10);
    expect(invitationsTo()).toEqual([]);
    const row = (await pool.query(`select state, last_error from mail_outbox where payload->>'personId' = $1`, [r.personId])).rows[0];
    expect(row).toEqual({ state: "failed", last_error: "cancelled: no_longer_pending" });
  });
});

describe("T22 (limits, §8.5): 10 invitations per inviter per day, 1 per address per day, 30 per IP per hour", () => {
  it("the 11th invitation from one manager in a day is refused", async () => {
    const m = await joined("t22-limit", ["management"]);
    for (let i = 0; i < INVITES_PER_INVITER_PER_DAY; i++) {
      const r = await invite(m, { email: emailFor(`t22-${i}`), name: "N", placements: [{ role: "staff" }], language: "en" }, { ip: `10.22.${i}.1` });
      remember(r.personId);
    }
    await expect(
      invite(m, { email: emailFor("t22-11"), name: "N", placements: [{ role: "staff" }], language: "en" }, { ip: "10.22.99.1" }),
    ).rejects.toMatchObject({ reason: "limited" });
    expect(await pool.query(`select 1 from people where email = $1`, [emailFor("t22-11")])).toMatchObject({ rowCount: 0 });
    await settleOutbox();
  });

  describe("one invitation per address in any rolling 24 hours (spec §8.5; review follow-up to minor 3)", () => {
    const ask = (actor: typeof susan, label: string) =>
      invite(actor, { email: emailFor(label), name: "N", placements: [{ role: "staff" }], language: "en" }, { ip: "10.31.0.1" });
    /** Pretend the address's earlier invitation row was queued at this moment. */
    const backdate = (label: string, sqlMoment: string) =>
      pool.query(
        `update mail_outbox set created_at = ${sqlMoment}
          where purpose = 'person_invite' and recipient_hash = $1`,
        [hashRecipient(emailFor(label), "person_invite")],
      );

    it("invited at T0: refused at T0+23h59m, allowed at T0+24h01m", async () => {
      const first = await ask(susan, "t22-roll");
      remember(first.personId);
      await withdraw(susan, first.personId); // frees the address
      await backdate("t22-roll", "now() - interval '23 hours 59 minutes'");
      await expect(ask(jacky, "t22-roll")).rejects.toMatchObject({ reason: "limited" });
      await backdate("t22-roll", "now() - interval '24 hours 1 minute'");
      const again = await ask(jacky, "t22-roll");
      remember(again.personId);
      await settleOutbox();
    });

    it("the same at a UTC-midnight boundary: queued at 23:59:59 UTC yesterday, refused today (a UTC-day window would allow it)", async () => {
      const first = await ask(susan, "t22-midnight");
      remember(first.personId);
      await withdraw(susan, first.personId);
      // The last second of the previous UTC day: in another clock-aligned day,
      // but (unless this runs in the day's very last second) under 24 hours ago.
      await backdate("t22-midnight", "(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') - interval '1 second'");
      await expect(ask(jacky, "t22-midnight")).rejects.toMatchObject({ reason: "limited" });
      await backdate("t22-midnight", "now() - interval '24 hours 1 minute'");
      const again = await ask(jacky, "t22-midnight");
      remember(again.personId);
      await settleOutbox();
    });

    it("the check waits for the address's lock: an invitation queued by a transaction holding it is seen once that commits", async () => {
      const first = await ask(susan, "t22-lock");
      remember(first.personId);
      await withdraw(susan, first.personId);
      await backdate("t22-lock", "now() - interval '25 hours'");
      const hash = hashRecipient(emailFor("t22-lock"), "person_invite");
      // Another invitation to the same address, mid-transaction: it holds
      // the lock and has queued its row, but hasn't committed.
      const other = await pool.connect();
      try {
        await other.query("begin");
        await other.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`person_invite_address:${hash}`]);
        await other.query(`insert into mail_outbox (purpose, recipient_hash, payload) values ('person_invite', $1, '{}')`, [hash]);
        let settled = false;
        const mine = ask(jacky, "t22-lock").finally(() => {
          settled = true;
        });
        await new Promise((r) => setTimeout(r, 300));
        expect(settled).toBe(false); // waiting on the lock, not racing past it
        await other.query("commit");
        await expect(mine).rejects.toMatchObject({ reason: "limited" });
      } finally {
        other.release();
      }
    });

    it("review nit 2: bringing someone back counts too: brought back, withdrawn, brought back again within 24 h is refused", async () => {
      const x = await joined("t22-back");
      await markLeft(susan, x.id);
      await bringBack(susan, x.id, [{ role: "staff" }], "en");
      await withdraw(susan, x.id);
      await expect(bringBack(jacky, x.id, [{ role: "staff" }], "en")).rejects.toMatchObject({ reason: "limited" });
      expect((await personRow(x.id)).left_at).not.toBeNull();
      // A day later it may go.
      await backdate("t22-back", "now() - interval '24 hours 1 minute'");
      await bringBack(jacky, x.id, [{ role: "staff" }], "en");
      expect((await personRow(x.id)).left_at).toBeNull();
      await settleOutbox();
    });

    it("review nit 3: without EMAIL_FINGERPRINT_KEY the per-address check refuses (fails closed) and nothing is written", async () => {
      const saved = process.env["EMAIL_FINGERPRINT_KEY"];
      delete process.env["EMAIL_FINGERPRINT_KEY"];
      try {
        await expect(ask(susan, "t22-nokey")).rejects.toThrow(/EMAIL_FINGERPRINT_KEY is not set/);
      } finally {
        process.env["EMAIL_FINGERPRINT_KEY"] = saved;
      }
      expect((await pool.query(`select 1 from people where email = $1`, [emailFor("t22-nokey")])).rowCount).toBe(0);
    });

    it("two invitations to one freed address at the same moment: exactly one goes ahead, the other is refused by the limit", async () => {
      const first = await ask(susan, "t22-race");
      remember(first.personId);
      await withdraw(susan, first.personId);
      await backdate("t22-race", "now() - interval '25 hours'");
      const results = await Promise.allSettled([ask(susan, "t22-race"), ask(jacky, "t22-race")]);
      const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ personId: string }>[];
      expect(ok).toHaveLength(1);
      remember(ok[0]!.value.personId);
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(refused.reason).toMatchObject({ reason: "limited" });
      await settleOutbox();
    });
  });

  it("review minor 3: a refused typo, or an address already on the list, spends none of the inviter's ten", async () => {
    const m = await joined("t22-typos", ["management"]);
    for (let i = 0; i < 12; i++) {
      await expect(
        invite(m, { email: `not an address ${i}`, name: "N", placements: [{ role: "staff" }], language: "en" }, { ip: `10.40.${i}.1` }),
      ).rejects.toMatchObject({ reason: "refused" });
      await expect(
        invite(m, { email: susan.email, name: "N", placements: [{ role: "staff" }], language: "en" }, { ip: `10.41.${i}.1` }),
      ).rejects.toMatchObject({ reason: "refused" });
    }
    for (let i = 0; i < INVITES_PER_INVITER_PER_DAY; i++) {
      const r = await invite(m, { email: emailFor(`t22-typo-ok-${i}`), name: "N", placements: [{ role: "staff" }], language: "en" }, { ip: `10.42.${i}.1` });
      remember(r.personId);
    }
    await settleOutbox();
  });

  it("thirty from one IP in an hour, then refused", async () => {
    const managers = await Promise.all([0, 1, 2, 3].map((i) => joined(`t22-ip${i}`, ["management"])));
    let n = 0;
    for (const m of managers) {
      for (let i = 0; i < 8 && n < 30; i++, n++) {
        const r = await invite(m, { email: emailFor(`t22-ip-${n}`), name: "N", placements: [{ role: "staff" }], language: "en" }, { ip: "10.30.30.30" });
        remember(r.personId);
      }
    }
    await expect(
      invite(managers[3]!, { email: emailFor("t22-ip-31"), name: "N", placements: [{ role: "staff" }], language: "en" }, { ip: "10.30.30.30" }),
    ).rejects.toMatchObject({ reason: "limited" });
    await settleOutbox();
  });

  it("resend is at most once a day per person, whatever the limits allow", async () => {
    const p = await invited(susan, "t22-resend");
    await expect(resend(susan, p.id)).rejects.toThrow(/less than 24 hours ago/);
  });
});

describe("T22: a failed send is never shown as sent; no acceptance email exists", () => {
  it("while the mail path fails, she stays Not sent yet and the row retries", async () => {
    fail = true;
    const r = await invite(susan, { email: emailFor("t22-fail"), name: "F", placements: [{ role: "staff" }], language: "en" });
    remember(r.personId);
    await settleOutbox();
    expect((await personRow(r.personId)).invite_sent_at).toBeNull();
    expect(await eventKinds(r.personId)).toEqual(["invited"]);
    const row = (await pool.query(`select state from mail_outbox where purpose = 'person_invite' and payload->>'personId' = $1`, [r.personId])).rows[0];
    expect(row.state).toBe("queued");
    fail = false;
    await pool.query(`update mail_outbox set next_attempt_at = now() where payload->>'personId' = $1`, [r.personId]);
    const { drainDue } = await import("../mail/outbox");
    await drainDue(10);
    expect((await personRow(r.personId)).invite_sent_at).not.toBeNull();
    expect(await eventKinds(r.personId)).toEqual(["invited", "invite_sent"]);
  });

  it("there is no acceptance email: no purpose for it, and accepting queues nothing", async () => {
    expect(MAIL_PURPOSES.filter((p) => /accept/i.test(p))).toEqual([]);
    const p = await invited(susan, "t22-noaccept");
    const before = (await pool.query(`select count(*)::int as n from mail_outbox`)).rows[0].n;
    const { acceptInvitation } = await import("@workspace/db");
    await acceptInvitation(p.id, "A", "promises-v1");
    expect((await pool.query(`select count(*)::int as n from mail_outbox`)).rows[0].n).toBe(before);
    expect(await findPersonById(p.id)).not.toBeNull();
  });
});

it("ActionRefused carries a plain message for the screen", () => {
  const e = new ActionRefused("refused", "Nothing was changed.");
  expect(e.message).toBe("Nothing was changed.");
});

describe("review minor 2: a transaction Postgres rolled back for a race is said plainly, never a 500", () => {
  it("40P01 and 40001, bare or wrapped as Drizzle wraps them, become ActionRefused with the plain wording", async () => {
    for (const code of ["40P01", "40001"]) {
      const bare = Object.assign(new Error("deadlock detected"), { code });
      await expect(run(() => Promise.reject(bare))).rejects.toMatchObject({ reason: "refused", message: RACED });
      const wrapped = Object.assign(new Error("Failed query"), { cause: bare });
      await expect(run(() => Promise.reject(wrapped))).rejects.toMatchObject({ reason: "refused", message: RACED });
    }
    expect(RACED).toBe("Someone else changed this at the same moment. Nothing was changed; please try again.");
  });

  it("any other database error is left as it is", async () => {
    const other = Object.assign(new Error("boom"), { code: "23505" });
    await expect(run(() => Promise.reject(other))).rejects.toBe(other);
  });
});
