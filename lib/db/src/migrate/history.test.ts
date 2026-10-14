import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkHistory, historyProblems, type RecordedRow } from "./history";
import { migrateUp, readMigrations, type Migration } from "./runner";

// SYC-178. The post-go-live migration-history check: the database's own
// record of applied migrations against meta/_journal.json, read-only.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

const admin = new pg.Client({ connectionString: withDb(baseUrl, "postgres") });
const created: string[] = [];
const open: pg.Client[] = [];
const folders: string[] = [];

beforeAll(async () => {
  await admin.connect();
});

afterAll(async () => {
  for (const c of open) await c.end();
  for (const name of created)
    await admin.query(`drop database if exists "${name}"`);
  await admin.end();
  for (const dir of folders) fs.rmSync(dir, { recursive: true, force: true });
});

async function freshDb(): Promise<pg.Client> {
  const name = `history_test_${crypto.randomBytes(4).toString("hex")}`;
  await admin.query(`create database "${name}"`);
  created.push(name);
  const client = new pg.Client({ connectionString: withDb(baseUrl!, name) });
  await client.connect();
  open.push(client);
  return client;
}

const FILES = [
  { tag: "0000_base", when: 1000, sql: `CREATE TABLE "cats" ("id" serial PRIMARY KEY NOT NULL);` },
  {
    tag: "0001_notes",
    when: 2000,
    sql: `ALTER TABLE "cats" ADD COLUMN "notes" text;\n-- rollback-begin\n-- ALTER TABLE "cats" DROP COLUMN "notes";\n-- rollback-end\n`,
  },
  {
    tag: "0002_age",
    when: 3000,
    sql: `ALTER TABLE "cats" ADD COLUMN "age" integer;\n-- rollback-begin\n-- ALTER TABLE "cats" DROP COLUMN "age";\n-- rollback-end\n`,
  },
];

function fixture(): Migration[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "history-"));
  folders.push(dir);
  fs.mkdirSync(path.join(dir, "meta"));
  fs.writeFileSync(
    path.join(dir, "meta/_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: FILES.map((f, idx) => ({
        idx,
        version: "7",
        when: f.when,
        tag: f.tag,
        breakpoints: true,
      })),
    }),
  );
  for (const f of FILES)
    fs.writeFileSync(path.join(dir, `${f.tag}.sql`), f.sql);
  return readMigrations(dir);
}

const migrations = fixture();
const [m0, m1, m2] = migrations as [Migration, Migration, Migration];
const row = (id: number, m: Migration, hash = m.hash): RecordedRow => ({
  id,
  hash,
  created_at: String(m.when),
});

describe("historyProblems", () => {
  it("passes when every journal entry is recorded once, unedited, in order", () => {
    expect(historyProblems([row(1, m0), row(2, m1), row(3, m2)], migrations)).toEqual([]);
  });

  it("ignores gaps in the id sequence (a rolled-back migration uses up an id)", () => {
    expect(historyProblems([row(1, m0), row(4, m1), row(9, m2)], migrations)).toEqual([]);
  });

  it("catches a missing migration at the end (not applied yet)", () => {
    const p = historyProblems([row(1, m0), row(2, m1)], migrations);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/0002_age.*not been applied/);
  });

  it("catches a missing migration in the middle (skipped)", () => {
    const p = historyProblems([row(1, m0), row(2, m2)], migrations);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/0001_notes.*skipped/);
  });

  it("catches an extra migration this code does not know", () => {
    const p = historyProblems(
      [row(1, m0), row(2, m1), row(3, m2), { id: 4, hash: "f".repeat(64), created_at: "4000" }],
      migrations,
    );
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/does not know/);
    expect(p[0]).toMatch(/4000/);
  });

  it("catches migrations applied out of order", () => {
    const p = historyProblems([row(1, m0), row(2, m2), row(3, m1)], migrations);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/0001_notes.*after 0002_age/);
  });

  it("catches a migration edited after it was applied", () => {
    const p = historyProblems([row(1, m0), row(2, m1, "0".repeat(64)), row(3, m2)], migrations);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/0001_notes.*edited/);
  });

  it("catches a migration recorded twice", () => {
    const p = historyProblems([row(1, m0), row(2, m1), row(3, m1), row(4, m2)], migrations);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/0001_notes.*twice/);
  });

  it("reports an edited duplicate, not just the duplicate", () => {
    const p = historyProblems([row(1, m0), row(2, m1), row(3, m1, "0".repeat(64)), row(4, m2)], migrations);
    expect(p.join("\n")).toMatch(/0001_notes.*twice/);
    expect(p.join("\n")).toMatch(/second record.*does not match/);
  });

  it("names a row with no timestamp instead of calling it timestamp 0", () => {
    const p = historyProblems(
      [row(1, m0), row(2, m1), row(3, m2), { id: 4, hash: "a".repeat(64), created_at: null }],
      migrations,
    );
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/Row 4 .* no timestamp/);
  });

  it("catches an empty history", () => {
    const p = historyProblems([], migrations);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/no migrations recorded/i);
  });
});

describe("checkHistory against a real database", () => {
  async function migrated(): Promise<pg.Client> {
    const c = await freshDb();
    await migrateUp(c, migrations);
    return c;
  }

  it("passes on a database migrated by the runner", async () => {
    const c = await migrated();
    const r = await checkHistory(c, migrations);
    expect(r).toEqual({ problems: [], recorded: 3, newest: "0002_age" });
  });

  it("catches a missing migration", async () => {
    const c = await migrated();
    await c.query(`delete from drizzle.__drizzle_migrations where created_at = $1`, [m2.when]);
    const r = await checkHistory(c, migrations);
    expect(r.problems.join("\n")).toMatch(/0002_age.*not been applied/);
  });

  it("catches an extra migration", async () => {
    const c = await migrated();
    await c.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
      ["e".repeat(64), 4000],
    );
    const r = await checkHistory(c, migrations);
    expect(r.problems.join("\n")).toMatch(/does not know/);
  });

  it("catches migrations applied out of order", async () => {
    const c = await migrated();
    // Re-record 0001 so it gets a later id than 0002: it now reads as applied
    // after 0002.
    await c.query(`delete from drizzle.__drizzle_migrations where created_at = $1`, [m1.when]);
    await c.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
      [m1.hash, m1.when],
    );
    const r = await checkHistory(c, migrations);
    expect(r.problems.join("\n")).toMatch(/0001_notes.*after 0002_age/);
  });

  it("reports a database with no history table, and does not create one", async () => {
    const c = await freshDb();
    const r = await checkHistory(c, migrations);
    expect(r.problems.join("\n")).toMatch(/no migration history table/i);
    const t = await c.query(`select to_regclass('drizzle.__drizzle_migrations') as t`);
    expect(t.rows[0].t).toBeNull();
  });

  it("reads inside a read-only transaction", async () => {
    const c = await migrated();
    const seen: string[] = [];
    const spy = {
      query: (text: string, values?: unknown[]) => {
        seen.push(text);
        return c.query(text, values);
      },
    } as unknown as pg.Client;
    await checkHistory(spy, migrations);
    expect(seen[0]).toMatch(/^begin (transaction )?read only$/i);
    expect(seen.some((s) => /\b(insert|update|delete|create|alter|drop)\b/i.test(s))).toBe(false);
  });
});
