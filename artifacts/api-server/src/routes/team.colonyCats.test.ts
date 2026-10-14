import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import {
  addPerson,
  catsTable,
  coloniesTable,
  db,
  observationsTable,
  photosTable,
  pool,
} from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import { signInThroughHandoff, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { currentColonyOf } from "../lib/colonyMembership";

// SYC-209 PR 2.2: cats in colonies. Spec test 15 (the team's half), plus
// escaping (16), refusals (12) and the counts. Cats and colonies made here
// are unique to this run; colonies can't be deleted once they have history,
// so the throwaway database is dropped at the end of the run
// (src/test/globalSetup.ts).

// A staff member who lacks exactly one capability: today staff hold all
// of them, so `can` is wrapped (team.colonies.test.ts does the same).
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
const P = `vt-cc-${RUN}-`;
const SUSAN = `vitest-cc-susan-${RUN}@example.com`;
const KEY = "vitest-cc-key-0123456789abcdef-0123456789abcdef";
const handoffKey = makeKey();
const MARKUP = `<img src=x onerror="alert(1)"> "q" 'x'`;

let susan: string;
let cookie: string;
let n = 0;
const photoIds: number[] = [];
const catIds: number[] = [];

const unique = (label: string) => `${P}${label}-${(n += 1)}`;

function post(
  path: string,
  body: Record<string, string | string[]>,
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

const decoded = (html: string) =>
  html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

async function makeColony(name: string): Promise<number> {
  const res = await post("/api/team/colonies", { name });
  expect(res.status, res.text).toBe(303);
  return Number(/\/colonies\/(\d+)/.exec(res.headers["location"] as string)![1]);
}

async function seedCat(name: string): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${P}photo-${(n += 1)}`, data: "ZmFrZQ==", mime: "image/jpeg" })
    .returning({ id: photosTable.id });
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
  catIds.push(c!.id);
  return c!.id;
}

const colonyStatements = (catId: number) =>
  db
    .select()
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, catId), eq(observationsTable.kind, "colony")))
    .orderBy(asc(observationsTable.id));

const allStatements = (catId: number) =>
  db
    .select()
    .from(observationsTable)
    .where(eq(observationsTable.catId, catId))
    .orderBy(asc(observationsTable.id));

/** Moves a cat with the form the cat page uses; returns the response. */
const moveCat = (catId: number, colonyId: number | "none", extra: Record<string, string> = {}) =>
  post(`/api/team/cats/${catId}/colony`, { colonyId: String(colonyId), ...extra });

const addCats = (colonyId: number, ids: number[]) =>
  post(`/api/team/colonies/${colonyId}/cats`, { catIds: ids.map(String) });

/** The public cat as the app sees it, with the one field that always moves removed. */
async function publicCat(id: number) {
  const res = await get(`/api/cats/${id}`, null);
  expect(res.status, res.text).toBe(200);
  return res.body as Record<string, unknown>;
}

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  susan = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest" })).id;
  cookie = await signInThroughHandoff(app, handoffKey, susan);
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await db.delete(catsTable).where(like(catsTable.name, `${P}%`));
  await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  await pool.end();
});

describe("test 15 (team half): adding cats from a colony page", () => {
  it("writes one signed statement per ticked cat, in one go, and moves no derived status", async () => {
    const colony = await makeColony(unique("Vaporia"));
    const a = await seedCat("Mimi");
    const b = await seedCat("Tigger");
    const c = await seedCat("Bella");
    const before = await Promise.all([a, b, c].map(publicCat));

    const res = await addCats(colony, [a, b]);
    expect(res.status, res.text).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/colonies/${colony}?done=added`);

    for (const id of [a, b]) {
      const rows = await colonyStatements(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "colony",
        value: { colonyId: colony },
        accountId: susan,
        roleAtTime: "staff",
        supersedesId: null,
      });
    }
    expect(await colonyStatements(c)).toHaveLength(0);

    // The public cat is word for word what it was: life, sterilisation and
    // "last seen" did not move.
    const after = await Promise.all([a, b, c].map(publicCat));
    expect(after).toEqual(before);

    const m = await currentColonyOf([a, b, c]);
    expect([m.get(a), m.get(b), m.get(c)]).toEqual([colony, colony, undefined]);
  });

  it("a cat already in the colony is skipped, and ticking only such cats writes nothing", async () => {
    const colony = await makeColony(unique("Skip"));
    const a = await seedCat("Skip-a");
    await addCats(colony, [a]);
    const res = await addCats(colony, [a]);
    expect(res.headers["location"]).toBe(`/api/team/colonies/${colony}?done=nothingNew`);
    expect(await colonyStatements(a)).toHaveLength(1);
  });

  it("a colony that doesn't exist is refused and nothing is written", async () => {
    const a = await seedCat("Ghost-a");
    const missing = 999_999_999;
    const res = await addCats(missing, [a]);
    expect(res.status).toBe(404);
    expect(await colonyStatements(a)).toHaveLength(0);
    const json = await request(app)
      .post(`/api/team/colonies/${missing}/cats`)
      .set("Cookie", cookie)
      .set("Origin", TEAM_ORIGIN)
      .send({ catIds: [a] });
    expect(json.status).toBe(404);
    expect(await colonyStatements(a)).toHaveLength(0);
  });

  it("one cat that doesn't exist refuses the whole batch", async () => {
    const colony = await makeColony(unique("AllOrNone"));
    const a = await seedCat("AllOrNone-a");
    const res = await addCats(colony, [a, 999_999_999]);
    expect(res.status).toBe(400);
    expect(res.text).toContain("One of those cats");
    expect(await colonyStatements(a)).toHaveLength(0);
  });

  it("a bad form is a 400 naming fields only, and writes nothing", async () => {
    const colony = await makeColony(unique("Bad"));
    const a = await seedCat("Bad-a");
    for (const body of [{} as Record<string, string | string[]>, { catIds: "" }, { catIds: ["x"] }, { catIds: ["1e3"] }]) {
      const res = await post(`/api/team/colonies/${colony}/cats`, body);
      expect([res.status, body]).toEqual([400, body]);
    }
    const json = await request(app)
      .post(`/api/team/colonies/${colony}/cats`)
      .set("Cookie", cookie)
      .set("Origin", TEAM_ORIGIN)
      .send({ catIds: [a, "<script>"] });
    expect(json.status).toBe(400);
    expect(json.body).toEqual({ error: "Invalid request", fields: ["catIds.1"] });
    const tooMany = await request(app)
      .post(`/api/team/colonies/${colony}/cats`)
      .set("Cookie", cookie)
      .set("Origin", TEAM_ORIGIN)
      .send({ catIds: Array.from({ length: 101 }, (_, i) => i + 1) });
    expect(tooMany.status).toBe(400);
    expect(await colonyStatements(a)).toHaveLength(0);
  });

  it("the search finds cats by folded name or SYR number, and shows each cat's colony by name", async () => {
    const colony = await makeColony(unique("Finder"));
    const other = await makeColony(`${unique("Other")} — Eleni's`);
    const inOther = await seedCat("Mélissa");
    const free = await seedCat("Melissa-free");
    await addCats(other, [inOther]);
    await addCats(colony, [await seedCat("Melissa-here")]);

    // Accents and capitals fold away: "MELISSA" finds "Mélissa".
    const res = await get(`/api/team/colonies/${colony}/cats?q=${encodeURIComponent(`${P}MELISSA`)}`);
    expect(res.status).toBe(200);
    const html = decoded(res.text);
    expect(html).toContain(`${P}Mélissa`);
    expect(html).toContain(`${P}Melissa-free`);
    expect(html).toContain("No colony");
    expect(html).toContain(`In ${P}Other`);
    expect(html).toContain("Already in this colony");
    expect(html).toContain(`name="catIds" value="${free}"`);
    // The cat already here can't be ticked.
    expect(html).toMatch(/value="\d+" disabled/);

    const bySyr = await get(
      `/api/team/colonies/${colony}/cats?q=${encodeURIComponent(`SYR-${String(free).padStart(4, "0")}`)}`,
    );
    expect(bySyr.text).toContain(`${P}Melissa-free`);

    const json = await request(app)
      .get(`/api/team/colonies/${colony}/cats?q=${encodeURIComponent(`${P}melissa-free`)}`)
      .set("Cookie", cookie)
      .set("Accept", "application/json");
    expect(json.body.results).toEqual([
      expect.objectContaining({ id: free, name: `${P}Melissa-free`, colony: null }),
    ]);
  });

  it("a % or _ in the search means itself, and a NUL matches nothing and is not echoed", async () => {
    const colony = await makeColony(unique("Wild"));
    await seedCat("Wild-a");
    const pct = await get(`/api/team/colonies/${colony}/cats?q=%25`);
    expect(pct.status).toBe(200);
    expect(pct.text).toContain("No cat matches");
    const nul = await get(`/api/team/colonies/${colony}/cats?q=zq9x%00wv8y`);
    expect(nul.status).toBe(200);
    expect(nul.text).not.toContain("zq9x");
    expect(nul.text).not.toContain("\u0000");
  });

  it("the page for a colony that doesn't exist is the not-found page", async () => {
    const res = await get(`/api/team/colonies/999999999/cats`);
    expect(res.status).toBe(404);
    expect((await get(`/api/team/colonies/abc/cats`)).status).toBe(404);
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("test 15 (team half): the team's cat page and moving a cat", () => {
  it("moving writes a new statement, the newest stands, and both stay in the history by name", async () => {
    const a = await makeColony(unique("Alpha"));
    const b = await makeColony(unique("Beta"));
    const cat = await seedCat("Mover");
    expect((await moveCat(cat, a)).status).toBe(303);
    await sleep(5);
    const res = await moveCat(cat, b);
    expect(res.status, res.text).toBe(303);
    expect(res.headers["location"]).toMatch(new RegExp(`^/api/team/cats/${cat}\\?done=colony&s=\\d+#s-\\d+$`));

    const rows = await colonyStatements(cat);
    expect(rows.map((r) => (r.value as { colonyId: number }).colonyId)).toEqual([a, b]);
    expect(rows.every((r) => r.accountId === susan && r.roleAtTime === "staff")).toBe(true);
    expect((await currentColonyOf([cat])).get(cat)).toBe(b);

    const page = decoded((await get(`/api/team/cats/${cat}`)).text);
    expect(page).toContain(`<a href="/api/team/colonies/${b}">${P}Beta`);
    expect(page).not.toContain("Put in colony ");
    // Both statements are in the history, by name.
    expect(page).toContain(`Put in the colony “${P}Alpha`);
    expect(page).toContain(`Put in the colony “${P}Beta`);
    // The picker lists every colony, with the current one chosen.
    expect(page).toContain(`<option value="${b}" selected>`);
    expect(page).toContain(`<option value="${a}">`);
    expect(page).toContain("Take out of this colony");

    const json = await request(app)
      .get(`/api/team/cats/${cat}`)
      .set("Cookie", cookie)
      .set("Accept", "application/json");
    expect(json.body.colony).toEqual({ id: b, name: expect.stringContaining(`${P}Beta`), wasName: null });
  });

  it("a cat in no colony says so", async () => {
    const cat = await seedCat("Loner");
    const page = (await get(`/api/team/cats/${cat}`)).text;
    expect(page).toContain("Not in a colony");
    expect(page).not.toContain("Take out of this colony");
  });

  it("after a rename the cat page shows the new name with 'was' the old one, linked to the colony", async () => {
    const old = unique("Vaporia");
    const colony = await makeColony(old);
    const cat = await seedCat("Renamed");
    await moveCat(cat, colony);
    await sleep(5);
    const renamed = unique("Vaporia — Eleni's");
    expect(
      (await post(`/api/team/colonies/${colony}`, { name: renamed })).status,
    ).toBe(303);

    const html = decoded((await get(`/api/team/cats/${cat}`)).text);
    expect(html).toContain(`<a href="/api/team/colonies/${colony}">${renamed}</a> <span class="meta">(was ${old})</span>`);
    expect(html).toContain(`Put in the colony “${renamed} (was ${old})”`);

    // A cat put there after the rename was never in the old one: no "was".
    const later = await seedCat("Later");
    await sleep(5);
    await moveCat(later, colony);
    const laterHtml = decoded((await get(`/api/team/cats/${later}`)).text);
    expect(laterHtml).toContain(`${renamed}</a>`);
    expect(laterHtml).not.toContain("(was");
  });

  it("the colony counts on the Colonies page agree with currentColonyOf", async () => {
    const x = await makeColony(unique("CountX"));
    const y = await makeColony(unique("CountY"));
    const cats = [await seedCat("Count-1"), await seedCat("Count-2"), await seedCat("Count-3")];
    await addCats(x, cats);
    await moveCat(cats[2]!, y);
    await moveCat(cats[1]!, "none");

    const now = await currentColonyOf();
    const expected = (id: number) => [...now.values()].filter((c) => c === id).length;
    const res = await request(app)
      .get(`/api/team/colonies?q=${encodeURIComponent(`${P}Count`)}`)
      .set("Cookie", cookie)
      .set("Accept", "application/json");
    const byId = new Map<number, number>(
      (res.body.colonies as { id: number; catCount: number }[]).map((c) => [c.id, c.catCount]),
    );
    expect([byId.get(x), byId.get(y)]).toEqual([expected(x), expected(y)]);
    expect([byId.get(x), byId.get(y)]).toEqual([1, 1]);
  });

  it("a colony that doesn't exist, or a bad form, writes nothing", async () => {
    const cat = await seedCat("Nowhere");
    expect((await moveCat(cat, 999_999_999)).status).toBe(404);
    for (const body of [{}, { colonyId: "" }, { colonyId: "abc" }, { colonyId: "-1" }, { colonyId: "1\u0000" }]) {
      expect(
        [(await post(`/api/team/cats/${cat}/colony`, body as Record<string, string>)).status, body],
      ).toEqual([400, body]);
    }
    expect((await moveCat(999_999_999, "none")).status).toBe(404);
    expect(await colonyStatements(cat)).toHaveLength(0);
  });

  it("a person asking in JSON gets the id of the statement, or null if nothing was different", async () => {
    const colony = await makeColony(unique("Json"));
    const cat = await seedCat("Json-cat");
    const send = (colonyId: unknown) =>
      request(app)
        .post(`/api/team/cats/${cat}/colony`)
        .set("Cookie", cookie)
        .set("Origin", TEAM_ORIGIN)
        .send({ colonyId });
    const first = await send(colony);
    expect(first.status).toBe(201);
    expect(typeof first.body.id).toBe("number");
    const again = await send(colony);
    expect([again.status, again.body]).toEqual([200, { id: null }]);
    const out = await send(null);
    expect(out.status).toBe(201);
    expect(await colonyStatements(cat)).toHaveLength(2);
  });
});

describe("test 15 (team half): taking a cat out of a colony", () => {
  it("writes { colonyId: null }, and the earlier statement stays visible in the history", async () => {
    const colony = await makeColony(unique("Leaver"));
    const cat = await seedCat("Leaver-cat");
    await moveCat(cat, colony);
    const res = await moveCat(cat, "none");
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toMatch(/\?done=colonyOut&s=\d+#s-\d+$/);

    const rows = await colonyStatements(cat);
    expect(rows.map((r) => r.value)).toEqual([{ colonyId: colony }, { colonyId: null }]);
    expect(rows[1]).toMatchObject({ accountId: susan, roleAtTime: "staff" });
    expect((await currentColonyOf([cat])).has(cat)).toBe(false);

    const page = decoded((await get(`/api/team/cats/${cat}?done=colonyOut&s=${rows[1]!.id}`)).text);
    expect(page).toContain("Not in a colony");
    expect(page).toContain(`Put in the colony “${P}Leaver`);
    expect(page).toContain("Taken out of its colony");
    expect(page).toContain("The cat is out of its colony");
    // Gone from the colony page's cats.
    const colonyView = await request(app)
      .get(`/api/team/colonies/${colony}`)
      .set("Cookie", cookie)
      .set("Accept", "application/json");
    expect(colonyView.body.cats).toEqual([]);
  });

  it("from a colony page it goes back there; a cat moved since the page was drawn is left alone", async () => {
    const a = await makeColony(unique("From-A"));
    const b = await makeColony(unique("From-B"));
    const cat = await seedCat("From-cat");
    await moveCat(cat, a);

    // The colony page offers it per cat, and says which colony it is leaving.
    const html = (await get(`/api/team/colonies/${a}`)).text;
    expect(html).toContain(`action="/api/team/cats/${cat}/colony"`);
    expect(html).toContain(`name="from" value="${a}"`);
    expect(html).toContain("Take out of this colony");

    // Someone moves the cat to B; then the stale page's button is pressed.
    await moveCat(cat, b);
    const stale = await moveCat(cat, "none", { from: String(a) });
    expect(stale.status).toBe(303);
    expect(stale.headers["location"]).toBe(`/api/team/colonies/${a}?done=notThere`);
    expect((await currentColonyOf([cat])).get(cat)).toBe(b);
    expect(await colonyStatements(cat)).toHaveLength(2);

    // From B's page it works.
    const done = await moveCat(cat, "none", { from: String(b) });
    expect(done.headers["location"]).toBe(`/api/team/colonies/${b}?done=takenOut`);
    expect((await currentColonyOf([cat])).has(cat)).toBe(false);
    expect(await colonyStatements(cat)).toHaveLength(3);
  });

  it("taking out a cat that is in no colony writes nothing", async () => {
    const cat = await seedCat("Nobody");
    const res = await moveCat(cat, "none");
    expect(res.headers["location"]).toMatch(/\?done=colonyAlready#corrections$/);
    expect(await colonyStatements(cat)).toHaveLength(0);
  });
});

// Kept to the end of the file so later tests can reuse the helpers above.
void coloniesTable;
