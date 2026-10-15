import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { addPerson, pool } from "@workspace/db";
import app from "../app";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";
import {
  clearWelfareTables,
  seedReport,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-43 part 2 plan, test P1-5: every dashboard response carries the team
// headers. The security header now includes `img-src 'self'` and still has no
// `script-src`. Later PRs add their routes to RESPONSES.

const EMAIL = "vitest-headers-susan@example.com";
const TEAM = "https://team.catspotters.com";
const KEY = "vitest-headers-key-0123456789abcdef-0123456789";
const handoffKey = makeKey();
let cookie: string;
let reportPhotoId: string;

const EXPECTED_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await removeTestPerson(EMAIL);
  await clearWelfareTables();
  reportPhotoId = (
    await seedReport({
      photo: { mime: "image/jpeg", bytes: Buffer.from("headers-test") },
    })
  ).photoPublicId!;
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
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await clearWelfareTables();
  await removeTestPerson(EMAIL);
  await pool.end();
});

const RESPONSES: [string, () => request.Test][] = [
  ["the queue page", () => request(app).get("/api/team").set("Cookie", cookie)],
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
  it.each(RESPONSES)("%s", async (_name, send) => {
    const res = await send();
    expect(res.headers["content-security-policy"]).toBe(EXPECTED_CSP);
    expect(res.headers["content-security-policy"]).toContain("img-src 'self'");
    expect(res.headers["content-security-policy"]).not.toMatch(/script-src/);
    expect(res.headers["cache-control"]).toBe("no-store");
    // SYC-330: "same-origin", on purpose. "no-referrer" makes a browser send
    // `Origin: null` on form posts, and every dashboard button was refused.
    expect(res.headers["referrer-policy"]).toBe("same-origin");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
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
