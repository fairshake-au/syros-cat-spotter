import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { areaByKey } from "../lib/areas/namedAreas";
import { guardianOn, newColony, RUN, signedPerson, type Signed } from "../test/roleKit";
import { isOpenMapLink } from "../test/openMapLink";

// SYC-396 PR 2.4 (plan Task 2.4.3; dashboard §3.3): the Areas page. Team-only
// (edit_named_areas). Areas written here use this run's own keys and sit in
// the sea off Syros's north-east corner, more than 2 km from every seed
// centre; the seed rows are never changed (see areaWrites.test.ts).

const KEY = "vitest-areas-key-0123456789abcdef-0123456789";
const k = (s: string) => `vt-${RUN}-${s}`;
const nm = (s: string) => `VT ${RUN} ${s}`;
// Its own point: the sea off the north-east corner, about 5.5 km from Chalandriani.
const SEA = { lat: "37.51500", lng: "24.98500" };
const NUM = { lat: 37.515, lng: 24.985 };

let team: Signed;
let guardian: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  team = await signedPerson("areas-team", ["staff"]);
  guardian = await guardianOn("areas-guardian", [await newColony("areas")]);
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  await pool.end();
});

const page = (cookie: string) => request(app).get("/api/team/areas").set("Cookie", cookie).set("Accept", "text/html");
const send = (cookie: string, body: Record<string, string>) =>
  request(app).post("/api/team/areas").set("Origin", TEAM_ORIGIN).set("Cookie", cookie).set("Accept", "text/html").type("form").send(body);

/** Every href and action on a page, as written. */
const addresses = (html: string) => [...html.matchAll(/\b(?:href|action)="([^"]*)"/g)].map((m) => m[1]!);

describe("the Areas page", () => {
  it("lists every area with its centre, and says the version", async () => {
    const res = await page(team.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("<h3>Kini</h3>");
    expect(res.text).toContain("37.44360, 24.88890");
    expect(res.text).toMatch(/This is version \d+\./);
    expect(res.text).toContain("nearest this centre");
  });

  it("a team member can add, rename, move and retire an area, and each change is in the history", async () => {
    const key = k("page");
    const add = await send(team.cookie, { op: "add", name: nm("Page"), key, ...SEA });
    expect([add.status, add.headers["location"]]).toEqual([303, "/api/team/areas?done=added"]);
    expect(areaByKey(key)?.name).toBe(nm("Page"));

    const ren = await send(team.cookie, { op: "rename", key, name: nm("Paged") });
    expect(ren.headers["location"]).toBe("/api/team/areas?done=renamed");
    const move = await send(team.cookie, { op: "move", key, lat: "37.51600", lng: "24.98400" });
    expect(move.headers["location"]).toBe("/api/team/areas?done=moved");
    expect(areaByKey(key)).toMatchObject({ name: nm("Paged"), lat: 37.516, lng: 24.984 });

    // Retire asks first, and changes nothing until Yes.
    const sure = await send(team.cookie, { op: "retire", key });
    expect(sure.status).toBe(200);
    expect(sure.text).toContain(`Retire ${nm("Paged")}?`);
    expect(areaByKey(key)).toBeDefined();
    const ret = await send(team.cookie, { op: "retire", key, confirm: "1" });
    expect(ret.headers["location"]).toBe("/api/team/areas?done=retired");
    expect(areaByKey(key)).toBeUndefined();

    const after = await page(team.cookie);
    expect(after.text).toContain(`Vt areas-team · added ${nm("Page")}`);
    expect(after.text).toContain(`Vt areas-team · renamed ${nm("Page")} to ${nm("Paged")}`);
    expect(after.text).toContain(`Vt areas-team · moved ${nm("Paged")}&#39;s centre`);
    expect(after.text).toContain(`Vt areas-team · retired ${nm("Paged")}`);
    expect(after.text).not.toContain(`<h3>${nm("Paged")}</h3>`);
  });

  it("a cat guardian gets 403 on the page and on the form", async () => {
    const g = await request(app).get("/api/team/areas").set("Cookie", guardian.cookie);
    expect([g.status, g.text]).toEqual([403, '{"error":"forbidden"}']);
    const p = await request(app)
      .post("/api/team/areas")
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", guardian.cookie)
      .type("form")
      .send({ op: "add", name: nm("G"), key: k("g"), ...SEA });
    expect([p.status, p.text]).toEqual([403, '{"error":"forbidden"}']);
    expect(areaByKey(k("g"))).toBeUndefined();
  });

  it("a POST from another site, or with no Origin, is refused", async () => {
    for (const origin of ["https://evil.example", undefined]) {
      const t = request(app).post("/api/team/areas").set("Cookie", team.cookie).type("form");
      if (origin) t.set("Origin", origin);
      const res = await t.send({ op: "add", name: nm("Evil"), key: k("evil"), ...SEA });
      expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    }
    expect(areaByKey(k("evil"))).toBeUndefined();
  });

  it("an empty name is named next to its field, and the form keeps what was typed", async () => {
    const res = await send(team.cookie, { op: "add", name: "", key: k("empty"), ...SEA });
    expect(res.status).toBe(400);
    const nameAt = res.text.indexOf('id="add-name"');
    const errAt = res.text.indexOf("Give the area a name of 2 to 40 letters.");
    expect(errAt).toBeGreaterThan(-1);
    // The problem sits just above the name box, and the form is open.
    expect(nameAt - errAt).toBeGreaterThan(0);
    expect(nameAt - errAt).toBeLessThan(300);
    expect(res.text).toContain('<details open><summary>Add an area</summary>');
    expect(res.text).toContain(`value="${k("empty")}"`);
    expect(res.text).toContain('value="37.51500"');
    expect(areaByKey(k("empty"))).toBeUndefined();
  });

  it("a centre off Syros is refused beside the longitude", async () => {
    const res = await send(team.cookie, { op: "add", name: nm("Myk"), key: k("myk"), lat: "37.45", lng: "25.33" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("That centre isn&#39;t on Syros. Check the longitude.");
    expect(res.text).toContain('id="add-lng" name="lng" value="25.33" inputmode="decimal" aria-invalid="true"');
  });

  it("retire asks first even for an area this server's list hasn't seen yet (review F1)", async () => {
    // Another server: a second copy of the module, with its own cache and pool.
    vi.resetModules();
    const otherServer = await import("../lib/areas/areaWrites");
    const otherDb = await import("@workspace/db");
    await otherServer.changeArea({ id: team.id }, { kind: "add", key: k("fresh"), name: nm("Fresh"), ...NUM });
    await otherDb.pool.end();
    const sure = await send(team.cookie, { op: "retire", key: k("fresh") });
    expect(sure.status).toBe(200);
    expect(sure.text).toContain(`Retire ${nm("Fresh")}?`);
    const ret = await send(team.cookie, { op: "retire", key: k("fresh"), confirm: "1" });
    expect(ret.headers["location"]).toBe("/api/team/areas?done=retired");
  });

  it("a refusal about an area no longer listed, or a form the page doesn't send, still says why (review F3)", async () => {
    await send(team.cookie, { op: "add", key: k("gone"), name: nm("Gone"), ...SEA });
    await send(team.cookie, { op: "retire", key: k("gone"), confirm: "1" });
    const ren = await send(team.cookie, { op: "rename", key: k("gone"), name: nm("Back") });
    expect(ren.status).toBe(400);
    expect(ren.text).toContain(`${nm("Gone")} has been retired.`);
    const retire = await send(team.cookie, { op: "retire", key: k("gone") });
    expect(retire.status).toBe(400);
    expect(retire.text).toContain("There is no such area, or it has already been retired.");
    const bogus = await send(team.cookie, { op: "bogus" });
    expect(bogus.status).toBe(400);
    expect(bogus.text).toContain("That form wasn&#39;t one this page sends.");
  });

  it("is reachable: the Cats filters link it beside the area select", async () => {
    const cats = await request(app).get("/api/team/cats").set("Cookie", team.cookie).set("Accept", "text/html");
    expect(cats.status).toBe(200);
    const select = cats.text.indexOf('id="f-area"');
    const link = cats.text.indexOf('<a href="/api/team/areas">Change the areas</a>');
    expect(select).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(select);
    expect(link - select).toBeLessThan(4000);
  });

  it("no position appears in any of our own addresses", async () => {
    await send(team.cookie, { op: "add", name: nm("Addr"), key: k("addr"), ...SEA });
    const res = await page(team.cookie);
    const ours = addresses(res.text).filter((a) => !isOpenMapLink(a));
    expect(ours.length).toBeGreaterThan(5);
    for (const a of ours) expect(a, a).not.toMatch(/\d+\.\d{4,}/);
    // The island-wide team does get the Open map links.
    expect(addresses(res.text).some(isOpenMapLink)).toBe(true);
    await send(team.cookie, { op: "retire", key: k("addr"), confirm: "1" });
  });
});
