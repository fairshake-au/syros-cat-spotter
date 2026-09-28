import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  cycle,
  defaultMigrationsFolder,
  MigrationError,
  migrateUp,
  parseRollback,
  readMigrations,
  rollbackLast,
} from "./runner";

// Each test gets its own throwaway database on the server DATABASE_URL points
// at, so nothing here touches the database the api-server tests use.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const admin = new pg.Client({ connectionString: withDb(baseUrl, "postgres") });
const created: string[] = [];
const open: pg.Client[] = [];
const folders: string[] = [];

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function freshDb(): Promise<pg.Client> {
  const name = `migrate_test_${crypto.randomBytes(4).toString("hex")}`;
  await admin.query(`create database "${name}"`);
  created.push(name);
  const client = new pg.Client({ connectionString: withDb(baseUrl!, name) });
  await client.connect();
  open.push(client);
  return client;
}

/** A migrations folder in Drizzle's layout, from a list of files. */
function fixture(files: { tag: string; when: number; sql: string }[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-"));
  folders.push(dir);
  fs.mkdirSync(path.join(dir, "meta"));
  fs.writeFileSync(
    path.join(dir, "meta/_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: files.map((f, idx) => ({
        idx,
        version: "7",
        when: f.when,
        tag: f.tag,
        breakpoints: true,
      })),
    }),
  );
  for (const f of files)
    fs.writeFileSync(path.join(dir, `${f.tag}.sql`), f.sql);
  return dir;
}

const BASELINE = {
  tag: "0000_base",
  when: 1000,
  sql: [
    `CREATE TYPE "public"."mood" AS ENUM('calm', 'cross');`,
    `CREATE TABLE "cats" ("id" serial PRIMARY KEY NOT NULL, "name" text NOT NULL, "mood" "mood" DEFAULT 'calm' NOT NULL);`,
    `CREATE UNIQUE INDEX "cats_name_lower" ON "cats" USING btree (lower("name"));`,
  ].join("--> statement-breakpoint\n"),
};

const ADD_NOTES = {
  tag: "0001_notes",
  when: 2000,
  sql:
    [
      `CREATE TABLE "notes" ("id" serial PRIMARY KEY NOT NULL, "cat_id" integer NOT NULL);`,
      `CREATE INDEX "notes_cat" ON "notes" ("cat_id");`,
    ].join("--> statement-breakpoint\n") +
    ["", `-- rollback-begin`, `-- DROP TABLE "notes";`, `-- rollback-end`].join(
      "\n",
    ),
};

const ADD_COLOUR = {
  tag: "0002_colour",
  when: 3000,
  sql: [
    `ALTER TABLE "cats" ADD COLUMN "colour" text;`,
    `-- rollback-begin`,
    `-- ALTER TABLE "cats" DROP COLUMN "colour";`,
    `-- rollback-end`,
  ].join("\n"),
};

async function tables(c: pg.Client): Promise<string[]> {
  const r = await c.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`,
  );
  return r.rows.map((x) => x.table_name);
}

async function recorded(c: pg.Client): Promise<number> {
  const r = await c.query(
    `select 1 from information_schema.tables
      where table_schema = 'drizzle' and table_name = '__drizzle_migrations'`,
  );
  if (!r.rowCount) return 0;
  return (await c.query(`select 1 from drizzle.__drizzle_migrations`))
    .rowCount!;
}

/** What `drizzle-kit push` used to leave: the schema, and no history. */
async function buildWithoutHistory(c: pg.Client, sql: string): Promise<void> {
  for (const s of sql.split("--> statement-breakpoint")) await c.query(s);
}

beforeAll(async () => {
  await admin.connect();
});

afterEach(async () => {
  for (const c of open.splice(0)) await c.end();
});

afterAll(async () => {
  for (const name of created)
    await admin.query(`drop database if exists "${name}"`);
  await admin.end();
  for (const d of folders) fs.rmSync(d, { recursive: true, force: true });
});

describe("parseRollback", () => {
  it("returns the uncommented SQL between the markers", () => {
    expect(parseRollback(ADD_COLOUR.sql)).toBe(
      `ALTER TABLE "cats" DROP COLUMN "colour";`,
    );
  });
  it("returns null when there is no block", () => {
    expect(parseRollback(BASELINE.sql)).toBeNull();
  });
  it("rejects an unterminated block", () => {
    expect(() => parseRollback("-- rollback-begin\n-- DROP TABLE x;")).toThrow(
      MigrationError,
    );
  });
  it("rejects an uncommented line, which would run on the way up", () => {
    expect(() =>
      parseRollback(
        'CREATE TABLE "x" ();\n-- rollback-begin\nDROP TABLE "x";\n-- rollback-end\n',
      ),
    ).toThrow(/rollback line 3 is not commented/);
  });
  it("rejects a second rollback block", () => {
    expect(() =>
      parseRollback(
        "-- rollback-begin\n-- DROP TABLE x;\n-- rollback-end\n-- rollback-begin\n-- DROP TABLE y;\n-- rollback-end\n",
      ),
    ).toThrow(/more than one rollback block/);
  });
  it("tolerates CRLF line endings", () => {
    expect(
      parseRollback(
        "-- rollback-begin\r\n-- DROP TABLE x;\r\n-- rollback-end\r\n",
      ),
    ).toBe("DROP TABLE x;");
  });
});

describe("migrateUp", () => {
  it("applies everything to an empty database, then does nothing", async () => {
    const c = await freshDb();
    const m = readMigrations(fixture([BASELINE, ADD_NOTES]));
    expect(await migrateUp(c, m)).toEqual({
      adoptedBaseline: false,
      applied: ["0000_base", "0001_notes"],
    });
    expect(await tables(c)).toEqual(["cats", "notes"]);
    expect(await migrateUp(c, m)).toEqual({
      adoptedBaseline: false,
      applied: [],
    });
    expect(await recorded(c)).toBe(2);
  });

  it("adopts the baseline on a push-built database without running it, then applies the rest", async () => {
    const c = await freshDb();
    await buildWithoutHistory(c, BASELINE.sql);
    await c.query(`insert into cats (name) values ('Agatha')`);
    const m = readMigrations(fixture([BASELINE, ADD_NOTES]));
    expect(await migrateUp(c, m)).toEqual({
      adoptedBaseline: true,
      applied: ["0001_notes"],
    });
    expect((await c.query(`select name from cats`)).rows).toEqual([
      { name: "Agatha" },
    ]);
    const scratch = await c.query(
      `select 1 from pg_namespace where nspname = '__baseline_check'`,
    );
    expect(scratch.rowCount).toBe(0);
  });

  it("refuses to adopt a drifted database, names the drift, and changes nothing", async () => {
    const c = await freshDb();
    await buildWithoutHistory(c, BASELINE.sql);
    await c.query(`alter table cats add column nickname text`);
    await c.query(`drop index cats_name_lower`);
    const m = readMigrations(fixture([BASELINE, ADD_NOTES]));
    const err = await migrateUp(c, m).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationError);
    const message = (err as Error).message;
    expect(message).toMatch(/only in database: column cats\.nickname/);
    expect(message).toMatch(/only in 0000_base: index cats_name_lower/);
    expect(await tables(c)).toEqual(["cats"]);
    expect(await recorded(c)).toBe(0);
  });

  it("detects a drifted enum and a changed default", async () => {
    const c = await freshDb();
    await buildWithoutHistory(c, BASELINE.sql);
    await c.query(`alter type mood add value 'sleepy'`);
    await c.query(`alter table cats alter column mood set default 'cross'`);
    const err = await migrateUp(c, readMigrations(fixture([BASELINE]))).catch(
      (e: unknown) => e,
    );
    expect((err as Error).message).toMatch(/enum mood \(calm, cross, sleepy\)/);
    expect((err as Error).message).toMatch(
      /column cats\.mood .*default='cross'/,
    );
  });

  it("applies nothing when one migration fails", async () => {
    const c = await freshDb();
    const broken = {
      tag: "0001_broken",
      when: 2000,
      sql: `CREATE TABLE "fine" ("id" integer);--> statement-breakpoint\nALTER TABLE "nope" ADD COLUMN "x" text;`,
    };
    await expect(
      migrateUp(c, readMigrations(fixture([BASELINE, broken]))),
    ).rejects.toThrow();
    expect(await tables(c)).toEqual([]);
    expect(await recorded(c)).toBe(0);
  });

  it("refuses a migration older than the newest applied one instead of skipping it", async () => {
    const c = await freshDb();
    await migrateUp(c, readMigrations(fixture([BASELINE, ADD_COLOUR])));
    const late = { ...ADD_NOTES, tag: "0001_late", when: 2500 };
    const m = readMigrations(
      fixture([BASELINE, late, { ...ADD_COLOUR, tag: "0002_colour" }]),
    );
    await expect(migrateUp(c, m)).rejects.toThrow(
      /older than the newest one already applied[\s\S]*0001_late/,
    );
    expect(await tables(c)).toEqual(["cats"]);
  });

  it("refuses a migration edited after it was applied", async () => {
    const c = await freshDb();
    await migrateUp(c, readMigrations(fixture([BASELINE, ADD_NOTES])));
    const edited = {
      ...ADD_NOTES,
      sql: ADD_NOTES.sql.replace("cat_id", "cat"),
    };
    await expect(
      migrateUp(c, readMigrations(fixture([BASELINE, edited]))),
    ).rejects.toThrow(/0001_notes was edited after it was applied/);
  });

  it("refuses when the database is ahead of the code", async () => {
    const c = await freshDb();
    await migrateUp(c, readMigrations(fixture([BASELINE, ADD_NOTES])));
    await expect(
      migrateUp(c, readMigrations(fixture([BASELINE]))),
    ).rejects.toThrow(/database is ahead of this code/);
  });
  it("detects drift in length, collation and identity", async () => {
    const c = await freshDb();
    const base = {
      tag: "0000_base",
      when: 1000,
      sql: `CREATE TABLE "cats" ("id" integer PRIMARY KEY NOT NULL, "name" varchar(50) NOT NULL);`,
    };
    await buildWithoutHistory(c, base.sql);
    await c.query(`alter table cats alter column name type varchar(200)`);
    await c.query(
      `alter table cats alter column name type varchar(200) collate "C"`,
    );
    await c.query(
      `alter table cats alter column id add generated always as identity`,
    );
    const err = await migrateUp(c, readMigrations(fixture([base]))).catch(
      (e: unknown) => e,
    );
    const message = (err as Error).message;
    expect(message).toMatch(
      /only in database: column cats\.name .*len=200 .*collation=C/,
    );
    expect(message).toMatch(
      /only in database: column cats\.id .*identity=YES\/ALWAYS/,
    );
    expect(message).toMatch(/only in 0000_base: column cats\.name .*len=50/);
  });

  it("gives up on a table lock rather than queueing the live app behind it", async () => {
    const c = await freshDb();
    const m = readMigrations(fixture([BASELINE, ADD_COLOUR]));
    await migrateUp(c, m, { throughIdx: 0 });
    const holder = new pg.Client({
      connectionString: withDb(baseUrl!, c.database!),
    });
    await holder.connect();
    open.push(holder);
    await holder.query("begin");
    await holder.query("lock table cats in access share mode");
    const previous = process.env.MIGRATE_LOCK_TIMEOUT;
    process.env.MIGRATE_LOCK_TIMEOUT = "200ms";
    try {
      await expect(migrateUp(c, m)).rejects.toThrow(/lock timeout/);
    } finally {
      if (previous === undefined) delete process.env.MIGRATE_LOCK_TIMEOUT;
      else process.env.MIGRATE_LOCK_TIMEOUT = previous;
      await holder.query("rollback");
    }
    expect(await recorded(c)).toBe(1);
  });
});

describe("rollbackLast", () => {
  it("undoes the newest migration and its record, then refuses the baseline", async () => {
    const c = await freshDb();
    const m = readMigrations(fixture([BASELINE, ADD_NOTES]));
    await migrateUp(c, m);
    expect(await rollbackLast(c, m)).toBe("0001_notes");
    expect(await tables(c)).toEqual(["cats"]);
    expect(await recorded(c)).toBe(1);
    await expect(rollbackLast(c, m)).rejects.toThrow(
      /baseline and is never rolled back/,
    );
    expect(await tables(c)).toEqual(["cats"]);
  });

  it("refuses a migration with no rollback block", async () => {
    const c = await freshDb();
    const bare = {
      tag: "0001_bare",
      when: 2000,
      sql: `CREATE TABLE "bare" ("id" integer);`,
    };
    const m = readMigrations(fixture([BASELINE, bare]));
    await migrateUp(c, m);
    await expect(rollbackLast(c, m)).rejects.toThrow(/no rollback block/);
    expect(await tables(c)).toEqual(["bare", "cats"]);
  });
});

describe("cycle", () => {
  it("passes when every rollback restores the previous schema", async () => {
    const c = await freshDb();
    const lines: string[] = [];
    await cycle(
      c,
      readMigrations(fixture([BASELINE, ADD_NOTES, ADD_COLOUR])),
      (l) => lines.push(l),
    );
    expect(lines).toEqual([
      "up    0000_base",
      "up    0001_notes",
      "up    0002_colour",
      "down  0002_colour",
      "down  0001_notes",
      "up    all again: schema matches",
    ]);
  });

  it("fails when a rollback leaves something behind", async () => {
    const c = await freshDb();
    const leaky = {
      ...ADD_NOTES,
      sql: ADD_NOTES.sql.replace(
        `-- DROP TABLE "notes";`,
        `-- DROP INDEX "notes_cat";`,
      ),
    };
    await expect(
      cycle(c, readMigrations(fixture([BASELINE, leaky]))),
    ).rejects.toThrow(
      /Rolling back 0001_notes did not restore the schema[\s\S]*only in after rollback: column notes\.id/,
    );
  });
});

describe("cycle catches incomplete rollbacks", () => {
  it("of a type change", async () => {
    const c = await freshDb();
    const base = {
      tag: "0000_base",
      when: 1000,
      sql: `CREATE TABLE "cats" ("id" integer, "name" varchar(50));`,
    };
    const widen = {
      tag: "0001_widen",
      when: 2000,
      sql: [
        `ALTER TABLE "cats" ALTER COLUMN "name" TYPE varchar(200);`,
        `-- rollback-begin`,
        `-- SELECT 1;`,
        `-- rollback-end`,
      ].join("\n"),
    };
    await expect(
      cycle(c, readMigrations(fixture([base, widen]))),
    ).rejects.toThrow(/Rolling back 0001_widen did not restore the schema/);
  });

  it("that leaves a trigger function behind", async () => {
    const c = await freshDb();
    const withFunction = {
      tag: "0001_guard",
      when: 2000,
      sql:
        [
          `CREATE FUNCTION "guard"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`,
          `CREATE TRIGGER "cats_guard" BEFORE UPDATE ON "cats" FOR EACH ROW EXECUTE FUNCTION "guard"();`,
        ].join("--> statement-breakpoint\n") +
        [
          "",
          `-- rollback-begin`,
          `-- DROP TRIGGER "cats_guard" ON "cats";`,
          `-- rollback-end`,
        ].join("\n"),
    };
    await expect(
      cycle(c, readMigrations(fixture([BASELINE, withFunction]))),
    ).rejects.toThrow(/only in after rollback: function guard/);
  });
});

describe("the real migration history", () => {
  it("builds on an empty database and passes the up/down/up cycle", async () => {
    const c = await freshDb();
    await cycle(c, readMigrations(defaultMigrationsFolder()));
    expect(await tables(c)).toContain("cats");
  });
});
