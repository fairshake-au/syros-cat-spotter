import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "../migrate/runner";

// SYC-527 piece 3, Task 4: scripts/db-ops.sh's fingerprint-accuracy, run for
// real against a throwaway local database standing in for a Neon branch, as
// dbOps.settings.test.ts does for the settings commands. It runs the real
// api-server script (and the real DINOv2 model) in a child process.
vi.setConfig({ testTimeout: 180_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = path.join(ROOT, "scripts/db-ops.sh");

// Two 32 px JPEGs of plain, different colours (made with sharp once; kept as text).
const RED_JPEG =
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAgACADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAYH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AiwE01MAAAAAB/9k=";
const BLUE_JPEG =
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAgACADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AkgDVkgAAAAAB/9k=";

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `dbops_fpacc_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

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

function run(env: Record<string, string | undefined>) {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  // Local runs strip darwin's esbuild; tsx needs the binary's path (CI doesn't set this).
  if (process.env.ESBUILD_BINARY_PATH) clean.ESBUILD_BINARY_PATH = process.env.ESBUILD_BINARY_PATH;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const r = spawnSync("bash", [SCRIPT], { cwd: ROOT, env: clean, encoding: "utf8", timeout: 170_000 });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const dev = (extra: Record<string, string | undefined> = {}) =>
  run({ TARGET: "development", DATABASE_TARGET: "development", NEON_DEV_URL: url(name), COMMAND: "fingerprint-accuracy", ...extra });

async function photo(b64: string, at: string): Promise<number> {
  return (await c.query(`insert into photos (data, mime, created_at) values ($1, 'image/jpeg', $2) returning id`, [b64, at])).rows[0].id;
}

describe("db-ops fingerprint-accuracy", () => {
  it("refuses rehearsal", () => {
    const r = run({ TARGET: "rehearsal", DATABASE_TARGET: "rehearsal", NEON_REHEARSAL_URL: url(name), COMMAND: "fingerprint-accuracy" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("only runs against target=development or target=production");
  });

  it("refuses a missing database address, naming the variable, never a value", () => {
    const r = run({ TARGET: "development", DATABASE_TARGET: "development", COMMAND: "fingerprint-accuracy" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("NEON_DEV_URL must be set");
  });

  it("an empty database: runs, says there is nothing to test, prints no address", () => {
    const r = dev();
    expect(r.out).toContain("Gallery: 0 active cats");
    expect(r.out).toContain("cannot pass or fail");
    expect(r.out).not.toMatch(/postgres(ql)?:\/\//);
    expect(r.code, r.out).toBe(0);
  });

  it("one pair: prints the rank only, and writes nothing", async () => {
    const dRed = await photo(RED_JPEG, "2026-10-01T10:00:00Z");
    const dBlue = await photo(BLUE_JPEG, "2026-10-01T10:00:00Z");
    const q = await photo(RED_JPEG, "2026-10-04T10:00:00Z");
    const red = (await c.query(`insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id) values ('Fp Red', $1, 37.44, 24.94, 'dev-fpacc') returning id`, [dRed])).rows[0].id;
    await c.query(`insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id) values ('Fp Blue', $1, 37.44, 24.94, 'dev-fpacc')`, [dBlue]);
    await c.query(`insert into sightings (cat_id, device_id, photo_id, lat, lng, status) values ($1, 'dev-fpacc', $2, 37.44, 24.94, 'resolved')`, [red, q]);
    const count = async (t: string) => (await c.query(`select count(*)::int as n from ${t}`)).rows[0].n;
    const before = { photos: await count("photos"), variants: await count("photo_variants"), cats: await count("cats"), sightings: await count("sightings") };

    const r = dev();
    expect(r.out).toContain("Gallery: 2 active cats");
    expect(r.out).toContain("Pairs: 1 cats");
    expect(r.out).toMatch(/pair 1: dinov2-small-q8 rank [12]\b/);
    expect(r.out).toMatch(/smoke (PASSES|FAILS) at top 10/);
    expect(r.out).toContain("CLIP check skipped");
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain("Fp Red");
    expect(r.out).not.toMatch(/postgres(ql)?:\/\//);

    expect({ photos: await count("photos"), variants: await count("photo_variants"), cats: await count("cats"), sightings: await count("sightings") }).toEqual(before);
  });
});
