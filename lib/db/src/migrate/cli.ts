import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import {
  cycle,
  defaultMigrationsFolder,
  MigrationError,
  migrateUp,
  readMigrations,
  rollbackLast,
} from "./runner";
import { modelledOnly, schemaSignature, signatureDiff } from "./signature";
import { resolveDatabaseUrl } from "../url";

// pnpm --filter @workspace/db run migrate            apply pending migrations
// pnpm --filter @workspace/db run migrate:rollback   undo the newest one
// pnpm --filter @workspace/db run migrate:cycle      up/down/up proof (empty db)
// pnpm --filter @workspace/db run migrate:check      schema code vs history (CI)
// pnpm --filter @workspace/db run smoke <base-url>   post-migration smoke test

const folder = defaultMigrationsFolder();

function resolveCliUrl(): string {
  try {
    return resolveDatabaseUrl(process.env).url;
  } catch (err) {
    throw new MigrationError((err as Error).message);
  }
}

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: resolveCliUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function drizzleKit(args: string[]): string {
  const r = spawnSync("drizzle-kit", args, { encoding: "utf8" });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0) {
    throw new MigrationError(`drizzle-kit ${args[0]} failed:`, [output]);
  }
  return output;
}

// drizzle-kit prefixes paths with "./", so an absolute path breaks it. Pass
// paths relative to the working directory.
const rel = (p: string) => path.relative(process.cwd(), p);
const schemaPath = path.resolve(import.meta.dirname, "../schema/index.ts");

/** Is there schema code no migration captures? Checked against the snapshots. */
function uncapturedChanges(problems: string[]): void {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-check-"));
  try {
    fs.cpSync(folder, scratch, { recursive: true });
    const before = fs
      .readdirSync(scratch)
      .filter((f) => f.endsWith(".sql")).length;
    // drizzle-kit exits 0 even when it fails to read the history, so require
    // a positive answer rather than trusting the exit code.
    const output = drizzleKit([
      "generate",
      "--dialect=postgresql",
      `--schema=${rel(schemaPath)}`,
      `--out=${rel(scratch)}`,
    ]);
    const after = fs.readdirSync(scratch).filter((f) => f.endsWith(".sql"));
    if (after.length === before && !/No schema changes/i.test(output)) {
      problems.push(
        "drizzle-kit generate did not report a result (a rename prompt needs `pnpm run generate` run by hand):",
        output,
      );
    } else if (after.length !== before) {
      const added = after.sort().slice(before);
      problems.push(
        "The schema code has changes with no migration. Run `pnpm --filter @workspace/db run generate`, " +
          "add a rollback block, and commit the result. It would generate:",
        ...added.map((f) => fs.readFileSync(path.join(scratch, f), "utf8")),
      );
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Does the SQL that actually runs build what the schema code describes? The
 * snapshots only record what drizzle-kit generated, and a hand edit to a
 * migration's SQL does not change them. So build one scratch database from
 * the migrations and another with `drizzle-kit push` from the schema code, and
 * compare what they contain. Triggers, functions and views come only from
 * hand-written SQL and are left out of the comparison.
 */
async function migrationsBuildTheSchema(problems: string[]): Promise<void> {
  let base: string;
  try {
    base = resolveDatabaseUrl(process.env).url;
  } catch {
    throw new MigrationError(
      "migrate:check needs DATABASE_URL: it builds two scratch databases on that server.",
    );
  }
  const url = (db: string) => {
    const u = new URL(base);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const suffix = crypto.randomBytes(4).toString("hex");
  const migratedDb = `migrate_check_${suffix}_migrations`;
  const pushedDb = `migrate_check_${suffix}_schema`;
  const admin = new pg.Client({ connectionString: url("postgres") });
  await admin.connect();
  try {
    await admin.query(`create database "${migratedDb}"`);
    await admin.query(`create database "${pushedDb}"`);

    const migrated = new pg.Client({ connectionString: url(migratedDb) });
    await migrated.connect();
    let fromMigrations: string[];
    try {
      await migrateUp(migrated, readMigrations(folder));
      fromMigrations = modelledOnly(await schemaSignature(migrated, "public"));
    } finally {
      await migrated.end();
    }

    // push has no schema of its own for extensions, so give it the ones the
    // migrations create; otherwise an index needing one fails only here.
    const pushed0 = new pg.Client({ connectionString: url(pushedDb) });
    await pushed0.connect();
    try {
      for (const ext of extensionsCreatedByMigrations()) {
        await pushed0.query(`create extension if not exists "${ext}"`);
      }
    } finally {
      await pushed0.end();
    }

    // push exits 0 even when a statement fails part-way (it is not one
    // transaction), so require its success line and no error in its output.
    const pushOutput = drizzleKit([
      "push",
      "--dialect=postgresql",
      `--schema=${rel(schemaPath)}`,
      `--url=${url(pushedDb)}`,
      "--force",
    ]);
    if (!/Changes applied/.test(pushOutput) || /\berror\b/i.test(pushOutput)) {
      throw new MigrationError(
        "drizzle-kit push did not build the schema cleanly, so the comparison cannot be trusted:",
        [pushOutput],
      );
    }
    const pushed = new pg.Client({ connectionString: url(pushedDb) });
    await pushed.connect();
    let fromSchema: string[];
    try {
      fromSchema = modelledOnly(await schemaSignature(pushed, "public"));
    } finally {
      await pushed.end();
    }

    const diff = signatureDiff(fromMigrations, fromSchema, {
      actual: "the migrations",
      expected: "the schema code",
    });
    if (diff.length) {
      problems.push(
        "Running the migrations does not build what the schema code describes:",
        ...diff,
      );
    }
  } finally {
    await admin.query(`drop database if exists "${migratedDb}"`);
    await admin.query(`drop database if exists "${pushedDb}"`);
    await admin.end();
  }
}

function extensionsCreatedByMigrations(): string[] {
  const found = new Set<string>();
  for (const m of readMigrations(folder)) {
    for (const stmt of m.statements) {
      const re =
        /create\s+extension\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi;
      for (const match of stmt.matchAll(re)) found.add(match[1]!.toLowerCase());
    }
  }
  return [...found];
}

async function check(): Promise<void> {
  const migrations = readMigrations(folder);
  const problems: string[] = [];

  migrations.forEach((m, i) => {
    if (m.idx !== i)
      problems.push(`${m.tag}: journal idx ${m.idx}, expected ${i}`);
    if (i > 0 && m.when <= migrations[i - 1]!.when) {
      problems.push(
        `${m.tag}: timestamp is not after ${migrations[i - 1]!.tag}`,
      );
    }
    if (i > 0 && !m.rollback) {
      problems.push(
        `${m.tag}: no rollback. Add a commented "-- rollback-begin" / "-- rollback-end" block.`,
      );
    }
  });

  const tags = new Set(migrations.map((m) => `${m.tag}.sql`));
  for (const f of fs.readdirSync(folder).filter((f) => f.endsWith(".sql"))) {
    if (!tags.has(f)) {
      problems.push(`${f} is not in meta/_journal.json, so it never runs.`);
    }
  }

  uncapturedChanges(problems);
  await migrationsBuildTheSchema(problems);

  if (problems.length)
    throw new MigrationError("migrate:check failed.", problems);
  console.log(
    `migrate:check ok — ${migrations.length} migration(s); the schema code, the snapshots and the SQL agree.`,
  );
}

// SYC-121, task B.5. With the SYC-113 pre-launch gate on, an unauthenticated
// GET gets a 401 (artifacts/api-server/src/middlewares/prelaunchGate.ts), so
// smoke needs a pass too. Sends X-Prelaunch-Key on every request when
// PRELAUNCH_KEY is set in the environment; when it isn't (CI, or a
// deployment with the gate off), behaviour is unchanged.
// A hanging endpoint must not hang the whole job — fail fast with a clear
// message instead. Overridable via SMOKE_TIMEOUT_MS so tests can use a short
// timeout without waiting 30s for the real one to fire.
const DEFAULT_SMOKE_TIMEOUT_MS = 30_000;

export async function smoke(
  baseUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!baseUrl)
    throw new MigrationError(
      "usage: smoke <base-url>, e.g. https://api.catspotters.com",
    );
  const base = baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {};
  if (env.PRELAUNCH_KEY) headers["X-Prelaunch-Key"] = env.PRELAUNCH_KEY;
  const timeoutMs = env.SMOKE_TIMEOUT_MS
    ? Number(env.SMOKE_TIMEOUT_MS)
    : DEFAULT_SMOKE_TIMEOUT_MS;
  const get = async (p: string) => {
    let res: Response;
    try {
      res = await fetch(`${base}${p}`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new MigrationError(
          `smoke: GET ${p} timed out after ${timeoutMs / 1000} s. Roll back now.`,
        );
      }
      throw err;
    }
    if (!res.ok)
      throw new MigrationError(
        `smoke: GET ${p} returned ${res.status}. Roll back now.`,
      );
    console.log(`ok  GET ${p} ${res.status}`);
    return res;
  };
  await get("/api/healthz");
  const cats = (await (await get("/api/cats")).json()) as {
    photoUrl: string;
  }[];
  // Owner-registered cats carry the photo id 0 sentinel, which 404s by design.
  const withPhoto = cats.find((c) => !c.photoUrl.endsWith("/0"));
  if (withPhoto) {
    await get(withPhoto.photoUrl);
  } else {
    console.log("--  no cat has a photo yet; photo route not exercised");
  }
}

async function main(): Promise<void> {
  const [command = "up", arg] = process.argv.slice(2);
  switch (command) {
    case "up": {
      const r = await withClient((c) => migrateUp(c, readMigrations(folder)));
      if (r.adoptedBaseline)
        console.log("adopted baseline: live schema matches it");
      console.log(
        r.applied.length ? `applied: ${r.applied.join(", ")}` : "up to date",
      );
      return;
    }
    case "rollback": {
      const tag = await withClient((c) =>
        rollbackLast(c, readMigrations(folder)),
      );
      console.log(`rolled back: ${tag}`);
      return;
    }
    case "cycle":
      await withClient((c) => cycle(c, readMigrations(folder), console.log));
      return;
    case "check":
      await check();
      return;
    case "smoke":
      await smoke(arg);
      return;
    default:
      throw new MigrationError(`unknown command: ${command}`);
  }
}

// Belt and braces on top of `smoke`'s per-request timeout: whatever a command
// leaves open (a keep-alive HTTP agent's socket, say — see SYC-141, where an
// idle fetch/undici socket held the event loop open for ~10 minutes after the
// last request finished) must not stop the CLI from exiting the moment the
// command is actually done.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof MigrationError ? err.message : err);
    process.exit(1);
  });
