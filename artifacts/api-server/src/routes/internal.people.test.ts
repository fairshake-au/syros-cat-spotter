import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import { addPerson, pool } from "@workspace/db";
import app from "../app";
import { removeTestPerson } from "../test/removeTestPerson";

// POST /api/internal/people/allowed (SYC-43 part 1 plan §4, tests 6–8).

// Every log line the app writes, so test 8 can check the address never
// appears in one.
const logLines = vi.hoisted(() => [] as string[]);
vi.mock("../lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/logger")>();
  const { default: pino } = await import("pino");
  return {
    ...actual,
    logger: pino(
      { level: "debug" },
      { write: (line: string) => void logLines.push(line) },
    ),
  };
});

const TOKEN = "vitest-internal-token-0123456789abcdef";
const EMAIL = "vitest-internal-susan@example.com";
// SYC-619 §2.2 (N1): the workspace is management's, so the old shape's yes
// (which means the workspace) is a manager's. Susan is staff only.
const MANAGER = "vitest-internal-maria@example.com";
let personId: string;
let managerId: string;

beforeAll(async () => {
  await removeTestPerson(EMAIL);
  const p = await addPerson({
    email: EMAIL,
    name: "Susan",
    addedBy: "cli:vitest",
  });
  personId = p.id;
  await removeTestPerson(MANAGER);
  const m = await addPerson({
    email: MANAGER,
    name: "Maria",
    addedBy: "cli:vitest",
  });
  // Management is given by set-roles, never by add: written directly, as
  // the other route tests do.
  await pool.query(
    "update person_scopes set role = 'management' where person_id = $1",
    [m.id],
  );
  managerId = m.id;
});

afterEach(() => {
  delete process.env["INTERNAL_PEOPLE_TOKEN"];
});

afterAll(async () => {
  await removeTestPerson(EMAIL);
  await removeTestPerson(MANAGER);
  await pool.end();
});

const ask = (email: unknown, auth?: string) => {
  const r = request(app).post("/api/internal/people/allowed");
  if (auth !== undefined) r.set("Authorization", auth);
  return r.send({ email });
};

describe("POST /api/internal/people/allowed", () => {
  it("answers 503 not_configured when the token isn't set, even with a token sent", async () => {
    for (const auth of [undefined, `Bearer ${TOKEN}`, "Bearer "]) {
      const res = await ask(EMAIL, auth);
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "not_configured" });
    }
  });

  it("answers 401 for a wrong or missing token", async () => {
    process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
    for (const auth of [
      undefined,
      "",
      "Bearer ",
      `Bearer ${TOKEN}x`,
      `Bearer ${TOKEN.slice(0, -1)}`,
      TOKEN,
      `Basic ${TOKEN}`,
    ]) {
      const res = await ask(EMAIL, auth);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized" });
    }
  });

  it("answers allowed:false for an address not on the list", async () => {
    process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
    const res = await ask("vitest-nobody@example.com", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ allowed: false });
  });

  it("answers allowed:true with the id and session version, for a manager's address in capitals", async () => {
    process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
    const res = await ask(`  ${MANAGER.toUpperCase()} `, `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.body).toEqual({
      allowed: true,
      personId: managerId,
      name: "Maria",
      sessionVersion: 1,
    });
  });

  it("version 2: staff-only gets workspace false and dashboard true; a manager gets both", async () => {
    process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
    const askV2 = (email: string) =>
      request(app)
        .post("/api/internal/people/allowed")
        .set("Authorization", `Bearer ${TOKEN}`)
        .send({ email, version: 2 });
    const staff = await askV2(EMAIL);
    expect(staff.status).toBe(200);
    expect(staff.body).toEqual({
      allowed: true,
      doors: { workspace: false, dashboard: true },
      language: "en",
      personId,
      name: "Susan",
      sessionVersion: 1,
    });
    const manager = await askV2(MANAGER);
    expect(manager.body).toEqual({
      allowed: true,
      doors: { workspace: true, dashboard: true },
      language: "en",
      personId: managerId,
      name: "Maria",
      sessionVersion: 1,
    });
  });

  it("no version: staff-only gets the fixed no body", async () => {
    process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
    const staff = await ask(EMAIL, `Bearer ${TOKEN}`);
    const stranger = await ask("vitest-nobody@example.com", `Bearer ${TOKEN}`);
    expect(staff.status).toBe(200);
    expect(staff.body).toEqual({ allowed: false });
    expect(staff.text).toBe(stranger.text);
  });

  it("refuses a body without a string address", async () => {
    process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
    const res = await ask({ $ne: null }, `Bearer ${TOKEN}`);
    expect(res.status).toBe(400);
  });

  it("sends no CORS headers, even when the request carries an Origin", async () => {
    process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
    for (const origin of [
      "https://admin.catspotters.com",
      "https://evil.example",
    ]) {
      const res = await ask(EMAIL, `Bearer ${TOKEN}`).set("Origin", origin);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    }
    const upper = await request(app)
      .post("/API/Internal/people/allowed")
      .set("Origin", "https://evil.example")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ email: EMAIL });
    expect(upper.headers["access-control-allow-origin"]).toBeUndefined();
    const preflight = await request(app)
      .options("/api/internal/people/allowed")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("never writes the address into a log line", async () => {
    process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
    logLines.length = 0;
    await ask(EMAIL, `Bearer ${TOKEN}`);
    await ask(MANAGER, `Bearer ${TOKEN}`);
    await ask("vitest-nobody@example.com", `Bearer ${TOKEN}`);
    expect(logLines.length).toBeGreaterThan(0);
    const all = logLines.join("\n").toLowerCase();
    expect(all).toContain('"outcome":"allowed"');
    expect(all).toContain('"outcome":"not_allowed"');
    expect(all).not.toContain("vitest-internal-susan");
    expect(all).not.toContain("vitest-internal-maria");
    expect(all).not.toContain("vitest-nobody");
    expect(all).not.toContain(TOKEN);
  });
});
