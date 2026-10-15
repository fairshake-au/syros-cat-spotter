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
import { placeCats } from "../lib/colonyCats";
import { supersedeStatement } from "../lib/teamCorrections";

// SYC-209 PR 2.2: cats in colonies. Spec test 15 (the team's half), plus
// escaping (16), refusals (12) and the counts. Cats and colonies made here
// are unique to this run; colonies can't be deleted once they have history,
// so the throwaway database is dropped at the end of the run
// (src/test/globalSetup.ts).

// A staff member who lacks exactly one capability: today staff hold all
// of them, so `can` is wrapped (team.colonies.test.ts does the same).
// `cap`: lacks that one. `only`: holds that one and nothing else. `grant`: a
// scope with this role holds every capability and signs as that role (stands
// in for a future role that grants something, so that a write which does not
// go through actingRole shows up).
const denied = vi.hoisted(() => ({
  cap: null as string | null,
  only: null as string | null,
  grant: null as string | null,
}));
vi.mock("../lib/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/capabilities")>();
  return {
    ...real,
    can: (...args: Parameters<typeof real.can>) =>
      args[1] === denied.cap
        ? false
        : denied.only !== null && args[1] !== denied.only
          ? false
          : denied.grant !== null && args[0].scopes.some((sc) => sc.role === denied.grant)
            ? true
            : real.can(...args),
    // actingRole asks the real can() inside its own module, so the stand-in
    // role is answered here: a statement signed with it went through actingRole.
    actingRole: (...args: Parameters<typeof real.actingRole>) =>
      denied.grant !== null && args[0].scopes.some((sc) => sc.role === denied.grant)
        ? denied.grant
        : real.actingRole(...args),
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
  denied.only = null;
  denied.grant = null;
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
    expect(html).toContain('class="primary">Add the ticked cats</button>');
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
    expect(html).toContain(`<a href="/api/team/colonies/${colony}">${renamed}</a> <span class="meta">(was “${old}”)</span>`);
    expect(html).toContain(`Put in the colony “${renamed}” (was “${old}”)`);

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

/** "Mark wrong" on a statement, as the cat page's form posts it. */
const markWrong = (statementId: number, extra: Record<string, string> = {}) =>
  post(`/api/team/statements/${statementId}/wrong`, {
    choice: "colony_previous",
    reason: "Put in the wrong colony",
    ...extra,
  });

describe("test 15 (team half): Mark wrong on a colony statement", () => {
  it("A then B, then Mark wrong on B, puts the cat back in A, signed and pointing at B", async () => {
    const a = await makeColony(unique("Back-A"));
    const b = await makeColony(unique("Back-B"));
    const cat = await seedCat("Back-cat");
    await moveCat(cat, a);
    await moveCat(cat, b);
    const [first, second] = await colonyStatements(cat);

    const res = await markWrong(second!.id);
    expect(res.status, res.text).toBe(303);
    expect(res.headers["location"]).toMatch(new RegExp(`^/api/team/cats/${cat}\\?done=wrong&s=\\d+#s-\\d+$`));

    const rows = await colonyStatements(cat);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({
      value: { colonyId: a },
      supersedesId: second!.id,
      supersedeReason: "Put in the wrong colony",
      accountId: susan,
      roleAtTime: "staff",
    });
    expect((await currentColonyOf([cat])).get(cat)).toBe(a);
    void first;

    const page = decoded((await get(`/api/team/cats/${cat}`)).text);
    expect(page).toContain(`<a href="/api/team/colonies/${a}">`);
    // The wrong statement stays, struck through, with what replaced it.
    expect(page).toContain(`<del>Put in the colony “${P}Back-B`);
    // Marking it wrong again says someone already did.
    const again = await markWrong(second!.id);
    expect(again.headers["location"]).toMatch(/\?done=already&s=\d+#s-\d+$/);
    expect(await colonyStatements(cat)).toHaveLength(3);
  });

  it("with no earlier statement the cat is left in no colony", async () => {
    const a = await makeColony(unique("None-A"));
    const cat = await seedCat("None-cat");
    await moveCat(cat, a);
    const [only] = await colonyStatements(cat);
    expect((await markWrong(only!.id)).status).toBe(303);
    const rows = await colonyStatements(cat);
    expect(rows[1]!.value).toEqual({ colonyId: null });
    expect(rows[1]!.supersedesId).toBe(only!.id);
    expect((await currentColonyOf([cat])).has(cat)).toBe(false);
    expect(decoded((await get(`/api/team/cats/${cat}`)).text)).toContain("Not in a colony");
  });

  it("marking an older statement wrong leaves the newest standing; marking a take-out wrong restores the colony", async () => {
    const a = await makeColony(unique("Mid-A"));
    const b = await makeColony(unique("Mid-B"));
    const c = await makeColony(unique("Mid-C"));
    const cat = await seedCat("Mid-cat");
    await moveCat(cat, a);
    await moveCat(cat, b);
    await moveCat(cat, c);
    const [, middle] = await colonyStatements(cat);
    expect((await markWrong(middle!.id)).status).toBe(303);
    expect((await currentColonyOf([cat])).get(cat)).toBe(c);

    const cat2 = await seedCat("Out-cat");
    await moveCat(cat2, a);
    await moveCat(cat2, "none");
    const [, takeOut] = await colonyStatements(cat2);
    expect((await markWrong(takeOut!.id)).status).toBe(303);
    expect((await currentColonyOf([cat2])).get(cat2)).toBe(a);
  });

  it("the replacement is worked out on the server: a colony in the form or the JSON body is ignored", async () => {
    const a = await makeColony(unique("Host-A"));
    const b = await makeColony(unique("Host-B"));
    const evil = await makeColony(unique("Host-Evil"));
    const cat = await seedCat("Host-cat");
    await moveCat(cat, a);
    await moveCat(cat, b);
    const [, second] = await colonyStatements(cat);

    // The JSON route takes a value; for a colony statement it is not used.
    const res = await request(app)
      .post(`/api/team/observations/${second!.id}/supersede`)
      .set("Cookie", cookie)
      .set("Origin", TEAM_ORIGIN)
      .send({
        value: { colonyId: evil },
        reason: "trying to choose",
        observedAt: "2020-01-01T00:00:00Z",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.value).toEqual({ colonyId: a });
    // And it is dated now, not the date the caller sent.
    expect(Date.parse(res.body.observedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect((await currentColonyOf([cat])).get(cat)).toBe(a);

    // A colony smuggled into the form changes nothing either.
    const cat2 = await seedCat("Host-cat2");
    await moveCat(cat2, a);
    await moveCat(cat2, b);
    const [, second2] = await colonyStatements(cat2);
    await markWrong(second2!.id, { colonyId: String(evil), value: `{"colonyId":${evil}}` });
    expect((await currentColonyOf([cat2])).get(cat2)).toBe(a);
  });

  it("A, B, C: mark C wrong, then mark B wrong, and the cat is back in A", async () => {
    const a = await makeColony(unique("Twice-A"));
    const b = await makeColony(unique("Twice-B"));
    const c = await makeColony(unique("Twice-C"));
    const cat = await seedCat("Twice-cat");
    await moveCat(cat, a);
    await moveCat(cat, b);
    await moveCat(cat, c);
    const [, sb, sc] = await colonyStatements(cat);
    expect((await markWrong(sc!.id)).status).toBe(303);
    expect((await currentColonyOf([cat])).get(cat)).toBe(b);
    expect((await markWrong(sb!.id)).status).toBe(303);
    expect((await currentColonyOf([cat])).get(cat)).toBe(a);
  });

  it("A, B, C: marking B and C wrong at the same moment ends in A, whichever goes first", async () => {
    const a = await makeColony(unique("Both-A"));
    const b = await makeColony(unique("Both-B"));
    const c = await makeColony(unique("Both-C"));
    const cat = await seedCat("Both-cat");
    await moveCat(cat, a);
    await moveCat(cat, b);
    await moveCat(cat, c);
    const [, sb, sc] = await colonyStatements(cat);
    const results = await Promise.all([markWrong(sb!.id), markWrong(sc!.id)]);
    expect(results.map((r) => r.status)).toEqual([303, 303]);
    expect((await currentColonyOf([cat])).get(cat)).toBe(a);
  });

  it("holding only assign_cat_to_colony is enough, and the colony capability is the one it needs", async () => {
    const a = await makeColony(unique("Gate-A"));
    const b = await makeColony(unique("Gate-B"));
    const cat = await seedCat("Gate-cat");
    await moveCat(cat, a);
    await moveCat(cat, b);
    const [, second] = await colonyStatements(cat);

    // Someone who may set life status but not assign cats is refused, and
    // nothing is written.
    denied.only = "set_life_status";
    const refused = await markWrong(second!.id);
    expect([refused.status, refused.text]).toEqual([401, '{"error":"not_signed_in"}']);
    denied.cap = "assign_cat_to_colony";
    denied.only = null;
    expect((await markWrong(second!.id)).status).toBe(401);
    expect(await colonyStatements(cat)).toHaveLength(2);

    // Someone who may only assign cats can mark a colony statement wrong.
    denied.cap = null;
    denied.only = "assign_cat_to_colony";
    const ok = await markWrong(second!.id);
    expect(ok.status, ok.text).toBe(303);
    expect((await currentColonyOf([cat])).get(cat)).toBe(a);
  });

  it("the cat page offers Mark wrong on a colony statement only to someone who may assign", async () => {
    const a = await makeColony(unique("Form-A"));
    const cat = await seedCat("Form-cat");
    await moveCat(cat, a);
    const html = (await get(`/api/team/cats/${cat}`)).text;
    expect(html).toContain('name="choice" value="colony_previous"');
    expect(html).toContain("The cat goes back to the colony it was in before this");
    denied.cap = "assign_cat_to_colony";
    const without = (await get(`/api/team/cats/${cat}`)).text;
    expect(without).not.toContain("colony_previous");
  });

  it("a colony statement's Mark wrong never changes life status, sterilisation or last seen", async () => {
    const a = await makeColony(unique("Quiet-A"));
    const cat = await seedCat("Quiet-cat");
    await moveCat(cat, a);
    const before = await publicCat(cat);
    const [only] = await colonyStatements(cat);
    await markWrong(only!.id);
    expect(await publicCat(cat)).toEqual(before);
    // Every statement the cat has is a colony one.
    expect((await allStatements(cat)).every((r) => r.kind === "colony")).toBe(true);
  });
});

describe("the colony's history says which cats were added and taken out", () => {
  it("reads them from the colony statements, newest first, by name, and leaves a corrected one out", async () => {
    const a = await makeColony(unique("Hist-A"));
    const b = await makeColony(unique("Hist-B"));
    const c1 = await seedCat("Hist-1");
    const c2 = await seedCat("Hist-2");
    const c3 = await seedCat("Hist-3");
    await addCats(a, [c1, c2, c3]);
    await sleep(5);
    await moveCat(c1, "none");
    await sleep(5);
    await moveCat(c2, b);
    // c3 was put in by mistake: marked wrong, so it never counts as added.
    const [wrong] = await colonyStatements(c3);
    await markWrong(wrong!.id);

    const res = await request(app)
      .get(`/api/team/colonies/${a}`)
      .set("Cookie", cookie)
      .set("Accept", "application/json");
    const catLines = (res.body.history as { kind: string; by: string; after: { catId: number } }[]).filter(
      (h) => h.kind.startsWith("cat_"),
    );
    expect(catLines.map((h) => [h.kind, h.after.catId])).toEqual([
      ["cat_moved_out", c2],
      ["cat_taken_out", c1],
      ["cat_added", c2],
      ["cat_added", c1],
    ]);
    expect(catLines.every((h) => h.by === "Susan")).toBe(true);

    const html = decoded((await get(`/api/team/colonies/${a}`)).text);
    expect(html).toContain("Cat added");
    expect(html).toContain("Cat taken out");
    expect(html).toContain(`Cat moved to another colony: <a href="/api/team/cats/${c2}">${P}Hist-2</a>`);
    expect(html).toContain(`→ “${P}Hist-B`);
    // The colony's own pages count agree: it holds none of these three now.
    expect(res.body.catCount).toBe(0);
    // B sees c2 arrive.
    const bHtml = decoded((await get(`/api/team/colonies/${b}`)).text);
    expect(bHtml).toContain(`Cat added: <a href="/api/team/cats/${c2}">${P}Hist-2</a>`);
  });

  it("a colony with no cat ever added has none of these lines", async () => {
    const a = await makeColony(unique("Hist-empty"));
    const res = await request(app)
      .get(`/api/team/colonies/${a}`)
      .set("Cookie", cookie)
      .set("Accept", "application/json");
    expect((res.body.history as { kind: string }[]).map((h) => h.kind)).toEqual(["colony_created"]);
  });
});

describe("test 16 (escaping): a name with markup shows as text on every page this PR draws", () => {
  it("never lets a colony name, an old name or a cat name draw as markup", async () => {
    const colony = await makeColony(`${P}${MARKUP}-1`);
    const cat = await seedCat(`${MARKUP}-cat`);
    await addCats(colony, [cat]);
    await sleep(5);
    // A rename puts the markup into "was …" as well.
    await post(`/api/team/colonies/${colony}`, { name: `${P}${MARKUP}-2` });
    await moveCat(cat, "none");
    await moveCat(cat, colony);

    const find = encodeURIComponent(`${P}${MARKUP}-cat`);
    const pages = [
      `/api/team/colonies/${colony}/cats?q=${find}`,
      `/api/team/colonies/${colony}`,
      `/api/team/cats/${cat}`,
      `/api/team/cats/${cat}?done=colony`,
    ];
    for (const path of pages) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.text, path).not.toContain("<img src=x");
      expect(res.text, path).not.toContain('onerror="alert');
    }
    // The text is there, as text.
    const cats = await get(`/api/team/colonies/${colony}/cats?q=${find}`);
    expect(decoded(cats.text)).toContain(`${P}${MARKUP}-cat`);
    const catPage = decoded((await get(`/api/team/cats/${cat}`)).text);
    expect(catPage).toContain(`(was “${P}${MARKUP}-1”)`);
    const raw = (await get(`/api/team/colonies/${colony}`)).text;
    expect(raw).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("test 12 (part): refusals", () => {
  it("every new route answers the identical 401 with no session, and writes nothing", async () => {
    const colony = await makeColony(unique("Refuse"));
    const cat = await seedCat("Refuse-cat");
    const routes: [string, string, Record<string, string | string[]>][] = [
      ["get", `/api/team/colonies/${colony}/cats?q=x`, {}],
      ["post", `/api/team/colonies/${colony}/cats`, { catIds: [String(cat)] }],
      ["post", `/api/team/cats/${cat}/colony`, { colonyId: String(colony) }],
    ];
    for (const [method, path, body] of routes) {
      const t = request(app)[method as "get" | "post"](path);
      if (method === "post") t.set("Origin", TEAM_ORIGIN).type("form").send(body);
      const res = await t;
      expect([res.status, res.text], path).toEqual([401, '{"error":"not_signed_in"}']);
    }
    expect(await colonyStatements(cat)).toHaveLength(0);
  });

  it("every POST refuses a foreign or missing Origin, and writes nothing", async () => {
    const colony = await makeColony(unique("Origin"));
    const cat = await seedCat("Origin-cat");
    for (const origin of [null, "https://evil.example.com", "https://admin.catspotters.com", `${TEAM_ORIGIN}.evil.com`]) {
      const add = await post(`/api/team/colonies/${colony}/cats`, { catIds: [String(cat)] }, { origin });
      expect([add.status, add.text], String(origin)).toEqual([401, '{"error":"not_signed_in"}']);
      const move = await post(`/api/team/cats/${cat}/colony`, { colonyId: String(colony) }, { origin });
      expect([move.status, move.text], String(origin)).toEqual([401, '{"error":"not_signed_in"}']);
      const out = await post(`/api/team/cats/${cat}/colony`, { colonyId: "none" }, { origin });
      expect(out.status).toBe(401);
    }
    expect(await colonyStatements(cat)).toHaveLength(0);
  });

  it("each write asks for assign_cat_to_colony, hides its controls without it, and writes nothing", async () => {
    const colony = await makeColony(unique("Caps"));
    const cat = await seedCat("Caps-cat");
    denied.cap = "assign_cat_to_colony";
    expect((await addCats(colony, [cat])).status).toBe(401);
    expect((await moveCat(cat, colony)).status).toBe(401);
    expect((await moveCat(cat, "none")).status).toBe(401);
    expect((await get(`/api/team/colonies/${colony}/cats`)).status).toBe(401);
    expect(await colonyStatements(cat)).toHaveLength(0);

    // The pages hide what the person cannot use.
    const page = (await get(`/api/team/colonies/${colony}`)).text;
    expect(page).not.toContain(`/api/team/colonies/${colony}/cats`);
    const catPage = (await get(`/api/team/cats/${cat}`)).text;
    expect(catPage).not.toContain("<summary>Colony</summary>");
    denied.cap = null;
    expect((await get(`/api/team/cats/${cat}`)).text).toContain("<summary>Colony</summary>");
    expect((await get(`/api/team/colonies/${colony}`)).text).toContain(`/api/team/colonies/${colony}/cats`);
  });

  it("a NUL character is a 400 and writes nothing", async () => {
    const colony = await makeColony(unique("Nul"));
    const cat = await seedCat("Nul-cat");
    expect((await post(`/api/team/colonies/${colony}/cats`, { catIds: [`${cat}\u0000`] })).status).toBe(400);
    expect((await post(`/api/team/cats/${cat}/colony`, { colonyId: `${colony}\u0000` })).status).toBe(400);
    expect((await post(`/api/team/cats/${cat}/colony`, { colonyId: "none", from: `${colony}\u0000` })).status).toBe(400);
    expect((await post(`/api/team/statements/1/wrong`, { choice: "colony_previous", reason: "x\u0000y" })).status).toBe(400);
    expect(await colonyStatements(cat)).toHaveLength(0);
  });

  it("the ?done= message is looked up safely on the pages this PR changes", async () => {
    const colony = await makeColony(unique("Done"));
    const cat = await seedCat("Done-cat");
    for (const done of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      for (const path of [`/api/team/colonies/${colony}`, `/api/team/cats/${cat}`]) {
        const res = await get(`${path}?done=${done}`);
        expect(res.status, `${path} ${done}`).toBe(200);
        expect(res.text, `${path} ${done}`).not.toContain('class="notice"');
      }
    }
  });
});

describe("the role a colony statement is signed with comes from actingRole", () => {
  it("is the role that granted the capability, for adding, moving, taking out and Mark wrong", async () => {
    // A person whose only scope is a role that (in this test) grants the
    // capability: the statements must say that role, not a hand-written "staff".
    const person = { id: susan, scopes: [{ role: "management", colonyId: null }] };
    denied.grant = "management";
    const colony = await makeColony(unique("Role"));
    const cat = await seedCat("Role-cat");

    expect((await placeCats(person, colony, [cat])).kind).toBe("done");
    expect((await placeCats(person, null, [cat])).kind).toBe("done");
    const [, takeOut] = await colonyStatements(cat);
    await supersedeStatement(person, { id: takeOut!.id, value: {}, reason: "wrong" });

    const rows = await colonyStatements(cat);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.roleAtTime)).toEqual(["management", "management", "management"]);
    expect((await currentColonyOf([cat])).get(cat)).toBe(colony);
  });
});

describe("which colony stands follows the spine's rule: superseded statements never count", () => {
  it("a correction dated earlier than the statement it replaces still wins over it", async () => {
    const a = await makeColony(unique("Rule-A"));
    const b = await makeColony(unique("Rule-B"));
    const cat = await seedCat("Rule-cat");
    const at = (iso: string) => new Date(iso);
    const insert = async (colonyId: number, observedAt: Date, supersedesId?: number) =>
      (
        await db
          .insert(observationsTable)
          .values({
            catId: cat,
            kind: "colony",
            value: { colonyId },
            accountId: susan,
            roleAtTime: "staff",
            observedAt,
            ...(supersedesId ? { supersedesId, supersedeReason: "rule test" } : {}),
          })
          .returning({ id: observationsTable.id })
      )[0]!.id;
    await insert(a, at("2026-09-01T10:00:00Z"));
    const wrong = await insert(b, at("2026-09-01T10:01:00Z"));
    // Written later, but dated between the two: B is superseded, so A stands.
    await insert(a, at("2026-09-01T10:00:30Z"), wrong);

    expect((await currentColonyOf([cat])).get(cat)).toBe(a);
    const json = await request(app)
      .get(`/api/team/cats/${cat}`)
      .set("Cookie", cookie)
      .set("Accept", "application/json");
    expect(json.body.colony).toMatchObject({ id: a });
    const counts = await request(app)
      .get(`/api/team/colonies?q=${encodeURIComponent(`${P}Rule`)}`)
      .set("Cookie", cookie)
      .set("Accept", "application/json");
    const byId = new Map<number, number>(
      (counts.body.colonies as { id: number; catCount: number }[]).map((c) => [c.id, c.catCount]),
    );
    expect([byId.get(a), byId.get(b)]).toEqual([1, 0]);
  });
});

describe("two people changing one cat at the same moment", () => {
  /**
   * Holds the cat's row lock from a connection of its own, starts the
   * requests, waits until `n` of them are queued behind the lock (polled
   * from a connection OUTSIDE any transaction: Postgres keeps one snapshot
   * per transaction), then lets them go. With the cat locks removed nothing
   * queues, and this fails.
   */
  async function whileHeld<T>(catId: number, n: number, fire: () => Promise<T>[]): Promise<T[]> {
    const holder = await pool.connect();
    let pending: Promise<T[]> | null = null;
    try {
      await holder.query("begin");
      await holder.query("select id from cats where id = $1 for update", [catId]);
      pending = Promise.all(fire());
      let waiting = 0;
      for (let i = 0; i < 100 && waiting < n; i++) {
        const r = await pool.query<{ n: string }>(
          `select count(*)::text as n from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock'
             and query ilike '%cats%for update%' and pid <> pg_backend_pid()`,
        );
        waiting = Number(r.rows[0]!.n);
        if (waiting < n) await sleep(50);
      }
      expect(waiting, "requests queued behind the cat's lock").toBeGreaterThanOrEqual(n);
    } finally {
      await holder.query("commit");
      holder.release();
    }
    return pending!;
  }

  it("two moves to different colonies write two statements, and one of them stands", async () => {
    const b = await makeColony(unique("Race-B"));
    const c = await makeColony(unique("Race-C"));
    const cat = await seedCat("Race-cat");
    const res = await whileHeld(cat, 2, () => [moveCat(cat, b), moveCat(cat, c)]);
    expect(res.map((r) => r.status)).toEqual([303, 303]);
    const rows = await colonyStatements(cat);
    expect(rows.map((r) => (r.value as { colonyId: number }).colonyId).sort()).toEqual([b, c].sort());
    // The newest statement stands, whichever went second.
    const newest = rows[rows.length - 1]!.value as { colonyId: number };
    expect((await currentColonyOf([cat])).get(cat)).toBe(newest.colonyId);
  });

  it("two take-outs from the same colony write one statement: the second finds the cat gone", async () => {
    const a = await makeColony(unique("Race-out"));
    const cat = await seedCat("Race-out-cat");
    await moveCat(cat, a);
    const res = await whileHeld(cat, 2, () => [
      moveCat(cat, "none", { from: String(a) }),
      moveCat(cat, "none", { from: String(a) }),
    ]);
    expect(res.map((r) => r.headers["location"]).sort()).toEqual([
      `/api/team/colonies/${a}?done=notThere`,
      `/api/team/colonies/${a}?done=takenOut`,
    ]);
    expect(await colonyStatements(cat)).toHaveLength(2);
  });

  it("marking two of a cat's statements wrong at once queues them, and the cat ends where the originals say", async () => {
    const a = await makeColony(unique("Race-wrong-A"));
    const b = await makeColony(unique("Race-wrong-B"));
    const c = await makeColony(unique("Race-wrong-C"));
    const cat = await seedCat("Race-wrong-cat");
    await moveCat(cat, a);
    await moveCat(cat, b);
    await moveCat(cat, c);
    const [, sb, sc] = await colonyStatements(cat);
    const res = await whileHeld(cat, 2, () => [markWrong(sb!.id), markWrong(sc!.id)]);
    expect(res.map((r) => r.status)).toEqual([303, 303]);
    expect((await currentColonyOf([cat])).get(cat)).toBe(a);
  });
});

// Kept to the end of the file so later tests can reuse the helpers above.
void coloniesTable;
