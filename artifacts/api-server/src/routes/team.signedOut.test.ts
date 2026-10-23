import { createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { addPerson, db, feedingSitesTable, heldTypingTable, markLeft, pool, signOutEverywhere } from "@workspace/db";
import app from "../app";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";
import { clearWelfareTables, seedReport, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { NOT_SIGNED_IN_PAGE, TEAM_CSP } from "../lib/teamAuth/refuse";
import { SESSION_COOKIE } from "../lib/teamAuth/session";
import { SIGN_IN_PAGE } from "../lib/teamAuth/config";
import { removeTestPerson } from "../test/removeTestPerson";
import { newColony, seedCat } from "../test/roleKit";
import { HELD_COOKIE, deleteStaleHeldTyping, opportunisticHeldTypingTidy } from "../lib/teamAuth/heldTyping";

// SYC-516 C2 (spec §3.2): a browser form post that came from the dashboard
// but whose sign-in has lapsed gets a "signed out" page in the dashboard's
// look, never the instant jump. Every other refusal is today's, byte for byte.
// C3: what they typed is kept on the server for that same person, and given
// back after they sign in again.

const SUSAN = "vitest-signedout-susan@example.com";
const MARIA = "vitest-signedout-maria@example.com";
const GINA = "vitest-signedout-gina@example.com";
const LEFT = "vitest-signedout-left@example.com";
const KEY = "vitest-signedout-key-0123456789abcdef-0123456789";
const handoffKey = makeKey();
let susanId: string;
let mariaId: string;
let ginaId: string;
let colonyId: number;

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
  for (const e of [SUSAN, MARIA, GINA, LEFT]) await removeTestPerson(e);
  susanId = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest" })).id;
  mariaId = (await addPerson({ email: MARIA, name: "Maria", addedBy: "cli:vitest" })).id;
  colonyId = await newColony("signedout");
  ginaId = (await addPerson({ email: GINA, name: "Gina", addedBy: "cli:vitest", roles: ["guardian"], colonyId })).id;
});

beforeEach(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
  await db.delete(heldTypingTable);
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await clearWelfareTables();
  for (const e of [SUSAN, MARIA, GINA, LEFT]) await removeTestPerson(e);
  await pool.end();
});

const nowS = () => Math.floor(Date.now() / 1000);
const heldRows = () => db.select().from(heldTypingTable);

/** A genuine team cookie, signed by hand with a chosen expiry. */
function cookieWithExp(pid: string, sv: number, exp: number, key = KEY): string {
  const body = Buffer.from(JSON.stringify({ pid, sv, exp })).toString("base64url");
  const mac = createHmac("sha256", Buffer.from(key)).update(body).digest("base64url");
  return `${SESSION_COOKIE}=${body}.${mac}`;
}

function notePost(publicId: string, opts: { origin?: string | null; cookie?: string; browser?: boolean; json?: boolean } = {}) {
  const t = request(app).post(`/api/team/reports/${publicId}/note`);
  if (opts.origin !== null) t.set("Origin", opts.origin ?? TEAM_ORIGIN);
  if (opts.cookie) t.set("Cookie", opts.cookie);
  if (opts.browser !== false) t.set("Sec-Fetch-Mode", "navigate");
  if (opts.json) return t.send({ note: "Fed her at six" });
  return t.type("form").send({ note: "Fed her at six" });
}

describe("C2: who gets the signed-out page", () => {
  it("Review Focus 1: a post from another site after the sign-in lapses gets today's exact 401 body", async () => {
    const { publicId } = await seedReport();
    const expired = cookieWithExp(susanId, 1, nowS() - 3600);
    for (const origin of ["https://evil.example", null, "https://admin.catspotters.com"]) {
      for (const cookie of [undefined, expired]) {
        const res = await notePost(publicId, { origin, cookie });
        expect(res.status, String(origin)).toBe(401);
        expect(res.text, String(origin)).toBe(NOT_SIGNED_IN_PAGE);
        expect(res.text).not.toContain("Fed her at six");
        expect(res.headers["set-cookie"]).toBeUndefined();
      }
    }
    expect(await heldRows()).toEqual([]);
  });

  it("a dashboard form post with no session at all: the signed-out page, in the dashboard's look, no jump", async () => {
    const { publicId } = await seedReport();
    const res = await notePost(publicId);
    expect(res.status).toBe(401);
    expect(res.headers["content-security-policy"]).toBe(TEAM_CSP);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).toContain("You were signed out, so this wasn&#39;t saved.");
    expect(res.text).toContain(`href="${SIGN_IN_PAGE}"`);
    expect(res.text).toContain("Sign in again");
    expect(res.text).not.toMatch(/http-equiv="refresh"/i);
    expect(res.text).not.toContain("<script");
  });

  it("a dashboard form post with an expired cookie: the signed-out page", async () => {
    const { publicId } = await seedReport();
    const res = await notePost(publicId, { cookie: cookieWithExp(susanId, 1, nowS() - 3600) });
    expect(res.status).toBe(401);
    expect(res.text).toContain("You were signed out, so this wasn&#39;t saved.");
  });

  it("the invite pages' 401 is unchanged: a dashboard form post to accept or decline with no session", async () => {
    for (const path of ["/api/team/my/accept", "/api/team/my/decline"]) {
      for (const cookie of [undefined, expiredFor(susanId)]) {
        const t = request(app).post(path).set("Origin", TEAM_ORIGIN).set("Sec-Fetch-Mode", "navigate").type("form");
        if (cookie) t.set("Cookie", cookie);
        const res = await t.send({ note: "not kept" });
        expect([path, res.status, res.text]).toEqual([path, 401, NOT_SIGNED_IN_PAGE]);
        expect(res.headers["set-cookie"]).toBeUndefined();
      }
    }
    expect(await heldRows()).toEqual([]);
  });

  it("everything else keeps today's answer byte for byte", async () => {
    const { publicId } = await seedReport();
    // A data call (not a browser page).
    const data = await notePost(publicId, { browser: false });
    expect([data.status, data.text]).toEqual([401, '{"error":"not_signed_in"}']);
    // A browser page whose body isn't a form.
    const json = await notePost(publicId, { json: true });
    expect([json.status, json.text]).toEqual([401, NOT_SIGNED_IN_PAGE]);
    // Simply opening a page while signed out keeps its instant jump.
    const page = await request(app).get("/api/team").set("Sec-Fetch-Mode", "navigate");
    expect([page.status, page.text]).toEqual([401, NOT_SIGNED_IN_PAGE]);
    const pageExpired = await request(app)
      .get("/api/team")
      .set("Sec-Fetch-Mode", "navigate")
      .set("Cookie", cookieWithExp(susanId, 1, nowS() - 3600));
    expect([pageExpired.status, pageExpired.text]).toEqual([401, NOT_SIGNED_IN_PAGE]);
    // The sign-in hand-over itself.
    const handoff = await request(app)
      .post("/api/team/handoff")
      .set("Origin", TEAM_ORIGIN)
      .set("Sec-Fetch-Mode", "navigate")
      .type("form")
      .send({ token: "nope" });
    expect([handoff.status, handoff.text]).toEqual([401, NOT_SIGNED_IN_PAGE]);
  });
});

// ── C3: keep, return and clear ────────────────────────────────────────────

const HOUR_AGO = () => nowS() - 3600;
const expiredFor = (pid: string, sv = 1) => cookieWithExp(pid, sv, HOUR_AGO());

/** A signed-out browser form save from the dashboard; the response. */
function save(path: string, body: Record<string, string>, cookie?: string) {
  const t = request(app).post(path).set("Origin", TEAM_ORIGIN).set("Sec-Fetch-Mode", "navigate");
  if (cookie) t.set("Cookie", cookie);
  return t.type("form").send(body);
}

/** The held cookie pair a response set, or undefined. */
function heldCookieOf(res: request.Response): string | undefined {
  const all = (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
  return all.find((c) => c.startsWith(`${HELD_COOKIE}=`) && !c.startsWith(`${HELD_COOKIE}=;`));
}

/** The real hand-off, from a browser carrying `cookie`. */
function handoff(personId: string, cookie?: string, sv = 1) {
  const t = request(app).post("/api/team/handoff").set("Origin", "https://admin.catspotters.com");
  if (cookie) t.set("Cookie", cookie);
  return t.type("form").send({ token: mint(handoffKey, claimsFor(personId, { sv })) });
}

const teamCookieOf = (res: request.Response) =>
  ((res.headers["set-cookie"] as unknown as string[]) ?? []).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0]!;

/** Keep as `pid`, sign in again as `who`, follow the 303; the landing page's HTML. */
async function keepAndReturn(path: string, body: Record<string, string>, pid = susanId) {
  const kept = await save(path, body, expiredFor(pid));
  expect(kept.status, kept.text.slice(0, 200)).toBe(401);
  const held = heldCookieOf(kept);
  expect(held, "a held cookie").toBeDefined();
  const back = await handoff(pid, held!.split(";")[0]!);
  expect(back.status).toBe(303);
  const location = String(back.headers["location"]);
  expect(location.startsWith(`${TEAM_ORIGIN}/api/team`)).toBe(true);
  const page = await request(app)
    .get(location.slice(TEAM_ORIGIN.length))
    .set("Cookie", teamCookieOf(back))
    .set("Sec-Fetch-Mode", "navigate");
  expect(page.status, page.text.slice(0, 300)).toBe(200);
  return { location, html: page.text, teamCookie: teamCookieOf(back) };
}

/**
 * Someone who leaves a record (a statement, a site opened) can't be removed,
 * only marked left, so such tests use a person of this run only (the run's
 * database is thrown away afterwards).
 */
const runPerson = async () =>
  (await addPerson({ email: `vitest-signedout-run-${randomBytes(4).toString("hex")}@example.com`, name: "Wren", addedBy: "cli:vitest" })).id;

const COME_BACK =
  "You were signed out, so this wasn&#39;t saved. Sign in again and you&#39;ll come back to this page.";

const STATUS_LINE =
  '<p class="notice" role="status">You were signed out before this was saved. We kept what you typed. Check it and press Save.</p>';

describe("C3: keep what was typed", () => {
  it("a signed-out note save with a genuine cookie expired an hour ago: the kept page, one row, the cookie", async () => {
    const { publicId } = await seedReport();
    const res = await save(`/api/team/reports/${publicId}/note`, { note: "Fed her at six" }, expiredFor(susanId));
    expect(res.status).toBe(401);
    expect(res.text).toContain(
      "You were signed out, so this wasn&#39;t saved. We&#39;ve kept what you typed for 30 minutes. Sign in again to carry on.",
    );
    expect(res.text).toContain(`href="${SIGN_IN_PAGE}"`);
    // Kept, so not shown back on this page.
    expect(res.text).not.toContain("Fed her at six");
    expect(res.text).not.toMatch(/http-equiv="refresh"/i);
    const rows = await heldRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      personId: susanId,
      sessionVersion: 1,
      formKey: `note:${publicId}`,
      landingPath: `/api/team?open=${publicId}`,
      fields: { note: "Fed her at six" },
      claimedAt: null,
    });
    const held = heldCookieOf(res)!;
    expect(held.startsWith(`${HELD_COOKIE}=${rows[0]!.id};`)).toBe(true);
    expect(held).toMatch(/; Max-Age=1800(;|$)/);
    expect(held).toMatch(/; Path=\/(;|$)/);
    expect(held).toMatch(/; HttpOnly(;|$)/);
    expect(held).toMatch(/; Secure(;|$)/);
    expect(held).toMatch(/; SameSite=Lax(;|$)/);
    expect(held).not.toMatch(/Domain=/i);
  });

  it("a second save replaces the first: one row per person", async () => {
    const { publicId } = await seedReport();
    await save(`/api/team/reports/${publicId}/note`, { note: "first" }, expiredFor(susanId));
    await save(`/api/team/reports/${publicId}/note`, { note: "second" }, expiredFor(susanId));
    const rows = await heldRows();
    expect(rows.map((r) => r.fields)).toEqual([{ note: "second" }]);
  });

  it("each value is cut to 4,000 characters, and CRLF becomes LF", async () => {
    const { publicId } = await seedReport();
    await save(`/api/team/reports/${publicId}/note`, { note: `a\r\nb${"x".repeat(5000)}` }, expiredFor(susanId));
    const [row] = await heldRows();
    expect(row!.fields["note"]!.length).toBe(4000);
    expect(row!.fields["note"]!.startsWith("a\nb")).toBe(true);
  });

  it("an empty box keeps no text, only the way back to the report (final review, fix 2)", async () => {
    const { publicId } = await seedReport();
    const res = await save(`/api/team/reports/${publicId}/note`, { note: "   " }, expiredFor(susanId));
    expect(res.status).toBe(401);
    expect(res.text).toContain(COME_BACK);
    expect(res.text).not.toContain("kept what you typed");
    expect(res.text).not.toContain("<textarea");
    const rows = await heldRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fields: {}, landingPath: `/api/team?open=${publicId}`, formKey: `land:note:${publicId}` });
    expect(heldCookieOf(res)).toBeDefined();
  });

  it("the hand-off for the same person lands on that report with the note filled in; the row is gone after", async () => {
    const { publicId } = await seedReport();
    const { location, html, teamCookie } = await keepAndReturn(`/api/team/reports/${publicId}/note`, { note: "Fed <her> at six" });
    const [row] = await db.select({ id: heldTypingTable.id }).from(heldTypingTable);
    expect(row).toBeUndefined();
    // Final review, fix 3: the opened row is scrolled into view.
    expect(location).toMatch(new RegExp(`^${TEAM_ORIGIN}/api/team\\?open=${publicId}&kept=[0-9a-f-]{36}#r-${publicId}$`));
    expect(html).toContain(STATUS_LINE);
    expect(html).toContain(`<details class="notebox" open>`);
    expect(html).toContain(`name="note" rows="3" maxlength="2000">\nFed &lt;her&gt; at six</textarea>`);
    // Used once: the same address again draws the normal page.
    const again = await request(app).get(location.slice(TEAM_ORIGIN.length)).set("Cookie", teamCookie);
    expect(again.status).toBe(200);
    expect(again.text).not.toContain("We kept what you typed");
    expect(again.text).not.toContain("Fed &lt;her&gt; at six");
  });

  it("the hand-off clears the held cookie, and nothing kept means the usual home", async () => {
    const plain = await handoff(susanId);
    expect(plain.headers["location"]).toBe("https://team.catspotters.com/api/team/home");
    expect((plain.headers["set-cookie"] as unknown as string[]).length).toBe(1);
    const { publicId } = await seedReport();
    const kept = await save(`/api/team/reports/${publicId}/note`, { note: "x" }, expiredFor(susanId));
    const back = await handoff(susanId, heldCookieOf(kept)!.split(";")[0]!);
    const cleared = (back.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith(`${HELD_COOKIE}=;`));
    expect(cleared).toBeDefined();
  });

  it("Review Focus 2: a different person signs in on the same browser: their normal home, and the row is deleted", async () => {
    const { publicId } = await seedReport();
    const kept = await save(`/api/team/reports/${publicId}/note`, { note: "Susan's words" }, expiredFor(susanId));
    expect(await heldRows()).toHaveLength(1);
    const back = await handoff(mariaId, heldCookieOf(kept)!.split(";")[0]!);
    expect(back.status).toBe(303);
    expect(back.headers["location"]).toBe("https://team.catspotters.com/api/team/home");
    expect(await heldRows()).toEqual([]);
    const page = await request(app).get(`/api/team?open=${publicId}`).set("Cookie", teamCookieOf(back));
    expect(page.text).not.toContain("Susan&#39;s words");
  });

  it("a posted lat, lng or from is never kept or shown back", async () => {
    const colony = await newColony("latlng");
    const body = { name: "Harbour", notes: "By the steps", lat: "37.4417361", lng: "24.9418777", from: "looking" };
    await save(`/api/team/colonies/${colony}`, body, expiredFor(susanId));
    const [row] = await heldRows();
    expect(row!.fields).toEqual({ name: "Harbour", notes: "By the steps" });
    expect(JSON.stringify(row)).not.toContain("37.4417361");
    // With nobody to keep it for, it is shown back, without them.
    const { publicId } = await seedReport();
    for (const [path, b] of [
      [`/api/team/colonies/${colony}`, body],
      [`/api/team/reports/${publicId}/note`, { note: "Thin", lat: "37.4417361", lng: "24.9418777", from: "looking" }],
    ] as const) {
      const res = await save(path, b);
      expect(res.status).toBe(401);
      expect(res.text).toContain("readonly");
      expect(res.text).not.toContain("37.4417361");
      expect(res.text).not.toContain("24.9418777");
      expect(res.text).not.toContain("looking");
    }
  });

  it("a row 31 minutes old is not given back, and is deleted", async () => {
    const { publicId } = await seedReport();
    const kept = await save(`/api/team/reports/${publicId}/note`, { note: "old" }, expiredFor(susanId));
    await db.update(heldTypingTable).set({ createdAt: new Date(Date.now() - 31 * 60_000) });
    const back = await handoff(susanId, heldCookieOf(kept)!.split(";")[0]!);
    expect(back.headers["location"]).toBe("https://team.catspotters.com/api/team/home");
    expect(await heldRows()).toEqual([]);
  });

  it("someone signed out everywhere since, or gone: nothing kept, the words shown back to copy", async () => {
    const left = await addPerson({ email: LEFT, name: "Lefty", addedBy: "cli:vitest" });
    await markLeft(LEFT, "cli:vitest");
    await signOutEverywhere(SUSAN, "cli:vitest"); // Susan is now at version 2
    const { publicId } = await seedReport();
    for (const cookie of [expiredFor(susanId, 1), expiredFor(left.id, 1)]) {
      const res = await save(`/api/team/reports/${publicId}/note`, { note: "Copy <me>" }, cookie);
      expect(res.status).toBe(401);
      expect(res.text).toContain("You were signed out, so this wasn&#39;t saved.");
      expect(res.text).not.toContain("kept what you typed");
      expect(res.text).toContain('<textarea id="typed-0" readonly rows="4">Copy &lt;me&gt;</textarea>');
      expect(heldCookieOf(res)).toBeUndefined();
    }
    expect(await heldRows()).toEqual([]);
    // Signed in again at the new version, the next save is kept as usual.
    const ok = await save(`/api/team/reports/${publicId}/note`, { note: "kept" }, expiredFor(susanId, 2));
    expect(ok.text).toContain("kept what you typed");
    await db.delete(heldTypingTable);
    // Put Susan back at version 1 for the other tests.
    await pool.query("update people set session_version = 1 where id = $1", [susanId]);
  });

  it("a cat guardian whose landing is a team page: her own home, and the row is deleted", async () => {
    const { publicId } = await seedReport();
    const kept = await save(`/api/team/reports/${publicId}/note`, { note: "hers" }, expiredFor(ginaId));
    expect(await heldRows()).toHaveLength(1);
    const back = await handoff(ginaId, heldCookieOf(kept)!.split(";")[0]!);
    expect(back.headers["location"]).toBe("https://team.catspotters.com/api/team/my/colonies");
    expect(await heldRows()).toEqual([]);
  });

  it("kept= with someone else's row id is ignored, and their row stays", async () => {
    const { publicId } = await seedReport();
    const kept = await save(`/api/team/reports/${publicId}/note`, { note: "Susan only" }, expiredFor(susanId));
    const susanBack = await handoff(susanId, heldCookieOf(kept)!.split(";")[0]!);
    const location = String(susanBack.headers["location"]);
    const mariaIn = await handoff(mariaId);
    const page = await request(app).get(location.slice(TEAM_ORIGIN.length)).set("Cookie", teamCookieOf(mariaIn));
    expect(page.status).toBe(200);
    expect(page.text).not.toContain("Susan only");
    expect(page.text).not.toContain("We kept what you typed");
    expect(await heldRows()).toHaveLength(1);
  });

  it("a kept note for a report with no card on the page isn't used up, and no kept line shows", async () => {
    const { publicId } = await seedReport({ isDraft: true });
    const kept = await save(`/api/team/reports/${publicId}/note`, { note: "for a draft" }, expiredFor(susanId));
    const back = await handoff(susanId, heldCookieOf(kept)!.split(";")[0]!);
    expect(String(back.headers["location"])).toContain(`open=${publicId}&kept=`);
    const page = await request(app)
      .get(String(back.headers["location"]).slice(TEAM_ORIGIN.length))
      .set("Cookie", teamCookieOf(back));
    expect(page.status).toBe(200);
    expect(page.text).not.toContain("We kept what you typed");
    expect(page.text).not.toContain("for a draft");
    // Left to expire, not deleted.
    expect(await heldRows()).toHaveLength(1);
  });

  it("a HEAD request to the landing page doesn't use the row up; the GET after it still fills the form in", async () => {
    const { publicId } = await seedReport();
    const kept = await save(`/api/team/reports/${publicId}/note`, { note: "after a HEAD" }, expiredFor(susanId));
    const back = await handoff(susanId, heldCookieOf(kept)!.split(";")[0]!);
    const path = String(back.headers["location"]).slice(TEAM_ORIGIN.length);
    const head = await request(app).head(path).set("Cookie", teamCookieOf(back));
    expect(head.status).toBe(200);
    expect(await heldRows()).toHaveLength(1);
    const page = await request(app).get(path).set("Cookie", teamCookieOf(back));
    expect(page.text).toContain("after a HEAD</textarea>");
    expect(await heldRows()).toEqual([]);
  });

  it("signed out everywhere between keeping and signing in again: nothing returned, the row deleted", async () => {
    const { publicId } = await seedReport();
    const kept = await save(`/api/team/reports/${publicId}/note`, { note: "before the bump" }, expiredFor(susanId, 1));
    expect(await heldRows()).toHaveLength(1);
    await signOutEverywhere(SUSAN, "cli:vitest"); // now version 2
    try {
      const back = await handoff(susanId, heldCookieOf(kept)!.split(";")[0]!, 2);
      expect(back.status).toBe(303);
      expect(back.headers["location"]).toBe("https://team.catspotters.com/api/team/home");
      expect(await heldRows()).toEqual([]);
    } finally {
      await pool.query("update people set session_version = 1 where id = $1", [susanId]);
    }
  });

  it("a nested or array body (note[]=x, note[a]=b) is never kept or shown back", async () => {
    const { publicId } = await seedReport();
    for (const raw of ["note[]=hidden-one&note[]=hidden-two", "note[a]=hidden-one", "note[a][b]=hidden-one"]) {
      for (const cookie of [expiredFor(susanId), undefined]) {
        const t = request(app)
          .post(`/api/team/reports/${publicId}/note`)
          .set("Origin", TEAM_ORIGIN)
          .set("Sec-Fetch-Mode", "navigate")
          .type("form");
        if (cookie) t.set("Cookie", cookie);
        const res = await t.send(raw);
        expect(res.status, raw).toBe(401);
        expect(res.text, raw).not.toContain("hidden-one");
        expect(res.text, raw).not.toContain("<textarea");
        expect(heldCookieOf(res), raw).toBeUndefined();
      }
    }
    expect(await heldRows()).toEqual([]);
  });

  it("kept= more than 5 minutes after the hand-off is ignored", async () => {
    const { publicId } = await seedReport();
    const kept = await save(`/api/team/reports/${publicId}/note`, { note: "late" }, expiredFor(susanId));
    const back = await handoff(susanId, heldCookieOf(kept)!.split(";")[0]!);
    await db.update(heldTypingTable).set({ claimedAt: new Date(Date.now() - 6 * 60_000) });
    const page = await request(app)
      .get(String(back.headers["location"]).slice(TEAM_ORIGIN.length))
      .set("Cookie", teamCookieOf(back));
    expect(page.text).not.toContain("late</textarea>");
  });

  it("the tidy-up deletes rows older than 30 minutes, and only those", async () => {
    const { publicId } = await seedReport();
    await save(`/api/team/reports/${publicId}/note`, { note: "old" }, expiredFor(susanId));
    await save(`/api/team/reports/${publicId}/note`, { note: "new" }, expiredFor(mariaId));
    await db
      .update(heldTypingTable)
      .set({ createdAt: new Date(Date.now() - 31 * 60_000) })
      .where(eq(heldTypingTable.personId, susanId));
    expect(await deleteStaleHeldTyping()).toBe(1);
    expect((await heldRows()).map((r) => r.fields)).toEqual([{ note: "new" }]);
  });

  it("the opportunistic tidy-up runs it after a response, at most once a minute", async () => {
    const { publicId } = await seedReport();
    await save(`/api/team/reports/${publicId}/note`, { note: "old" }, expiredFor(susanId));
    await db.update(heldTypingTable).set({ createdAt: new Date(Date.now() - 31 * 60_000) });
    process.env["HELD_TYPING_TIDY_ON_REQUEST"] = "on";
    try {
      let finish: (() => void) | undefined;
      let nexted = false;
      opportunisticHeldTypingTidy({}, { on: (_e, cb) => (finish = cb) }, () => (nexted = true));
      expect(nexted).toBe(true);
      finish!();
      await expect.poll(async () => (await heldRows()).length).toBe(0);
    } finally {
      delete process.env["HELD_TYPING_TIDY_ON_REQUEST"];
    }
  });
});

describe("C3: every landing page fills its form in", () => {
  it("Colonies: create", async () => {
    const { html } = await keepAndReturn("/api/team/colonies", { name: "Agora <cats>", guardianName: "Eleni", notes: "Feed at 7" });
    expect(html).toContain(STATUS_LINE);
    expect(html).toContain('<details id="create" open>');
    expect(html).toContain('id="new-name" name="name" type="text" required maxlength="100" autocomplete="off" value="Agora &lt;cats&gt;"');
    expect(html).toContain('value="Eleni"');
    expect(html).toContain(">Feed at 7</textarea>");
  });

  it("Colonies: edit", async () => {
    const id = await newColony("kept-edit");
    const { html } = await keepAndReturn(`/api/team/colonies/${id}`, { guardianName: "Nikos", notes: "Two new kittens" });
    expect(html).toContain(STATUS_LINE);
    expect(html).toContain('<div class="fixes"><details open>');
    expect(html).toContain('id="edit-guardian" name="guardianName" type="text" maxlength="100" value="Nikos"');
    expect(html).toContain(">Two new kittens</textarea>");
  });

  it("Feeding site: edit", async () => {
    // Not under the shared test-site prefix: opening it leaves a read record,
    // which would stop other files' clean-up of those sites.
    const [site] = await db
      .insert(feedingSitesTable)
      .values({ name: `vt-signedout site ${randomBytes(3).toString("hex")}`, lat: 37.4401, lng: 24.9301 })
      .returning({ id: feedingSitesTable.id });
    // Opening a site is recorded against the person, so one of this run only.
    const { html } = await keepAndReturn(`/api/team/sites/${site!.id}`, { directions: "Behind the church", notes: "Bowl missing" }, await runPerson());
    expect(html).toContain(STATUS_LINE);
    expect(html).toContain("<details open><summary>Edit details</summary>");
    expect(html).toContain('value="Behind the church"');
    expect(html).toContain(">Bowl missing</textarea>");
  });

  it("Cat: rename, where it lives, sterilised", async () => {
    const cat = await seedCat(null);
    const rn = await keepAndReturn(`/api/team/cats/${cat.id}/name`, { name: "Pipis", reason: "The vet calls him that" });
    expect(rn.html).toContain(STATUS_LINE);
    expect(rn.html).toContain("<details open><summary>Rename the cat</summary>");
    expect(rn.html).toContain('id="rn-name" name="name" required maxlength="60" value="Pipis"');
    expect(rn.html).toContain('id="rn-why" name="reason" required maxlength="500" autocomplete="off" value="The vet calls him that"');
    const ls = await keepAndReturn(`/api/team/cats/${cat.id}/life-status`, { status: "homed", reason: "Adopted by the baker" });
    expect(ls.html).toContain("<details open><summary>Where the cat lives</summary>");
    expect(ls.html).toContain('id="ls-why" name="reason" required maxlength="500" autocomplete="off" value="Adopted by the baker"');
    const st = await keepAndReturn(`/api/team/cats/${cat.id}/sterilisation`, { sterilised: "yes", reason: "Clinic record" });
    expect(st.html).toContain("<details open><summary>Whether sterilised</summary>");
    expect(st.html).toContain('id="st-why" name="reason" required maxlength="500" autocomplete="off" value="Clinic record"');
  });

  it("Cat: this cat has died", async () => {
    const cat = await seedCat(null);
    const { html } = await keepAndReturn(`/api/team/cats/${cat.id}/died`, { reason: "Found by the road", date: "" });
    expect(html).toContain(STATUS_LINE);
    expect(html).toContain("Found by the road");
  });

  it("Mark wrong: the statement on the cat page", async () => {
    const writer = await runPerson();
    const cat = await seedCat(null);
    const live = await request(app)
      .post(`/api/team/cats/${cat.id}/life-status`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", teamCookieOf(await handoff(writer)))
      .send({ status: "in_care", reason: "At the shelter" });
    expect(live.status).toBe(201);
    const statement = live.body.id as number;
    const { location, html } = await keepAndReturn(`/api/team/statements/${statement}/wrong`, { choice: "street", reason: "Wrong cat" }, writer);
    expect(location).toContain(`/api/team/cats/${cat.id}?s=${statement}&kept=`);
    expect(html).toContain(STATUS_LINE);
    expect(html).toContain(`id="w${statement}-why" name="reason" required maxlength="500" autocomplete="off" value="Wrong cat"`);
  });
});

// Final review, fix 2 (spec §3.2 "Back where they were"): a save with no
// text to keep still comes back to its page after signing in again.
describe("landing only: saves with nothing typed come back to their page", () => {
  /** A signed-out save, then the hand-off with its held cookie; both responses. */
  async function landAfter(path: string, body: Record<string, string>, pid = susanId, signIn = pid) {
    const kept = await save(path, body, expiredFor(pid));
    expect(kept.status, kept.text.slice(0, 200)).toBe(401);
    const held = heldCookieOf(kept);
    expect(held, "a held cookie").toBeDefined();
    const rows = await heldRows();
    const back = await handoff(signIn, held!.split(";")[0]!);
    expect(back.status).toBe(303);
    return { kept, rows, location: String(back.headers["location"]), back };
  }

  it("a Queue state button: a row with no fields, then the hand-off opens that report", async () => {
    const { publicId } = await seedReport();
    const { kept, rows, location } = await landAfter(`/api/team/reports/${publicId}/state`, { from: "new", to: "looking" });
    expect(kept.text).toContain(COME_BACK);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      personId: susanId,
      sessionVersion: 1,
      formKey: `land:state:${publicId}`,
      landingPath: `/api/team?open=${publicId}`,
      fields: {},
    });
    expect(location).toBe(`${TEAM_ORIGIN}/api/team?open=${publicId}#r-${publicId}`);
    // Used up by the hand-off: there is nothing to fill in.
    expect(await heldRows()).toEqual([]);
  });

  it("Close and send (the confirm page's press), with the reporter's line: no field is ever stored", async () => {
    const { publicId } = await seedReport({ state: "looking" });
    const { rows } = await landAfter(`/api/team/reports/${publicId}/state`, {
      from: "looking",
      to: "done",
      confirm: "1",
      expect: "will_send",
      reporterSentence: "She is at the vet",
    });
    expect(rows[0]!.fields).toEqual({});
    expect(JSON.stringify(rows[0])).not.toContain("She is at the vet");
  });

  it("SYC-44 PR 7.1: an Issues row's Keep hidden, Restore and Hide come back to that row", async () => {
    const posts: [string, Record<string, string>][] = [["keep-hidden", { from: "new" }], ["restore", { from: "new" }], ["hide", {}]];
    for (const [action, body] of posts) {
      await db.delete(heldTypingTable);
      // The save never reaches the route (signed out), so the row needs no photo.
      const { publicId } = await seedReport({ kind: "content", reason: "other" });
      const { rows, location } = await landAfter(`/api/team/issues/${publicId}/${action}`, body);
      expect(rows, action).toHaveLength(1);
      expect(rows[0], action).toMatchObject({
        personId: susanId,
        formKey: `land:issue:${action}:${publicId}`,
        landingPath: `/api/team?open=${publicId}`,
        fields: {},
      });
      expect(location, action).toBe(`${TEAM_ORIGIN}/api/team?open=${publicId}#r-${publicId}`);
    }
  });

  it("SYC-44 PR 7.1: a team note on an Issues row is kept and filled in on that row", async () => {
    const { publicId } = await seedReport({ kind: "content", reason: "other" });
    const { html } = await keepAndReturn(`/api/team/reports/${publicId}/note`, { note: "Asked the owner" });
    expect(html).toContain(STATUS_LINE);
    const start = html.indexOf(`id="r-${publicId}"`);
    const row = html.slice(start, html.indexOf("</article>", start));
    expect(row).toMatch(/^id="r-[^"]+"><details open>/);
    expect(row).toContain(`<details class="notebox" open>`);
    expect(row).toContain(`name="note" rows="3" maxlength="2000">\nAsked the owner</textarea>`);
    expect(await heldRows()).toEqual([]);
  });

  it("tying a cat comes back to that report", async () => {
    const { publicId } = await seedReport();
    const { location } = await landAfter(`/api/team/reports/${publicId}/cat`, { catId: "1", expectedCatId: "" });
    expect(location).toBe(`${TEAM_ORIGIN}/api/team?open=${publicId}#r-${publicId}`);
  });

  it("a different person signs in on that browser: their home, and the row is deleted", async () => {
    const { publicId } = await seedReport();
    const { location } = await landAfter(`/api/team/reports/${publicId}/state`, { from: "new", to: "looking" }, susanId, mariaId);
    expect(location).toBe("https://team.catspotters.com/api/team/home");
    expect(await heldRows()).toEqual([]);
  });

  it("a cat guardian on a team page's landing: her own home, and the row is deleted", async () => {
    const { publicId } = await seedReport();
    const { location } = await landAfter(`/api/team/reports/${publicId}/state`, { from: "new", to: "looking" }, ginaId);
    expect(location).toBe("https://team.catspotters.com/api/team/my/colonies");
    expect(await heldRows()).toEqual([]);
  });

  it("a state post from another site keeps today's exact 401, and nothing is kept", async () => {
    const { publicId } = await seedReport();
    for (const origin of ["https://evil.example", "https://admin.catspotters.com"]) {
      const res = await request(app)
        .post(`/api/team/reports/${publicId}/state`)
        .set("Origin", origin)
        .set("Sec-Fetch-Mode", "navigate")
        .set("Cookie", expiredFor(susanId))
        .type("form")
        .send({ from: "new", to: "looking" });
      expect([res.status, res.text]).toEqual([401, NOT_SIGNED_IN_PAGE]);
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
    const noOrigin = await request(app)
      .post(`/api/team/reports/${publicId}/state`)
      .set("Sec-Fetch-Mode", "navigate")
      .set("Cookie", expiredFor(susanId))
      .type("form")
      .send({ from: "new", to: "looking" });
    expect([noOrigin.status, noOrigin.text]).toEqual([401, NOT_SIGNED_IN_PAGE]);
    expect(await heldRows()).toEqual([]);
  });

  it("someone signed out everywhere since: nothing kept, the plain signed-out page", async () => {
    const { publicId } = await seedReport();
    const res = await save(`/api/team/reports/${publicId}/state`, { from: "new", to: "looking" }, expiredFor(susanId, 0));
    expect(res.status).toBe(401);
    expect(res.text).toContain("You were signed out, so this wasn&#39;t saved.");
    expect(res.text).not.toContain("come back to this page");
    expect(heldCookieOf(res)).toBeUndefined();
    expect(await heldRows()).toEqual([]);
  });

  it("a guardian's Clear the centre, and her centre confirm, come back to her colony page", async () => {
    for (const body of [{ lat: "", lng: "" }, { lat: "37.4447", lng: "24.9417" }]) {
      const { kept, rows, location } = await landAfter(`/api/team/colonies/${colonyId}`, body, ginaId);
      expect(kept.text).toContain(COME_BACK);
      expect(rows[0]).toMatchObject({ landingPath: `/api/team/colonies/${colonyId}`, fields: {} });
      expect(JSON.stringify(rows[0])).not.toContain("37.4447");
      expect(location).toBe(`${TEAM_ORIGIN}/api/team/colonies/${colonyId}`);
      expect(await heldRows()).toEqual([]);
    }
  });

  it("an area's centre confirmed on the map comes back to the Areas page; other Areas forms keep nothing", async () => {
    const { rows, location } = await landAfter("/api/team/areas", { op: "move", key: "kini", lat: "37.44", lng: "24.90" });
    expect(rows[0]).toMatchObject({ landingPath: "/api/team/areas", fields: {} });
    expect(location).toBe(`${TEAM_ORIGIN}/api/team/areas`);
    const add = await save("/api/team/areas", { op: "add", name: "Somewhere", key: "x", lat: "37.4", lng: "24.9" }, expiredFor(susanId));
    expect(add.status).toBe(401);
    expect(heldCookieOf(add)).toBeUndefined();
    expect(await heldRows()).toEqual([]);
  });
});
