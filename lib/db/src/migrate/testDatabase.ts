import crypto from "node:crypto";
import pg from "pg";
import { describeHost } from "../url";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";

// SYC-111. Shared by any test harness (api-server's, so far) that wants its
// own disposable Postgres database instead of a shared one — the same
// building block lib/db/src/migrate/cli.ts's `migrate:check` and
// runner.test.ts's `freshDb` already use: `CREATE DATABASE` against the
// `postgres` admin database on the server DATABASE_URL points at, then the
// real checked-in migrations (triggers, functions and all — not
// `drizzle-kit push`, which only builds the table shape).

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/** A quoted Postgres identifier, safe for our generated `test_<hex>` names. */
function quoteIdent(name: string): string {
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`refusing to quote an unexpected database name: ${name}`);
  }
  return `"${name}"`;
}

function refuseNeon(baseUrl: string): void {
  const host = describeHost(baseUrl);
  if (/\.neon\.tech$/i.test(host)) {
    throw new Error(
      `createThrowawayDatabase refuses a Neon host (${host}). Tests must run ` +
        "against a local or CI Postgres server, never a Neon branch (production " +
        "or development) — that is exactly the shared/production database this " +
        "exists to avoid touching.",
    );
  }
}

function cleanPrefix(prefix: string | undefined): string {
  return (prefix ?? "test").toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export interface ThrowawayDatabase {
  /** Connection URL for the new database, on the same server as `baseUrl`. */
  url: string;
  /** The generated database name, for `dropThrowawayDatabase`. */
  name: string;
}

/**
 * Creates a fresh, uniquely-named database on the same Postgres server as
 * `baseUrl` and applies every checked-in migration to it (the same runner
 * `pnpm --filter @workspace/db run migrate` and db-ops use), then returns
 * its connection URL. Refuses a Neon host outright.
 */
export async function createThrowawayDatabase(
  baseUrl: string,
  opts: { prefix?: string } = {},
): Promise<ThrowawayDatabase> {
  refuseNeon(baseUrl);
  const prefix = cleanPrefix(opts.prefix);
  const name = `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  const admin = new pg.Client({
    connectionString: withDb(baseUrl, "postgres"),
  });
  await admin.connect();
  try {
    await admin.query(`create database ${quoteIdent(name)}`);
  } finally {
    await admin.end();
  }

  const url = withDb(baseUrl, name);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await migrateUp(client, readMigrations(defaultMigrationsFolder()));
  } finally {
    await client.end();
  }

  return { url, name };
}

/**
 * Drops a database created by {@link createThrowawayDatabase}. Terminates
 * any connections left open against it first (an unclosed pool, a run that
 * was interrupted) so the drop can't hang or fail with "database is being
 * accessed by other users".
 */
export async function dropThrowawayDatabase(
  baseUrl: string,
  name: string,
): Promise<void> {
  refuseNeon(baseUrl);
  const admin = new pg.Client({
    connectionString: withDb(baseUrl, "postgres"),
  });
  await admin.connect();
  try {
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
         where datname = $1 and pid <> pg_backend_pid()`,
      [name],
    );
    await admin.query(`drop database if exists ${quoteIdent(name)}`);
  } finally {
    await admin.end();
  }
}

/**
 * Drops throwaway databases with this prefix that are older than
 * `olderThanMs` (default one hour). A run that is killed (Ctrl-C on a
 * platform where the signal handler can't finish, a cancelled CI job, an
 * OOM-killed process) never reaches its teardown, so its database would
 * otherwise stay on the server for good. Calling this at the start of each
 * run clears what earlier runs left behind, without touching a database a
 * concurrent run is still using. Matches only names this module generates
 * (`<prefix>_<13-digit ms timestamp>_<8 hex>`). Returns the names dropped.
 */
export async function reapStaleThrowawayDatabases(
  baseUrl: string,
  opts: { prefix?: string; olderThanMs?: number } = {},
): Promise<string[]> {
  refuseNeon(baseUrl);
  const prefix = cleanPrefix(opts.prefix);
  const cutoff = Date.now() - (opts.olderThanMs ?? 60 * 60 * 1000);
  const pattern = new RegExp(`^${prefix}_(\\d{13})_[0-9a-f]{8}$`);

  const admin = new pg.Client({
    connectionString: withDb(baseUrl, "postgres"),
  });
  await admin.connect();
  let stale: string[];
  try {
    const { rows } = await admin.query<{ datname: string }>(
      "select datname from pg_database",
    );
    stale = rows
      .map((r) => r.datname)
      .filter((n) => {
        const m = pattern.exec(n);
        return m !== null && Number(m[1]) < cutoff;
      });
  } finally {
    await admin.end();
  }
  for (const name of stale) {
    await dropThrowawayDatabase(baseUrl, name);
  }
  return stale;
}
