import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "../migrate/runner";

// scripts/db-ops.sh's people-add and people-list (SYC-43 part 1; SYC-121
// plan H.1(b)), run for real against a throwaway local database standing in
// for a Neon branch. Each run starts pnpm, so allow CI some time.
vi.setConfig({ testTimeout: 60_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const SCRIPT = path.join(ROOT, "scripts/db-ops.sh");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `dbops_people_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

const EMAIL = "Jacky.Test@Example.com";
const PERSON_NAME = "Jacky Testperson";

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, readMigrations(defaultMigrationsFolder()));
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

beforeEach(async () => {
  await c.query(`truncate person_scopes, people cascade`);
});

function run(env: Record<string, string | undefined>) {
  const clean: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
  };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const r = spawnSync("bash", [SCRIPT], {
    cwd: ROOT,
    env: clean,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

/** Output as GitHub would show it: its own ::add-mask:: lines are consumed. */
const shown = (out: string) =>
  out
    .split("\n")
    .filter((l) => !l.startsWith("::add-mask::"))
    .join("\n");

const devAdd = (extra: Record<string, string | undefined> = {}) =>
  run({
    COMMAND: "people-add",
    TARGET: "development",
    DATABASE_TARGET: "development",
    NEON_DEV_URL: url(name),
    PEOPLE_EMAIL: EMAIL,
    PEOPLE_NAME: PERSON_NAME,
    PEOPLE_ROLE: "staff",
    GITHUB_ACTOR: "claude-bot",
    ...extra,
  });

const countPeople = async () =>
  (await c.query(`select count(*)::int as n from people`)).rows[0].n as number;

describe("db-ops people-add", () => {
  it("masks both secrets first, adds the person, and shows only the id and role", async () => {
    const r = devAdd();
    expect(r.code).toBe(0);
    const lines = r.out.split("\n");
    expect(lines[0]).toBe(`::add-mask::${EMAIL}`);
    expect(lines[1]).toBe(`::add-mask::${PERSON_NAME}`);
    const row = await c.query(`select id, email, name, added_by from people`);
    expect(row.rows[0]).toMatchObject({
      email: "jacky.test@example.com",
      name: PERSON_NAME,
      added_by: "cli:db-ops:claude-bot",
    });
    const out = shown(r.out);
    expect(out).toContain(`Added person ${row.rows[0].id} as staff.`);
    expect(out.toLowerCase()).not.toContain("jacky");
    expect(out).not.toMatch(/postgres(ql)?:\/\//);
    expect(out).not.toContain(url(name));
  });

  it("refuses when DATABASE_TARGET is missing or doesn't match, and adds nobody", async () => {
    for (const DATABASE_TARGET of [undefined, "production"]) {
      const r = devAdd({ DATABASE_TARGET });
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(
        /DATABASE_TARGET .* doesn't match target 'development'/,
      );
    }
    expect(await countPeople()).toBe(0);
  });

  it("refuses target=production when only another branch's address is set", async () => {
    const r = devAdd({
      TARGET: "production",
      DATABASE_TARGET: "production",
      NEON_DEV_URL: url(name),
      NEON_REHEARSAL_URL: url(name),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/NEON_PROD_URL must be set/);
    expect(await countPeople()).toBe(0);
  });

  it("refuses target=rehearsal", async () => {
    const r = devAdd({
      TARGET: "rehearsal",
      DATABASE_TARGET: "rehearsal",
      NEON_REHEARSAL_URL: url(name),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(
      /only runs against target=development or target=production/,
    );
    expect(await countPeople()).toBe(0);
  });

  it("refuses a role that isn't on the fixed list, or a missing secret", async () => {
    for (const extra of [
      { PEOPLE_ROLE: "admin" },
      { PEOPLE_ROLE: undefined },
      { PEOPLE_ROLE: "staff --role vet" },
      { PEOPLE_EMAIL: undefined },
      { PEOPLE_NAME: undefined },
    ]) {
      const r = devAdd(extra);
      expect(r.code).not.toBe(0);
    }
    expect(await countPeople()).toBe(0);
  });

  it("refuses a shared mailbox, without showing the address", async () => {
    const r = devAdd({ PEOPLE_EMAIL: "admin@syroscats.com" });
    expect(r.code).not.toBe(0);
    const out = shown(r.out);
    expect(out).toContain("admin@ is a shared mailbox.");
    expect(out).not.toContain("admin@syroscats.com");
    expect(await countPeople()).toBe(0);
  });
});

describe("db-ops people-list", () => {
  it("lists ids and roles, with no address, name or connection details", async () => {
    expect(devAdd().code).toBe(0);
    const r = run({
      COMMAND: "people-list",
      TARGET: "development",
      DATABASE_TARGET: "development",
      NEON_DEV_URL: url(name),
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("1 person on the list.");
    expect(r.out).toMatch(/[0-9a-f-]{36}\tstaff\tsession 1\t/);
    expect(r.out.toLowerCase()).not.toContain("jacky");
    expect(r.out).not.toMatch(/postgres(ql)?:\/\//);
    expect(r.out).not.toContain("localhost");
  });

  it("refuses a mismatched target", () => {
    const r = run({
      COMMAND: "people-list",
      TARGET: "production",
      DATABASE_TARGET: "development",
      NEON_PROD_URL: url(name),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/DATABASE_TARGET/);
  });
});
