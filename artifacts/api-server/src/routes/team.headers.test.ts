import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { addPerson, db, feedingSitesTable, photosTable, pool, sightingsTable } from "@workspace/db";
import app from "../app";
import { setMapSourceForTests } from "./teamMapData";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";
import {
  clearWelfareTables,
  seedReport,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";
import { newColony, seedCat } from "../test/roleKit";
import { STRICT_CSP, WIDE_CSP, WIDE_CSP_ROUTES, expectedCsp } from "../test/wideCsp";

// SYC-43 part 2 plan, test P1-5: every dashboard response carries the team
// headers. The security header includes `img-src 'self'` and has no
// `script-src`, on every answer except the one page named in
// WIDE_CSP_ROUTES (SYC-396 PR 1.3.4: the Cats grid, which loads our own
// script). Later PRs add their routes to RESPONSES. The route walk
// (team.walk.test.ts) checks the same rule on every registered route.

const EMAIL = "vitest-headers-susan@example.com";
const TEAM = "https://team.catspotters.com";
const KEY = "vitest-headers-key-0123456789abcdef-0123456789";
const handoffKey = makeKey();
let cookie: string;
let reportPhotoId: string;
let catId: number;

beforeAll(async () => {
  // SYC-705 2b.3: the map-data routes ask the map host through the store; here it is unreachable.
  setMapSourceForTests({ fetch: (async () => { throw new Error("offline"); }) as typeof fetch });
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await removeTestPerson(EMAIL);
  await clearWelfareTables();
  reportPhotoId = (
    await seedReport({
      photo: { mime: "image/jpeg", bytes: Buffer.from("headers-test") },
    })
  ).photoPublicId!;
  catId = (await seedCat(await newColony("headers"))).id;
  const p = await addPerson({
    email: EMAIL,
    name: "Susan",
    addedBy: "cli:vitest",
  });
  const res = await request(app)
    .post("/api/team/handoff")
    .set("Origin", "https://admin.catspotters.com")
    .type("form")
    .send({ token: mint(handoffKey, claimsFor(p.id, { sv: 1 })) });
  expect(res.status).toBe(303);
  cookie = (res.headers["set-cookie"] as unknown as string[])[0]!.split(
    ";",
  )[0]!;
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  setMapSourceForTests(undefined);
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await clearWelfareTables();
  await removeTestPerson(EMAIL);
  await pool.end();
});

/**
 * [what, how to ask for it, the route that answers it]. The route is named
 * only where that route's own handler answers (not a refusal before it), so
 * expectedCsp can tell the one exempt page from everything else.
 */
const RESPONSES: [string, () => request.Test, string?][] = [
  ["the queue page", () => request(app).get("/api/team").set("Cookie", cookie), "GET /api/team"],
  [
    "the queue page, signed out",
    () => request(app).get("/api/team").set("Sec-Fetch-Mode", "navigate"),
  ],
  [
    "the queue as JSON",
    () => request(app).get("/api/team/reports").set("Cookie", cookie),
  ],
  [
    "the queue as JSON, signed out",
    () => request(app).get("/api/team/reports"),
  ],
  [
    "a report photo",
    () =>
      request(app)
        .get(`/api/team/report-photos/${reportPhotoId}`)
        .set("Cookie", cookie),
  ],
  [
    "a report photo that doesn't exist",
    () =>
      request(app).get("/api/team/report-photos/nope").set("Cookie", cookie),
  ],
  [
    "a report photo, signed out",
    () => request(app).get(`/api/team/report-photos/${reportPhotoId}`),
  ],
  [
    "a catalogue photo that doesn't exist",
    () => request(app).get("/api/team/photos/nope").set("Cookie", cookie),
  ],
  [
    "a catalogue photo, signed out",
    () => request(app).get("/api/team/photos/x"),
  ],
  [
    "the Reports list (SYC-396 PR 3.3a: no script, so the strict header)",
    () => request(app).get("/api/team/insights").set("Cookie", cookie).set("Accept", "text/html"),
    "GET /api/team/insights",
  ],
  [
    "Sterilisation progress (charts are SVG drawn by the server, no script)",
    () => request(app).get("/api/team/insights/progress?range=all").set("Cookie", cookie).set("Accept", "text/html"),
    "GET /api/team/insights/:report",
  ],
  [
    "Colony health, sorted",
    () => request(app).get("/api/team/insights/health?sort=cats&dir=desc").set("Cookie", cookie).set("Accept", "text/html"),
    "GET /api/team/insights/:report",
  ],
  [
    "a report's spreadsheet",
    () => request(app).get("/api/team/insights/health.csv").set("Cookie", cookie),
    "GET /api/team/insights/:report.csv",
  ],
  [
    "the Reports list, signed out",
    () => request(app).get("/api/team/insights").set("Sec-Fetch-Mode", "navigate"),
  ],
  [
    "the Cats grid page",
    () => request(app).get("/api/team/cats").set("Cookie", cookie).set("Accept", "text/html"),
    "GET /api/team/cats",
  ],
  [
    "the Cats grid page, filtered",
    () =>
      request(app)
        .get("/api/team/cats?colours=ginger&lives=street")
        .set("Cookie", cookie)
        .set("Accept", "text/html")
        .set("Sec-Fetch-Mode", "navigate"),
    "GET /api/team/cats",
  ],
  [
    "the Cats grid as JSON (the old search answer)",
    () => request(app).get("/api/team/cats?q=x").set("Cookie", cookie).set("Accept", "application/json"),
    "GET /api/team/cats",
  ],
  [
    "Find from a photo's form (SYC-396 PR 2.5: no script, so the strict header)",
    () => request(app).get("/api/team/cats/find?area=kini").set("Cookie", cookie).set("Accept", "text/html"),
    "GET /api/team/cats/find",
  ],
  [
    "Find from a photo's search with no photo",
    () =>
      request(app)
        .post("/api/team/cats/find")
        .set("Origin", TEAM)
        .set("Cookie", cookie)
        .field("area", "kini"),
    "POST /api/team/cats/find",
  ],
  [
    "the Cats grid, signed out",
    () => request(app).get("/api/team/cats").set("Sec-Fetch-Mode", "navigate"),
  ],
  [
    "a cat's page",
    () => request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie).set("Accept", "text/html"),
    "GET /api/team/cats/:id",
  ],
  [
    "a cat that doesn't exist",
    () => request(app).get("/api/team/cats/999999999").set("Cookie", cookie).set("Accept", "text/html"),
    "GET /api/team/cats/:id",
  ],
  [
    "the colonies page",
    () => request(app).get("/api/team/colonies").set("Cookie", cookie).set("Accept", "text/html"),
    "GET /api/team/colonies",
  ],
  [
    "the Feeding sites page",
    () => request(app).get("/api/team/sites").set("Cookie", cookie).set("Accept", "text/html"),
    "GET /api/team/sites",
  ],
  [
    "the map page",
    () => request(app).get("/api/team/map").set("Cookie", cookie).set("Accept", "text/html"),
    "GET /api/team/map",
  ],
  // SYC-396 PR 1.5: the island map's square tokens and squares (JSON and
  // pictures, so the strict header, never the Cats page's wider one).
  [
    "the island map's square tokens",
    () =>
      request(app)
        .post("/api/team/map-squares")
        .set("Origin", TEAM)
        .set("Cookie", cookie)
        .send({ z: 14, xMin: 0, xMax: 1, yMin: 0, yMax: 1 }),
    "POST /api/team/map-squares",
  ],
  // SYC-705 2b.3: the dashboard's own map files are JSON or bytes, so the strict header.
  [
    "the map's version",
    () => request(app).get("/api/team/map-data/current").set("Cookie", cookie),
    "GET /api/team/map-data/current",
  ],
  [
    "a map file of a version that does not exist",
    () => request(app).get("/api/team/map-data/v999999999/syros.pmtiles").set("Cookie", cookie),
    "GET /api/team/map-data/v:version/syros.pmtiles",
  ],
  [
    "a map symbol that is not one",
    () => request(app).get("/api/team/map-data/v1/sprites/nope.json").set("Cookie", cookie),
    "GET /api/team/map-data/v:version/sprites/:file",
  ],
  [
    "the island Map (the Cats page as a map)",
    () => request(app).get("/api/team/cats?view=map").set("Cookie", cookie).set("Accept", "text/html"),
    "GET /api/team/cats",
  ],
  [
    "the island Map, filtered, with a cat in focus",
    () =>
      request(app)
        .get(`/api/team/cats?view=map&sterilised=not_known&focus=${catId}`)
        .set("Cookie", cookie)
        .set("Accept", "text/html")
        .set("Sec-Fetch-Mode", "navigate"),
    "GET /api/team/cats",
  ],
  [
    "the island Map's button-map move (no script)",
    () =>
      request(app)
        .post("/api/team/cats/map")
        .set("Origin", TEAM)
        .set("Cookie", cookie)
        .type("form")
        .send({ vz: "12", vx: "0", vy: "0", go: "in", filters: "sterilised=not_known" }),
    "POST /api/team/cats/map",
  ],
  [
    "the island map's cat positions",
    () => request(app).post("/api/team/cats/positions").set("Origin", TEAM).set("Cookie", cookie).send({}),
    "POST /api/team/cats/positions",
  ],
  [
    "an unmatched dashboard path (SYC-516 C1)",
    () => request(app).get("/api/team/nope").set("Sec-Fetch-Mode", "navigate"),
    "GET /api/team/nope",
  ],
  [
    "an unmatched dashboard path, as data (SYC-516 C1)",
    () => request(app).get("/api/team/nope"),
    "GET /api/team/nope",
  ],
  [
    "an island map square with a bad token",
    () => request(app).get("/api/team/map-square/nope").set("Cookie", cookie),
    "GET /api/team/map-square/:token",
  ],
  ["My page", () => request(app).get("/api/team/my").set("Cookie", cookie), "GET /api/team/my"],
  ["GET /me", () => request(app).get("/api/team/me").set("Cookie", cookie)],
  ["GET /me, signed out", () => request(app).get("/api/team/me")],
  [
    "a hand-off with no pass",
    () =>
      request(app)
        .post("/api/team/handoff")
        .set("Origin", "https://admin.catspotters.com"),
  ],
  [
    "a sign-out from the wrong origin",
    () =>
      request(app)
        .post("/api/team/signout")
        .set("Origin", "https://evil.example")
        .set("Cookie", cookie),
  ],
  [
    "a sign-out from the dashboard (last: it ends the cookie's use on this device only)",
    () =>
      request(app)
        .post("/api/team/signout")
        .set("Origin", TEAM)
        .set("Cookie", cookie),
  ],
];

describe("P1-5: every dashboard response has the team headers", () => {
  it.each(RESPONSES)("%s", async (_name, send, route) => {
    const res = await send();
    const want = expectedCsp(route, res);
    expect(res.headers["content-security-policy"]).toBe(want);
    expect(res.headers["content-security-policy"]).toContain("img-src 'self'");
    if (want === STRICT_CSP) {
      expect(res.headers["content-security-policy"]).not.toMatch(/script-src|connect-src|blob:/);
    }
    expect(res.headers["content-security-policy"]).not.toMatch(/unsafe-eval|https?:|\*/);
    expect(res.headers["cache-control"]).toBe("no-store");
    // SYC-330: "same-origin", on purpose. "no-referrer" makes a browser send
    // `Origin: null` on form posts, and every dashboard button was refused.
    expect(res.headers["referrer-policy"]).toBe("same-origin");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

// SYC-396 PR 1.3.4: the one exemption, pinned exactly.
describe("the wider header is the named pages' alone, and exactly this", () => {
  it("the exemption names exactly these routes", () => {
    expect([...WIDE_CSP_ROUTES]).toEqual([
      "GET /api/team/cats",
      "GET /api/team/cats/find",
      // SYC-705 Task 2b.5: the pages with a MapLibre view map.
      "GET /api/team/sites",
      "GET /api/team/sites/:id",
      "GET /api/team/colonies/:id",
      "GET /api/team/cats/:id",
    ]);
  });

  // SYC-705 2b.5 review: a cat's or colony's page loads the map, and gets the
  // wider header, only when it draws a map (sightings; sites).
  it("a cat's page and a colony's page are wide only when they draw a map", async () => {
    const page = (path: string) => request(app).get(path).set("Cookie", cookie).set("Accept", "text/html");
    const scriptsOf = (html: string) => html.match(/<script\b/gi)?.length ?? 0;
    // No sightings, no sites: no map, no script, the strict header.
    const bareCol = await newColony("headers-bare");
    const bareCat = (await seedCat(bareCol)).id;
    for (const path of [`/api/team/cats/${bareCat}`, `/api/team/colonies/${bareCol}`]) {
      const res = await page(path);
      expect(res.status, path).toBe(200);
      expect(res.headers["content-security-policy"], path).toBe(STRICT_CSP);
      expect(scriptsOf(res.text), path).toBe(0);
      expect(res.text, path).not.toContain('class="map"');
    }
    // With a sighting, and with a site: the map, its scripts, the wider header.
    const mapCol = await newColony("headers-map");
    const mapCat = (await seedCat(mapCol)).id;
    const [photo] = await db.insert(photosTable).values({ data: "AAAA", mime: "image/jpeg" }).returning();
    await db.insert(sightingsTable).values({ deviceId: "vt-headers-device", photoId: photo!.id, catId: mapCat, lat: 37.44, lng: 24.94, status: "resolved" });
    await db.insert(feedingSitesTable).values({ name: "vt-headers site", lat: 37.445, lng: 24.94, colonyId: mapCol });
    for (const path of [`/api/team/cats/${mapCat}`, `/api/team/colonies/${mapCol}`]) {
      const res = await page(path);
      expect(res.status, path).toBe(200);
      expect(res.headers["content-security-policy"], path).toBe(WIDE_CSP);
      expect(scriptsOf(res.text), path).toBe(3);
      expect(res.text, path).toContain(' data-map="');
    }
  });

  // SYC-705 Task 2b.5: a map page's own 200 carries the wider header; its JSON
  // answer, its not-found page and "Show on our map" (still the old picture
  // map until Task 2b.7) keep the strict one.
  it("the Feeding sites page carries the wider header; its JSON and the map pages' not-found answers the strict one", async () => {
    const sites = await request(app).get("/api/team/sites").set("Cookie", cookie).set("Accept", "text/html");
    expect(sites.status).toBe(200);
    expect(sites.headers["content-security-policy"]).toBe(WIDE_CSP);
    const json = await request(app).get("/api/team/sites").set("Cookie", cookie).set("Accept", "application/json");
    expect(json.headers["content-security-policy"]).toBe(STRICT_CSP);
    for (const path of ["/api/team/sites/999999999", "/api/team/colonies/999999999", "/api/team/cats/999999999"]) {
      const nf = await request(app).get(path).set("Cookie", cookie).set("Accept", "text/html");
      expect(nf.status, path).toBe(404);
      expect(nf.headers["content-security-policy"], path).toBe(STRICT_CSP);
    }
  });

  it("the Cats grid page carries exactly the wider header", async () => {
    const res = await request(app).get("/api/team/cats").set("Cookie", cookie).set("Accept", "text/html");
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    expect(res.headers["content-security-policy"]).toBe(WIDE_CSP);
  });

  it("the Find from a photo form carries exactly the wider header (SYC-522); a problem form the strict one", async () => {
    const form = await request(app).get("/api/team/cats/find").set("Cookie", cookie).set("Accept", "text/html");
    expect(form.status).toBe(200);
    expect(form.headers["content-security-policy"]).toBe(WIDE_CSP);
    expect(form.text).toContain("find-photo.");
    const none = await request(app)
      .post("/api/team/cats/find")
      .set("Origin", TEAM)
      .set("Cookie", cookie)
      .field("area", "");
    expect(none.status).toBe(400);
    expect(none.headers["content-security-policy"]).toBe(STRICT_CSP);
    expect(none.text).not.toContain("find-photo.");
  });

  it("its script rule is 'self' and nothing else", async () => {
    const res = await request(app).get("/api/team/cats").set("Cookie", cookie).set("Accept", "text/html");
    const directive = (name: string) =>
      String(res.headers["content-security-policy"])
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${name} `));
    expect(directive("script-src")).toBe("script-src 'self'");
    expect(directive("connect-src")).toBe("connect-src 'self'");
    expect(directive("default-src")).toBe("default-src 'none'");
    expect(String(res.headers["content-security-policy"])).not.toMatch(/unsafe-eval|strict-dynamic|'nonce-|'sha(256|384|512)-/);
  });

  // SYC-396 PR 1.5: the island Map is the Cats route's own page (?view=map),
  // so it carries the same wider header and no other; the exemption still
  // names one route. Its no-script move page and its JSON answers are strict.
  it("the island Map carries exactly the wider header; its JSON answers the strict one", async () => {
    const map = await request(app).get("/api/team/cats?view=map").set("Cookie", cookie).set("Accept", "text/html");
    expect(map.status).toBe(200);
    expect(map.headers["content-security-policy"]).toBe(WIDE_CSP);
    for (const post of ["/api/team/cats/positions", "/api/team/map-squares"]) {
      const res = await request(app).post(post).set("Origin", TEAM).set("Cookie", cookie).send({});
      expect(res.headers["content-security-policy"], post).toBe(STRICT_CSP);
    }
  });

  it("every other page keeps today's header, byte for byte", async () => {
    const res = await request(app).get("/api/team").set("Cookie", cookie);
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
  });
});

// SYC-330: moving to "same-origin" must not loosen the Origin check. A blank
// (`null`) Origin is still refused; nobody should "fix" a refused button by
// accepting it.
describe("SYC-330: a POST with Origin: null is still refused", () => {
  it("refuses a sign-out sent with Origin: null, and does not clear the cookie", async () => {
    const res = await request(app)
      .post("/api/team/signout")
      .set("Origin", "null")
      .set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "not_signed_in" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("refuses a note post sent with Origin: null", async () => {
    const res = await request(app)
      .post("/api/team/reports/vt-nobody/note")
      .set("Origin", "null")
      .set("Cookie", cookie)
      .type("form")
      .send({ note: "x" });
    expect(res.status).toBe(401);
  });
});

// SYC-330: cross-site and missing origins stay refused (requireOrigin).
describe("SYC-330: other origins are refused", () => {
  const cases: [string, (t: request.Test) => request.Test][] = [
    ["a foreign Origin", (t) => t.set("Origin", "https://evil.example")],
    // Same site, different origin: SameSite=Lax would let the cookie through,
    // so the Origin check is what refuses it.
    ["a sister site's Origin", (t) => t.set("Origin", "https://apptest.catspotters.com")],
    [
      "Origin: null from a cross-site page",
      (t) => t.set("Origin", "null").set("Sec-Fetch-Site", "cross-site"),
    ],
    ["no Origin at all", (t) => t],
  ];
  it.each(cases)("a sign-out with %s is refused", async (_n, shape) => {
    const res = await shape(
      request(app).post("/api/team/signout").set("Cookie", cookie),
    );
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "not_signed_in" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
  it.each(cases)("a note post with %s is refused", async (_n, shape) => {
    const res = await shape(
      request(app)
        .post("/api/team/reports/vt-nobody/note")
        .set("Cookie", cookie)
        .type("form")
        .send({ note: "x" }),
    );
    expect(res.status).toBe(401);
  });
});
