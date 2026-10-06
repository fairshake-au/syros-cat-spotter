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
import { addPerson, pool, removePerson } from "@workspace/db";
import app from "../app";

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
let personId: string;

beforeAll(async () => {
  await removePerson(EMAIL);
  const p = await addPerson({
    email: EMAIL,
    name: "Susan",
    addedBy: "cli:vitest",
  });
  personId = p.id;
});

afterEach(() => {
  delete process.env["INTERNAL_PEOPLE_TOKEN"];
});

afterAll(async () => {
  await removePerson(EMAIL);
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

  it("answers allowed:true with the id and session version, for a listed address in capitals", async () => {
    process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
    const res = await ask(`  ${EMAIL.toUpperCase()} `, `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.body).toEqual({
      allowed: true,
      personId,
      name: "Susan",
      sessionVersion: 1,
    });
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
    await ask("vitest-nobody@example.com", `Bearer ${TOKEN}`);
    expect(logLines.length).toBeGreaterThan(0);
    const all = logLines.join("\n").toLowerCase();
    expect(all).toContain('"outcome":"allowed"');
    expect(all).toContain('"outcome":"not_allowed"');
    expect(all).not.toContain("vitest-internal-susan");
    expect(all).not.toContain("vitest-nobody");
    expect(all).not.toContain(TOKEN);
  });
});
