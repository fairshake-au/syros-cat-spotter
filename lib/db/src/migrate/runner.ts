import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ClientBase } from "pg";
import { schemaSignature, signatureDiff } from "./signature";

/**
 * Applies the generated migrations in lib/db/migrations and records them in
 * Drizzle's own bookkeeping table (drizzle.__drizzle_migrations), so the
 * history stays readable by drizzle-kit. Replaces `drizzle-kit push` (SYC-64,
 * hosting-and-photo-storage.md §5.2).
 *
 * Beyond Drizzle's stock migrator it:
 *  - adopts the baseline on a database `push` already built, but only after
 *    proving the live schema matches it;
 *  - refuses to skip a migration older than the newest one applied, and
 *    refuses a migration edited after it was applied;
 *  - rolls back the newest migration from its `-- rollback-begin` block.
 */

export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";
const TABLE = `"${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`;
// Serialises concurrent runs (two deploys at once) against one database.
const LOCK_KEY = 64_064_064;
const BASELINE_CHECK_SCHEMA = "__baseline_check";

export interface Migration {
  idx: number;
  tag: string;
  when: number;
  hash: string;
  statements: string[];
  /** SQL from the rollback block, or null when the file has none. */
  rollback: string | null;
}

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(details.length ? `${message}\n  ${details.join("\n  ")}` : message);
    this.name = "MigrationError";
  }
}

export function defaultMigrationsFolder(): string {
  return path.resolve(import.meta.dirname, "../../migrations");
}

/**
 * The rollback block is commented SQL, so running the forward migration never
 * executes it:
 *
 *   -- rollback-begin
 *   -- DROP TABLE "observations";
 *   -- rollback-end
 */
export function parseRollback(sql: string): string | null {
  const lines = sql.split("\n");
  const start = lines.findIndex((l) => l.trim() === "-- rollback-begin");
  if (start === -1) return null;
  const end = lines.findIndex(
    (l, i) => i > start && l.trim() === "-- rollback-end",
  );
  if (end === -1) {
    throw new MigrationError("rollback-begin has no matching rollback-end");
  }
  if (lines.slice(end + 1).some((l) => l.trim() === "-- rollback-begin")) {
    throw new MigrationError("more than one rollback block");
  }
  const block = lines.slice(start + 1, end);
  // Every line must be commented. An uncommented line inside the block would
  // run on the way up, which is exactly what a rollback must never do.
  const live = block.findIndex((l) => l.trim().length > 0 && !/^\s*--/.test(l));
  if (live !== -1) {
    throw new MigrationError(
      `rollback line ${start + live + 2} is not commented, so it would run on the way up: ${block[live]!.trim()}`,
    );
  }
  const body = block
    .map((l) => l.replace(/^\s*--\s?/, ""))
    .join("\n")
    .trim();
  return body.length ? body : null;
}

export function readMigrations(folder: string): Migration[] {
  const journalPath = path.join(folder, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  return journal.entries.map((entry) => {
    const sql = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
    let rollback: string | null;
    try {
      rollback = parseRollback(sql);
    } catch (err) {
      throw new MigrationError(`${entry.tag}: ${(err as Error).message}`);
    }
    return {
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
      // Same hash Drizzle's own migrator records.
      hash: crypto.createHash("sha256").update(sql).digest("hex"),
      statements: sql
        .split("--> statement-breakpoint")
        .filter((s) => s.trim().length),
      rollback,
    };
  });
}

/**
 * Serialise concurrent runs, then bound how long any DDL waits for a table
 * lock. Without a bound, an ALTER queued behind a long query on the live app
 * blocks every request that arrives after it: a migration becomes an outage.
 * Failing after the timeout rolls the whole run back; retry when quieter.
 */
async function lockAndLimit(client: ClientBase): Promise<void> {
  await client.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
  const timeout = process.env.MIGRATE_LOCK_TIMEOUT ?? "5s";
  await client.query("select set_config('lock_timeout', $1, true)", [timeout]);
}

interface AppliedRow {
  hash: string;
  created_at: string;
}

async function ensureTable(client: ClientBase): Promise<void> {
  await client.query(`create schema if not exists "${MIGRATIONS_SCHEMA}"`);
  await client.query(
    `create table if not exists ${TABLE} (
       id serial primary key,
       hash text not null,
       created_at bigint
     )`,
  );
}

async function appliedRows(client: ClientBase): Promise<AppliedRow[]> {
  const r = await client.query<AppliedRow>(
    `select hash, created_at from ${TABLE} order by created_at`,
  );
  return r.rows;
}

async function publicHasTables(client: ClientBase): Promise<boolean> {
  const r = await client.query(
    `select 1 from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' limit 1`,
  );
  return r.rowCount! > 0;
}

/**
 * Builds the baseline in a scratch schema inside a savepoint that is always
 * rolled back, and compares it with the live public schema. Returns the
 * differences; empty means the live database is exactly the baseline.
 */
export async function diffAgainstBaseline(
  client: ClientBase,
  baseline: Migration,
): Promise<string[]> {
  await client.query("savepoint baseline_check");
  try {
    await client.query(`create schema "${BASELINE_CHECK_SCHEMA}"`);
    await client.query(`set local search_path to "${BASELINE_CHECK_SCHEMA}"`);
    for (const stmt of baseline.statements) {
      await client.query(
        stmt.split(`"public".`).join(`"${BASELINE_CHECK_SCHEMA}".`),
      );
    }
    const expected = await schemaSignature(client, BASELINE_CHECK_SCHEMA);
    const actual = await schemaSignature(client, "public");
    return signatureDiff(actual, expected, {
      actual: "database",
      expected: baseline.tag,
    });
  } finally {
    await client.query("rollback to savepoint baseline_check");
    await client.query("release savepoint baseline_check");
  }
}

/** Every recorded migration must be in the journal, unedited. */
function checkRecorded(applied: AppliedRow[], migrations: Migration[]): void {
  const byWhen = new Map(migrations.map((m) => [m.when, m]));
  const problems: string[] = [];
  for (const row of applied) {
    const m = byWhen.get(Number(row.created_at));
    if (!m) {
      problems.push(
        `the database has a migration from ${row.created_at} that this code does not know. ` +
          `The database is ahead of this code; deploy the newer code or roll the migration back from it.`,
      );
    } else if (m.hash !== row.hash) {
      problems.push(
        `${m.tag} was edited after it was applied. Revert the edit and put the change in a new migration.`,
      );
    }
  }
  if (problems.length) {
    throw new MigrationError(
      "Migration history does not match this code.",
      problems,
    );
  }
}

export interface UpResult {
  adoptedBaseline: boolean;
  applied: string[];
}

/**
 * Applies pending migrations, in order, in one transaction: a failure leaves
 * the database as it was. `throughIdx` stops after that migration (tests and
 * the rollback cycle use it).
 */
export async function migrateUp(
  client: ClientBase,
  migrations: Migration[],
  opts: { throughIdx?: number } = {},
): Promise<UpResult> {
  const target = migrations.filter(
    (m) => opts.throughIdx === undefined || m.idx <= opts.throughIdx,
  );
  await client.query("begin");
  try {
    await lockAndLimit(client);
    await ensureTable(client);
    let applied = await appliedRows(client);
    let adoptedBaseline = false;

    if (
      applied.length === 0 &&
      migrations.length &&
      (await publicHasTables(client))
    ) {
      const baseline = migrations[0]!;
      const diff = await diffAgainstBaseline(client, baseline);
      if (diff.length) {
        throw new MigrationError(
          `The database already has tables but they do not match ${baseline.tag}, so it cannot be adopted. ` +
            "Nothing was changed. Bring the database in line with the baseline by hand, then run migrate again.",
          diff,
        );
      }
      await client.query(
        `insert into ${TABLE} (hash, created_at) values ($1, $2)`,
        [baseline.hash, baseline.when],
      );
      adoptedBaseline = true;
      applied = await appliedRows(client);
    }

    checkRecorded(applied, migrations);
    const done = new Set(applied.map((r) => Number(r.created_at)));
    const newest = applied.length
      ? Number(applied[applied.length - 1]!.created_at)
      : -Infinity;
    const pending = target.filter((m) => !done.has(m.when));

    const stale = pending.filter((m) => m.when < newest);
    if (stale.length) {
      throw new MigrationError(
        "These migrations are older than the newest one already applied, so they were probably generated on a branch that merged late. " +
          "Nothing was changed. Delete them and run `pnpm run generate` again on top of the current history.",
        stale.map((m) => m.tag),
      );
    }

    for (const m of pending) {
      for (const stmt of m.statements) {
        await client.query(stmt);
      }
      await client.query(
        `insert into ${TABLE} (hash, created_at) values ($1, $2)`,
        [m.hash, m.when],
      );
    }
    await client.query("commit");
    return { adoptedBaseline, applied: pending.map((m) => m.tag) };
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}

/** Undoes the newest applied migration from its rollback block. */
export async function rollbackLast(
  client: ClientBase,
  migrations: Migration[],
): Promise<string> {
  await client.query("begin");
  try {
    await lockAndLimit(client);
    await ensureTable(client);
    const applied = await appliedRows(client);
    if (!applied.length) throw new MigrationError("Nothing has been applied.");
    checkRecorded(applied, migrations);
    const last = applied[applied.length - 1]!;
    const m = migrations.find((x) => x.when === Number(last.created_at))!;
    if (m.idx === 0) {
      throw new MigrationError(
        `${m.tag} is the baseline and is never rolled back.`,
      );
    }
    if (!m.rollback) {
      throw new MigrationError(`${m.tag} has no rollback block.`);
    }
    await client.query(m.rollback);
    await client.query(`delete from ${TABLE} where created_at = $1`, [m.when]);
    await client.query("commit");
    return m.tag;
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}

/**
 * Proves each rollback works on an empty database: apply one migration at a
 * time recording the schema, roll each back and require the schema to return
 * to what it was, then apply everything again.
 */
export async function cycle(
  client: ClientBase,
  migrations: Migration[],
  log: (line: string) => void = () => {},
): Promise<void> {
  const existing = await client.query(
    `select 1 from information_schema.tables where table_schema = 'public' limit 1`,
  );
  if (existing.rowCount) {
    throw new MigrationError(
      "cycle needs an empty database; this one has tables.",
    );
  }
  const after: string[][] = [];
  for (const m of migrations) {
    await migrateUp(client, migrations, { throughIdx: m.idx });
    after[m.idx] = await schemaSignature(client, "public");
    log(`up    ${m.tag}`);
  }
  for (const m of [...migrations].reverse()) {
    if (m.idx === 0) break;
    await rollbackLast(client, migrations);
    const diff = signatureDiff(
      await schemaSignature(client, "public"),
      after[m.idx - 1]!,
      { actual: "after rollback", expected: "before the migration" },
    );
    if (diff.length) {
      throw new MigrationError(
        `Rolling back ${m.tag} did not restore the schema.`,
        diff,
      );
    }
    log(`down  ${m.tag}`);
  }
  await migrateUp(client, migrations);
  const final = await schemaSignature(client, "public");
  const diff = signatureDiff(final, after[migrations.length - 1]!, {
    actual: "second run",
    expected: "first run",
  });
  if (diff.length) {
    throw new MigrationError(
      "Re-applying the migrations gave a different schema.",
      diff,
    );
  }
  log("up    all again: schema matches");
}
