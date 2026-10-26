import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { markLeftById, pool, placementEndsAt, type PersonWithScopes } from "@workspace/db";
import app from "../app";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { SESSION_COOKIE } from "../lib/teamAuth/session";
import { TEAM_HOME } from "../lib/teamAuth/config";
import { installFakeResend, type SentMail } from "../test/fakeResend";
import { cleanUpPeople, eventKinds, inviteCookieFor, invited, joined, otherManagerEmails, personRow } from "../test/inviteKit";
import { endPlacements } from "../test/roleKit";
import { settleOutbox } from "../lib/mail/outbox";
import { aboutYou, renderMyColoniesPage, renderMyPage } from "../lib/teamPages/myPages";
import { CATALOGUE, LIVE_LANGUAGES } from "../lib/teamPages/strings";
import { renderAccessNotice } from "../lib/mail/personTemplates";
import { en } from "../lib/teamPages/strings/en";

// SYC-53 PR 1.3: "My page" and "My colonies" (roles-and-invites.md §2.6,
// §6.2 note 1, §9.1, §9.5, §13.1). Home after the hand-off and after accept;
// Stop helping (recorded as `left` by `self`, ends the session at the next
// request, refused for the last manager); sign out everywhere; change
// language and the fall-back to English while Greek and French aren't live;
// the one sentence about yourself; My colonies shows only in-force
// placements; every POST is Origin-checked and safe to press twice.
//
// The order matters: the file's first manager is the ONLY management person
// until `second` is created (the last-manager tests run first).

const KEY = "vitest-my-key-0123456789abcdef-0123456789";
const handoffKey = makeKey();
type Who = PersonWithScopes & { cookie: string };

let sent: SentMail[];
let solo: Who; // the only management person, until `second` joins
let second: Who;
let vaporia: number;
let katoChora: number;

const NAV = { "Sec-Fetch-Mode": "navigate" };

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  sent = installFakeResend();
  vaporia = await colonyNamed("Vaporia — Eleni's");
  katoChora = await colonyNamed("Kato Chora");
  solo = await joined("my-solo", ["staff", "management"]);
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  await settleOutbox();
  await cleanUpPeople();
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  delete process.env["RESEND_API_KEY"];
});

async function colonyNamed(name: string): Promise<number> {
  const r = await pool.query<{ id: number }>(
    "insert into colonies (name, normalised_name) values ($1, lower($1)) returning id",
    [`${name}`],
  );
  return r.rows[0]!.id;
}

/** A cat guardian, placed on these colonies (the first through the usual route). */
async function guardian(label: string, colonies: number[]): Promise<Who> {
  const g = await joined(label, ["guardian"], colonies[0]);
  for (const c of colonies.slice(1)) {
    await pool.query(`insert into person_scopes (person_id, role, colony_id, reach) values ($1, 'guardian', $2, 'colony')`, [g.id, c]);
  }
  return g;
}

const get = (path: string, cookie: string) => request(app).get(path).set("Cookie", cookie).set(NAV);
const post = (path: string, cookie: string, body: Record<string, string> = {}, origin: string | null = TEAM_ORIGIN) => {
  const t = request(app).post(path).type("form").send(body).set("Cookie", cookie).set(NAV);
  return origin === null ? t : t.set("Origin", origin);
};

/** The "Yes" tap on the Are-you-sure page (SYC-520). */
const YES = { confirm: "1" };

/** Visible words only: no tags, no styles. */
const words = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

async function handoff(personId: string, sv: number) {
  return request(app)
    .post("/api/team/handoff")
    .set("Origin", "https://admin.catspotters.com")
    .type("form")
    .send({ token: mint(handoffKey, claimsFor(personId, { sv })) });
}

describe("the last manager is refused, plainly, and nothing changes", () => {
  it("Stop helping: a plain explanation, no `left` event, the session still works", async () => {
    const before = await eventKinds(solo.id);
    const res = await post("/api/team/my/stop-helping", solo.cookie);
    expect(res.status).toBe(409);
    expect(words(res.text)).toContain("You’re the last person in Syros Cats management, so you can’t stop helping yet");
    expect(words(res.text)).toContain("Nothing was changed.");
    expect((await personRow(solo.id)).left_at).toBeNull();
    expect(await eventKinds(solo.id)).toEqual(before);
    expect((await get("/api/team/my", solo.cookie)).status).toBe(200);
  });

  it("Sign out everywhere: the same, and the session version does not rise", async () => {
    const before = await personRow(solo.id);
    const kinds = await eventKinds(solo.id);
    const res = await post("/api/team/my/sign-out-everywhere", solo.cookie, YES);
    expect(res.status).toBe(409);
    expect(words(res.text)).toContain("You’re the last person in Syros Cats management, so you can’t be signed out everywhere");
    expect((await personRow(solo.id)).session_version).toBe(before.session_version);
    expect(await eventKinds(solo.id)).toEqual(kinds);
    expect((await get("/api/team/my", solo.cookie)).status).toBe(200);
  });
});

describe("home after the hand-off, and after accept", () => {
  beforeAll(async () => {
    second = await joined("my-second", ["staff", "management"]);
  });

  it("a guardian's home is My colonies; a team member's is Home", async () => {
    expect(TEAM_HOME).toBe("https://team.catspotters.com/api/team/home");
    const g = await guardian("my-home-g", [vaporia]);
    const t = await joined("my-home-t", ["staff"]);
    const gh = await handoff(g.id, 1);
    expect([gh.status, gh.headers["location"]]).toEqual([303, "https://team.catspotters.com/api/team/my/colonies"]);
    const th = await handoff(t.id, 1);
    expect([th.status, th.headers["location"]]).toEqual([303, TEAM_HOME]);
  });

  it("after accept: the same (a guardian to My colonies, the team to Home)", async () => {
    const g = await invited(second, "my-acc-g", [{ role: "guardian", colonyId: vaporia }]);
    const t = await invited(second, "my-acc-t", [{ role: "staff" }]);
    const ga = await post("/api/team/my/accept", inviteCookieFor(g.id, 1));
    expect(ga.headers["location"]).toBe("https://team.catspotters.com/api/team/my/colonies");
    const ta = await post("/api/team/my/accept", inviteCookieFor(t.id, 1));
    expect(ta.headers["location"]).toBe(TEAM_HOME);
  });
});

describe("Stop helping", () => {
  it("is a second page first (no change), worded as her own choice and not management's", async () => {
    const g = await guardian("my-stop-page", [vaporia]);
    const my = await get("/api/team/my", g.cookie);
    expect(my.text).toContain('href="/api/team/my/stop-helping"');
    expect(words(my.text)).toContain("Stop helping");
    expect(words(my.text)).not.toMatch(/mark(ed)? as left/i);
    const confirm = await get("/api/team/my/stop-helping", g.cookie);
    expect(confirm.status).toBe(200);
    expect(words(confirm.text)).toContain("Stop helping Syros Cats?");
    expect(confirm.text).toContain('<form method="post" action="/api/team/my/stop-helping">');
    expect((await personRow(g.id)).left_at).toBeNull();
  });

  it("writes `left` by `self`, ends the session at the next request; pressing again is harmless", async () => {
    const g = await guardian("my-stop", [vaporia]);
    const res = await post("/api/team/my/stop-helping", g.cookie);
    expect(res.status).toBe(200);
    expect(words(res.text)).toContain("Thank you for helping");
    const row = await personRow(g.id);
    expect(row.left_at).not.toBeNull();
    const ev = (await pool.query(`select "by", kind from person_events where person_id = $1 and kind = 'left'`, [g.id])).rows;
    expect(ev).toEqual([{ by: "self", kind: "left" }]);
    expect((await pool.query(`select left_by from people where id = $1`, [g.id])).rows[0].left_by).toBe("self");
    // The old cookie: refused at the next request, on every page.
    for (const path of ["/api/team/my", "/api/team/my/colonies", "/api/team/my/stop-helping"]) {
      const r = await request(app).get(path).set("Cookie", g.cookie);
      expect([path, r.status]).toEqual([path, 401]);
    }
    // Pressing it again: the sign-in 401, and nothing more is written.
    const again = await post("/api/team/my/stop-helping", g.cookie);
    expect(again.status).toBe(401);
    expect((await eventKinds(g.id)).filter((k) => k === "left")).toHaveLength(1);
  });

  it("two presses at the same moment: one `left`, neither a 500", async () => {
    const g = await guardian("my-stop-twice", [katoChora]);
    const [a, b] = await Promise.all([post("/api/team/my/stop-helping", g.cookie), post("/api/team/my/stop-helping", g.cookie)]);
    expect([a.status, b.status].every((s) => s === 200 || s === 401)).toBe(true);
    expect((await eventKinds(g.id)).filter((k) => k === "left")).toHaveLength(1);
  });

  it("a person who holds nothing any more can still stop helping (any accepted person)", async () => {
    const g = await guardian("my-stop-ended", [vaporia]);
    await endPlacements(g.id);
    expect((await get("/api/team/my", g.cookie)).status).toBe(200);
    expect(words((await get("/api/team/my", g.cookie)).text)).toContain("You aren’t helping with a colony or with the team right now.");
    expect((await post("/api/team/my/stop-helping", g.cookie)).status).toBe(200);
    expect((await personRow(g.id)).left_at).not.toBeNull();
  });

  it("management can stop helping while another manager remains", async () => {
    const m = await joined("my-stop-mgr", ["staff", "management"]);
    expect((await post("/api/team/my/stop-helping", m.cookie)).status).toBe(200);
    const ev = (await pool.query(`select "by" from person_events where person_id = $1 and kind = 'left'`, [m.id])).rows;
    expect(ev).toEqual([{ by: "self" }]);
  });
});

describe("Sign out everywhere (yourself)", () => {
  it("SYC-520: a form post asks 'Are you sure?' first and changes nothing", async () => {
    const t = await joined("my-soe-ask", ["staff"]);
    const before = (await personRow(t.id)).session_version;
    const res = await post("/api/team/my/sign-out-everywhere", t.cookie);
    expect(res.status).toBe(200);
    expect(words(res.text)).toContain("Sign out everywhere?");
    expect(res.text).toContain('name="confirm" value="1"');
    expect((await personRow(t.id)).session_version).toBe(before);
    expect((await request(app).get("/api/team/my").set("Cookie", t.cookie)).status).toBe(200);
  });

  it("raises the session version, writes its event, and the old cookie is refused at the next request", async () => {
    const t = await joined("my-soe", ["staff"]);
    const before = (await personRow(t.id)).session_version;
    const res = await post("/api/team/my/sign-out-everywhere", t.cookie, YES);
    expect([res.status, res.headers["location"]]).toEqual([303, "https://admin.catspotters.com/"]);
    expect((await personRow(t.id)).session_version).toBe(before + 1);
    const ev = (await pool.query(`select "by" from person_events where person_id = $1 and kind = 'signed_out_everywhere'`, [t.id])).rows;
    expect(ev).toEqual([{ by: t.id }]);
    expect((await request(app).get("/api/team/my").set("Cookie", t.cookie)).status).toBe(401);
    // Pressing it again with the dead cookie: refused, nothing more written.
    expect((await post("/api/team/my/sign-out-everywhere", t.cookie, YES)).status).toBe(401);
    expect((await pool.query(`select count(*)::int n from person_events where person_id = $1 and kind = 'signed_out_everywhere'`, [t.id])).rows[0].n).toBe(1);
  });
});

describe("change language", () => {
  it("saves people.language; the page stays English while Greek isn't live, and says so plainly", async () => {
    const g = await guardian("my-lang", [vaporia]);
    const res = await post("/api/team/my/language", g.cookie, { language: "el" });
    expect([res.status, res.headers["location"]]).toEqual([303, "/api/team/my?saved=language"]);
    expect((await pool.query(`select language from people where id = $1`, [g.id])).rows[0].language).toBe("el");
    const page = await get("/api/team/my?saved=language", g.cookie);
    expect(page.text).toContain('<html lang="en">');
    expect(words(page.text)).toContain("Saved.");
    expect(words(page.text)).toContain("Greek isn’t ready on the dashboard yet, so pages are in English for now.");
    expect(page.text).toContain('<option value="el" selected>Ελληνικά</option>');
    // Pressing it twice is harmless.
    expect((await post("/api/team/my/language", g.cookie, { language: "el" })).status).toBe(303);
  });

  it("refuses a language we don't have, and changes nothing", async () => {
    const g = await guardian("my-lang-bad", [vaporia]);
    const res = await post("/api/team/my/language", g.cookie, { language: "de" });
    expect(res.status).toBe(400);
    expect(words(res.text)).toContain("That isn’t a language we have.");
    expect((await pool.query(`select language from people where id = $1`, [g.id])).rows[0].language).toBe("en");
  });

  it("with Greek (or French) made live in a test, the page is in it and says so in <html lang>", () => {
    const person = { name: "Eleni", language: "el", team: false, management: false, placements: [] };
    const el = renderMyPage({ person }, ["en", "el"]);
    expect(el).toContain('<html lang="el">');
    expect(el).toContain("Η σελίδα μου");
    expect(el).not.toContain("isn’t ready");
    const fr = renderMyColoniesPage({ person: { ...person, language: "fr" } }, ["en", "fr"]);
    expect(fr).toContain('<html lang="fr">');
    expect(fr).toContain("Mes colonies");
    // Greek chosen but not live: English, <html lang="en">.
    expect(renderMyPage({ person }, ["en"])).toContain('<html lang="en">');
  });
});

describe("the one sentence about yourself (§2.6)", () => {
  it("a guardian with one colony", async () => {
    const g = await guardian("my-s1", [vaporia]);
    const page = await get("/api/team/my", g.cookie);
    expect(words(page.text)).toContain("You’re a cat guardian for Vaporia — Eleni's.");
    expect(page.text).toContain("Eleni&#39;s");
  });

  it("a guardian with two colonies", async () => {
    const g = await guardian("my-s2", [vaporia, katoChora]);
    expect(words((await get("/api/team/my", g.cookie)).text)).toContain("You’re a cat guardian for Kato Chora and Vaporia — Eleni's.");
  });

  it("the team, and management as well as the team", async () => {
    const t = await joined("my-s3", ["staff"]);
    expect(words((await get("/api/team/my", t.cookie)).text)).toContain("You’re on the Syros Cats team.");
    expect(words((await get("/api/team/my", solo.cookie)).text)).toContain("You’re in Syros Cats management and on the team.");
  });

  it("never says role, scope or capability, in any language, on the pages or in the new words", async () => {
    const g = await guardian("my-s4", [vaporia]);
    for (const path of ["/api/team/my", "/api/team/my/colonies", "/api/team/my/stop-helping"]) {
      expect(words((await get(path, g.cookie)).text), path).not.toMatch(/\b(role|scope|capabilit)/i);
    }
    for (const lang of ["en", "el", "fr"] as const) {
      for (const [k, v] of Object.entries(CATALOGUE[lang])) {
        if (k.startsWith("my.") || k.startsWith("mycol.")) expect(v, `${lang} ${k}`).not.toMatch(/\b(role|scope|capabilit)/i);
      }
    }
  });

  it("escapes colony names", async () => {
    const evil = await colonyNamed("<script>alert(1)</script>");
    const g = await guardian("my-s5", [evil]);
    for (const path of ["/api/team/my", "/api/team/my/colonies"]) {
      const text = (await get(path, g.cookie)).text;
      expect(text, path).not.toContain("<script>alert(1)");
      expect(text, path).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    }
  });

  it("in Greek and French once live (the sentence is built from the catalogue)", () => {
    const who = { team: false, management: false, placements: [{ colonyId: 1, name: "Βαπόρια", relationship: null, expiresAt: null }] };
    expect(aboutYou("el", who, ["en", "el"])).toBe("Είστε κηδεμόνας γατών για Βαπόρια.");
    expect(aboutYou("fr", who, ["en", "fr"])).toBe("Tu es gardien(ne) de chats pour Βαπόρια.");
    expect(aboutYou("el", who, LIVE_LANGUAGES)).toBe("You’re a cat guardian for Βαπόρια.");
  });
});

describe("My colonies", () => {
  it("shows only her in-force placements, with the label and the end date (Athens, her language)", async () => {
    const g = await guardian("my-c1", [vaporia, katoChora]);
    const ended = await colonyNamed("Ended Place");
    const open = await colonyNamed("Open Place");
    await pool.query(
      `insert into person_scopes (person_id, role, colony_id, reach, expires_at) values ($1, 'guardian', $2, 'colony', now() - interval '1 second')`,
      [g.id, ended],
    );
    await pool.query(`insert into person_scopes (person_id, role, colony_id, reach) values ($1, 'guardian', $2, 'colony')`, [g.id, open]);
    await pool.query(`update person_scopes set relationship = 'feeds', expires_at = $3 where person_id = $1 and colony_id = $2`, [g.id, vaporia, placementEndsAt("2027-06-30")]);
    const page = await get("/api/team/my/colonies", g.cookie);
    expect(page.status).toBe(200);
    const text = words(page.text);
    expect(text).toContain("Vaporia — Eleni's");
    expect(text).toContain("You feed here");
    expect(text).toContain("Until 30 June 2027");
    expect(text).toContain("Kato Chora");
    expect(text).toContain("Open Place");
    expect(text).not.toContain("Ended Place");
    // The shell's reading wrapper is div.readcol; the page's own .col cards are still drawn (SYC-619 §2.4).
    expect(page.text).toMatch(/<main[^>]*><div class="readcol">/);
    expect(page.text).toContain(".col{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--accent)");
    expect(page.text).toContain('<div class="col"><strong>');
    expect(page.text).not.toMatch(/<div class="readcol"[^>]*><strong>/);
    // A guardian sees her own two links, and none of the team's menu.
    expect(page.text).toContain('href="/api/team/my/colonies"');
    expect(page.text).toContain('href="/api/team/my"');
    expect(page.text).not.toContain("Welfare queue");
  });

  it("someone whose every placement has ended is told she has none", async () => {
    const g = await guardian("my-c2", [vaporia]);
    await endPlacements(g.id);
    expect(words((await get("/api/team/my/colonies", g.cookie)).text)).toContain("You aren’t looking after a colony right now.");
  });

  it("the team sees a short line and a link to the island-wide pages, not a list", async () => {
    const t = await joined("my-c3", ["staff"]);
    await pool.query(`insert into person_scopes (person_id, role, colony_id, reach) values ($1, 'guardian', $2, 'colony')`, [t.id, vaporia]);
    const page = await get("/api/team/my/colonies", t.cookie);
    expect(words(page.text)).toContain("so you can see every colony on the island");
    expect(page.text).toContain('href="/api/team/colonies"');
    expect(words(page.text)).not.toContain("Vaporia");
  });

  it("the My page link is in the bar for everyone signed in", async () => {
    const t = await joined("my-c4", ["staff"]);
    const queue = await request(app).get("/api/team").set("Cookie", t.cookie).set(NAV);
    expect(queue.text).toContain('<a href="/api/team/my">My page</a>');
    const people = await request(app).get("/api/team/people").set("Cookie", solo.cookie).set(NAV);
    expect(people.text).toContain('<a href="/api/team/my">My page</a>');
  });
});

describe("every POST is Origin-checked (a missing Origin too) and changes nothing when refused", () => {
  it("language, sign out everywhere, stop helping", async () => {
    const g = await guardian("my-origin", [vaporia]);
    const sv = (await personRow(g.id)).session_version;
    for (const path of ["/api/team/my/language", "/api/team/my/sign-out-everywhere", "/api/team/my/stop-helping"]) {
      for (const origin of [null, "https://evil.example", "https://admin.catspotters.com", "null"]) {
        const res = await post(path, g.cookie, { language: "fr" }, origin);
        expect([path, origin, res.status, res.text.includes("Please sign in again")]).toEqual([path, origin, 401, true]);
      }
    }
    const row = await personRow(g.id);
    expect([row.left_at, row.session_version]).toEqual([null, sv]);
    expect((await pool.query(`select language from people where id = $1`, [g.id])).rows[0].language).toBe("en");
    expect(await eventKinds(g.id)).toEqual(["added"]);
  });

  it("a pending cookie and a left person reach none of these", async () => {
    const p = await invited(second, "my-pending", [{ role: "staff" }]);
    const pend = `${SESSION_COOKIE}=${inviteCookieFor(p.id, 1).split("=")[1]}`;
    for (const cookie of [inviteCookieFor(p.id, 1), pend]) {
      expect((await get("/api/team/my", cookie)).status).toBe(401);
      expect((await post("/api/team/my/stop-helping", cookie)).status).toBe(401);
    }
    const gone = await joined("my-gone", ["staff"]);
    await markLeftById(second.id, gone.id);
    expect((await get("/api/team/my", gone.cookie)).status).toBe(401);
  });
});

// ── Samuel, 15 Oct 2026: the team and management tell the other managers when
// they remove themselves; a cat guardian's own actions email nobody. ──

const NOTICE_SUBJECT = en["mail.notice.subject"];

/** Notices sent since the last call, as who they went to. */
async function notices(): Promise<SentMail[]> {
  await settleOutbox();
  const out = sent.filter((m) => m.subject === NOTICE_SUBJECT);
  sent.length = 0;
  return out;
}

describe("stopping helping, and signing yourself out: who is told", () => {
  beforeEach(async () => {
    await settleOutbox();
    sent.length = 0;
  });

  it("a team member stopping helping emails every other manager, not themselves, in its own words", async () => {
    const t = await joined("my-n-team", ["staff"]);
    const expected = await otherManagerEmails(t.id);
    expect(expected.length).toBeGreaterThanOrEqual(2);
    expect((await post("/api/team/my/stop-helping", t.cookie)).status).toBe(200);
    const mails = await notices();
    expect(mails.map((m) => m.to).sort()).toEqual(expected);
    expect(mails.map((m) => m.to)).not.toContain(t.email);
    for (const m of mails) {
      expect(m.text).toContain("Vt my-n-team stopped helping Syros Cats.");
      expect(m.text).not.toMatch(/marked/);
    }
  });

  it("a manager doing so: the same", async () => {
    const m = await joined("my-n-mgr", ["staff", "management"]);
    const expected = await otherManagerEmails(m.id);
    expect((await post("/api/team/my/stop-helping", m.cookie)).status).toBe(200);
    const mails = await notices();
    expect(mails.map((x) => x.to).sort()).toEqual(expected);
    expect(mails.map((x) => x.to)).not.toContain(m.email);
    expect(mails[0]!.text).toContain("Vt my-n-mgr stopped helping Syros Cats.");
  });

  it("a cat guardian stopping helping emails nobody", async () => {
    const g = await guardian("my-n-g1", [vaporia]);
    expect((await post("/api/team/my/stop-helping", g.cookie)).status).toBe(200);
    expect(await notices()).toEqual([]);
    expect((await pool.query(`select count(*)::int n from mail_outbox where purpose = 'access_change_notice' and payload->>'subjectId' = $1`, [g.id])).rows[0].n).toBe(0);
  });

  it("a cat guardian's own sign-out everywhere emails nobody", async () => {
    const g = await guardian("my-n-g2", [vaporia]);
    expect((await post("/api/team/my/sign-out-everywhere", g.cookie, YES)).status).toBe(303);
    expect(await notices()).toEqual([]);
  });

  it("a team member's own sign-out everywhere emails the managers", async () => {
    const t = await joined("my-n-team2", ["staff"]);
    const expected = await otherManagerEmails(t.id);
    expect((await post("/api/team/my/sign-out-everywhere", t.cookie, YES)).status).toBe(303);
    const mails = await notices();
    expect(mails.map((m) => m.to).sort()).toEqual(expected);
    for (const m of mails) {
      expect(m.text).toContain("Vt my-n-team2 signed out on all their phones and computers.");
      expect(m.text.split("Vt my-n-team2")).toHaveLength(2); // the name once, never twice
    }
  });

  it("the notice names the person and says they stopped; nothing typed reaches it (three languages, same kind)", () => {
    const base = { actorName: "Susan", subjectName: "Susan", change: { kind: "left_self", withdrawn: 0 } as const, colonyNames: new Map<number, string>() };
    const mail = renderAccessNotice({ ...base, language: "en" });
    expect(mail.text.split("\n\n")[0]).toBe("Susan stopped helping Syros Cats.");
    expect(mail.text).not.toMatch(/marked/);
    expect(renderAccessNotice({ ...base, language: "el" }, ["en", "el"]).text).toContain("Susan σταμάτησε να βοηθάει");
    expect(renderAccessNotice({ ...base, language: "fr" }, ["en", "fr"]).text).toContain("Susan a arrêté d’aider Syros Cats.");
    // A hostile name is defanged like every other notice.
    const evil = renderAccessNotice({ ...base, subjectName: "x https://evil.example" , language: "en" });
    expect(evil.text).not.toContain("https://evil.example");
  });
});

describe("minor 3: sign out everywhere answers a form post with a page redirect, not a blank 204", () => {
  it("a form POST without Sec-Fetch-Mode gets the 303 to sign-in; a plain JSON POST gets 204", async () => {
    const a = await joined("my-m3a", ["staff"]);
    const form = await request(app).post("/api/team/my/sign-out-everywhere").type("form").send(YES).set("Cookie", a.cookie).set("Origin", TEAM_ORIGIN);
    expect([form.status, form.headers["location"]]).toEqual([303, "https://admin.catspotters.com/"]);
    const b = await joined("my-m3b", ["staff"]);
    const json = await request(app).post("/api/team/my/sign-out-everywhere").send({}).set("Cookie", b.cookie).set("Origin", TEAM_ORIGIN);
    expect(json.status).toBe(204);
  });
});
