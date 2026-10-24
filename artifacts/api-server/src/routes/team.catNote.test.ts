import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import { addPerson, catsTable, db, markLeft, observationsTable, photosTable, pool } from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import { sessionCookieFor, signInThroughHandoff, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { guardianOn, newColony, seedCat } from "../test/roleKit";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-602 PR 4, Task 4.1: "Add a note" on the team cat page. A team-only
// `team_note`, gated on `add_team_note`, written as the person who typed it.
// (team.note.test.ts is the older queue-note test.)
//
// `denied.cap`, when set, is refused to everyone; the rest goes to the real `can`.
const denied = vi.hoisted(() => ({ cap: null as string | null }));
vi.mock("../lib/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/capabilities")>();
  return {
    ...real,
    can: (...args: Parameters<typeof real.can>) =>
      args[1] === denied.cap ? false : real.can(...args),
  };
});

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-cn-${RUN}-`;
const SUSAN = `vitest-cn-susan-${RUN}@example.com`;
const VERA = `vitest-cn-vera-${RUN}@example.com`;
const KEY = "vitest-cn-key-0123456789abcdef-0123456789abcd";
const handoffKey = makeKey();

let cookie: string;
let susanId: string;
let veraCookie: string;
let guardianCookie: string;
let n = 0;

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
}

async function newCat(): Promise<number> {
  n += 1;
  const publicId = `${PREFIX}photo-${n}`;
  const [p] = await db
    .insert(photosTable)
    .values({ publicId, data: Buffer.from(`fake ${n}`).toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}cat-${n}`,
      description: "",
      primaryPhotoId: p!.id,
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: `${PREFIX}device`,
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

const notes = (catId: number) =>
  db
    .select()
    .from(observationsTable)
    .where(eq(observationsTable.catId, catId))
    .orderBy(observationsTable.id)
    .then((rows) => rows.filter((r) => r.kind === "team_note"));

const allRows = (catId: number) =>
  db.select().from(observationsTable).where(eq(observationsTable.catId, catId)).orderBy(observationsTable.id);

const form = (path: string, c = cookie) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", c).type("form");

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await cleanup();
  for (const e of [SUSAN, VERA]) await removeTestPerson(e);
  susanId = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest", roles: ["staff"] })).id;
  cookie = await signInThroughHandoff(app, handoffKey, susanId);
  const vera = await addPerson({ email: VERA, name: "Vera", addedBy: "cli:vitest", roles: ["vet"] });
  veraCookie = sessionCookieFor(vera.id);
  const colony = await newColony(`cn-${RUN}`);
  guardianCookie = (await guardianOn(`cn-${RUN}`, [colony])).cookie;
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
});

afterAll(async () => {
  await cleanup();
  await markLeft(SUSAN, "cli:vitest");
  await markLeft(VERA, "cli:vitest");
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

describe("POST /api/team/cats/:id/note", () => {
  it("a team member's note is saved as theirs, trimmed, and shows in the history", async () => {
    const catId = await newCat();
    const res = await form(`/api/team/cats/${catId}/note`).send({ text: "  Limping on the left.\r\nSecond line  " });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/cats/${catId}?done=note#corrections`);
    const rows = await notes(catId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "team_note",
      accountId: susanId,
      roleAtTime: "staff",
      value: { text: "Limping on the left.\nSecond line" },
    });
    const page = await request(app).get(`/api/team/cats/${catId}?done=note`).set("Cookie", cookie);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Note (team only): “Limping on the left.");
    expect(page.text).toContain("Saved. The note is in the history below.");
  });

  it("an empty note, a blank one and a 2001-character one are a 400 naming the form, and nothing is written", async () => {
    const catId = await newCat();
    const before = await allRows(catId);
    for (const text of ["", "   \r\n ", "x".repeat(2001), `a${String.fromCharCode(0)}b`]) {
      const res = await form(`/api/team/cats/${catId}/note`).send({ text });
      expect(res.status, JSON.stringify(text.slice(0, 5))).toBe(400);
      expect(res.text).toContain("Write a note of 1 to 2000 characters");
      expect(res.text).toContain("Nothing was changed");
      expect(res.text).not.toContain("xxxxxxxx");
    }
    const missing = await form(`/api/team/cats/${catId}/note`).send({});
    expect(missing.status).toBe(400);
    expect(await allRows(catId)).toEqual(before);
  });

  it("2000 characters is saved; JSON callers get JSON errors", async () => {
    const catId = await newCat();
    const ok = await form(`/api/team/cats/${catId}/note`).send({ text: "y".repeat(2000) });
    expect(ok.status).toBe(303);
    expect((await notes(catId))[0]!.value).toEqual({ text: "y".repeat(2000) });
    const json = await request(app)
      .post(`/api/team/cats/${catId}/note`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ text: "" });
    expect(json.status).toBe(400);
    expect(json.body).toEqual({ error: "Invalid request", fields: ["text"] });
  });

  it("a cat guardian, a person whose scopes grant nothing, and staff lacking add_team_note get the 403", async () => {
    const catId = await newCat();
    const before = await allRows(catId);
    for (const c of [guardianCookie, veraCookie]) {
      const res = await form(`/api/team/cats/${catId}/note`, c).send({ text: "hello" });
      expect([res.status, res.text]).toEqual([403, '{"error":"forbidden"}']);
    }
    denied.cap = "add_team_note";
    const res = await form(`/api/team/cats/${catId}/note`).send({ text: "hello" });
    expect([res.status, res.text]).toEqual([403, '{"error":"forbidden"}']);
    expect(await allRows(catId)).toEqual(before);
  });

  it("the capability gate runs before the body is read: no add_team_note and a malformed body is a 403, not a 400", async () => {
    const catId = await newCat();
    denied.cap = "add_team_note";
    for (const body of [{}, { text: "" }, { text: "x".repeat(2001) }, { text: "a\ud800b" }]) {
      const res = await form(`/api/team/cats/${catId}/note`).send(body);
      expect([res.status, res.text]).toEqual([403, '{"error":"forbidden"}']);
    }
    const json = await request(app)
      .post(`/api/team/cats/${catId}/note`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ text: ["not", "a", "string"] });
    expect(json.status).toBe(403);
    expect(await notes(catId)).toEqual([]);
  });

  it("text that is not well formed (a lone surrogate) is a 400, never a 500, and nothing is written", async () => {
    const catId = await newCat();
    const json = await request(app)
      .post(`/api/team/cats/${catId}/note`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send('{"text":"a\\ud800b"}');
    expect(json.status).toBe(400);
    expect(json.body).toEqual({ error: "Invalid request", fields: ["text"] });
    expect(await notes(catId)).toEqual([]);
  });

  it("control characters and bidi overrides are dropped before the note is stored; what is empty afterwards is refused", async () => {
    const catId = await newCat();
    const ok = await form(`/api/team/cats/${catId}/note`).send({ text: "a\u202Eb\u0007c\u2066d\u2069e\u001Ff\nline two\ttab" });
    expect(ok.status).toBe(303);
    expect((await notes(catId))[0]!.value).toEqual({ text: "abcdef\nline two tab" });
    const before = await allRows(catId);
    for (const text of ["\u202E\u2066\u0007", " \u202A \u0001 "]) {
      const res = await form(`/api/team/cats/${catId}/note`).send({ text });
      expect(res.status, JSON.stringify(text)).toBe(400);
    }
    expect(await allRows(catId)).toEqual(before);
  });

  it("another Origin, or none, is refused before anything is read", async () => {
    const catId = await newCat();
    const before = await allRows(catId);
    const evil = await request(app)
      .post(`/api/team/cats/${catId}/note`)
      .set("Origin", "https://evil.catspotters.com")
      .set("Cookie", cookie)
      .type("form")
      .send({ text: "hello" });
    expect([evil.status, evil.text]).toEqual([401, '{"error":"not_signed_in"}']);
    const none = await request(app).post(`/api/team/cats/${catId}/note`).set("Cookie", cookie).type("form").send({ text: "hello" });
    expect(none.status).toBe(401);
    expect(await allRows(catId)).toEqual(before);
  });

  it("signed out is the sign-in answer, and writes nothing", async () => {
    const catId = await newCat();
    const res = await request(app).post(`/api/team/cats/${catId}/note`).set("Origin", TEAM_ORIGIN).type("form").send({ text: "hello" });
    expect(res.status).toBe(401);
    expect(await allRows(catId)).toEqual([]);
  });

  it("the team cat JSON carries the notes only for a person who holds add_team_note", async () => {
    const catId = await newCat();
    await form(`/api/team/cats/${catId}/note`).send({ text: "JSON note text" });
    const get = () => request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie).set("Accept", "application/json");
    const withCap = await get();
    expect(withCap.status).toBe(200);
    expect(JSON.stringify(withCap.body)).toContain("JSON note text");
    denied.cap = "add_team_note";
    const without = await get();
    expect(without.status).toBe(200);
    expect(JSON.stringify(without.body)).not.toContain("JSON note text");
    expect(without.body.history.some((h: { kind: string }) => h.kind === "team_note")).toBe(false);
  });

  it("a cat that doesn't exist is a 404, and a bad id too; nothing is written", async () => {
    const gone = await form("/api/team/cats/999999999/note").send({ text: "hello" });
    expect(gone.status).toBe(404);
    expect(gone.text).toContain("Nothing was changed");
    const bad = await form("/api/team/cats/abc/note").send({ text: "hello" });
    expect(bad.status).toBe(404);
  });

  it("the cat page draws Add a note only with add_team_note,", async () => {
    const catId = await newCat();
    const page = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(page.text).toContain("Add a note");
    expect(page.text).toContain(`action="/api/team/cats/${catId}/note"`);
    expect(page.text).toContain('name="text"');
    denied.cap = "add_team_note";
    const without = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(without.text).not.toContain("Add a note");
    expect(without.text).not.toContain(`/api/team/cats/${catId}/note`);
  });
});

/** The facts panel of a cat page: its <dl class="catfacts kf"> up to its closing tag. */
const factsOf = (html: string) => {
  const start = html.indexOf('<dl class="catfacts kf">');
  return start < 0 ? "" : html.slice(start, html.indexOf("</div></dl>", start));
};

describe("the Health note fact and Mark wrong on a note (SYC-602 PR 4.2)", () => {
  const write = (catId: number, text: string, c = cookie) => form(`/api/team/cats/${catId}/note`, c).send({ text });
  const wrong = (id: number, c = cookie, extra: Record<string, string> = {}) =>
    form(`/api/team/statements/${id}/wrong`, c).send({ choice: "retract", reason: "Written on the wrong cat", ...extra });

  it("the cat page shows the newest standing note as the Health note, 'team only' under it", async () => {
    const catId = await newCat();
    await write(catId, "Older note");
    await write(catId, "Newer <i>note</i>");
    const page = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    const facts = factsOf(page.text);
    expect(facts).toContain("<dt>Health note</dt>");
    expect(facts).toContain("Newer &lt;i&gt;note&lt;/i&gt;");
    expect(facts).not.toContain("Older note");
    expect(facts).toMatch(/Susan, \d{1,2} \w{3} \d{4} · team only/);
    expect(page.text).not.toContain("<i>note</i>");
    expect(page.text).toContain('<span class="tag note">team only</span>');
  });

  it("Mark wrong takes a note back: a retraction is written, the older note shows again, the history keeps both", async () => {
    const catId = await newCat();
    await write(catId, "Older note");
    await write(catId, "Newer note");
    const [older, newer] = await notes(catId);
    const res = await wrong(newer!.id);
    expect(res.status).toBe(303);
    const rows = await notes(catId);
    expect(res.headers["location"]).toContain(`/api/team/cats/${catId}?done=wrong`);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({
      value: { retracted: true },
      supersedesId: newer!.id,
      supersedeReason: "Written on the wrong cat",
      accountId: susanId,
    });
    const page = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    const facts = factsOf(page.text);
    expect(facts).toContain("Older note");
    expect(facts).not.toContain("Newer note");
    expect(page.text).toContain("<del>Note (team only): “Newer note”</del>");
    expect(older).toBeDefined();
  });

  it("with every note marked wrong the fact goes", async () => {
    const catId = await newCat();
    await write(catId, "Only note");
    const [only] = await notes(catId);
    expect((await wrong(only!.id)).status).toBe(303);
    const page = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(page.text).not.toContain("<dt>Health note</dt>");
  });

  it("a second Mark wrong of the same note says someone already corrected it, and writes nothing", async () => {
    const catId = await newCat();
    await write(catId, "Once");
    const [n] = await notes(catId);
    expect((await wrong(n!.id)).status).toBe(303);
    const before = await allRows(catId);
    const again = await wrong(n!.id);
    expect(again.status).toBe(303);
    expect(again.headers["location"]).toContain("done=already");
    expect(await allRows(catId)).toEqual(before);
  });

  it("a cat guardian and a person with no capabilities get the 403; without add_team_note nobody takes a note back", async () => {
    const catId = await newCat();
    await write(catId, "Keep me");
    const [n] = await notes(catId);
    const before = await allRows(catId);
    for (const c of [guardianCookie, veraCookie]) {
      const res = await wrong(n!.id, c);
      expect([res.status, res.text]).toEqual([403, '{"error":"forbidden"}']);
    }
    denied.cap = "add_team_note";
    const res = await wrong(n!.id);
    expect(res.status).toBe(403);
    expect(await allRows(catId)).toEqual(before);
  });

  it("the menu draws Mark wrong on a note only with add_team_note, and not on a note already marked wrong", async () => {
    const catId = await newCat();
    await write(catId, "Menu note");
    const [n] = await notes(catId);
    const page = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(page.text).toContain(`action="/api/team/statements/${n!.id}/wrong"`);
    denied.cap = "add_team_note";
    const without = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(without.text).not.toContain(`action="/api/team/statements/${n!.id}/wrong"`);
    denied.cap = null;
    await wrong(n!.id);
    const after = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(after.text).not.toContain(`action="/api/team/statements/${n!.id}/wrong"`);
  });

  it("the retraction is a retraction and nothing else: another value for a note is refused, nothing written", async () => {
    const catId = await newCat();
    await write(catId, "Stay");
    const [n] = await notes(catId);
    const before = await allRows(catId);
    const res = await form(`/api/team/statements/${n!.id}/wrong`).send({ choice: "street", reason: "x" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await allRows(catId)).toEqual(before);
  });
});
