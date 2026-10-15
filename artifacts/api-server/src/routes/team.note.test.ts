import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  addPerson,
  db,
  mailOutboxTable,
  markLeft,
  pool,
  reportStateEventsTable,
  welfareReportsTable,
} from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  clearWelfareTables,
  seedReport,
  sessionCookieFor,
  signInThroughHandoff,
  TEAM_ORIGIN,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-43 part 2 plan, PR 2: the team note, the forms on the queue page, and
// P2-6 (a person who has left stays named on what they did).

const SUSAN = "vitest-note-susan@example.com";
const MARIA = "vitest-note-maria@example.com";
const VERA = "vitest-note-vera@example.com";
const KEY = "vitest-note-key-0123456789abcdef-0123456789";
const handoffKey = makeKey();
let susanId: string;
let mariaId: string;
let susanCookie: string;
let mariaCookie: string;
let veraCookie: string;

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
  for (const e of [SUSAN, MARIA, VERA]) await removeTestPerson(e);
  const susan = await addPerson({
    email: SUSAN,
    name: "Susan",
    addedBy: "cli:vitest",
  });
  const maria = await addPerson({
    email: MARIA,
    name: "Maria",
    addedBy: "cli:vitest",
  });
  const vera = await addPerson({
    email: VERA,
    name: "Vera",
    addedBy: "cli:vitest",
    roles: ["vet"],
  });
  susanId = susan.id;
  mariaId = maria.id;
  susanCookie = await signInThroughHandoff(app, handoffKey, susan.id);
  mariaCookie = await signInThroughHandoff(app, handoffKey, maria.id);
  // A vet (who holds nothing yet) gets no session from the hand-off (SYC-188).
  veraCookie = sessionCookieFor(vera.id);
});

beforeEach(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await clearWelfareTables();
  for (const e of [SUSAN, MARIA, VERA]) await removeTestPerson(e);
  await pool.end();
});

const note = (
  publicId: string,
  body: Record<string, unknown>,
  cookie = susanCookie,
) =>
  request(app)
    .post(`/api/team/reports/${publicId}/note`)
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", cookie)
    .send(body);

const move = (publicId: string, from: string, to: string, cookie: string) =>
  request(app)
    .post(`/api/team/reports/${publicId}/state`)
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", cookie)
    .send({ from, to });

const row = async (id: number) =>
  (
    await db
      .select()
      .from(welfareReportsTable)
      .where(eq(welfareReportsTable.id, id))
  )[0]!;

const getPage = async (query = "") => {
  const res = await request(app)
    .get(`/api/team${query}`)
    .set("Cookie", susanCookie);
  expect(res.status).toBe(200);
  return res.text;
};

/** The HTML of one report's card. */
const card = (html: string, publicId: string) => {
  const from = html.indexOf(`id="r-${publicId}"`);
  expect(from, `card for ${publicId}`).toBeGreaterThan(-1);
  const begin = html.lastIndexOf("<article", from);
  const end = html.indexOf("</article>", from);
  return html.slice(begin, end);
};

describe("the team note route", () => {
  it("writes the note, who wrote it and when; answers JSON 200 with the new row", async () => {
    const { id, publicId } = await seedReport({ state: "looking" });
    const res = await note(publicId, { note: "Fed her, will return Friday" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: publicId,
      state: "looking",
      teamNote: "Fed her, will return Friday",
      teamNoteBy: { name: "Susan", left: false },
    });
    expect(typeof res.body.teamNoteAt).toBe("string");
    const r = await row(id);
    expect(r.teamNote).toBe("Fed her, will return Friday");
    expect(r.teamNoteBy).toBe(susanId);
    expect(r.teamNoteAt).not.toBeNull();
    // A note is not a move, and sends nothing.
    expect(r.state).toBe("looking");
    expect(r.stateChangedBy).toBeNull();
    expect(
      await db
        .select()
        .from(reportStateEventsTable)
        .where(eq(reportStateEventsTable.reportId, id)),
    ).toHaveLength(0);
    expect(await db.select().from(mailOutboxTable)).toHaveLength(0);
  });

  it("answers a browser form post with 303 back to the report", async () => {
    const { id, publicId } = await seedReport();
    const res = await request(app)
      .post(`/api/team/reports/${publicId}/note`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", mariaCookie)
      .type("form")
      .send({ note: "Line one\nLine two" });
    expect(res.status).toBe(303);
    // ?noted= makes the queue say "Saved" and keep this report open.
    expect(res.headers["location"]).toBe(`/api/team?noted=${publicId}#r-${publicId}`);
    const page = await request(app).get(`/api/team?noted=${publicId}`).set("Cookie", mariaCookie);
    expect(page.text).toContain("Saved. The team note is updated.");
    const r = await row(id);
    expect(r.teamNote).toBe("Line one\nLine two");
    expect(r.teamNoteBy).toBe(mariaId);
  });

  it("takes up to 2,000 characters and refuses more, naming only the field", async () => {
    const { id, publicId } = await seedReport();
    expect((await note(publicId, { note: "a".repeat(2000) })).status).toBe(200);
    const marker = "SECRET-NOTE-MARKER";
    const tooLong = marker + "b".repeat(2001 - marker.length);
    const res = await note(publicId, { note: tooLong });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid request", fields: ["note"] });
    expect(res.text).not.toContain(marker);
    expect((await row(id)).teamNote).toBe("a".repeat(2000));
  });

  it("counts a browser's CRLF line breaks as one character, and stores them as LF (review of PR 2)", async () => {
    const { id, publicId } = await seedReport();
    // 2,000 characters as the textarea counts them; 2,099 once CRLF is sent.
    const lines = Array.from({ length: 100 }, () => "x".repeat(19)).join(
      "\r\n",
    );
    expect(lines.replace(/\r\n/g, "\n")).toHaveLength(1999);
    const res = await request(app)
      .post(`/api/team/reports/${publicId}/note`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", susanCookie)
      .type("form")
      .send({ note: lines + "y" });
    expect(res.status).toBe(303);
    const stored = (await row(id)).teamNote!;
    expect(stored).toHaveLength(2000);
    expect(stored).not.toContain("\r");
  });

  it("answers a form post that's too long with a page and a way back, not JSON, and never the note", async () => {
    const { id, publicId } = await seedReport({ teamNote: "keep me" });
    const marker = "SECRET-NOTE-MARKER";
    const res = await request(app)
      .post(`/api/team/reports/${publicId}/note`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", susanCookie)
      .type("form")
      .send({ note: marker + "z".repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("A team note can be at most 2,000 characters.");
    expect(res.text).toContain(`href="/api/team#r-${publicId}"`);
    expect(res.text).not.toContain(marker);
    expect(res.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect((await row(id)).teamNote).toBe("keep me");
  });

  it("refuses a missing or non-text note, with field names only", async () => {
    const { id, publicId } = await seedReport({ teamNote: "keep me" });
    for (const body of [{}, { note: 42 }, { note: ["x"] }, { note: null }]) {
      const res = await note(publicId, body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid request", fields: ["note"] });
    }
    expect((await row(id)).teamNote).toBe("keep me");
  });

  it("an empty note clears the text, and still records who and when", async () => {
    const { id, publicId } = await seedReport({
      teamNote: "old",
      teamNoteBy: mariaId,
    });
    const res = await note(publicId, { note: "  \n " });
    expect(res.status).toBe(200);
    expect(res.body.teamNote).toBeNull();
    const r = await row(id);
    expect(r.teamNote).toBeNull();
    expect(r.teamNoteBy).toBe(susanId);
  });

  it("can't write a note on a draft or an unknown report", async () => {
    const { id, publicId } = await seedReport({ isDraft: true });
    expect((await note(publicId, { note: "hello" })).status).toBe(404);
    expect((await note("nope", { note: "hello" })).status).toBe(404);
    expect((await row(id)).teamNote).toBeNull();
  });

  it("a person without the capability gets the 403 (signed in, so not the sign-in 401; SYC-53 PR 0.5) and nothing is written", async () => {
    const { id, publicId } = await seedReport();
    const res = await note(publicId, { note: "hello" }, veraCookie);
    expect([res.status, res.text]).toEqual([403, '{"error":"forbidden"}']);
    expect((await row(id)).teamNote).toBeNull();
  });
});

describe("the forms on the queue page", () => {
  it("every sent report has the four state buttons and the team note form; a draft has neither", async () => {
    await seedReport({ publicId: "open-1", state: "looking" });
    await seedReport({ publicId: "closed-1", state: "done" });
    await seedReport({ publicId: "draft-1", isDraft: true });
    const html = await getPage();
    for (const [id, state, enabled] of [
      ["open-1", "looking", ["new", "done", "nothing_needed"]],
      ["closed-1", "done", ["new", "looking", "nothing_needed"]],
    ] as const) {
      const c = card(html, id);
      expect(c).toContain(`action="/api/team/reports/${id}/state"`);
      expect(c).toContain(`<input type="hidden" name="from" value="${state}">`);
      for (const s of enabled) {
        expect(c).toContain(`name="to" value="${s}"`);
      }
      // The state it is in has no button that submits.
      expect(c).not.toContain(`name="to" value="${state}"`);
      expect(c).toContain(">Looking at it");
      expect(c).toContain(`action="/api/team/reports/${id}/note"`);
      expect(c).toContain("Team only. Never shown to the reporter.");
      expect(c).toContain('<label class="label" for="note-' + id + '"');
      expect(c).toContain('maxlength="2000"');
    }
    expect(card(html, "open-1")).toContain(">Looking at it (current)");
    const from = html.indexOf('id="d-draft-1"');
    const draft = html.slice(from, html.indexOf("</article>", from));
    expect(draft).not.toContain("<form");
    expect(html).not.toContain("<script");
  });

  it("shows the current note in the box, escaped, and a note full of markup is only text", async () => {
    const evil = `</textarea><script>alert("x")</script><img src=x onerror=alert(1)>`;
    await seedReport({
      publicId: "evil-1",
      teamNote: evil,
      teamNoteBy: mariaId,
    });
    const html = await getPage();
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;/textarea&gt;&lt;script&gt;");
  });

  it("the 'someone else changed this' notice appears on the named report only, escaped", async () => {
    await seedReport({ publicId: "moved-1", state: "looking" });
    await seedReport({ publicId: "other-1" });
    const html = await getPage("?changed=moved-1");
    const message =
      "Someone else changed this report a moment ago. Here&#39;s where it is now.";
    expect(card(html, "moved-1")).toContain(message);
    expect(card(html, "other-1")).not.toContain("Someone else changed");
    // A made-up or hostile value picks no card and is never printed.
    for (const q of [
      "?changed=nope",
      `?changed=${encodeURIComponent('"><script>alert(1)</script>')}`,
      "?changed[]=moved-1",
    ]) {
      const page = await getPage(q);
      expect(page).not.toContain("Someone else changed");
      expect(page).not.toContain("<script");
    }
    expect(await getPage()).not.toContain("Someone else changed");
  });

  it("a stale button press end to end: the page the browser lands on says so and shows where it is now", async () => {
    const { publicId } = await seedReport({ state: "new" });
    await move(publicId, "new", "done", mariaCookie);
    const res = await request(app)
      .post(`/api/team/reports/${publicId}/state`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", susanCookie)
      .type("form")
      .send({ from: "new", to: "looking" });
    expect(res.status).toBe(303);
    const next = await request(app)
      .get(res.headers["location"]!.split("#")[0]!)
      .set("Cookie", susanCookie);
    expect(card(next.text, publicId)).toContain("Someone else changed");
    expect(card(next.text, publicId)).toContain(">Done (current)");
  });
});

describe("P2-6: a person who has left stays named on what they did", () => {
  it("shows 'Maria (left)' on the report, and the database refuses to delete her", async () => {
    const { id, publicId } = await seedReport({ state: "new" });
    expect((await move(publicId, "new", "looking", mariaCookie)).status).toBe(
      200,
    );
    expect(
      (await note(publicId, { note: "Checked the bins" }, mariaCookie)).status,
    ).toBe(200);
    expect(await markLeft(MARIA, "cli:vitest")).not.toBeNull();

    // The report still shows, with her name and "(left)", on both.
    const html = await getPage();
    const c = card(html, publicId);
    expect(c).toContain("Maria (left), ");
    expect(c.match(/Maria \(left\)/g)).toHaveLength(2);
    const queue = await request(app)
      .get("/api/team/reports")
      .set("Cookie", susanCookie);
    expect(queue.body.open[0].stateChangedBy).toEqual({
      name: "Maria",
      left: true,
    });
    expect(queue.body.open[0].teamNoteBy).toEqual({
      name: "Maria",
      left: true,
    });

    // Hard-deleting her is refused by the welfare links themselves. Her
    // `added` event would refuse it too, so the test removes her events first
    // (trigger off, inside a transaction that is rolled back), leaving the
    // welfare links the only thing standing in the way.
    const client = await pool.connect();
    let code: string | undefined;
    try {
      await client.query("begin");
      await client.query(
        `alter table person_events disable trigger person_events_append_only`,
      );
      await client.query(`delete from person_events where person_id = $1`, [
        mariaId,
      ]);
      await client.query(`delete from person_scopes where person_id = $1`, [
        mariaId,
      ]);
      try {
        await client.query(`delete from people where id = $1`, [mariaId]);
      } catch (err) {
        code = (err as { code?: string }).code;
      }
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
    expect(code).toBe("23503");
    // ...and the app has no way to delete a person at all (SYC-53 PR 0.1:
    // marking as left is the only way off the list).
    expect("removePerson" in (await import("@workspace/db"))).toBe(false);
    await expect(removeTestPerson(MARIA)).rejects.toThrow(
      "This person has history. Use mark-left instead.",
    );
    const r = await row(id);
    expect(r.stateChangedBy).toBe(mariaId);
    expect(r.teamNoteBy).toBe(mariaId);
  });
});

describe("a person marked as left can't use either form (review of PR 2)", () => {
  const LENA = "vitest-note-lena@example.com";

  it("gets the identical 401 on both routes, at their very next request, and nothing is written", async () => {
    await removeTestPerson(LENA);
    const lena = await addPerson({
      email: LENA,
      name: "Lena",
      addedBy: "cli:vitest",
    });
    const cookie = await signInThroughHandoff(app, handoffKey, lena.id);
    const { id, publicId } = await seedReport({ state: "new" });
    expect((await note(publicId, { note: "before" }, cookie)).status).toBe(200);
    expect(await markLeft(LENA, "cli:vitest")).not.toBeNull();

    const n = await note(publicId, { note: "after" }, cookie);
    const m = await move(publicId, "new", "looking", cookie);
    for (const res of [n, m]) {
      expect([res.status, res.text]).toEqual([
        401,
        '{"error":"not_signed_in"}',
      ]);
    }
    const r = await row(id);
    expect(r.teamNote).toBe("before");
    expect(r.state).toBe("new");
  });
});
