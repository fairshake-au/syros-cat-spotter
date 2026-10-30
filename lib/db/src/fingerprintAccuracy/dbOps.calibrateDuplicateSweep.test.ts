import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "../migrate/runner";

// SYC-59 PR 5.3: scripts/db-ops.sh's calibrate-duplicate-sweep, run for real
// against a throwaway local database standing in for a Neon branch, as
// dbOps.fingerprintAccuracy.test.ts does. It runs the real api-server script
// in a child process, against decided pairs with fingerprints made up here.
vi.setConfig({ testTimeout: 180_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = path.join(ROOT, "scripts/db-ops.sh");
const MODEL = "dinov2-small-q8/v1";

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `dbops_calsweep_${crypto.randomBytes(4).toString("hex")}`;
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

const dev = () =>
  run({ TARGET: "development", DATABASE_TARGET: "development", NEON_DEV_URL: url(name), COMMAND: "calibrate-duplicate-sweep" });

let dim = 0;
/** A cat whose main photo has a fingerprint along `d`, leaning `lean` onto the next dimension. */
async function cat(d: number, lean: number): Promise<number> {
  const v = new Array<number>(384).fill(0);
  v[d] = Math.sqrt(1 - lean * lean);
  if (lean > 0) v[d + 1] = lean;
  const photo = (await c.query(`insert into photos (data, mime) values ('eA==', 'image/jpeg') returning id`)).rows[0].id;
  await c.query(`insert into photo_fingerprints (photo_id, model, vector) values ($1, $2, $3::real[])`, [photo, MODEL, v]);
  return (
    await c.query(`insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id) values ($1, $2, 37.44, 24.94, 'dev-calsweep') returning id`, [
      `Cal ${crypto.randomBytes(3).toString("hex")}`,
      photo,
    ])
  ).rows[0].id;
}

/** A decided pair whose two cats look alike by `score`. */
async function decided(decision: "merged" | "different", score: number) {
  dim += 2;
  const a = await cat(dim, 0);
  const b = await cat(dim, Math.sqrt(1 - score * score));
  await c.query(
    `insert into duplicate_decisions (cat_low, cat_high, decision, merge_id, by_account_id) values ($1, $2, $3, $4, 'dev-calsweep')`,
    [Math.min(a, b), Math.max(a, b), decision, decision === "merged" ? 1 : null],
  );
}

describe("db-ops calibrate-duplicate-sweep", () => {
  it("starts the script with every session read-only by default, for this command only", () => {
    const sh = readFileSync(SCRIPT, "utf8");
    const fn = /run_calibrate_duplicate_sweep\(\) \{[\s\S]*?\n\}/.exec(sh)?.[0] ?? "";
    expect(fn).toContain('PGOPTIONS="-c default_transaction_read_only=on"');
    expect(fn).not.toMatch(/export\s+PGOPTIONS/);
  });

  it("refuses rehearsal", () => {
    const r = run({ TARGET: "rehearsal", DATABASE_TARGET: "rehearsal", NEON_REHEARSAL_URL: url(name), COMMAND: "calibrate-duplicate-sweep" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("only runs against target=development or target=production");
  });

  it("refuses a missing database address, naming the variable, never a value", () => {
    const r = run({ TARGET: "development", DATABASE_TARGET: "development", COMMAND: "calibrate-duplicate-sweep" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("NEON_DEV_URL must be set");
  });

  it("with no decided pairs: says so, suggests nothing, prints no address", () => {
    const r = dev();
    expect(r.out).toContain("Decided pairs scored: 0");
    expect(r.out).toContain("Suggested SWEEP_THRESHOLD: none yet");
    expect(r.out).not.toMatch(/postgres(ql)?:\/\//);
    expect(r.code, r.out).toBe(0);
  });

  it("against fixture pairs: shows each threshold's top 10 and suggests the lowest that gets 3 in 4 right; writes nothing", async () => {
    // Merged (same cat): .97 .95 .93 .91. Different: .96 .85 .82 .80. One merged pair whose cat has no fingerprint.
    for (const s of [0.97, 0.95, 0.93, 0.91]) await decided("merged", s);
    for (const s of [0.96, 0.85, 0.82, 0.8]) await decided("different", s);
    const [lone, other] = [await cat((dim += 2), 0), await cat((dim += 2), 0)];
    await c.query(`delete from photo_fingerprints where photo_id = (select primary_photo_id from cats where id = $1)`, [lone]);
    await c.query(`insert into duplicate_decisions (cat_low, cat_high, decision, merge_id, by_account_id) values ($1, $2, 'merged', 1, 'dev-calsweep')`, [
      Math.min(lone, other),
      Math.max(lone, other),
    ]);
    const count = async (t: string) => (await c.query(`select count(*)::int as n from ${t}`)).rows[0].n;
    const before = { d: await count("duplicate_decisions"), r: await count("duplicate_reports"), f: await count("photo_fingerprints"), cats: await count("cats") };

    const r = dev();
    expect(r.out).toContain("Decided pairs scored: 8 (4 merged, 4 different). Not scored, a cat has no fingerprint: 1.");
    // At 0.70 the top 10 is all eight pairs: 4 of 8 were the same cat. At 0.88: five pairs, 4 of 5.
    expect(r.out).toMatch(/0\.70\s+8\s+8\s+4\s+50%\s+no/);
    expect(r.out).toMatch(/0\.85\s+6\s+6\s+4\s+67%\s+no/);
    expect(r.out).toMatch(/0\.88\s+5\s+5\s+4\s+80%\s+yes/);
    expect(r.out).toMatch(/0\.98\s+0\s+0\s+0\s+-\s+no/);
    expect(r.out).toContain("Suggested SWEEP_THRESHOLD: 0.88");
    expect(r.out).not.toMatch(/postgres(ql)?:\/\//);
    expect(r.code, r.out).toBe(0);

    expect({ d: await count("duplicate_decisions"), r: await count("duplicate_reports"), f: await count("photo_fingerprints"), cats: await count("cats") }).toEqual(before);
  });
});
