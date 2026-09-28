import { execFileSync } from "node:child_process";
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

// pnpm --filter @workspace/db run migrate            apply pending migrations
// pnpm --filter @workspace/db run migrate:rollback   undo the newest one
// pnpm --filter @workspace/db run migrate:cycle      up/down/up proof (empty db)
// pnpm --filter @workspace/db run migrate:check      schema code vs history (CI)
// pnpm --filter @workspace/db run smoke <base-url>   post-migration smoke test

const folder = defaultMigrationsFolder();

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) {
    throw new MigrationError("DATABASE_URL is not set.");
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function check(): void {
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

  // Generate against a copy of the history: any output means the schema code
  // has changes no migration captures.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-check-"));
  try {
    fs.cpSync(folder, scratch, { recursive: true });
    const before = fs
      .readdirSync(scratch)
      .filter((f) => f.endsWith(".sql")).length;
    // drizzle-kit prefixes --out with "./", so an absolute path breaks it, and
    // it exits 0 even then. Pass paths relative to the working directory and
    // require a positive answer rather than trusting the exit code.
    const output = execFileSync(
      "drizzle-kit",
      [
        "generate",
        "--dialect=postgresql",
        `--schema=${path.relative(process.cwd(), path.resolve(import.meta.dirname, "../schema/index.ts"))}`,
        `--out=${path.relative(process.cwd(), scratch)}`,
      ],
      { encoding: "utf8", stdio: "pipe" },
    );
    const after = fs.readdirSync(scratch).filter((f) => f.endsWith(".sql"));
    if (after.length === before && !/No schema changes/i.test(output)) {
      problems.push("drizzle-kit generate did not report a result:", output);
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

  if (problems.length)
    throw new MigrationError("migrate:check failed.", problems);
  console.log(
    `migrate:check ok — ${migrations.length} migration(s), schema code matches.`,
  );
}

async function smoke(baseUrl: string | undefined): Promise<void> {
  if (!baseUrl)
    throw new MigrationError(
      "usage: smoke <base-url>, e.g. https://api.catspotters.com",
    );
  const base = baseUrl.replace(/\/$/, "");
  const get = async (p: string) => {
    const res = await fetch(`${base}${p}`);
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
      check();
      return;
    case "smoke":
      await smoke(arg);
      return;
    default:
      throw new MigrationError(`unknown command: ${command}`);
  }
}

main().catch((err) => {
  console.error(err instanceof MigrationError ? err.message : err);
  process.exit(1);
});
