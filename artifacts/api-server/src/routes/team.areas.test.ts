import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { areaByKey } from "../lib/areas/namedAreas";
import { guardianOn, newColony, RUN, signedPerson, type Signed } from "../test/roleKit";
import { isOpenMapLink } from "../test/openMapLink";
import { viewAround, tapToPosition } from "../lib/mapTiles/geometry";
import { mintTileToken } from "../lib/mapTiles/tileToken";
import { renderAreasPage, type AreaRow } from "../lib/teamPages/areasPage";
import type { AreaChange } from "../lib/areas/areaHistory";
import { busiestFirst } from "./teamAreas";
import { SEED_AREAS } from "../lib/areas/seedAreas";

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
    expect(res.text).toContain("<summary><strong>Kini</strong>");
    // Each area's lines say it in words; the only numbers on the page are the Add form's example hints.
    const meta = [...res.text.matchAll(/<p class="meta">([\s\S]*?)<\/p>/g)].map((m) => m[1]!.replace(/<[^>]*>/g, " "));
    expect(meta.length).toBeGreaterThan(0);
    for (const m of meta) expect(m).not.toMatch(/\d{2}\.\d{5}/);
    expect(res.text).not.toContain("Centre: ");
    expect(res.text).toContain("37.44360%2C24.88890");
    expect(res.text).toMatch(/This is version \d+\./);
    expect(res.text).toMatch(/<span class="meta">\d+ cats?<\/span>/);
  });

  it("says under the name boxes that area names are shown to cat guardians", async () => {
    const res = await page(team.cookie);
    const hint = "Area names are shown to cat guardians. Use the place&#39;s name, never a person&#39;s.";
    // Under the Add form's Name box and under each area's Rename box.
    const count = res.text.split(hint).length - 1;
    expect(count).toBeGreaterThan(1);
    expect(res.text).toMatch(/id="add-name"[\s\S]*?<\/form>/);
    expect(res.text.indexOf(hint)).toBeLessThan(res.text.indexOf('id="add-name"'));
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
    expect(after.text).not.toContain(`<summary><strong>${nm("Paged")}</strong>`);
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

// SYC-517 (decision 517-B), PR E task E2: an area's centre is moved by tapping a map.
describe("moving an area's centre by map (517-B)", () => {
  const tap = (around = { lat: 37.4447, lng: 24.9417 }) => {
    const view = viewAround(around, 16);
    const spot = tapToPosition(view, 179, 190, 190)!;
    return { spot, body: { view: mintTileToken({ ...view, size: 179 as const }), size: "179", x: "190", y: "190" } };
  };
  const hidden = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(html)![1]!;
  const getPage = (path: string, cookie: string) => request(app).get(path).set("Cookie", cookie).set("Accept", "text/html");
  const sendTo = (path: string, cookie: string, body: Record<string, string>) =>
    request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", cookie).set("Accept", "text/html").type("form").send(body);

  it("each area has a link to its map and no typed latitude box for moving", async () => {
    const res = await page(team.cookie);
    expect(res.text).toContain('href="/api/team/areas/kini/centre"');
    expect(res.text).toContain("Move centre on a map");
    expect(res.text).not.toMatch(/id="move-[^"]*-lat"/);
    // The Add form still takes typed numbers.
    expect(res.text).toContain('id="add-lat"');
  });

  it("the map opens on the area, a tap asks first, and the button moves the centre", async () => {
    const key = k("bymap");
    expect((await send(team.cookie, { op: "add", name: nm("Bymap"), key, ...SEA })).status).toBe(303);
    const map = await getPage(`/api/team/areas/${key}/centre`, team.cookie);
    expect(map.status).toBe(200);
    expect(map.text).toContain('class="mappage"');
    expect(map.text).toContain(`action="/api/team/areas/${key}/centre/pick"`);
    expect(map.text).toContain("<summary>Type a position instead</summary>");
    // The fold's summary is a 44px tap target like the dashboard's other folds.
    expect(map.text).toMatch(/\.typedfold summary\{[^}]*min-height:44px/);

    const { body, spot } = tap();
    const pick = await sendTo(`/api/team/areas/${key}/centre/pick`, team.cookie, body);
    expect(pick.status).toBe(200);
    expect(pick.text).toContain(`Move the centre of ${nm("Bymap")} here?`);
    expect(pick.text).toContain("Open map");
    expect(pick.text).toContain(`href="/api/team/areas/${key}/centre">Start again on this area&#39;s map</a>`);
    expect(areaByKey(key)).toMatchObject({ lat: NUM.lat, lng: NUM.lng });

    const save = await sendTo("/api/team/areas", team.cookie, {
      op: "move",
      key,
      lat: hidden(pick.text, "lat"),
      lng: hidden(pick.text, "lng"),
    });
    expect(save.headers["location"]).toBe("/api/team/areas?done=moved");
    expect(areaByKey(key)).toMatchObject({ lat: spot.lat, lng: spot.lng });
  });

  it("the confirmation shows the map and Open map, never the centre now in words (final review, fix 7)", async () => {
    const { body } = tap();
    const pick = await sendTo("/api/team/areas/kini/centre/pick", team.cookie, body);
    expect(pick.status).toBe(200);
    expect(pick.text).toContain('class="mappage"');
    expect(pick.text).toContain("Open map");
    expect(pick.text).not.toContain('<p class="hint">The centre now:');
  });

  it("a move from the map that fails says it's off Syros, never to type a number (final review, fix 7)", async () => {
    for (const pos of [{ lat: "abc", lng: "24.9" }, { lat: "38.5", lng: "24.9" }, { lat: "37.44", lng: "26.0" }]) {
      const res = await sendTo("/api/team/areas", team.cookie, { op: "move", key: "kini", ...pos });
      expect(res.status, JSON.stringify(pos)).toBe(400);
      expect(res.text, JSON.stringify(pos)).toContain("That&#39;s off Syros. Tap a spot on the island.");
      expect(res.text).not.toContain("Type the latitude");
      expect(res.text).not.toContain("Check the l");
    }
  });

  it("a pick off the island is refused with the plain line", async () => {
    const res = await sendTo("/api/team/areas/kini/centre/pick", team.cookie, { lat: "38.5", lng: "26.0" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("That&#39;s off Syros. Tap a spot on the island.");
  });

  it("an unknown area is a 404, and a cat guardian gets 403 on all three routes", async () => {
    expect((await getPage("/api/team/areas/no-such-area/centre", team.cookie)).status).toBe(404);
    for (const path of ["/api/team/areas/kini/centre/map", "/api/team/areas/kini/centre/pick"]) {
      expect((await sendTo(path, guardian.cookie, tap().body)).status, path).toBe(403);
    }
    expect((await getPage("/api/team/areas/kini/centre", guardian.cookie)).status).toBe(403);
  });
});

// SYC-619 PR 2 (spec §4.2, D5): the Areas page as short rows, busiest first.
describe("the Areas page as short rows (SYC-619 §4.2)", () => {
  const area = (key: string, name: string, cats: number): AreaRow => ({ key, name, lat: 37.4, lng: 24.9, cats });
  const render = (o: { areas?: AreaRow[]; history?: AreaChange[]; again?: Parameters<typeof renderAreasPage>[0]["again"] }) =>
    renderAreasPage({ personName: "T", link: true, areas: o.areas ?? [], version: 22, firstVersion: 3, history: o.history ?? [], again: o.again });
  const change = (over: Partial<AreaChange> & { version: number }): AreaChange => ({
    at: new Date("2026-10-15T00:00:00Z"),
    kind: "area_added",
    who: null,
    before: null,
    after: { key: "x", name: "X", lat: 1, lng: 2, retired: false },
    ...over,
  });

  it("sorts cats most first, then name; two areas with no cats are both listed in name order", () => {
    const sorted = busiestFirst([area("b", "Beta", 0), area("a", "Alpha", 0), area("c", "Cee", 3), area("d", "Dee", 5)]);
    expect(sorted.map((a) => a.name)).toEqual(["Dee", "Cee", "Alpha", "Beta"]);
    const html = render({ areas: sorted });
    const names = [...html.matchAll(/<summary><strong>([^<]*)<\/strong>/g)].map((m) => m[1]);
    expect(names).toEqual(["Dee", "Cee", "Alpha", "Beta"]);
  });

  it("the closed row is the name and its cats, with no fold marker class of its own", () => {
    const html = render({ areas: [area("a", "Alpha", 1), area("b", "Beta", 2)] });
    expect(html).toContain('<li><details class="arearow"><summary><strong>Alpha</strong> <span class="meta">1 cat</span></summary>');
    expect(html).toContain('<span class="meta">2 cats</span></summary>');
    expect(html).toContain("min-height:48px");
  });

  it("a form that comes back with an error keeps its row open", () => {
    const html = render({
      areas: [area("a", "Alpha", 1), area("b", "Beta", 2)],
      again: { op: "rename", key: "a", field: "name", message: "Too short.", values: { name: "A" } },
    });
    expect(html).toContain('<details class="arearow" open><summary><strong>Alpha</strong>');
    expect(html).toContain('<details class="arearow"><summary><strong>Beta</strong>');
  });

  it("the first version's rows fold into one line; a later row with no name stays on its own", () => {
    const first = Array.from({ length: 3 }, (_, i) => change({ version: i + 1 }));
    const later = change({ version: 4, at: new Date("2026-10-20T10:00:00Z"), kind: "area_moved", who: null });
    const html = render({ history: [later, ...first.reverse()] });
    expect(html).toContain('3 areas set up by Syros Cats, <time datetime="2026-10-15T00:00:00.000Z">15 Oct 2026</time>');
    expect(html.match(/<li class="meta">/g)).toHaveLength(2);
    expect(html).toContain("Syros Cats (the first list) · moved X&#39;s centre");
  });

  it("the line still says how many were set up when the row limit has cut the oldest rows off", () => {
    const html = render({ history: [change({ version: 3 }), change({ version: 2 })] });
    expect(html).toContain("3 areas set up by Syros Cats,");
  });

  it("the seed has 21 areas: the route passes this as firstVersion, so it must match migration 0033_named_areas.sql", () => {
    expect(SEED_AREAS.length).toBe(21);
  });

  it.each([
    ["move", "lat"],
    ["retire", "area"],
  ] as const)("a %s form sent back with an error keeps its row open", (op, field) => {
    const html = render({
      areas: [area("a", "Alpha", 1), area("b", "Beta", 2)],
      again: { op, key: "a", field, message: "Nope.", values: {} },
    });
    expect(html).toContain('<details class="arearow" open><summary><strong>Alpha</strong>');
    expect(html).toContain('<details class="arearow"><summary><strong>Beta</strong>');
  });

  it("the intro and the footer are in the How this is worked out fold", () => {
    const html = render({});
    const fold = html.slice(html.indexOf('<details class="method">'));
    expect(fold).toContain("A place belongs to the area whose centre is nearest.");
    expect(fold).toContain("This is version 22.");
  });

  it("the real page lists the seed's rows as one folded line", async () => {
    const res = await page(team.cookie);
    // 15 Oct 2026 is the migration's fixed seed timestamp (0033_named_areas.sql), not now().
    expect(res.text).toMatch(/\d+ areas set up by Syros Cats, <time datetime="2026-10-15T00:00:00.000Z">15 Oct 2026<\/time>/);
    expect(res.text).not.toContain("Syros Cats (the first list) · added Kini");
  });
});
