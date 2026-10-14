import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import {
  addPerson,
  catsTable,
  coloniesTable,
  colonyNameHistoryTable,
  db,
  feedingSitesTable,
  mappingEventsTable,
  markLeft,
  observationsTable,
  photosTable,
  pool,
} from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  sessionCookieFor,
  signInThroughHandoff,
  TEAM_ORIGIN,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { recordMappingEvent } from "../lib/mappingEvents";
import { currentColonyOf } from "../lib/colonyMembership";

// SYC-209 PR 2.1: the Colonies pages. Spec tests 14 (colony names), 11 (part:
// one history row per change, in the same transaction), 16 (escaping) and 12
// (part: refusals), plus the counts.
//
// colony_name_history and mapping_events refuse delete, and a colony with a
// name history can't be deleted, so nothing here is cleaned up: every name is
// unique to this run, and the throwaway database is dropped at the end of the
// run (src/test/globalSetup.ts).

// The history write is mocked through so a test can make it fail once; every
// other call goes to the real writer.
vi.mock("../lib/mappingEvents", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/mappingEvents")>();
  return { ...real, recordMappingEvent: vi.fn(real.recordMappingEvent) };
});

// A staff member who lacks exactly one capability: today staff hold all
// fifteen, so `can` is wrapped (the corrections tests do the same).
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
const P = `vt-col-${RUN}-`;
const SUSAN = `vitest-col-susan-${RUN}@example.com`;
const MARIA = `vitest-col-maria-${RUN}@example.com`;
const VERA = `vitest-col-vera-${RUN}@example.com`;
const KEY = "vitest-col-key-0123456789abcdef-0123456789abcd";
const handoffKey = makeKey();
const MARKUP = `<img src=x onerror="alert(1)"> "q" 'x'`;

let susan: string;
let maria: string;
let cookie: string;
let mariaCookie: string;
let volunteerCookie: string;
let n = 0;
const photoIds: number[] = [];

/** The text a browser would show: entities decoded. */
const decoded = (html: string) =>
  html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const unique = (label: string) => {
  n += 1;
  return `${P}${label}-${n}`;
};

function post(
  path: string,
  body: Record<string, string>,
  opts: { cookie?: string | null; origin?: string | null } = {},
) {
  const t = request(app).post(path).type("form");
  const c = opts.cookie === undefined ? cookie : opts.cookie;
  if (c) t.set("Cookie", c);
  const o = opts.origin === undefined ? TEAM_ORIGIN : opts.origin;
  if (o) t.set("Origin", o);
  return t.send(body);
}

const get = (path: string, c: string | null = cookie) => {
  const t = request(app).get(path);
  if (c) t.set("Cookie", c);
  return t;
};

async function makeColony(
  name: string,
  extra: { guardianName?: string; notes?: string; as?: string } = {},
): Promise<number> {
  const res = await post(
    "/api/team/colonies",
    {
      name,
      ...(extra.guardianName ? { guardianName: extra.guardianName } : {}),
      ...(extra.notes ? { notes: extra.notes } : {}),
    },
    { cookie: extra.as ?? cookie },
  );
  expect(res.status, res.text).toBe(303);
  const id = Number(/\/colonies\/(\d+)/.exec(res.headers["location"] as string)![1]);
  return id;
}

const eventsOf = (id: number) =>
  db
    .select()
    .from(mappingEventsTable)
    .where(and(eq(mappingEventsTable.subjectKind, "colony"), eq(mappingEventsTable.subjectId, id)))
    .orderBy(asc(mappingEventsTable.id));

const colonyRow = async (id: number) =>
  (await db.select().from(coloniesTable).where(eq(coloniesTable.id, id)))[0];

const myColonyCount = async () =>
  (await db.select().from(coloniesTable).where(like(coloniesTable.name, `${P}%`))).length;

const colonyEventCount = async () =>
  (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(mappingEventsTable)
      .where(eq(mappingEventsTable.subjectKind, "colony"))
  )[0]!.n;

async function seedCat(name: string, withPhoto = true) {
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${P}photo-${name}`, data: "ZmFrZQ==", mime: "image/jpeg" })
    .returning({ id: photosTable.id, publicId: photosTable.publicId });
  photoIds.push(p!.id);
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${P}${name}`,
      primaryPhotoId: p!.id,
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: `${P}device`,
    })
    .returning({ id: catsTable.id });
  void withPhoto;
  return { id: c!.id, photoPublicId: p!.publicId };
}

let statementClock = Date.parse("2026-09-01T10:00:00Z");
async function colonyStatement(catId: number, colonyId: number | null) {
  statementClock += 60_000;
  await db.insert(observationsTable).values({
    catId,
    kind: "colony",
    value: { colonyId },
    accountId: susan,
    roleAtTime: "staff",
    observedAt: new Date(statementClock),
  });
}

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  susan = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest" })).id;
  maria = (await addPerson({ email: MARIA, name: "Maria", addedBy: "cli:vitest" })).id;
  const vera = await addPerson({
    email: VERA,
    name: "Vera Volunteer",
    addedBy: "cli:vitest",
    roles: ["volunteer"],
  });
  cookie = await signInThroughHandoff(app, handoffKey, susan);
  mariaCookie = await signInThroughHandoff(app, handoffKey, maria);
  // A volunteer gets no session from the hand-off (SYC-188); this stands for
  // a session held anyway.
  volunteerCookie = sessionCookieFor(vera.id);
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
  vi.mocked(recordMappingEvent).mockClear();
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await db.delete(feedingSitesTable).where(like(feedingSitesTable.name, `${P}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${P}%`));
  await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  await pool.end();
});

describe("creating a colony", () => {
  it("writes the colony and exactly one history row, signed by the person", async () => {
    const name = `${P}Vaporia — Eleni's`;
    const res = await post("/api/team/colonies", {
      name,
      guardianName: "Eleni",
      notes: "Feeds at the quay",
    });
    expect(res.status).toBe(303);
    const id = Number(/\/colonies\/(\d+)\?done=created$/.exec(res.headers["location"] as string)![1]);

    const row = await colonyRow(id);
    expect(row).toMatchObject({
      name,
      guardianName: "Eleni",
      notes: "Feeds at the quay",
      lat: null,
      lng: null,
      // The person's id, as text: the column is text by design.
      createdBy: susan,
    });
    const events = await eventsOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "colony_created",
      personId: susan,
      actorSystem: null,
      before: null,
      after: { name, guardianName: "Eleni", notes: "Feeds at the quay" },
    });

    const page = await get(`/api/team/colonies/${id}?done=created`);
    expect(page.status).toBe(200);
    expect(decoded(page.text)).toContain("The colony was created.");
  });

  it("guardian and notes are optional", async () => {
    const id = await makeColony(unique("bare"));
    const row = await colonyRow(id);
    expect(row).toMatchObject({ guardianName: null, notes: null });
  });

  it("the list shows the naming convention and the notes hint", async () => {
    const page = decoded((await get("/api/team/colonies")).text);
    expect(page).toContain("Create a colony");
    expect(page).toContain("A place and the person who looks after it, like “Vaporia — Eleni's”.");
    expect(page).toContain("Don't write when people come and go.");
  });

  it("answers JSON to a JSON caller", async () => {
    const res = await request(app)
      .post("/api/team/colonies")
      .set("Cookie", cookie)
      .set("Origin", TEAM_ORIGIN)
      .send({ name: unique("json") });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe("number");
    expect(await eventsOf(res.body.id)).toHaveLength(1);
  });

  it("a bad form answers 400 naming the fields only, never echoing what was typed", async () => {
    const before = await colonyEventCount();
    const typed = { name: "   ", guardianName: `SECRET-guardian-${RUN}`, notes: `SECRET-notes-${RUN}` };
    const html = await post("/api/team/colonies", typed);
    expect(html.status).toBe(400);
    expect(html.text).not.toContain("SECRET");
    expect(decoded(html.text)).toContain("A colony needs a name.");

    const json = await request(app)
      .post("/api/team/colonies")
      .set("Cookie", cookie)
      .set("Origin", TEAM_ORIGIN)
      .send({ ...typed, name: "x".repeat(101) });
    expect(json.status).toBe(400);
    expect(json.body).toEqual({ error: "Invalid request", fields: ["name"] });
    expect(JSON.stringify(json.body)).not.toContain("SECRET");

    // A name with nothing left once folded (only invisible characters).
    const invisible = await post("/api/team/colonies", { name: "​​" });
    expect(invisible.status).toBe(400);
    expect(await colonyEventCount()).toBe(before);
  });
});

describe("test 14: colony names", () => {
  it("a clash under case, accents, final sigma or NFD is refused, with a link to the holder", async () => {
    const base = `${P}Ελένη`;
    const holder = await makeColony(base);
    const sigma = await makeColony(`${P}Σοφίας`);
    const before = await myColonyCount();

    const variants: [string, number][] = [
      [`${P}ΕΛΕΝΗ`, holder], // case and accents
      [`${P}ελένη`, holder], // case
      [`${P}ΕΛΈΝΗ`, holder], // accent on a capital
      [`${P}Ελένη`.normalize("NFD"), holder], // decomposed
      [`${P}ΣΟΦΊΑΣ`, sigma], // capitals, accent, final sigma
      [`${P}Σοφίασ`, sigma], // sigma where a final sigma belongs
    ];
    for (const [name, expected] of variants) {
      const res = await post("/api/team/colonies", { name });
      expect(res.status, name).toBe(409);
      expect(res.text).toContain(`href="/api/team/colonies/${expected}"`);
      const json = await request(app)
        .post("/api/team/colonies")
        .set("Cookie", cookie)
        .set("Origin", TEAM_ORIGIN)
        .send({ name });
      expect(json.status).toBe(409);
      expect(json.body).toMatchObject({
        code: "NAME_TAKEN",
        colony: { id: expected },
      });
    }
    expect(await myColonyCount()).toBe(before);
    // Nothing was written for the refusals: still one creation event each.
    expect(await eventsOf(holder)).toHaveLength(1);
    expect(await eventsOf(sigma)).toHaveLength(1);
  });

  it("a rename keeps every cat and site attached, and the old name still finds the colony", async () => {
    const oldName = `${P}Kini — Maria's`;
    const id = await makeColony(oldName, { guardianName: "Maria" });
    const cat = await seedCat("rename-cat");
    await colonyStatement(cat.id, id);
    const [site] = await db
      .insert(feedingSitesTable)
      .values({ name: `${P}rename-site`, colonyId: id, lat: 37.4452, lng: 24.9423 })
      .returning({ id: feedingSitesTable.id });

    const newName = `${P}Kini — Anna's`;
    const res = await post(`/api/team/colonies/${id}`, { name: newName });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/colonies/${id}?done=saved`);

    expect((await colonyRow(id))!.name).toBe(newName);
    const [siteAfter] = await db.select().from(feedingSitesTable).where(eq(feedingSitesTable.id, site!.id));
    expect(siteAfter!.colonyId).toBe(id);
    expect((await currentColonyOf([cat.id])).get(cat.id)).toBe(id);

    // The old name went into the name history, signed by the person.
    const history = await db
      .select()
      .from(colonyNameHistoryTable)
      .where(eq(colonyNameHistoryTable.colonyId, id));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ name: oldName, replacedBy: susan });

    // One history event, with before and after.
    const events = await eventsOf(id);
    expect(events.map((e) => e.kind)).toEqual(["colony_created", "colony_renamed"]);
    expect(events[1]).toMatchObject({
      personId: susan,
      before: { name: oldName },
      after: { name: newName },
    });

    // Searching the old name (and a differently-typed version of it) finds it.
    for (const q of [oldName, oldName.toUpperCase(), "KINI — MARIA"]) {
      const found = await get(`/api/team/colonies?q=${encodeURIComponent(q)}`).set("Accept", "application/json");
      const ids = (found.body.colonies as { id: number }[]).map((c) => c.id);
      expect(ids, q).toContain(id);
    }
    // …and it says which earlier name matched.
    const html = decoded((await get(`/api/team/colonies?q=${encodeURIComponent("kini — maria")}`)).text);
    expect(html).toContain(`Used to be called: ${oldName}`);
    // The new name finds it too.
    const byNew = await get(`/api/team/colonies?q=${encodeURIComponent("anna")}`).set("Accept", "application/json");
    expect((byNew.body.colonies as { id: number }[]).map((c) => c.id)).toContain(id);
  });

  it("a name that was redacted from the history no longer finds the colony", async () => {
    const oldName = `${P}Redactme-${RUN}`;
    const id = await makeColony(oldName);
    await post(`/api/team/colonies/${id}`, { name: `${P}Redacted new name` });
    const find = async (q: string) =>
      ((await get(`/api/team/colonies?q=${encodeURIComponent(q)}`).set("Accept", "application/json"))
        .body.colonies as { id: number }[]).map((c) => c.id);
    expect(await find(oldName)).toContain(id);
    await db
      .update(colonyNameHistoryTable)
      .set({
        name: "(name removed)",
        normalisedName: "(name removed)",
        redactedAt: new Date(),
        redactionReason: "guardian asked to be forgotten",
      })
      .where(eq(colonyNameHistoryTable.colonyId, id));
    expect(await find(oldName)).not.toContain(id);
    expect(await find("name removed")).not.toContain(id);
    // The current name still works.
    expect(await find("Redacted new name")).toContain(id);
  });

  it("a rename to a name another colony has is refused, with a link, and changes nothing", async () => {
    const a = await makeColony(unique("clash-a"));
    const b = await makeColony(unique("clash-b"));
    const bName = (await colonyRow(b))!.name;
    const res = await post(`/api/team/colonies/${a}`, { name: bName.toUpperCase() });
    expect(res.status).toBe(409);
    expect(res.text).toContain(`href="/api/team/colonies/${b}"`);
    expect((await colonyRow(a))!.name).not.toBe(bName);
    expect(await eventsOf(a)).toHaveLength(1);
    expect(
      await db.select().from(colonyNameHistoryTable).where(eq(colonyNameHistoryTable.colonyId, a)),
    ).toHaveLength(0);
  });

  it("a rename that changes only capitals or accents is a rename of the same colony", async () => {
    const id = await makeColony(`${P}Αγία`);
    const res = await post(`/api/team/colonies/${id}`, { name: `${P}ΑΓΊΑ` });
    expect(res.status).toBe(303);
    expect((await colonyRow(id))!.name).toBe(`${P}ΑΓΊΑ`);
    const [list] = (
      (await get(`/api/team/colonies?q=${encodeURIComponent(`${P}αγια`)}`).set("Accept", "application/json"))
        .body.colonies as { id: number }[]
    ).filter((c) => c.id === id);
    expect(list).toBeDefined();
  });

  it("two simultaneous creates of the same name produce exactly one colony", async () => {
    const name = unique("race");
    const results = await Promise.all([
      post("/api/team/colonies", { name }),
      post("/api/team/colonies", { name: name.toUpperCase() }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([303, 409]);
    const loser = results.find((r) => r.status === 409)!;
    const winner = results.find((r) => r.status === 303)!;
    const id = Number(/\/colonies\/(\d+)/.exec(winner.headers["location"] as string)![1]);
    // The loser sees the clash, with a link to the winner.
    expect(loser.text).toContain(`href="/api/team/colonies/${id}"`);
    const rows = await db.select().from(coloniesTable).where(like(coloniesTable.name, `${name.slice(0, -4)}%`));
    expect(rows.filter((r) => r.normalisedName === (rows.find((x) => x.id === id)!.normalisedName))).toHaveLength(1);
    expect(await eventsOf(id)).toHaveLength(1);
  });
});

describe("test 11 (part): one history row per change, in the same transaction", () => {
  it("every kind of write writes exactly one row, with before and after", async () => {
    const id = await makeColony(unique("hist"), { guardianName: "Eleni", notes: "old notes" });
    const kinds = async () => (await eventsOf(id)).map((e) => e.kind);
    expect(await kinds()).toEqual(["colony_created"]);

    expect((await post(`/api/team/colonies/${id}`, { guardianName: "Anna" })).status).toBe(303);
    expect(await kinds()).toEqual(["colony_created", "guardian_changed"]);

    expect((await post(`/api/team/colonies/${id}`, { notes: "new notes" })).status).toBe(303);
    expect(await kinds()).toEqual(["colony_created", "guardian_changed", "colony_notes_changed"]);

    expect((await post(`/api/team/colonies/${id}`, { lat: "37.4452", lng: "24.9423" })).status).toBe(303);
    expect((await colonyRow(id))).toMatchObject({ lat: 37.4452, lng: 24.9423 });
    expect(await kinds()).toEqual([
      "colony_created",
      "guardian_changed",
      "colony_notes_changed",
      "colony_centre_changed",
    ]);

    const newName = unique("hist-renamed");
    expect((await post(`/api/team/colonies/${id}`, { name: newName })).status).toBe(303);
    const events = await eventsOf(id);
    expect(events.map((e) => e.kind)).toEqual([
      "colony_created",
      "guardian_changed",
      "colony_notes_changed",
      "colony_centre_changed",
      "colony_renamed",
    ]);
    expect(events[1]).toMatchObject({ before: { guardianName: "Eleni" }, after: { guardianName: "Anna" } });
    expect(events[2]).toMatchObject({ before: { notes: "old notes" }, after: { notes: "new notes" } });
    expect(events[3]).toMatchObject({
      before: { centre: null },
      after: { centre: { lat: 37.4452, lng: 24.9423 } },
    });
    for (const e of events) expect(e.personId).toBe(susan);

    // Clearing the centre is a change too.
    expect((await post(`/api/team/colonies/${id}`, { lat: "", lng: "" })).status).toBe(303);
    expect(await kinds()).toHaveLength(6);
    expect(await colonyRow(id)).toMatchObject({ lat: null, lng: null });
  });

  it("sending the form again with nothing different writes nothing", async () => {
    const id = await makeColony(unique("same"), { guardianName: "Eleni", notes: "n" });
    const row = (await colonyRow(id))!;
    const res = await post(`/api/team/colonies/${id}`, {
      name: row.name,
      guardianName: "Eleni",
      notes: "n",
      lat: "",
      lng: "",
    });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/colonies/${id}?done=unchanged`);
    expect(await eventsOf(id)).toHaveLength(1);
    expect(
      await db.select().from(colonyNameHistoryTable).where(eq(colonyNameHistoryTable.colonyId, id)),
    ).toHaveLength(0);
  });

  it("changing several things at once writes one row for each", async () => {
    const id = await makeColony(unique("multi"));
    const res = await post(`/api/team/colonies/${id}`, {
      name: unique("multi-new"),
      guardianName: "Zoe",
      notes: "hello",
    });
    expect(res.status).toBe(303);
    expect((await eventsOf(id)).map((e) => e.kind).sort()).toEqual(
      ["colony_created", "colony_notes_changed", "colony_renamed", "guardian_changed"].sort(),
    );
  });

  it("a failure in the history write leaves a created colony not created", async () => {
    const name = unique("forced-create");
    vi.mocked(recordMappingEvent).mockImplementationOnce(async () => {
      throw new Error("forced failure in the history write");
    });
    const res = await post("/api/team/colonies", { name });
    expect(res.status).toBe(500);
    expect(await db.select().from(coloniesTable).where(eq(coloniesTable.name, name))).toHaveLength(0);
  });

  it("a failure in the history write leaves a changed colony unchanged, name history included", async () => {
    const name = unique("forced-change");
    const id = await makeColony(name, { guardianName: "Eleni", notes: "keep" });
    const eventsBefore = await eventsOf(id);
    vi.mocked(recordMappingEvent).mockImplementationOnce(async () => {
      throw new Error("forced failure in the history write");
    });
    const res = await post(`/api/team/colonies/${id}`, { name: unique("forced-new"), guardianName: "Changed" });
    expect(res.status).toBe(500);
    expect(await colonyRow(id)).toMatchObject({ name, guardianName: "Eleni", notes: "keep" });
    expect(
      await db.select().from(colonyNameHistoryTable).where(eq(colonyNameHistoryTable.colonyId, id)),
    ).toHaveLength(0);
    expect(await eventsOf(id)).toHaveLength(eventsBefore.length);
  });

  it("a failure on the second of two history writes undoes the first change too", async () => {
    const name = unique("forced-second");
    const id = await makeColony(name, { guardianName: "Eleni" });
    const real = vi.mocked(recordMappingEvent).getMockImplementation()!;
    vi.mocked(recordMappingEvent)
      .mockImplementationOnce(real)
      .mockImplementationOnce(async () => {
        throw new Error("forced failure on the second history write");
      });
    const res = await post(`/api/team/colonies/${id}`, { name: unique("forced-second-new"), guardianName: "Changed" });
    expect(res.status).toBe(500);
    expect(await colonyRow(id)).toMatchObject({ name, guardianName: "Eleni" });
    expect(await eventsOf(id)).toHaveLength(1);
  });
});

describe("test 16: a colony name with markup shows as text on every page", () => {
  it("never lets a name, guardian or note draw as markup", async () => {
    const name = `${P}${RUN} ${MARKUP}`;
    const guardian = `<b>G</b> ${MARKUP}`;
    const notes = `<script>alert(2)</script> ${MARKUP}`;
    const id = await makeColony(name, { guardianName: guardian, notes });
    const renamed = `${P}${RUN}-renamed <u>new</u> ${MARKUP}`;
    expect((await post(`/api/team/colonies/${id}`, { name: renamed, guardianName: `<i>H</i> ${MARKUP}` })).status).toBe(303);
    await post(`/api/team/colonies/${id}`, { notes: `<script>alert(3)</script>`, lat: "1", lng: "2" });

    const pages: [string, string][] = [
      ["list", (await get("/api/team/colonies")).text],
      ["list, found by an old name", (await get(`/api/team/colonies?q=${encodeURIComponent(`${RUN} <img`)}`)).text],
      ["search box", (await get(`/api/team/colonies?q=${encodeURIComponent(MARKUP)}`)).text],
      ["colony", (await get(`/api/team/colonies/${id}`)).text],
      ["clash on create", (await post("/api/team/colonies", { name: renamed })).text],
      ["clash on rename", (await post(`/api/team/colonies/${await makeColony(unique("other"))}`, { name: renamed })).text],
    ];
    for (const [label, html] of pages) {
      expect(html, label).not.toContain("<img src=x");
      expect(html, label).not.toContain("<script>alert");
      expect(html, label).not.toContain("<b>G</b>");
      expect(html, label).not.toContain("<u>new</u>");
      expect(html, label).not.toContain("<i>H</i>");
    }
    // …and the text is there, escaped.
    const list = pages[0]![1];
    expect(list).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(decoded(pages[1]![1])).toContain(`Used to be called: ${name}`);
    const colony = pages[3]![1];
    expect(colony).toContain("&lt;u&gt;new&lt;/u&gt;");
    // The history shows what it was called before and after.
    expect(decoded(colony)).toContain(`“${name}” → “${renamed}”`);
    expect(pages[4]![1]).toContain("&lt;u&gt;new&lt;/u&gt;");
  });
});

describe("the list and a colony's page", () => {
  it("counts sites and cats by the newest-statement rule, and shows the cat's photo", async () => {
    const a = await makeColony(unique("count-a"), { guardianName: "Eleni", notes: "Team only <b>notes</b>" });
    const b = await makeColony(unique("count-b"));
    const moved = await seedCat("moved");
    const stays = await seedCat("stays");
    const gone = await seedCat("gone");
    await colonyStatement(moved.id, a);
    await colonyStatement(moved.id, b); // A -> B: counts for B only
    await colonyStatement(stays.id, a);
    await colonyStatement(gone.id, a);
    await colonyStatement(gone.id, null); // in no colony: not counted
    await db.insert(feedingSitesTable).values([
      { name: `${P}site-1`, colonyId: a, lat: 37.4, lng: 24.9 },
      { name: `${P}site-2`, colonyId: a, lat: 37.4, lng: 24.9 },
      { name: `${P}site-closed`, colonyId: a, lat: 37.4, lng: 24.9, retiredAt: new Date() },
    ]);

    const json = await get("/api/team/colonies").set("Accept", "application/json");
    const find = (id: number) => (json.body.colonies as Record<string, unknown>[]).find((c) => c.id === id)!;
    expect(find(a)).toMatchObject({ guardianName: "Eleni", siteCount: 2, catCount: 1 });
    expect(find(b)).toMatchObject({ guardianName: null, siteCount: 0, catCount: 1 });

    const list = decoded((await get(`/api/team/colonies?q=${encodeURIComponent(`${P}count-a`)}`)).text);
    expect(list).toContain("Cat guardian: Eleni");
    expect(list).toContain("2 feeding sites · 1 cats");

    const page = (await get(`/api/team/colonies/${a}`)).text;
    expect(page).toContain(`href="/api/team/cats/${stays.id}"`);
    expect(page).toContain(`src="/api/team/photos/${stays.photoPublicId}"`);
    expect(page).not.toContain(`/api/team/cats/${moved.id}"`);
    expect(page).not.toContain(`/api/team/cats/${gone.id}"`);
    expect(page).toContain(`${P}site-1`);
    expect(page).not.toContain(`${P}site-closed`);
    expect(page).toContain("&lt;b&gt;notes&lt;/b&gt;");
    expect(decoded(page)).toContain("Don't write when people come and go.");
    // Team-only notes never need the colony to be public: nothing about a
    // colony is on a public route (the canary is test 1, PR 6.1).
    const asJson = await get(`/api/team/colonies/${a}`).set("Accept", "application/json");
    expect(asJson.body).toMatchObject({ siteCount: 2, catCount: 1, notes: "Team only <b>notes</b>" });
  });

  it("shows the history newest first, with 'Maria (left)' for someone who has left", async () => {
    const id = await makeColony(unique("people"), { guardianName: "Eleni" });
    expect((await post(`/api/team/colonies/${id}`, { guardianName: "Anna" }, { cookie: mariaCookie })).status).toBe(303);
    expect((await post(`/api/team/colonies/${id}`, { notes: "later" })).status).toBe(303);
    await markLeft(MARIA, "cli:vitest");

    const html = decoded((await get(`/api/team/colonies/${id}`)).text);
    const created = html.indexOf("Colony created");
    const guardian = html.indexOf("Cat guardian changed");
    const notes = html.indexOf("Team notes changed");
    expect(notes).toBeGreaterThan(-1);
    expect(notes).toBeLessThan(guardian);
    expect(guardian).toBeLessThan(created);
    expect(html).toContain("by Maria (left)");
    expect(html).toContain("by Susan");
    expect(html).toMatch(/Cat guardian changed: “Eleni” → “Anna”/);
    expect(html).toMatch(/<time datetime="[^"]+">\d{1,2} \w{3} \d{4}<\/time>/);
  });

  it("a search finds a colony by a Greek name typed in capitals", async () => {
    const id = await makeColony(`${P}Μιμή-${RUN}`);
    const found = await get(`/api/team/colonies?q=${encodeURIComponent(`ΜΙΜΗ-${RUN}`)}`).set("Accept", "application/json");
    expect((found.body.colonies as { id: number }[]).map((c) => c.id)).toEqual([id]);
    const none = await get(`/api/team/colonies?q=${encodeURIComponent(`no-such-${RUN}`)}`);
    expect(decoded(none.text)).toContain("No colony has ever had a name like that.");
    // % and _ in the box mean themselves.
    const wild = await get(`/api/team/colonies?q=${encodeURIComponent("%")}`).set("Accept", "application/json");
    expect((wild.body.colonies as unknown[]).length).toBe(0);
  });

  it("an unknown or malformed id gets the not-found page, HTML or JSON", async () => {
    for (const id of ["99999999", "abc", "1.5", "0000000000000000001"]) {
      const html = await get(`/api/team/colonies/${id}`);
      expect(html.status, id).toBe(404);
      expect(decoded(html.text)).toContain("There is no colony with that number.");
      const json = await get(`/api/team/colonies/${id}`).set("Accept", "application/json");
      expect(json.status).toBe(404);
    }
    const post404 = await post("/api/team/colonies/99999999", { guardianName: "x" });
    expect(post404.status).toBe(404);
  });

  it("the dashboard top bar has Colonies, and sets the dashboard's security headers", async () => {
    const res = await get("/api/team/colonies");
    expect(res.text).toContain('<a class="here" href="/api/team/colonies" aria-current="page">Colonies</a>');
    const other = await get("/api/team/cats");
    expect(other.text).toContain('<a href="/api/team/colonies">Colonies</a>');
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-security-policy"]).not.toContain("script-src");
  });
});

describe("the ?done= message is looked up safely", () => {
  it("names that exist on every object are no message, and no error", async () => {
    const id = await makeColony(unique("done"));
    for (const done of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      for (const path of ["/api/team/colonies", `/api/team/colonies/${id}`]) {
        const res = await get(`${path}?done=${done}`);
        expect(res.status, `${path} ${done}`).toBe(200);
        expect(res.text, `${path} ${done}`).not.toContain('class="notice"');
      }
    }
  });
});

describe("a NUL character", () => {
  const nul = String.fromCharCode(0);
  it("is a 400 in a name, guardian or notes, and writes nothing", async () => {
    const id = await makeColony(unique("nul"));
    const before = { colonies: await myColonyCount(), events: await colonyEventCount() };
    for (const field of ["name", "guardianName", "notes"]) {
      const bad = { [field]: `a${nul}b-${RUN}` };
      const create = await post("/api/team/colonies", { name: unique("nul-new"), ...bad });
      expect(create.status, `create ${field}`).toBe(400);
      expect(create.text).not.toContain(nul);
      const change = await post(`/api/team/colonies/${id}`, bad);
      expect(change.status, `change ${field}`).toBe(400);
    }
    expect({ colonies: await myColonyCount(), events: await colonyEventCount() }).toEqual(before);
  });

  it("in the search matches nothing, renders, and is not echoed", async () => {
    const res = await get(`/api/team/colonies?q=${encodeURIComponent(`mi${nul}mi`)}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(nul);
    expect(res.text).not.toContain("%00");
    expect(decoded(res.text)).toContain("No colony has ever had a name like that.");
    const json = await get(`/api/team/colonies?q=%00`).set("Accept", "application/json");
    expect(json.status).toBe(200);
    expect(json.body).toEqual({ query: "", colonies: [] });
  });
});

describe("test 12 (part): refusals", () => {
  it("every colony route answers the identical 401 with no session, and a person with no team role", async () => {
    const id = await makeColony(unique("refuse"));
    const before = { colonies: await myColonyCount(), events: await colonyEventCount() };
    for (const c of [null, volunteerCookie]) {
      for (const path of ["/api/team/colonies", `/api/team/colonies/${id}`]) {
        const res = await get(path, c).set("Accept", "application/json");
        expect([res.status, res.text], `${path} ${c ? "volunteer" : "anonymous"}`).toEqual([
          401,
          '{"error":"not_signed_in"}',
        ]);
      }
      const create = await post("/api/team/colonies", { name: unique("refused") }, { cookie: c }).set("Accept", "application/json");
      expect([create.status, create.text]).toEqual([401, '{"error":"not_signed_in"}']);
      const change = await post(`/api/team/colonies/${id}`, { guardianName: "Nope", name: unique("nope") }, { cookie: c }).set("Accept", "application/json");
      expect([change.status, change.text]).toEqual([401, '{"error":"not_signed_in"}']);
    }
    expect(await colonyRow(id)).toMatchObject({ guardianName: null });
    expect({ colonies: await myColonyCount(), events: await colonyEventCount() }).toEqual(before);
  });

  it("every POST refuses a foreign or missing Origin, and writes nothing", async () => {
    const id = await makeColony(unique("origin"));
    const before = { colonies: await myColonyCount(), events: await colonyEventCount() };
    for (const origin of [null, "https://evil.example.com", "https://admin.catspotters.com", `${TEAM_ORIGIN}.evil.com`]) {
      const create = await post("/api/team/colonies", { name: unique("origin-refused") }, { origin });
      expect([create.status, create.text], String(origin)).toEqual([401, '{"error":"not_signed_in"}']);
      const change = await post(`/api/team/colonies/${id}`, { guardianName: "Nope" }, { origin });
      expect([change.status, change.text], String(origin)).toEqual([401, '{"error":"not_signed_in"}']);
    }
    expect(await colonyRow(id)).toMatchObject({ guardianName: null });
    expect({ colonies: await myColonyCount(), events: await colonyEventCount() }).toEqual(before);
  });

  it("each write asks for its own capability, and a refusal writes nothing", async () => {
    const id = await makeColony(unique("caps"), { guardianName: "Eleni" });
    const eventsBefore = (await eventsOf(id)).length;
    const colonies = await myColonyCount();

    denied.cap = "create_colony";
    expect((await post("/api/team/colonies", { name: unique("no-create") })).status).toBe(401);
    expect(await myColonyCount()).toBe(colonies);

    denied.cap = "edit_colony";
    expect((await post(`/api/team/colonies/${id}`, { guardianName: "Nope" })).status).toBe(401);

    // The name needs rename_colony, not edit_colony.
    denied.cap = "rename_colony";
    const name = (await colonyRow(id))!.name;
    expect((await post(`/api/team/colonies/${id}`, { name: unique("no-rename") })).status).toBe(401);
    expect((await colonyRow(id))!.name).toBe(name);
    // A change that doesn't touch the name still goes through…
    expect((await post(`/api/team/colonies/${id}`, { name, guardianName: "Anna" })).status).toBe(303);
    // …but a rename together with a guardian change is refused whole.
    expect((await post(`/api/team/colonies/${id}`, { name: unique("no-rename-2"), guardianName: "Zoe" })).status).toBe(401);
    expect(await colonyRow(id)).toMatchObject({ name, guardianName: "Anna" });
    expect(await eventsOf(id)).toHaveLength(eventsBefore + 1);
    expect(
      await db.select().from(colonyNameHistoryTable).where(eq(colonyNameHistoryTable.colonyId, id)),
    ).toHaveLength(0);

    // The pages hide controls the person cannot use.
    denied.cap = "rename_colony";
    expect((await get(`/api/team/colonies/${id}`)).text).not.toContain('name="name"');
    denied.cap = "edit_colony";
    expect((await get(`/api/team/colonies/${id}`)).text).not.toContain('name="guardianName"');
    denied.cap = "create_colony";
    expect((await get("/api/team/colonies")).text).not.toContain("Create the colony");
    denied.cap = null;
    expect((await get(`/api/team/colonies/${id}`)).text).toContain('name="name"');
  });

  it("a bad centre is a 400 naming the fields, and writes nothing", async () => {
    const id = await makeColony(unique("centre"));
    const bad: Record<string, string>[] = [
      { lat: "37.4", lng: "" },
      { lat: "north", lng: "24.9" },
      { lat: "91", lng: "24.9" },
      { lat: "37.4" },
    ];
    for (const body of bad) {
      const res = await post(`/api/team/colonies/${id}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.text).not.toContain("north");
    }
    expect(await colonyRow(id)).toMatchObject({ lat: null, lng: null });
    expect(await eventsOf(id)).toHaveLength(1);
  });
});
