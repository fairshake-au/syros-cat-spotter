import { randomBytes } from "node:crypto";
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
import { addPerson, markLeft, pool } from "@workspace/db";
import app from "../app";
import { removeTestPerson } from "../test/removeTestPerson";

// POST /api/internal/people/allowed answers two doors (SYC-53 plan PR 0.4;
// roles spec §4.5, §6.3, §14 cases 11 and 13; SYC-222 points 1 and 2).
//
// T7: a cat guardian gets no from the old request shape (the Worker deployed
// today gives the workspace to every yes) and no workspace door from the new.
// T8 (part) and §14 case 13: unknown, left, pending and no-door addresses get
// byte-identical answers, in each shape.

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

const TOKEN = "vitest-internal-token-doors-0123456789abcdef";
const RUN = randomBytes(3).toString("hex");
const addr = (who: string) => `vitest-doors-${who}-${RUN}@example.com`;

const STAFF = addr("staff");
const STAFF_GREEK = addr("staff-el");
const GUARDIAN = addr("guardian");
const VET = addr("vet");
const NO_ROLES = addr("noroles");
const LEFT = addr("left");
const PENDING = addr("pending");
const NEVER = addr("never");
const EVERYONE = [STAFF, STAFF_GREEK, GUARDIAN, VET, NO_ROLES, LEFT, PENDING];

const ids: Record<string, { id: string; sessionVersion: number }> = {};
const colonyIds: number[] = [];

const aColony = async () => {
  const id = (
    await pool.query<{ id: number }>(
      "insert into colonies (name, normalised_name) values ($1, lower($1)) returning id",
      [`Vitest doors colony ${RUN} ${Math.random()}`],
    )
  ).rows[0]!.id;
  colonyIds.push(id);
  return id;
};

const add = async (
  email: string,
  roles: string[],
  extra: { colonyId?: number; language?: string } = {},
) => {
  const p = await addPerson({
    email,
    name: "Pat",
    addedBy: "cli:vitest",
    roles,
    ...extra,
  });
  ids[email] = { id: p.id, sessionVersion: p.sessionVersion };
  return p;
};

beforeAll(async () => {
  for (const e of EVERYONE) await removeTestPerson(e);
  await add(STAFF, ["staff"]);
  await add(STAFF_GREEK, ["staff"], { language: "el" });
  // T7: a cat guardian, placed on one colony.
  await add(GUARDIAN, ["guardian"], { colonyId: await aColony() });
  await add(VET, ["vet"]);
  const noRoles = await add(NO_ROLES, ["staff"]);
  await pool.query("delete from person_scopes where person_id = $1", [
    noRoles.id,
  ]);
  await add(LEFT, ["staff"]);
  await markLeft(LEFT, "cli:vitest");
  // Invited, not yet accepted (spec §10.1). Staff, so the role isn't why
  // they're refused: being pending is.
  const pending = await add(PENDING, ["staff"]);
  await pool.query("update people set accepted_at = null where id = $1", [
    pending.id,
  ]);
});

afterEach(() => {
  delete process.env["INTERNAL_PEOPLE_TOKEN"];
});

afterAll(async () => {
  for (const e of EVERYONE) await removeTestPerson(e);
  await pool.query("delete from colonies where id = any($1)", [colonyIds]);
  await pool.end();
});

const ask = (body: Record<string, unknown>) => {
  process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
  return request(app)
    .post("/api/internal/people/allowed")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send(body);
};
const askOld = (email: string) => ask({ email });
const askDoors = (email: string) => ask({ email, version: 2 });

/**
 * Everything the Worker can see of an answer: the status, the exact bytes,
 * and every header but the clock and the connection's own.
 */
const seen = (res: request.Response) => {
  const headers = { ...res.headers };
  for (const h of ["date", "connection", "keep-alive"]) delete headers[h];
  return { status: res.status, text: res.text, headers };
};

describe("T7: the old request shape says yes only to the workspace door (§14 case 11)", () => {
  it("a cat guardian placed on one colony gets allowed:false from the old shape, exactly as a stranger does", async () => {
    const guardian = await askOld(GUARDIAN);
    expect(guardian.status).toBe(200);
    expect(guardian.body).toEqual({ allowed: false });
    expect(seen(guardian)).toEqual(seen(await askOld(NEVER)));
  });

  it("the same guardian gets doors.workspace:false from the new shape", async () => {
    const res = await askDoors(GUARDIAN);
    expect(res.status).toBe(200);
    expect(res.body.doors.workspace).toBe(false);
    // Since PR 0.5 her placement holds placed capabilities on her colony, so
    // the dashboard door is open to her; the workspace door never is.
    expect(res.body).toMatchObject({
      allowed: true,
      doors: { workspace: false, dashboard: true },
    });
  });

  it("a staff address gets yes from the old shape, unchanged for today's Worker", async () => {
    const res = await askOld(STAFF);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      allowed: true,
      personId: ids[STAFF]!.id,
      name: "Pat",
      sessionVersion: ids[STAFF]!.sessionVersion,
    });
  });

  it("a staff address gets both doors, the language and who they are from the new shape", async () => {
    const res = await askDoors(STAFF);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      allowed: true,
      doors: { workspace: true, dashboard: true },
      language: "en",
      personId: ids[STAFF]!.id,
      name: "Pat",
      sessionVersion: ids[STAFF]!.sessionVersion,
    });
  });

  it("the new shape carries the person's own language", async () => {
    const res = await askDoors(`  ${STAFF_GREEK.toUpperCase()} `);
    expect(res.body.allowed).toBe(true);
    expect(res.body.language).toBe("el");
    expect(res.body.personId).toBe(ids[STAFF_GREEK]!.id);
  });
});

describe("T8 (part), §14 case 13: every no is the same, byte for byte", () => {
  // Unknown, left, not yet joined, and two kinds of "no door" (since PR 0.5
  // a placed guardian holds the dashboard door, so she is no longer one).
  const NOES = [NEVER, LEFT, PENDING, VET, NO_ROLES];

  for (const [shape, askIt, expected] of [
    ["old", askOld, { allowed: false }],
    [
      "version 2",
      askDoors,
      { allowed: false, doors: { workspace: false, dashboard: false } },
    ],
  ] as const) {
    it(`the ${shape} shape answers unknown, left, pending and no-door addresses identically`, async () => {
      const answers = [];
      for (const email of NOES) answers.push(seen(await askIt(email)));
      expect(answers[0]!.status).toBe(200);
      expect(JSON.parse(answers[0]!.text)).toEqual(expected);
      for (const [i, a] of answers.entries()) {
        expect(a, `${NOES[i]} differs from an unknown address`).toEqual(
          answers[0],
        );
      }
    });
  }

  it("a pending person is let in once they accept (control: the refusal is about being pending)", async () => {
    await pool.query("update people set accepted_at = now() where id = $1", [
      ids[PENDING]!.id,
    ]);
    try {
      expect((await askOld(PENDING)).body.allowed).toBe(true);
      expect((await askDoors(PENDING)).body.doors).toEqual({
        workspace: true,
        dashboard: true,
      });
    } finally {
      await pool.query("update people set accepted_at = null where id = $1", [
        ids[PENDING]!.id,
      ]);
    }
  });
});

describe("the version field", () => {
  it("refuses any version but 2 (or none), with the same 400 as a bad address", async () => {
    const bad = seen(await ask({ email: { $ne: null } }));
    expect(bad.status).toBe(400);
    for (const version of [1, 3, "2", 2.5, null, true, [2], { v: 2 }]) {
      expect(seen(await ask({ email: STAFF, version })), String(version)).toEqual(
        bad,
      );
    }
  });

  it("still asks for the bearer token first, in both shapes", async () => {
    process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
    const res = await request(app)
      .post("/api/internal/people/allowed")
      .set("Authorization", `Bearer ${TOKEN}x`)
      .send({ email: STAFF, version: 2 });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("never writes the address into a log line, in the new shape either", async () => {
    logLines.length = 0;
    await askDoors(STAFF);
    await askDoors(GUARDIAN);
    await askDoors(NEVER);
    const all = logLines.join("\n").toLowerCase();
    expect(all).toContain('"outcome":"allowed"');
    expect(all).toContain('"outcome":"not_allowed"');
    expect(all).not.toContain(`vitest-doors-`);
    expect(all).not.toContain(TOKEN);
  });
});
