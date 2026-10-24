import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { markLeftById, pool, withdrawInvitation, type PersonWithScopes } from "@workspace/db";
import { installFakeResend, type SentMail } from "../../test/fakeResend";
import { cleanUpPeople, emailFor, eventKinds, joined, personRow, remember } from "../../test/inviteKit";
import { newColony } from "../../test/roleKit";
import { bringBack, invite, changeRoles, resend } from "../people/actions";
import { drainDue, settleOutbox } from "./outbox";
import { sendMail, type PersonMailLookups } from "./send";
import { renderAccessNotice, renderInvitation } from "./personTemplates";
import { roleSentence } from "../people/words";

// SYC-53 PR 1.1: the two people emails (roles-and-invites.md §4.1 step 2,
// §8.3, §8.5; plan T22 and the delivery-time re-check, review M9). Nothing
// is sent to a real address: sendMail gets a fake fetch, and the outbox
// tests a fake Resend.

const quietLog = () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() });

function fakeFetch() {
  const calls: { body: Record<string, unknown> }[] = [];
  const impl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ id: "re_x" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const lookups = (over: Partial<PersonMailLookups> = {}): PersonMailLookups => ({
  invitee: async () => ({
    email: "eleni@example.com",
    language: "en",
    roles: ["guardian"],
    colonies: [{ id: 7, name: "Vaporia — Eleni's" }],
  }),
  manager: async () => ({ email: "jacky@example.com", language: "en" }),
  names: async () => new Map([["a", "Susan"], ["s", "Eleni"]]),
  colonyNames: async () => new Map([[7, "Vaporia — Eleni's"]]),
  ...over,
});

const notSuppressed = async () => false;

describe("T22: the invitation can't be given an address, and says only the role and the colony", () => {
  beforeEach(() => {
    process.env["RESEND_API_KEY"] = "re_test_not_real";
  });

  it("a message carrying `to` is refused, and nothing is sent", async () => {
    const { impl, calls } = fakeFetch();
    const result = await sendMail(
      // @ts-expect-error: the invitation takes a person id, never an address
      { purpose: "person_invite", personId: "p", to: "stranger@example.net" },
      { fetchImpl: impl, log: quietLog(), people: lookups(), isSuppressed: notSuppressed },
    );
    expect(result).toEqual({ ok: false, reason: "recipient_not_allowed" });
    expect(calls).toHaveLength(0);
  });

  it("so is one carrying a template, text or a subject; and one with no people lookup", async () => {
    const { impl, calls } = fakeFetch();
    for (const extra of [{ template: "x" }, { text: "free" }, { subject: "s" }, { html: "<p>" }, { params: {} }]) {
      const r = await sendMail(
        { purpose: "person_invite", personId: "p", ...extra } as never,
        { fetchImpl: impl, log: quietLog(), people: lookups(), isSuppressed: notSuppressed },
      );
      expect(r).toEqual({ ok: false, reason: "recipient_not_allowed" });
    }
    expect(await sendMail({ purpose: "person_invite", personId: "p" }, { fetchImpl: impl, log: quietLog() })).toEqual({
      ok: false,
      reason: "recipient_check_missing",
    });
    expect(calls).toHaveLength(0);
  });

  it("someone not pending, expired or anonymised (the lookup says no) gets nothing", async () => {
    const { impl, calls } = fakeFetch();
    const r = await sendMail(
      { purpose: "person_invite", personId: "p" },
      { fetchImpl: impl, log: quietLog(), people: lookups({ invitee: async () => null }), isSuppressed: notSuppressed },
    );
    expect(r).toEqual({ ok: false, reason: "not_pending" });
    expect(calls).toHaveLength(0);
  });

  it("goes to her own address, from signin@, saying the role and the colony and nothing else", async () => {
    const { impl, calls } = fakeFetch();
    const r = await sendMail(
      { purpose: "person_invite", personId: "p" },
      { fetchImpl: impl, log: quietLog(), people: lookups(), isSuppressed: notSuppressed },
    );
    expect(r.ok).toBe(true);
    const body = calls[0]!.body;
    expect(body["to"]).toEqual(["eleni@example.com"]);
    expect(body["from"]).toBe("Cat Spotters <signin@mail.catspotters.com>");
    expect(body["subject"]).toBe("Syros Cats has invited you to help");
    expect(body["text"]).toBe(
      "Syros Cats has invited you to help as a cat guardian for Vaporia — Eleni's.\n\n" +
        "To get started, go to admin.catspotters.com, type your email address, and tap the link we email you.\n\n" +
        "This invitation stops working after 14 days. If you weren't expecting it, you can ignore this message.\n",
    );
    // No link anywhere: no scheme, no anchor.
    expect(String(body["text"])).not.toMatch(/https?:/);
    expect(String(body["html"])).not.toMatch(/<a\b|https?:/);
  });

  it("a colony name with markup or a link is escaped and defanged, and length-limited", () => {
    const m = renderInvitation({
      language: "en",
      roles: ["guardian"],
      colonies: ["<b>Bad</b> https://evil.example/login", "x".repeat(200)],
    });
    expect(m.html).not.toContain("<b>");
    expect(m.html).toContain("&lt;b&gt;Bad&lt;/b&gt;");
    expect(m.text).not.toContain("https://evil.example");
    expect(m.text).toContain("https[:]//evil[.]example/login");
    expect(m.text).toContain(`${"x".repeat(59)}…`);
    expect(m.text).not.toContain("x".repeat(61));
  });

  it("in her language once it is live; English until then", () => {
    const el = renderInvitation({ language: "el", roles: ["staff"], colonies: [] }, ["en", "el"]);
    expect(el.subject).toBe("Οι Syros Cats σας προσκαλούν να βοηθήσετε");
    expect(el.html).toContain('lang="el"');
    expect(renderInvitation({ language: "el", roles: ["staff"], colonies: [] }).subject).toBe(
      "Syros Cats has invited you to help",
    );
  });
});

describe("the access-change notice: to a manager, never the actor; names from the records, made safe", () => {
  beforeEach(() => {
    process.env["RESEND_API_KEY"] = "re_test_not_real";
  });
  const notice = {
    purpose: "access_change_notice" as const,
    recipientId: "r",
    actorId: "a",
    subjectId: "s",
    change: { kind: "invited" as const, roles: ["guardian"], colonyIds: [7] },
  };

  it("refuses the actor as recipient, a recipient who isn't a manager now, and a carried `to`", async () => {
    const { impl, calls } = fakeFetch();
    const deps = { fetchImpl: impl, log: quietLog(), people: lookups(), isSuppressed: notSuppressed };
    expect(await sendMail({ ...notice, recipientId: "a" }, deps)).toEqual({ ok: false, reason: "recipient_not_allowed" });
    expect(await sendMail(notice, { ...deps, people: lookups({ manager: async () => null }) })).toEqual({
      ok: false,
      reason: "not_a_manager",
    });
    expect(await sendMail({ ...notice, to: "x@example.com" } as never, deps)).toEqual({ ok: false, reason: "recipient_not_allowed" });
    expect(calls).toHaveLength(0);
  });

  it("says who made which change to whom", async () => {
    const { impl, calls } = fakeFetch();
    expect((await sendMail(notice, { fetchImpl: impl, log: quietLog(), people: lookups(), isSuppressed: notSuppressed })).ok).toBe(true);
    expect(calls[0]!.body["to"]).toEqual(["jacky@example.com"]);
    expect(String(calls[0]!.body["text"])).toContain("Susan invited Eleni as a cat guardian for Vaporia — Eleni's.");
  });

  it("a name with markup or a link (typed by an inviter or an invitee) is escaped and defanged", () => {
    const m = renderAccessNotice({
      language: "en",
      actorName: "Susan",
      subjectName: '<img src=x onerror="alert(1)"> visit www.evil.example',
      change: { kind: "left", withdrawn: 0 },
      colonyNames: new Map(),
    });
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img");
    expect(m.text).not.toContain("www.evil.example");
    expect(m.text).toContain("www[.]evil[.]example");
    expect(m.text).not.toContain("\n<");
  });
});

// ── the outbox: queued by id, re-checked at delivery ───────────────────────

describe("delivery-time re-check (review M9): withdrawn, expired, anonymised or moved between queueing and sending sends nothing", () => {
  let sent: SentMail[];
  let fail = false;
  let susan: PersonWithScopes & { cookie: string };
  let jacky: PersonWithScopes & { cookie: string };
  let colony: number;

  beforeAll(async () => {
    process.env["TEAM_SESSION_KEYS"] = "vitest-mail-key-0123456789abcdef-0123456789";
    process.env["RESEND_API_KEY"] = "re_test_not_real";
    sent = installFakeResend({ fail: () => fail });
    colony = await newColony("mail-recheck");
    susan = await joined("ml-susan", ["staff", "management"]);
    jacky = await joined("ml-jacky", ["management"]);
  });

  afterAll(async () => {
    await settleOutbox();
    await cleanUpPeople();
    vi.unstubAllGlobals();
    delete process.env["TEAM_SESSION_KEYS"];
    delete process.env["RESEND_API_KEY"];
  });

  /** An invitation queued while the mail path is down. */
  async function queued(label: string) {
    fail = true;
    const r = await invite(susan, { email: emailFor(label), name: label, placements: [{ role: "guardian", colonyId: colony }], language: "en" });
    remember(r.personId);
    await settleOutbox();
    fail = false;
    sent.length = 0;
    return r.personId;
  }
  const deliverNow = async (personId: string) => {
    await pool.query(`update mail_outbox set next_attempt_at = now() where payload->>'personId' = $1`, [personId]);
    await drainDue(20);
  };
  const outboxRow = async (personId: string) =>
    (await pool.query(`select state, last_error from mail_outbox where purpose = 'person_invite' and payload->>'personId' = $1`, [personId])).rows[0];

  it("control: queued while the mail path was down, then delivered: she becomes Invited", async () => {
    const id = await queued("ml-control");
    expect((await personRow(id)).invite_sent_at).toBeNull();
    await deliverNow(id);
    expect(sent.map((m) => m.to)).toContain(emailFor("ml-control"));
    expect((await outboxRow(id)).state).toBe("sent");
    expect((await personRow(id)).invite_sent_at).not.toBeNull();
    expect(await eventKinds(id)).toEqual(["invited", "invite_sent"]);
  });

  it("withdrawn (and so anonymised) before delivery: nothing sent, the row cancelled", async () => {
    const id = await queued("ml-withdrawn");
    await withdrawInvitation(susan.id, id);
    await deliverNow(id);
    expect(sent.filter((m) => m.subject.startsWith("Syros Cats has invited"))).toEqual([]);
    expect(await outboxRow(id)).toEqual({ state: "failed", last_error: "cancelled: no_longer_pending" });
    expect(await eventKinds(id)).not.toContain("invite_sent");
  });

  it("expired before delivery: nothing sent", async () => {
    const id = await queued("ml-expired");
    await pool.query(`update people set invite_expires_at = now() - interval '1 second' where id = $1`, [id]);
    await deliverNow(id);
    expect(sent.filter((m) => m.subject.startsWith("Syros Cats has invited"))).toEqual([]);
    expect(await outboxRow(id)).toEqual({ state: "failed", last_error: "cancelled: no_longer_pending" });
  });

  it("anonymised but somehow pending again: nothing sent", async () => {
    const id = await queued("ml-anon");
    await pool.query(`update people set email = $2, name = 'Withdrawn invitation' where id = $1`, [id, `withdrawn-${id}@invalid`]);
    await deliverNow(id);
    expect(sent.filter((m) => m.subject.startsWith("Syros Cats has invited"))).toEqual([]);
    expect((await outboxRow(id)).state).toBe("failed");
  });

  it("an address that is no longer the one queued: nothing sent to either", async () => {
    const id = await queued("ml-moved");
    await pool.query(`update people set email = $2 where id = $1`, [id, emailFor("ml-moved-elsewhere")]);
    await deliverNow(id);
    expect(sent.filter((m) => m.subject.startsWith("Syros Cats has invited"))).toEqual([]);
    expect(await outboxRow(id)).toEqual({ state: "failed", last_error: "cancelled: address_changed" });
  });

  it("review minor 4: someone brought back, then withdrawn before delivery (not anonymised, same address, expiry ahead): nothing sent", async () => {
    const back = await joined("ml-back");
    await markLeftById(susan.id, back.id);
    fail = true;
    await bringBack(susan, back.id, [{ role: "staff" }], "en");
    await settleOutbox();
    fail = false;
    sent.length = 0;
    await withdrawInvitation(susan.id, back.id);
    const row = await personRow(back.id);
    expect(row.email).toBe(back.email); // joined once: never anonymised
    expect(row.invite_expires_at!.getTime()).toBeGreaterThan(Date.now());
    await deliverNow(back.id);
    expect(sent.filter((m) => m.subject.startsWith("Syros Cats has invited"))).toEqual([]);
    expect(await outboxRow(back.id)).toEqual({ state: "failed", last_error: "cancelled: no_longer_pending" });
  });

  it("review minor 4: a manager marked as left after a notice to her was queued gets nothing", async () => {
    const t = await joined("ml-target2");
    const leaving = await joined("ml-leaving", ["staff", "management"]);
    fail = true;
    await changeRoles(susan, t.id, [{ role: "management" }]);
    await settleOutbox();
    fail = false;
    sent.length = 0;
    await markLeftById(susan.id, leaving.id); // her management row is kept on her record
    await pool.query(`update mail_outbox set next_attempt_at = now() where purpose = 'access_change_notice' and payload->>'subjectId' = $1`, [t.id]);
    await drainDue(20);
    expect(sent.map((m) => m.to)).not.toContain(leaving.email);
    const rows = (await pool.query(`select state, last_error from mail_outbox where purpose = 'access_change_notice' and payload->>'recipientId' = $1 and payload->>'subjectId' = $2`, [leaving.id, t.id])).rows;
    expect(rows).toEqual([{ state: "failed", last_error: "cancelled: not_a_manager" }]);
  });

  it("review minor 1: a resend while the mail path is down leaves an Expired invitation Expired; delivery reopens it", async () => {
    const id = await queued("ml-resend");
    await deliverNow(id);
    await pool.query(`update people set invite_sent_at = now() - interval '15 days', invite_expires_at = now() - interval '1 day' where id = $1`, [id]);
    fail = true;
    await resend(susan, id);
    await settleOutbox();
    fail = false;
    const { findInvitee } = await import("@workspace/db");
    expect(await findInvitee(id)).toBeNull();
    expect((await personRow(id)).invite_expires_at!.getTime()).toBeLessThan(Date.now());
    sent.length = 0;
    await deliverNow(id);
    expect(sent.map((m) => m.to)).toEqual([emailFor("ml-resend")]);
    expect(await findInvitee(id)).not.toBeNull();
    expect((await eventKinds(id)).at(-1)).toBe("invite_resent");
  });

  it("a notice whose recipient stopped being a manager before delivery is not sent", async () => {
    const t = await joined("ml-target");
    const extra = await joined("ml-extra", ["management"]);
    fail = true;
    await changeRoles(susan, t.id, [{ role: "management" }]);
    await settleOutbox();
    fail = false;
    sent.length = 0;
    await pool.query(`update person_scopes set expires_at = now() - interval '1 second' where person_id = $1`, [extra.id]);
    await pool.query(`update mail_outbox set next_attempt_at = now() where purpose = 'access_change_notice' and payload->>'subjectId' = $1`, [t.id]);
    await drainDue(20);
    expect(sent.map((m) => m.to)).toContain(jacky.email);
    expect(sent.map((m) => m.to)).not.toContain(extra.email);
    const rows = (await pool.query(`select state, last_error from mail_outbox where purpose = 'access_change_notice' and payload->>'recipientId' = $1 and payload->>'subjectId' = $2`, [extra.id, t.id])).rows;
    expect(rows).toEqual([{ state: "failed", last_error: "cancelled: not_a_manager" }]);
  });
});

// ── review M-2: no transaction, lock or connection held across the send ───

describe("review M-2: a slow provider holds up nothing", () => {
  const DELAY_MS = 2000;
  let delivered: string[];
  /** While true, the provider refuses at once (so a queued row's first kick can't deliver it). */
  let down = false;
  let susan: PersonWithScopes & { cookie: string };

  beforeAll(async () => {
    process.env["TEAM_SESSION_KEYS"] = "vitest-slow-key-0123456789abcdef-0123456789";
    process.env["RESEND_API_KEY"] = "re_test_not_real";
    delivered = [];
    // A provider that takes two seconds to answer each send.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        if (down) throw new Error("network down");
        await new Promise((r) => setTimeout(r, DELAY_MS));
        delivered.push(String((JSON.parse(String(init?.body)) as { to: string[] }).to[0]));
        return new Response(JSON.stringify({ id: `re_slow_${delivered.length}` }), { status: 200 });
      }),
    );
    susan = await joined("slow-susan", ["staff", "management"]);
  });

  afterAll(async () => {
    await settleOutbox();
    await cleanUpPeople();
    vi.unstubAllGlobals();
    delete process.env["TEAM_SESSION_KEYS"];
    delete process.env["RESEND_API_KEY"];
  });

  /** Queue an invitation without sending it (the row is not yet due). */
  async function queuedNotDue(label: string, actor: PersonWithScopes = susan) {
    // The action kicks its rows at once: with the provider down, that first
    // try fails and the row waits, so it can't be delivered before the test
    // says (a flake seen once in a full run).
    down = true;
    await settleOutbox();
    const r = await invite(actor, { email: emailFor(label), name: label, placements: [{ role: "staff" }], language: "en" });
    remember(r.personId);
    // The action kicks its rows at once; stop them going until we say.
    await settleOutbox();
    down = false;
    await pool.query(`update mail_outbox set next_attempt_at = now() + interval '1 hour' where payload->>'personId' = $1 or payload->>'subjectId' = $1`, [r.personId]);
    return r.personId;
  }

  it("while an invitation is with the provider, withdrawing and accepting answer at once; nothing withdrawn mid-send is recorded as Invited", async () => {
    await settleOutbox(); // the invite's own kicks (slow) finish first
    const w = await queuedNotDue("slow-withdraw");
    // A second one already delivered once, with a resend now on its way.
    const a = await queuedNotDue("slow-accept");
    await pool.query(`update people set invite_sent_at = now(), invite_expires_at = now() + interval '1 day' where id = $1`, [a]);
    await settleOutbox();
    await pool.query(`update mail_outbox set next_attempt_at = now() where purpose = 'person_invite' and payload->>'personId' = any($1)`, [[w, a]]);
    const draining = drainDue(2);
    await new Promise((r) => setTimeout(r, 300)); // both are now inside the send
    const t0 = Date.now();
    expect(await withdrawInvitation(susan.id, w)).not.toBeNull();
    const { acceptInvitation } = await import("@workspace/db");
    expect(await acceptInvitation(a, "A", "promises-v1")).not.toBeNull();
    const took = Date.now() - t0;
    expect(took).toBeLessThan(DELAY_MS / 2);
    await draining;
    // The withdrawn one is never shown as sent; the accepted one has joined.
    expect(await eventKinds(w)).not.toContain("invite_sent");
    expect((await personRow(w)).invite_sent_at).toBeNull();
    expect((await personRow(a)).accepted_at).not.toBeNull();
    expect(await eventKinds(a)).not.toContain("invite_sent");
  }, 30_000);

  it("twelve drains at once with the slow provider: the pool stays free and every row settles", async () => {
    await settleOutbox();
    const ids: string[] = [];
    // Two senders, so no one inviter passes their 10 a day.
    const other = await joined("slow-other", ["management"]);
    for (let i = 0; i < 12; i++) ids.push(await queuedNotDue(`slow-many-${i}`, i % 2 ? other : susan));
    await pool.query(`update mail_outbox set next_attempt_at = now() where purpose = 'person_invite' and payload->>'personId' = any($1)`, [ids]);
    const drains = Array.from({ length: 12 }, () => drainDue(1));
    await new Promise((r) => setTimeout(r, 300));
    // Mid-send, an ordinary query gets a connection straight away.
    const t0 = Date.now();
    await pool.query("select 1");
    expect(Date.now() - t0).toBeLessThan(DELAY_MS / 2);
    const results = await Promise.all(drains);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(12);
    for (const id of ids) expect((await personRow(id)).invite_sent_at).not.toBeNull();
  }, 60_000);
});

// SYC-619 task 18: the roles forms get a line under each box, but the "Now:"
// sentence and the invitation emails must keep their exact words (spec 9.1).
describe("role wording in emails and the Now line is locked", () => {
  const roleSets = [["staff"], ["management"], ["guardian"], ["staff", "guardian"], ["management", "guardian"], []];
  it("roleSentence, in each language, for every role mix", () => {
    const out: Record<string, string> = {};
    for (const lang of ["en", "el", "fr"] as const)
      for (const roles of roleSets)
        for (const cols of [[], ["Vaporia"], ["Vaporia", "Ano Syros"]])
          out[`${lang} ${roles.join("+") || "none"} ${cols.join(",") || "no colonies"}`] = roleSentence(lang, roles, cols, (n) => n, ["en", "el", "fr"]);
    out["en starting"] = roleSentence("en", ["guardian"], [], (n) => n, ["en"], true);
    expect(out).toMatchSnapshot();
  });
  it("invitation emails, every role mix and language", () => {
    const out: Record<string, unknown> = {};
    for (const language of ["en", "el", "fr"])
      for (const roles of roleSets)
        out[`${language} ${roles.join("+") || "none"}`] = renderInvitation({ language, roles, colonies: roles.includes("guardian") ? ["Vaporia"] : [] }, ["en", "el", "fr"]);
    out["en starting"] = renderInvitation({ language: "en", roles: ["guardian"], colonies: [], starting: true });
    expect(out).toMatchSnapshot();
  });
  it("the access notice that carries the role sentence", () => {
    const names = new Map([[7, "Vaporia"]]);
    const base = { language: "en", actorName: "Susan", subjectName: "Eleni", colonyNames: names };
    expect([
      renderAccessNotice({ ...base, change: { kind: "invited", roles: ["management", "guardian"], colonyIds: [7] } }),
      renderAccessNotice({ ...base, change: { kind: "roles_changed", before: ["staff"], after: ["management", "guardian:7"] } }),
    ]).toMatchSnapshot();
  });
});
