import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "../migrate/runner";
import { guardTarget, mark, readMarkers } from "./guard";

// SYC-121 Fable review fixes 2 and 4: scripts/db-ops.sh, run for real
// against throwaway local databases. The copy tests need a Postgres 16
// pg_dump/pg_restore (PG_DUMP_BIN/PG_RESTORE_BIN, the Ubuntu path the
// workflow uses, or Homebrew's) and are skipped where there isn't one.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = path.join(ROOT, "scripts/db-ops.sh");

function pgBin(name: "pg_dump" | "pg_restore"): string | null {
  const env = process.env[name === "pg_dump" ? "PG_DUMP_BIN" : "PG_RESTORE_BIN"];
  for (const p of [env, `/usr/lib/postgresql/16/bin/${name}`, `/opt/homebrew/bin/${name}`]) {
    if (!p || !fs.existsSync(p)) continue;
    const v = spawnSync(p, ["--version"], { encoding: "utf8" });
    if (/\b16\./.test(v.stdout)) return p;
  }
  return null;
}
const PG_DUMP = pgBin("pg_dump");
const PG_RESTORE = pgBin("pg_restore");
const haveDump = PG_DUMP !== null && PG_RESTORE !== null;

const admin = new pg.Client({ connectionString: withDb(baseUrl, "postgres") });
const created: string[] = [];
const open: pg.Client[] = [];
const tmpDirs: string[] = [];

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function freshDb(): Promise<{ url: string; client: pg.Client }> {
  const name = `dbops_test_${crypto.randomBytes(4).toString("hex")}`;
  await admin.query(`create database "${name}"`);
  created.push(name);
  const url = withDb(baseUrl!, name);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  open.push(client);
  return { url, client };
}

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dbops-test-"));
  tmpDirs.push(d);
  return d;
}

/** A stand-in `age`: validates a recipient (output /dev/null) but fails a real encryption. */
function ageStub(dir: string, realEncrypt: "fail" | "succeed"): string {
  const p = path.join(dir, "age");
  const onReal =
    realEncrypt === "fail"
      ? "echo 'age: simulated failure' >&2; exit 1"
      : 'out=""; in=""; while [ $# -gt 0 ]; do if [ "$1" = -o ]; then out="$2"; shift; else in="$1"; fi; shift; done; cat "$in" > "$out"';
  fs.writeFileSync(
    p,
    `#!/bin/sh\ncase "$*" in *"-o /dev/null"*) cat >/dev/null; exit 0;; esac\n${onReal}\n`,
    { mode: 0o755 },
  );
  return p;
}

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

/** An "old Replit" database at the baseline with a row, and an empty-but-rehearsed Neon target. */
async function copyScenario() {
  const replit = await freshDb();
  await migrateUp(replit.client, readMigrations(defaultMigrationsFolder()), {
    throughIdx: 0,
  });
  await replit.client.query(
    `insert into photos (data, mime) values ('p', 'image/jpeg')`,
  );
  const neon = await freshDb();
  await guardTarget(neon.client, "rehearsal");
  await mark(neon.client, "rehearsal", "x");
  return { replit, neon };
}

beforeAll(async () => {
  await admin.connect();
});

afterEach(async () => {
  for (const c of open.splice(0)) await c.end();
  for (const name of created.splice(0)) {
    await admin.query(`drop database if exists "${name}" with (force)`);
  }
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}, 60_000);

afterAll(async () => {
  await admin.end();
});

describe("db-ops refuses a mismatched or ambiguous target (fix 4)", () => {
  it("refuses when DATABASE_TARGET doesn't equal TARGET, before doing anything", () => {
    const r = run({ COMMAND: "fingerprint-source", TARGET: "production", DATABASE_TARGET: "development" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/DATABASE_TARGET/);
  });

  it("refuses when DATABASE_TARGET is unset", () => {
    const r = run({ COMMAND: "fingerprint-source", TARGET: "production" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/DATABASE_TARGET/);
  });

  it("refuses copy-rehearsal with target=development", () => {
    const r = run({ COMMAND: "copy-rehearsal", TARGET: "development", DATABASE_TARGET: "development" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/copy-rehearsal is refused for target=development/);
  });

  it("target=production never falls through to another branch's address", async () => {
    // As if the workflow's `a && x || b && y || z` had fallen through to the
    // rehearsal secret because the production one was empty.
    const other = await freshDb();
    const r = run({
      COMMAND: "migrate",
      TARGET: "production",
      DATABASE_TARGET: "production",
      NEON_URL: other.url,
      NEON_REHEARSAL_URL: other.url,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/NEON_PROD_URL must be set/);
    const t = await other.client.query(
      `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
    );
    expect(t.rows[0].n).toBe(0);
  });
});

describe("copy-cutover encrypts the dump before anything is marked (fix 2)", () => {
  it("refuses up front, before the guard wipes anything, when DUMP_AGE_RECIPIENT is set but age is unusable", async () => {
    const { replit, neon } = await copyScenario();
    await neon.client.query(`create table public.keep_me (id int)`);
    const r = run({
      COMMAND: "copy-cutover",
      TARGET: "production",
      DATABASE_TARGET: "production",
      REPLIT_URL: replit.url,
      NEON_PROD_URL: neon.url,
      DUMP_AGE_RECIPIENT: "age1example",
      AGE_BIN: "/nonexistent/age",
      PG_DUMP_BIN: PG_DUMP ?? "/nonexistent/pg_dump",
      PG_RESTORE_BIN: PG_RESTORE ?? "/nonexistent/pg_restore",
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/age/);
    expect(r.out).not.toMatch(/guard-target/);
    const kept = await neon.client.query(`select to_regclass('public.keep_me') as t`);
    expect(kept.rows[0].t).not.toBeNull();
    expect((await readMarkers(neon.client)).cutoverDone).toBe(false);
  });

  it.skipIf(!haveDump)(
    "an encryption failure leaves S-failed-copy (marker kept, no cutover_done), not S-cut",
    async () => {
      const { replit, neon } = await copyScenario();
      const dir = tmpDir();
      const r = run({
        COMMAND: "copy-cutover",
        TARGET: "production",
        DATABASE_TARGET: "production",
        REPLIT_URL: replit.url,
        NEON_PROD_URL: neon.url,
        DUMP_AGE_RECIPIENT: "age1example",
        AGE_BIN: ageStub(dir, "fail"),
        DUMP_AGE_OUT: path.join(dir, "dump.age"),
        PG_DUMP_BIN: PG_DUMP!,
        PG_RESTORE_BIN: PG_RESTORE!,
      });
      expect(r.code).not.toBe(0);
      const m = await readMarkers(neon.client);
      expect(m.cutoverDone).toBe(false);
      expect(m.rehearsalMarked).toBe(true);
    },
    120_000,
  );

  it.skipIf(!haveDump)(
    "a successful copy-cutover produces the encrypted dump and marks cutover_done",
    async () => {
      const { replit, neon } = await copyScenario();
      const dir = tmpDir();
      const out = path.join(dir, "dump.age");
      const r = run({
        COMMAND: "copy-cutover",
        TARGET: "production",
        DATABASE_TARGET: "production",
        REPLIT_URL: replit.url,
        NEON_PROD_URL: neon.url,
        DUMP_AGE_RECIPIENT: "age1example",
        AGE_BIN: ageStub(dir, "succeed"),
        DUMP_AGE_OUT: out,
        PG_DUMP_BIN: PG_DUMP!,
        PG_RESTORE_BIN: PG_RESTORE!,
      });
      expect(r.code, r.out).toBe(0);
      expect(fs.statSync(out).size).toBeGreaterThan(0);
      expect((await readMarkers(neon.client)).cutoverDone).toBe(true);
      expect(r.out).not.toMatch(/postgres(ql)?:\/\//);
    },
    120_000,
  );
});
