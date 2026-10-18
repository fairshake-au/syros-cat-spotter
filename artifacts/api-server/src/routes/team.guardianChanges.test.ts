import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { addPerson, pool } from "@workspace/db";
import app from "../app";
import { sessionCookieFor, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { createColony } from "../lib/teamColonies";
import { addSite, moveSite } from "../lib/teamSiteWrites";
import { placeCats } from "../lib/colonyCats";
import { RECENT_GUARDIAN_CHANGES, type RecentGuardianChange } from "../lib/recentGuardianChanges";
import { day } from "../lib/teamPages/colonyPages";
import { guardianOn, seedCat, type Signed } from "../test/roleKit";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-209 PR 4.3: "Recent changes by cat guardians" at the top of the team's
// Colonies page (feeding-sites spec §2.6; plan PR 4.3, K6; test 21's last
// part). Team-only (`view_guardian_changes`, island-only): a cat guardian
// never sees it, on the page or as JSON, and asking for it gets the 403.
//
// Eleni is a cat guardian of colony 1, Zoe of colony 2. Susan is the team.

const RUN = randomBytes(3).toString("hex");
const KEY = "vitest-guardianchanges-key-0123456789abcdef-01";
const C1_NAME = `Vaporia ${RUN}`;
const C2_NAME = `Kini ${RUN}`;
const TITLE = "Recent changes by cat guardians";

let staffId: string;
let staffCookie: string;
let eleni: Signed;
let zoe: Signed;
let eleniName: string;
let c1: number;
let c2: number;

type Mode = "json" | "browser";
function get(path: string, cookie: string, mode: Mode = "browser") {
  const t = request(app).get(path).set("Cookie", cookie);
  return mode === "json" ? t.set("Accept", "application/json") : t.set("Sec-Fetch-Mode", "navigate");
}
function post(path: string, body: Record<string, string>, cookie: string) {
  return request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", cookie).set("Accept", "application/json").send(body);
}
const stampOf = async (id: number) =>
  String(
    (
      await pool.query(
        "select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as s from feeding_sites where id = $1",
        [id],
      )
    ).rows[0].s,
  );

async function teamList(): Promise<RecentGuardianChange[]> {
  const res = await get("/api/team/guardian-changes", staffCookie, "json");
  expect(res.status).toBe(200);
  return (res.body as { changes: RecentGuardianChange[] }).changes;
}

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  staffId = (
    await addPerson({ email: `vitest-gchg-staff-${RUN}@example.com`, name: `Susan ${RUN}`, addedBy: "cli:vitest" })
  ).id;
  staffCookie = sessionCookieFor(staffId);
  const made1 = await createColony(staffId, { name: C1_NAME, guardianName: "Eleni", notes: null });
  const made2 = await createColony(staffId, { name: C2_NAME, guardianName: "Zoe", notes: null });
  if (made1.kind !== "created" || made2.kind !== "created") throw new Error("seed colonies");
  c1 = made1.id;
  c2 = made2.id;
  eleni = await guardianOn(`gchg-eleni-${RUN}`, [c1]);
  zoe = await guardianOn(`gchg-zoe-${RUN}`, [c2]);
  eleniName = (await pool.query<{ name: string }>("select name from people where id = $1", [eleni.id])).rows[0]!.name;
});

afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  for (const p of [eleni, zoe]) if (p) await removeTestPerson(p.email).catch(() => undefined);
  await pool.end();
});

describe("test 21's last part: a cat guardian creates a colony", () => {
  let made: number;

  it("colonies 1 and 2 stay invisible to each other, and the new colony appears in the team's list", async () => {
    const name = `Kambos ${RUN}`;
    const res = await post("/api/team/colonies", { name }, eleni.cookie);
    expect(res.status).toBe(201);
    made = (res.body as { id: number }).id;

    // Still invisible to each other: the other's colony is "not found", and
    // neither list names it.
    expect((await get(`/api/team/colonies/${c2}`, eleni.cookie, "json")).status).toBe(404);
    expect((await get(`/api/team/colonies/${c1}`, zoe.cookie, "json")).status).toBe(404);
    expect((await get(`/api/team/colonies/${made}`, zoe.cookie, "json")).status).toBe(404);
    const hers = (await get("/api/team/colonies", eleni.cookie, "json")).body as { colonies: { id: number }[] };
    expect(hers.colonies.map((c) => c.id).sort()).toEqual([c1, made].sort());
    const zoes = (await get("/api/team/colonies", zoe.cookie, "json")).body as { colonies: { id: number }[] };
    expect(zoes.colonies.map((c) => c.id)).toEqual([c2]);

    // The team's list leads with it: her name, the day, the colony.
    const [first] = await teamList();
    expect(first).toMatchObject({
      kind: "colony_created",
      guardian: { id: eleni.id, name: eleniName, left: false },
      colony: { id: made, name },
    });
    const page = await get("/api/team/colonies", staffCookie);
    expect(page.status).toBe(200);
    const section = page.text.slice(page.text.indexOf(TITLE));
    expect(section).toContain(`<strong>${eleniName}</strong> created a colony`);
    expect(section).toContain(`<a href="/api/team/colonies/${made}">${name}</a>`);
    expect(section).toContain(`>${day(first!.at)}</time>`);
    // At the top: before the search and the list.
    expect(page.text.indexOf(TITLE)).toBeLessThan(page.text.indexOf('role="search"'));
  });
});

describe("what goes in the list", () => {
  it("her sites added and moved, and cats put in and taken out, each with her name, the day and the colony", async () => {
    const site = await addSite(eleni.id, { name: `Steps ${RUN}`, lat: 37.4451, lng: 24.9421, colonyId: c1, directions: null, notes: null });
    if (site.kind !== "created") throw new Error("seed site");
    const moved = await moveSite(eleni.id, site.id, await stampOf(site.id), { lat: 37.4453, lng: 24.9423 }, "better spot");
    expect(moved.kind).toBe("saved");
    const her = { id: eleni.id, scopes: [{ role: "guardian" as const, colonyId: c1 }] };
    const cat = await seedCat(null);
    await placeCats(her, c1, [cat.id]);
    await placeCats(her, null, [cat.id], { onlyFrom: c1 });
    const catName = (await pool.query("select name from cats where id = $1", [cat.id])).rows[0].name as string;

    const top = (await teamList()).slice(0, 4);
    expect(top.map((c) => c.kind)).toEqual(["cat_taken_out", "cat_added", "site_moved", "site_added"]);
    for (const c of top) {
      expect(c.guardian?.id).toBe(eleni.id);
      expect(c.colony).toEqual({ id: c1, name: C1_NAME });
    }
    expect(top[0]!.cat).toEqual({ id: cat.id, name: catName });
    expect(top[2]!.site).toEqual({ id: site.id, name: `Steps ${RUN}` });
    // Never a position, in any form.
    const json = JSON.stringify(top);
    expect(json).not.toMatch(/37\.44|24\.94|"lat"|"lng"/);

    const page = (await get("/api/team/colonies", staffCookie)).text;
    expect(page).toContain(`<strong>${eleniName}</strong> took ${catName} out of a colony`);
    expect(page).toContain(`<strong>${eleniName}</strong> put ${catName} in a colony`);
    expect(page).toContain(`<strong>${eleniName}</strong> moved a feeding site: Steps ${RUN}`);
    expect(page).toContain(`<strong>${eleniName}</strong> added a feeding site: Steps ${RUN}`);
    expect(page).not.toMatch(/37\.445|24\.942/);
  });

  it("only cat guardians' changes: the team's own sites and cats never appear", async () => {
    const site = await addSite(staffId, { name: `Team spot ${RUN}`, lat: 37.4455, lng: 24.9425, colonyId: c1, directions: null, notes: null });
    if (site.kind !== "created") throw new Error("seed site");
    await moveSite(staffId, site.id, await stampOf(site.id), { lat: 37.4456, lng: 24.9426 }, "team move");
    const cat = await seedCat(null);
    await placeCats({ id: staffId, scopes: [{ role: "staff", colonyId: null }] }, c1, [cat.id]);
    const list = await teamList();
    expect(list.some((c) => c.site?.id === site.id)).toBe(false);
    expect(list.some((c) => c.cat?.id === cat.id)).toBe(false);
    expect(list.every((c) => c.guardian?.id !== staffId)).toBe(true);
    expect((await get("/api/team/colonies", staffCookie)).text).not.toContain(`Team spot ${RUN}`);
  });

  it("only the four kinds of change: her other statements (sterilised, say) are not listed here", async () => {
    const cat = await seedCat(c1);
    await pool.query(
      `insert into observations (cat_id, kind, value, account_id, role_at_time, authority_scope, observed_at)
       values ($1, 'sterilised', '{"sterilised": true}', $2, 'guardian', $3, now())`,
      [cat.id, eleni.id, `colony:${c1}`],
    );
    expect((await teamList()).some((c) => c.cat?.id === cat.id)).toBe(false);
  });

  it("a burst of her other statements never pushes a cat off the list (review M1)", async () => {
    const her = { id: eleni.id, scopes: [{ role: "guardian" as const, colonyId: c1 }] };
    const cat = await seedCat(null);
    await placeCats(her, c1, [cat.id]);
    // 210 newer statements of another kind: more than the roles reader's 200.
    await pool.query(
      `insert into observations (cat_id, kind, value, account_id, role_at_time, authority_scope, observed_at)
       select $1, 'sterilised', '{"sterilised": true}', $2, 'guardian', $3, now() from generate_series(1, 210)`,
      [cat.id, eleni.id, `colony:${c1}`],
    );
    const list = await teamList();
    expect(list[0]).toMatchObject({ kind: "cat_added", cat: { id: cat.id }, colony: { id: c1 } });
  });

  it("a statement not written as a cat guardian is not listed, even one naming a colony", async () => {
    const cat = await seedCat(null);
    await pool.query(
      `insert into observations (cat_id, kind, value, account_id, role_at_time, authority_scope, observed_at)
       values ($1, 'colony', $2, $3, 'staff', $4, now())`,
      [cat.id, JSON.stringify({ colonyId: c1 }), staffId, `colony:${c1}`],
    );
    expect((await teamList()).some((c) => c.cat?.id === cat.id)).toBe(false);
  });

  it("a colony statement that doesn't say where the cat went is not listed (review m3)", async () => {
    const cat = await seedCat(c1);
    await pool.query(
      `insert into observations (cat_id, kind, value, account_id, role_at_time, authority_scope, observed_at)
       values ($1, 'colony', '{"retracted": true}', $2, 'guardian', $3, now())`,
      [cat.id, eleni.id, `colony:${c1}`],
    );
    expect((await teamList()).some((c) => c.cat?.id === cat.id)).toBe(false);
  });

  it("malformed rows never take a place in the twenty", async () => {
    const her = { id: eleni.id, scopes: [{ role: "guardian" as const, colonyId: c1 }] };
    const cat = await seedCat(null);
    await placeCats(her, c1, [cat.id]);
    await pool.query(
      `insert into observations (cat_id, kind, value, account_id, role_at_time, authority_scope, observed_at)
       select $1, 'colony', '{"retracted": true}', $2, 'guardian', $3, now() from generate_series(1, 25)`,
      [cat.id, eleni.id, `colony:${c1}`],
    );
    expect((await teamList())[0]).toMatchObject({ kind: "cat_added", cat: { id: cat.id } });
  });

  it("someone who is both the team and a cat guardian acts as the team: her site isn't listed", async () => {
    const both = await guardianOn(`gchg-both-${RUN}`, [c1]);
    await pool.query(
      "insert into person_scopes (person_id, role, colony_id, reach) values ($1, 'staff', null, 'island')",
      [both.id],
    );
    const site = await addSite(both.id, { name: `Both ${RUN}`, lat: 37.4458, lng: 24.9428, colonyId: c1, directions: null, notes: null });
    if (site.kind !== "created") throw new Error("seed site");
    expect((await teamList()).some((c) => c.site?.id === site.id)).toBe(false);
    await removeTestPerson(both.email).catch(() => undefined);
  });

  it("a cat guardian on another colony isn't credited with a site in this one", async () => {
    const site = await addSite(zoe.id, { name: `Not hers ${RUN}`, lat: 37.4459, lng: 24.9429, colonyId: c1, directions: null, notes: null });
    if (site.kind !== "created") throw new Error("seed site");
    expect((await teamList()).some((c) => c.site?.id === site.id)).toBe(false);
  });

  it("a cat guardian who has left is shown as having left", async () => {
    const gone = await guardianOn(`gchg-gone-${RUN}`, [c2]);
    await addSite(gone.id, { name: `Gone ${RUN}`, lat: 37.446, lng: 24.943, colonyId: c2, directions: null, notes: null });
    await pool.query("update people set left_at = now() where id = $1", [gone.id]);
    const name = (await pool.query("select name from people where id = $1", [gone.id])).rows[0].name as string;
    expect((await teamList())[0]).toMatchObject({ kind: "site_added", guardian: { id: gone.id, left: true } });
    expect((await get("/api/team/colonies", staffCookie)).text).toContain(`<strong>${name} (has left)</strong> added a feeding site: Gone ${RUN}`);
    await removeTestPerson(gone.email).catch(() => undefined);
  });

  it("a name someone typed is escaped, never markup", async () => {
    const odd = await guardianOn(`gchg-odd-${RUN}`, [c2]);
    await pool.query("update people set name = $1 where id = $2", [`<b>Odd</b> ${RUN}`, odd.id]);
    await addSite(odd.id, { name: `<i>spot</i> ${RUN}`, lat: 37.4457, lng: 24.9427, colonyId: c2, directions: null, notes: null });
    const page = (await get("/api/team/colonies", staffCookie)).text;
    expect(page).toContain(`<strong>&lt;b&gt;Odd&lt;/b&gt; ${RUN}</strong> added a feeding site: &lt;i&gt;spot&lt;/i&gt; ${RUN}`);
    expect(page).not.toContain("<b>Odd</b>");
    await removeTestPerson(odd.email).catch(() => undefined);
  });
});

describe("twenty at most", () => {
  it("the route and the page both stop at twenty, newest first", async () => {
    // One cat in and out 26 times: 26 changes without adding 25 cats to the
    // shared test database (other files page through every cat).
    const her = { id: eleni.id, scopes: [{ role: "guardian" as const, colonyId: c1 }] };
    const cat = await seedCat(null);
    const kinds: string[] = [];
    for (let i = 0; i < 13; i++) {
      await placeCats(her, c1, [cat.id]);
      kinds.push("cat_added");
      await placeCats(her, null, [cat.id], { onlyFrom: c1 });
      kinds.push("cat_taken_out");
    }
    const list = await teamList();
    expect(RECENT_GUARDIAN_CHANGES).toBe(20);
    expect(list).toHaveLength(20);
    // The newest twenty, newest first.
    expect(list.map((c) => [c.kind, c.cat?.id])).toEqual(kinds.slice(-20).reverse().map((k) => [k, cat.id]));
    const page = (await get("/api/team/colonies", staffCookie)).text;
    const section = page.slice(page.indexOf('id="recent-guardian-changes"'), page.indexOf("</ol>", page.indexOf('id="recent-guardian-changes"')));
    expect(section.match(/<li /g)).toHaveLength(20);
    const json = (await get("/api/team/colonies", staffCookie, "json")).body as { recentChanges: unknown[] };
    expect(json.recentChanges).toHaveLength(20);
  });
});

describe("a cat guardian never sees the list", () => {
  it("not on her Colonies page, not in its JSON, and asking for it directly is a 403", async () => {
    for (const g of [eleni, zoe]) {
      const page = await get("/api/team/colonies", g.cookie);
      expect(page.status).toBe(200);
      expect(page.text).not.toContain(TITLE);
      expect(page.text).not.toContain("recent-guardian-changes");
      const json = await get("/api/team/colonies", g.cookie, "json");
      expect(json.status).toBe(200);
      expect(Object.keys(json.body as object).sort()).toEqual(["colonies", "query"]);
      const direct = await get("/api/team/guardian-changes", g.cookie, "json");
      expect([direct.status, direct.text]).toEqual([403, '{"error":"forbidden"}']);
      const directPage = await get("/api/team/guardian-changes", g.cookie);
      expect(directPage.status).toBe(403);
      expect(directPage.text).not.toContain(TITLE);
    }
  });

  it("the team's browser is sent to the Colonies page, where the list is drawn", async () => {
    const res = await get("/api/team/guardian-changes", staffCookie);
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe("/api/team/colonies#recent-changes-title");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
