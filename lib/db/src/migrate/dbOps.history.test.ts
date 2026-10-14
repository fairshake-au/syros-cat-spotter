import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";

// SYC-178. scripts/db-ops.sh's verify-history, run for real against a
// throwaway local database standing in for Neon production, migrated with the
// real checked-in migrations. Each run starts pnpm, so allow CI some time.
vi.setConfig({ testTimeout: 60_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = path.join(ROOT, "scripts/db-ops.sh");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `dbops_history_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
const migrations = readMigrations(defaultMigrationsFolder());
const newest = migrations[migrations.length - 1]!;
const previous = migrations[migrations.length - 2]!;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, migrations);
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

// Each test starts from the history the runner wrote, in its original order.
beforeEach(async () => {
  await c.query(`truncate drizzle.__drizzle_migrations restart identity`);
  for (const m of migrations) {
    await c.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
      [m.hash, m.when],
    );
  }
});

function verifyHistory() {
  const r = spawnSync("bash", [SCRIPT], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      COMMAND: "verify-history",
      TARGET: "production",
      DATABASE_TARGET: "production",
      NEON_PROD_URL: url(name),
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  const out = `${r.stdout}\n${r.stderr}`;
  expect(out).not.toMatch(/postgres(ql)?:\/\//);
  return { code: r.status, out };
}

const history = async () =>
  (await c.query(`select id, hash, created_at from drizzle.__drizzle_migrations order by id`)).rows;

describe("db-ops verify-history", () => {
  it("passes on an up-to-date database and writes nothing", async () => {
    const before = await history();
    const r = verifyHistory();
    expect(r.out).toContain(
      `migration history ok: ${migrations.length} migration(s) recorded`,
    );
    expect(r.out).toContain(`Newest: ${newest.tag}.`);
    expect(r.code).toBe(0);
    expect(await history()).toEqual(before);
  });

  it("fails on a missing migration", async () => {
    await c.query(`delete from drizzle.__drizzle_migrations where created_at = $1`, [newest.when]);
    const r = verifyHistory();
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(`${newest.tag} has not been applied yet`);
  });

  it("fails on an extra migration", async () => {
    await c.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
      ["e".repeat(64), newest.when + 1],
    );
    const r = verifyHistory();
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("a migration this code does not know");
  });

  it("fails on migrations applied out of order", async () => {
    await c.query(`delete from drizzle.__drizzle_migrations where created_at = $1`, [previous.when]);
    await c.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
      [previous.hash, previous.when],
    );
    const r = verifyHistory();
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(`${previous.tag} was applied after ${newest.tag}`);
  });

  it("needs no old-database address", async () => {
    // REPLIT_URL is deliberately absent from verifyHistory()'s environment;
    // the passing run above proves it isn't required. Spelled out here so a
    // future edit that adds `require REPLIT_URL` fails a named test.
    const r = verifyHistory();
    expect(r.out).not.toContain("REPLIT_URL must be set");
    expect(r.code).toBe(0);
  });
});
