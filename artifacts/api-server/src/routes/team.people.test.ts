import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { invitePerson, markLeft as dbMarkLeft, markLeftById, pool, setPlacements, type PersonWithScopes } from "@workspace/db";
import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { installFakeResend, type SentMail } from "../test/fakeResend";
import { cleanUpPeople, emailFor, invited, joined, personRow, remember } from "../test/inviteKit";
import { newColony } from "../test/roleKit";
import { settleOutbox } from "../lib/mail/outbox";

// SYC-53 PR 1.2: the People screen (SYC-104; roles-and-invites.md §8.1,
// §8.2, §9). T15's screen half (a team-only member and a cat guardian get
// the 403 on every People route; management gets through), the chips, the
// 25 October end date, the self-change refusals, "no free text reaches an
// email", the colonies and language wording, and the history in words.
// Mail goes to a fake Resend; nothing leaves the machine.

type Mgr = PersonWithScopes & { cookie: string };
let sent: SentMail[];
let colony: number;
let colony2: number;
let susan: Mgr;
let jacky: Mgr;
let team: Mgr;
let guardian: Mgr;
let hop = 0;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = "vitest-people-key-0123456789abcdef-0123456789";
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  sent = installFakeResend();
  colony = await newColony("people");
  colony2 = await newColony("people2");
  susan = await joined("pp-susan", ["staff", "management"]);
  jacky = await joined("pp-jacky", ["staff", "management"]);
  team = await joined("pp-team", ["staff"]);
  guardian = await joined("pp-guardian", ["guardian"], colony);
});

afterAll(async () => {
  await settleOutbox();
  await cleanUpPeople();
  delete process.env["RESEND_API_KEY"];
  delete process.env["TEAM_SESSION_KEYS"];
});

/** A fresh client address each call, so the per-address limits never trip across tests. */
const ip = () => `10.88.${Math.floor(hop / 250)}.${(hop++ % 250) + 1}`;

function get(path: string, who: { cookie: string }, browser = true) {
  const t = request(app).get(path).set("Cookie", who.cookie).set("X-Forwarded-For", ip());
  return browser ? t.set("Sec-Fetch-Mode", "navigate") : t;
}

function post(path: string, who: { cookie: string }, body: Record<string, unknown> = {}, origin: string | null = TEAM_ORIGIN) {
  const t = request(app).post(path).set("Cookie", who.cookie).set("X-Forwarded-For", ip());
  if (origin !== null) t.set("Origin", origin);
  return t.type("form").send(body);
}

const banner = (html: string) => {
  const i = html.indexOf('class="okbox"');
  return i < 0 ? "" : html.slice(i, html.indexOf("</div>", i));
};

const card = (html: string, id: string): string => {
  const i = html.indexOf(`id="p-${id}"`);
  if (i < 0) throw new Error(`no card for ${id}`);
  return html.slice(i, html.indexOf("</article>", i));
};

/** Someone invited straight through lib/db, so no email is queued (the chip is then Not sent yet). */
async function pendingRow(label: string, by: string, placements = [{ role: "staff" }] as { role: string; colonyId?: number }[]) {
  const r = await invitePerson(by, {
    email: emailFor(label),
    name: `Vt ${label}`,
    placements,
    language: "en",
    languageUsed: "en",
  });
  remember(r.id);
  return r;
}

const ROUTES = [
  ["GET", "/api/team/people"],
  ["GET", "/api/team/people/:id/roles"],
  ["GET", "/api/team/people/:id/bring-back"],
  ["POST", "/api/team/people/invite"],
  ["POST", "/api/team/people/:id/resend"],
  ["POST", "/api/team/people/:id/withdraw"],
  ["POST", "/api/team/people/:id/roles"],
  ["POST", "/api/team/people/:id/left"],
  ["POST", "/api/team/people/:id/sign-out"],
  ["POST", "/api/team/people/:id/bring-back"],
] as const;

const ANY_ID = "00000000-0000-4000-8000-000000000000";
const call = (method: string, route: string, who: { cookie: string }, origin: string | null = TEAM_ORIGIN, browser = true) => {
  const path = route.replace(":id", ANY_ID);
  if (method === "GET") return get(path, who, browser);
  const t = post(path, who, {}, origin);
  return browser ? t.set("Sec-Fetch-Mode", "navigate") : t;
};

describe("T15 (screen half): only management gets through; a team-only member and a cat guardian get the 403", () => {
  for (const [method, route] of ROUTES) {
    it(`${method} ${route}`, async () => {
      for (const who of [team, guardian]) {
        const json = await call(method, route, who, TEAM_ORIGIN, false);
        expect([json.status, json.text]).toEqual([403, '{"error":"forbidden"}']);
        const page = await call(method, route, who);
        expect(page.status).toBe(403);
        expect(page.text).not.toContain("Please sign in again.");
      }
      const through = await call(method, route, susan);
      expect([401, 403]).not.toContain(through.status);
      expect(through.status).toBeLessThan(500);
    });
  }
});

describe("every POST checks the Origin first (a missing Origin is refused too)", () => {
  for (const [method, route] of ROUTES) {
    if (method !== "POST") continue;
    it(`POST ${route}`, async () => {
      const victim = await pendingRow(`origin-${hop}`, susan.id);
      const path = route.replace(":id", victim.id);
      for (const origin of [null, "https://evil.example"]) {
        const res = await post(path, susan, { email: "x@example.com", name: "x", roles: "staff" }, origin);
        expect(res.status, String(origin)).toBe(401);
      }
      const row = await personRow(victim.id);
      expect(row.left_at).toBeNull();
      const invites = (await pool.query(`select count(*)::int as n from people where email = 'x@example.com'`)).rows[0].n;
      expect(invites).toBe(0);
    });
  }
});

describe("the chips follow the state table (spec §10.1), worked out when the page is drawn", () => {
  it("one seeded person in each state shows the right chip, and Left is on its own tab", async () => {
    const notSent = await pendingRow("chip-notsent", susan.id);
    const inv = await pendingRow("chip-invited", susan.id);
    await pool.query(`update people set invite_sent_at = now(), invite_expires_at = now() + interval '14 days' where id = $1`, [inv.id]);
    const exp = await pendingRow("chip-expired", susan.id);
    await pool.query(
      `update people set invite_sent_at = now() - interval '20 days', invite_expires_at = now() - interval '6 days' where id = $1`,
      [exp.id],
    );
    const joinedP = await joined("chip-joined");
    const leaver = await joined("chip-left");
    await dbMarkLeft(leaver.email, "cli:vitest");

    const list = (await get("/api/team/people", susan)).text;
    const chipOf = (id: string) => /class="chip (\w+)">([^<]+)</.exec(card(list, id))!.slice(1, 3);
    expect(chipOf(notSent.id)).toEqual(["not_sent", "Not sent yet"]);
    expect(chipOf(inv.id)).toEqual(["invited", "Invited"]);
    expect(chipOf(exp.id)).toEqual(["expired", "Expired"]);
    expect(chipOf(joinedP.id)).toEqual(["joined", "Joined"]);
    expect(list).not.toContain(`id="p-${leaver.id}"`);

    const left = (await get("/api/team/people?tab=left", susan)).text;
    expect(/class="chip (\w+)">([^<]+)</.exec(card(left, leaver.id))!.slice(1, 3)).toEqual(["left", "Left"]);
    expect(card(left, leaver.id)).toContain("Bring back");
    expect(left).not.toContain(`id="p-${joinedP.id}"`);
  });

  it("Invited turns into Expired by itself when the expiry passes (computed at draw time, nothing written)", async () => {
    const p = await pendingRow("chip-turns", susan.id);
    await pool.query(`update people set invite_sent_at = now(), invite_expires_at = now() + interval '2 seconds' where id = $1`, [p.id]);
    expect(card((await get("/api/team/people", susan)).text, p.id)).toContain('class="chip invited"');
    await new Promise((r) => setTimeout(r, 2300));
    expect(card((await get("/api/team/people", susan)).text, p.id)).toContain('class="chip expired"');
    const row = await personRow(p.id);
    expect(row.left_at).toBeNull();
  });

  it("Joined in the last 7 days lists only people who joined in the last 7 days", async () => {
    const fresh = await joined("recent-fresh");
    const old = await joined("recent-old");
    await pool.query(`update people set accepted_at = now() - interval '8 days' where id = $1`, [old.id]);
    const html = (await get("/api/team/people", susan)).text;
    const section = html.slice(html.indexOf("Joined in the last 7 days"), html.indexOf("<h2>Everyone</h2>"));
    expect(section).toContain(`href="#p-${fresh.id}"`);
    expect(section).not.toContain(`href="#p-${old.id}"`);
  });
});

describe("T6 on the screen: an end date of 25 October 2026 is Athens midnight across the clock change", () => {
  it("lands on 2026-10-25T22:00:00Z, and the screen shows the instant", async () => {
    // The date must be in the future for lib/db's own check; only Date is faked.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T09:00:00Z"));
    let id: string;
    try {
      const res = await post("/api/team/people/invite", susan, {
        email: emailFor("t6-oct25"),
        name: "Vt t6",
        language: "en",
        roles: "guardian",
        colony: String(colony),
        [`end_${colony}`]: "2026-10-25",
        [`label_${colony}`]: "covering",
      });
      expect(res.status).toBe(303);
      id = new URL(res.headers["location"]!, "https://x").searchParams.get("p")!;
      remember(id);
    } finally {
      vi.useRealTimers();
    }
    const r = await pool.query(`select expires_at, relationship from person_scopes where person_id = $1`, [id]);
    expect(new Date(r.rows[0].expires_at).toISOString()).toBe("2026-10-25T22:00:00.000Z");
    expect(r.rows[0].relationship).toBe("covering");
    const { endsText } = await import("../lib/people/screen");
    expect(endsText(new Date("2026-10-25T22:00:00Z"))).toBe("Ends at midnight at the end of 25 October 2026 (Athens time)");
    if (Date.now() < Date.parse("2026-10-25T22:00:00Z")) {
      const html = card((await get("/api/team/people", susan)).text, id);
      expect(html).toContain("Ends at midnight at the end of 25 October 2026 (Athens time)");
      expect(html).toContain('data-ends="2026-10-25T22:00:00Z"');
      // m4: no raw timestamp in the words on screen.
      expect(html.replace(/data-ends="[^"]*"/g, "")).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
      expect(html).toContain("Covering for a while");
    }
  });
});

describe("a manager can never change themselves through this screen (the server refuses)", () => {
  it("roles", async () => {
    const res = await post(`/api/team/people/${susan.id}/roles`, susan, { roles: "staff" });
    expect(res.status).toBe(409);
    expect(res.text).toContain("You can&#39;t change your own roles");
    const kept = (await pool.query(`select role from person_scopes where person_id = $1 order by role`, [susan.id])).rows;
    expect(kept.map((r: { role: string }) => r.role)).toEqual(["management", "staff"]);
  });
  it("mark as left", async () => {
    const res = await post(`/api/team/people/${susan.id}/left`, susan);
    expect(res.status).toBe(409);
    expect((await personRow(susan.id)).left_at).toBeNull();
  });
  it("sign out everywhere", async () => {
    const before = (await personRow(susan.id)).session_version;
    const res = await post(`/api/team/people/${susan.id}/sign-out`, susan);
    expect(res.status).toBe(409);
    expect((await personRow(susan.id)).session_version).toBe(before);
  });
  it("M1: your own id in CAPITALS is still yourself, on the screen and in lib/db", async () => {
    const me = await joined("caps-me", ["staff", "management"]);
    const upper = me.id.toUpperCase();
    const before = (await personRow(me.id)).session_version;
    for (const [path, body] of [
      [`/api/team/people/${upper}/roles`, { roles: "staff" }],
      [`/api/team/people/${upper}/left`, {}],
      [`/api/team/people/${upper}/sign-out`, {}],
    ] as const) {
      const res = await post(path, me, body as Record<string, unknown>);
      expect(res.status, path).toBe(409);
    }
    const row = await personRow(me.id);
    expect(row.left_at).toBeNull();
    expect(row.session_version).toBe(before);
    const roles = (await pool.query(`select role from person_scopes where person_id = $1 order by role`, [me.id])).rows;
    expect(roles.map((r: { role: string }) => r.role)).toEqual(["management", "staff"]);
    // The same through lib/db directly, with an upper-cased self id.
    await expect(setPlacements(me.id, upper, [{ role: "staff" }])).rejects.toThrow(/own roles/);
    await expect(markLeftById(me.id, upper)).rejects.toThrow(/yourself/);
    await expect(markLeftById(upper, me.id)).rejects.toThrow(/yourself/);
    expect((await personRow(me.id)).left_at).toBeNull();
  });
  it("your own row has no buttons", async () => {
    const html = card((await get("/api/team/people", susan)).text, susan.id);
    expect(html).toContain("This is you");
    expect(html).not.toContain("/left");
    expect(html).not.toContain("/sign-out");
    expect(html).not.toContain("/roles");
  });
});

describe("no free text on this screen ends up in an email", () => {
  it("a name full of markup and links reaches the outbox as ids only, and the emails carry only the defanged name", async () => {
    const nasty = `<a href="https://evil.example/x">click</a> http://evil.example/y`;
    await settleOutbox();
    sent.length = 0;
    const res = await post("/api/team/people/invite", susan, {
      email: emailFor("nasty"),
      name: nasty,
      language: "en",
      roles: "staff",
    });
    expect(res.status).toBe(303);
    const id = new URL(res.headers["location"]!, "https://x").searchParams.get("p")!;
    remember(id);
    await settleOutbox();
    // Change their roles as well: that mails the other manager.
    const change = await post(`/api/team/people/${id}/roles`, susan, { roles: ["staff", "management"] });
    expect(change.status).toBe(303);
    await settleOutbox();

    const rows = (await pool.query(`select payload from mail_outbox where payload::text like $1`, [`%${id}%`])).rows;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      const text = JSON.stringify(r.payload);
      expect(text).not.toContain("evil");
      expect(text).not.toContain("click");
      expect(text).not.toContain("<");
    }
    expect(sent.length).toBeGreaterThanOrEqual(2);
    for (const m of sent) {
      for (const body of [m.text, m.html, m.subject]) {
        expect(body).not.toMatch(/https?:\/\/evil/i);
        expect(body).not.toContain('<a href="https://evil');
      }
      expect(m.html).not.toContain('<a href="http');
      expect(m.html).not.toMatch(/<a /);
      for (const body of [m.text]) {
        expect(body).not.toContain('<a href="https://evil');
      }
    }
    // Where the name is shown to a manager it is the defanged, clipped one.
    expect(sent.some((m) => m.text.includes("evil[.]example"))).toBe(true);
  });

  it("the screen offers no free-text box except the name (the address is typed once)", async () => {
    const html = (await get("/api/team/people", susan)).text;
    expect(html).not.toContain("<textarea");
    const form = html.slice(html.indexOf('id="invite"'), html.indexOf("Joined in the last 7 days"));
    expect(form.match(/name="email"/g)).toHaveLength(1);
    expect(form).not.toMatch(/confirm/i);
  });
});

describe("colony names are drawn whole", () => {
  it("a guardian's roles line and history carry the full colony name", async () => {
    const name = (await pool.query(`select name from colonies where id = $1`, [colony])).rows[0].name as string;
    const g = await joined("whole-name", ["guardian"], colony);
    const html = card((await get("/api/team/people", susan)).text, g.id);
    expect(html).toContain(`A cat guardian for ${name}`);
  });
});

describe("the language wording", () => {
  it('says "will be sent in English" for Greek and French while only English is live', async () => {
    const html = (await get("/api/team/people", susan)).text;
    expect(html).toContain("Greek (will be sent in English)");
    expect(html).toContain("French (will be sent in English)");
    expect(html).not.toContain("English (will be sent in English)");
  });
  it("and says it again after sending an invitation in Greek", async () => {
    const res = await post("/api/team/people/invite", susan, {
      email: emailFor("greek"),
      name: "Vt greek",
      language: "el",
      roles: "staff",
    });
    expect(res.status).toBe(303);
    remember(new URL(res.headers["location"]!, "https://x").searchParams.get("p")!);
    const page = await get(res.headers["location"]!, susan);
    expect(page.text).toContain("It will be sent in English.");
  });
});

describe("history is in words, with ids turned into names", () => {
  it("names the manager, never their id; an anonymised invitation shows the placeholder, never the old address", async () => {
    const r = await invited(susan, "hist-withdrawn");
    const before = (await get("/api/team/people", susan)).text;
    expect(card(before, r.id)).toContain("Vt pp-susan invited them as a member of the Syros Cats team.");
    const w = await post(`/api/team/people/${r.id}/withdraw`, susan);
    expect(w.status).toBe(303);
    const left = (await get("/api/team/people?tab=left", susan)).text;
    const c = card(left, r.id);
    expect(c).toContain("Withdrawn invitation");
    expect(c).toContain("Vt pp-susan withdrew the invitation.");
    expect(c).toContain("Their name and address were removed.");
    expect(c).toContain("Invite the person afresh");
    expect(c).not.toContain("Bring back");
    expect(left).not.toContain(emailFor("hist-withdrawn"));
    expect(left).not.toContain("Vt hist-withdrawn");
    const items = [...c.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);
    for (const li of items) expect(li).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe("the changes themselves, through the actions layer", () => {
  it("resend and withdraw on a pending person; a second resend inside a day is refused in words", async () => {
    const p = await pendingRow("resend-me", susan.id);
    const ok = await post(`/api/team/people/${p.id}/resend`, susan);
    expect(ok.status).toBe(303);
    expect(ok.headers["location"]).toContain("done=resent");
    await settleOutbox();
    const again = await post(`/api/team/people/${p.id}/resend`, susan);
    expect(again.status).toBe(409);
    expect(again.text).toContain("Nothing was changed.");
    const w = await post(`/api/team/people/${p.id}/withdraw`, susan);
    expect(w.headers["location"]).toContain("done=withdrawn");
  });

  it("change roles: a guardian who loses a colony gets the rename nudge, and the other manager is emailed", async () => {
    const g = await joined("roles-g", ["guardian"], colony);
    await settleOutbox();
    sent.length = 0;
    const page = await get(`/api/team/people/${g.id}/roles`, susan);
    expect(page.status).toBe(200);
    expect(page.text).toContain(`value="${colony}" checked`);
    const res = await post(`/api/team/people/${g.id}/roles`, susan, { roles: "staff" });
    expect(res.status).toBe(303);
    const banner = (await get(res.headers["location"]!, susan)).text;
    expect(banner).toMatch(/still has Vt roles-g on it\. <a href="\/api\/team\/colonies\/\d+">Rename it\?<\/a>/);
    await settleOutbox();
    expect(sent.some((m) => m.to === jacky.email)).toBe(true);
    expect(sent.some((m) => m.to === susan.email)).toBe(false);
  });

  it("guardian with an unknown colony, no colony, or colonies without the guardian role is refused in words", async () => {
    const t = await joined("roles-bad", ["staff"]);
    for (const body of [
      { roles: "guardian", colony: "999999999" },
      { roles: "guardian" },
      { roles: "staff", colony: String(colony) },
      {},
    ]) {
      const res = await post(`/api/team/people/${t.id}/roles`, susan, body as Record<string, unknown>);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.text).toContain("Nothing was changed.");
    }
  });

  it("m2: a repeated end date or label field is refused, never dropped into a permanent placement", async () => {
    const t = await joined("roles-dup", ["staff"]);
    for (const body of [
      `roles=guardian&colony=${colony}&end_${colony}=2099-01-01&end_${colony}=2099-02-02`,
      `roles=guardian&colony=${colony}&label_${colony}=feeds&label_${colony}=covering`,
    ]) {
      const res = await request(app)
        .post(`/api/team/people/${t.id}/roles`)
        .set("Cookie", susan.cookie)
        .set("Origin", TEAM_ORIGIN)
        .set("X-Forwarded-For", ip())
        .type("form")
        .send(body);
      expect(res.status, body).toBe(400);
      expect(res.text).toContain("Each colony takes one");
    }
    const rows = (await pool.query(`select role from person_scopes where person_id = $1`, [t.id])).rows;
    expect(rows.map((r: { role: string }) => r.role)).toEqual(["staff"]);
  });

  it("m3: a placement management removed shows when it really ended; m4: no raw timestamp anywhere", async () => {
    const g = await joined("m3-g", ["guardian"], colony);
    const res = await post(`/api/team/people/${g.id}/roles`, susan, { roles: "staff" });
    expect(res.status).toBe(303);
    const html = card((await get("/api/team/people", susan)).text, g.id);
    expect(html).toMatch(/Ended \d{1,2} \w{3} \d{4}, \d{2}:\d{2} \(Athens time\)/);
    expect(html).not.toContain("Ended at the end of");
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
  });

  it("m5: the bring-back page shows what they held and when they left", async () => {
    const g = await joined("m5-g", ["guardian"], colony);
    const name = (await pool.query(`select name from colonies where id = $1`, [colony])).rows[0].name as string;
    expect((await post(`/api/team/people/${g.id}/left`, susan)).status).toBe(303);
    const page = (await get(`/api/team/people/${g.id}/bring-back`, susan)).text;
    expect(page).toContain(`When they left they were a cat guardian for ${name}.`);
    expect(page).toMatch(/Left \d{1,2} \w+ \d{4}\./);
  });

  it("m6: withdrawing an invitation says so without the placeholder name", async () => {
    const p = await pendingRow("m6-w", susan.id);
    const res = await post(`/api/team/people/${p.id}/withdraw`, susan);
    const b = banner((await get(res.headers["location"]!, susan)).text);
    expect(b).toContain("The invitation was withdrawn.");
    expect(b).not.toContain("Withdrawn invitation");
  });

  it("a date refusal never echoes what was typed", async () => {
    const t = await joined("m-date", ["staff"]);
    const res = await post(`/api/team/people/${t.id}/roles`, susan, {
      roles: "guardian",
      colony: String(colony),
      [`end_${colony}`]: "2026-02-31<b>x</b>",
    });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain("2026-02-31");
    expect(res.text).not.toContain("<b>x");
  });

  it("mark as left: the workspace reminder for a team member, the rename nudge for a guardian", async () => {
    const t = await joined("left-team", ["staff"]);
    const res = await post(`/api/team/people/${t.id}/left`, susan);
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/people?done=left&p=${t.id}`);
    const html = (await get(res.headers["location"]!, susan)).text;
    expect(html).toContain("Change the shared document password today.");

    const g = await joined("left-guard", ["guardian"], colony2);
    const r2 = await post(`/api/team/people/${g.id}/left`, susan);
    const html2 = (await get(r2.headers["location"]!, susan)).text;
    const banner2 = html2.slice(html2.indexOf('class="okbox"'), html2.indexOf("</div>", html2.indexOf('class="okbox"')));
    expect(banner2).not.toContain("shared document password");
    expect(html2).toMatch(/still has Vt left-guard on it\./);
    expect(html2).toContain(`href="/api/team/colonies/${colony2}"`);
  });

  it("marking someone as left withdraws the invitations they sent, and says how many", async () => {
    const sender = await joined("left-sender", ["staff", "management"]);
    await invited(sender, "left-sender-a");
    await invited(sender, "left-sender-b");
    const res = await post(`/api/team/people/${sender.id}/left`, susan);
    expect(res.headers["location"]).toBe(`/api/team/people?done=left&p=${sender.id}`);
    const html = (await get(res.headers["location"]!, susan)).text;
    expect(html).toContain("2 invitations from Vt left-sender were withdrawn when they left. Re-send any you still want.");
  });

  it("sign out everywhere raises the session version of someone else", async () => {
    const t = await joined("signout-t", ["staff"]);
    const before = (await personRow(t.id)).session_version;
    const res = await post(`/api/team/people/${t.id}/sign-out`, susan);
    expect(res.status).toBe(303);
    expect((await personRow(t.id)).session_version).toBe(before + 1);
  });

  it("bring back: roles chosen afresh, the person is pending again", async () => {
    const t = await joined("back-t", ["staff", "management"]);
    await dbMarkLeft(t.email, "cli:vitest");
    const form = await get(`/api/team/people/${t.id}/bring-back`, susan);
    expect(form.status).toBe(200);
    expect(form.text).toContain("Nothing is restored automatically");
    expect(form.text).not.toMatch(/<input[^>]* checked/);
    const res = await post(`/api/team/people/${t.id}/bring-back`, susan, { roles: "staff", language: "en" });
    expect(res.status).toBe(303);
    const row = await personRow(t.id);
    expect(row.left_at).toBeNull();
    expect(row.accepted_at).toBeNull();
    const roles = (await pool.query(`select role from person_scopes where person_id = $1`, [t.id])).rows;
    expect(roles.map((r: { role: string }) => r.role)).toEqual(["staff"]);
  });

  it("a made-up person id is a 404, not a 500", async () => {
    const res = await post(`/api/team/people/not-an-id/left`, susan);
    expect(res.status).toBe(404);
  });
});

describe("m1: a banner can't be forged from a link; it is rebuilt from the person's own recent event", () => {
  it("claims in the query (w, n, c, en) are ignored, and nobody gets a banner for a change they didn't just make", async () => {
    const t = await joined("forge-t", ["staff"]);
    const crafted = `/api/team/people?done=left&p=${t.id}&w=1&n=999&c=${colony}&en=1`;
    expect(banner((await get(crafted, susan)).text)).toBe("");
    const inv = `/api/team/people?done=invited&p=${t.id}&en=1`;
    expect(banner((await get(inv, susan)).text)).toBe("");
    // A real change made by another manager is not Susan's banner either.
    const v = await joined("forge-v", ["staff"]);
    const res = await post(`/api/team/people/${v.id}/left`, jacky);
    expect(res.status).toBe(303);
    expect(banner((await get(res.headers["location"]!, susan)).text)).toBe("");
    expect(banner((await get(res.headers["location"]!, jacky)).text)).toContain("is marked as left");
  });

  it("the real banner's extras come from the event, and the banner expires after 10 minutes", async () => {
    const t = await joined("forge-real", ["staff"]);
    const res = await post(`/api/team/people/${t.id}/left`, susan);
    const loc = res.headers["location"]!;
    expect(banner((await get(loc, susan)).text)).toContain("Change the shared document password today.");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 11 * 60_000));
    try {
      expect(banner((await get(loc, susan)).text)).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the People link in the bar", () => {
  it("shows for management on other dashboard pages, and not for a team-only member", async () => {
    const m = await get("/api/team/colonies", susan);
    expect(m.text).toContain('<a href="/api/team/people">People</a>');
    const t = await get("/api/team/colonies", team);
    expect(t.text).not.toContain("/api/team/people");
  });
});
