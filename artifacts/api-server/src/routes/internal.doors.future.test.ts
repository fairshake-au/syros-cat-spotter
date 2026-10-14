import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { addPerson, pool } from "@workspace/db";
import app from "../app";
import { removeTestPerson } from "../test/removeTestPerson";

// The two doors once a cat guardian holds a dashboard capability (SYC-53 plan
// PR 0.4, T7 and the T27 probe).
//
// In this PR can() is still staff-only, so the dashboard door and the
// workspace door open for exactly the same people, and nothing real can tell
// them apart: answering the old shape with the dashboard door instead of the
// workspace door would pass every other test until PR 0.5 gives guardians
// something. So here the dashboard door is replaced with what PR 0.5 will
// make it for a guardian (any placement opens it), and the workspace door is
// left real. The route must still refuse her the workspace in both shapes.

vi.mock("../lib/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/capabilities")>();
  return {
    ...real,
    mayEnter: (person: Parameters<typeof real.mayEnter>[0]) =>
      real.mayEnter(person) ||
      person.scopes.some((s) => s.role === "guardian" && s.colonyId !== null),
  };
});

const TOKEN = "vitest-internal-token-doors-future-0123456789ab";
const RUN = randomBytes(3).toString("hex");
const GUARDIAN = `vitest-doorsf-guardian-${RUN}@example.com`;
const STAFF = `vitest-doorsf-staff-${RUN}@example.com`;
let guardianId: string;

beforeAll(async () => {
  process.env["INTERNAL_PEOPLE_TOKEN"] = TOKEN;
  const colonyId = (
    await pool.query<{ id: number }>(
      "insert into colonies (name, normalised_name) values ($1, lower($1)) returning id",
      [`Vitest doors future colony ${RUN}`],
    )
  ).rows[0]!.id;
  const g = await addPerson({
    email: GUARDIAN,
    name: "Eleni",
    addedBy: "cli:vitest",
    roles: ["guardian"],
    colonyId,
    language: "el",
  });
  guardianId = g.id;
  await addPerson({
    email: STAFF,
    name: "Pat",
    addedBy: "cli:vitest",
    roles: ["staff"],
  });
});

afterAll(async () => {
  delete process.env["INTERNAL_PEOPLE_TOKEN"];
  await removeTestPerson(GUARDIAN);
  await removeTestPerson(STAFF);
  await pool.end();
});

const ask = (body: Record<string, unknown>) =>
  request(app)
    .post("/api/internal/people/allowed")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send(body);

describe("a guardian with the dashboard door is still refused the workspace (T7, T27 part)", () => {
  it("the old shape says no to her, byte for byte as for a stranger", async () => {
    const her = await ask({ email: GUARDIAN });
    const stranger = await ask({ email: `vitest-doorsf-never-${RUN}@example.com` });
    expect(her.body).toEqual({ allowed: false });
    expect(her.text).toBe(stranger.text);
  });

  it("version 2 opens the dashboard door only, with her language", async () => {
    const res = await ask({ email: GUARDIAN, version: 2 });
    expect(res.body).toEqual({
      allowed: true,
      doors: { workspace: false, dashboard: true },
      language: "el",
      personId: guardianId,
      name: "Eleni",
      sessionVersion: 1,
    });
  });

  it("staff still get both doors (control)", async () => {
    expect((await ask({ email: STAFF })).body.allowed).toBe(true);
    expect((await ask({ email: STAFF, version: 2 })).body.doors).toEqual({
      workspace: true,
      dashboard: true,
    });
  });
});
