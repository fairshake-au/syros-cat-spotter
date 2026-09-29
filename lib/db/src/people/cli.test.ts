import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "../migrate/runner";
import { runPeopleCommand, type CliIo } from "./cli";

// The `people` command against a throwaway database (SYC-43 part 1,
// Decision 4). It must name its target and never fall back to DATABASE_URL.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `people_cli_test_${crypto.randomBytes(4).toString("hex")}`;
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

beforeEach(async () => {
  await c.query(`truncate person_scopes, people cascade`);
});

function io(
  answer = "",
  env: CliIo["env"] = {
    // DATABASE_URL points at the shared test database; with no matching
    // DATABASE_TARGET the command must ignore it and use the named target.
    DATABASE_URL: baseUrl,
    DATABASE_URL_SCRATCH: url(name),
  },
): CliIo & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    env,
    out: (line) => lines.push(line),
    ask: async () => answer,
  };
}

const run = (args: string[], answer?: string, env?: CliIo["env"]) => {
  const i = io(answer, env);
  return runPeopleCommand(args, i).then((code) => ({ code, out: i.lines }));
};

describe("people command", () => {
  it("refuses to run without a named target, or with one that isn't configured", async () => {
    const a = await run(["list"]);
    expect(a.code).toBe(2);
    expect(a.out.join("\n")).toMatch(/Give --target exactly once/);
    const b = await run(["list", "--target", "production"]);
    expect(b.code).toBe(2);
    expect(b.out.join("\n")).toMatch(
      /No database is configured for target "production"/,
    );
    // DATABASE_URL alone is never enough, even with a target named.
    const c2 = await run(["list", "--target", "production"], "", {
      DATABASE_URL: url(name),
      DATABASE_TARGET: "development",
    });
    expect(c2.code).toBe(2);
  });

  it("uses DATABASE_URL when DATABASE_TARGET names the same target", async () => {
    const r = await run(["list", "--target", "production"], "", {
      DATABASE_URL: url(name),
      DATABASE_TARGET: "production",
    });
    expect(r.code).toBe(0);
    expect(r.out).toEqual(["Target: production", "Nobody is on the list."]);
  });

  it("never prints the connection string or any part of it, even when connecting fails", async () => {
    const secretUrl =
      "postgres://neon_owner:s3cret-Pa55word@ep-secret-host-123456.invalid:5432/neondb";
    const r = await run(["list", "--target", "production"], "", {
      DATABASE_URL_PRODUCTION: secretUrl,
    });
    expect(r.code).toBe(1);
    const all = r.out.join("\n");
    expect(all).toMatch(/^Target: production\nFailed: /);
    for (const part of [
      secretUrl,
      "s3cret-Pa55word",
      "neon_owner",
      "ep-secret-host-123456",
    ]) {
      expect(all).not.toContain(part);
    }
  });

  it("adds, lists, signs out everywhere and removes", async () => {
    const add = await run([
      "add",
      "--target",
      "scratch",
      "--email",
      "Susan@Example.com",
      "--name",
      "Susan",
      "--by",
      "claude",
    ]);
    expect(add.code).toBe(0);
    // It names the target and confirms the action, nothing more.
    expect(add.out).toEqual([
      "Target: scratch",
      "Added susan@example.com as staff.",
    ]);
    const row = await c.query(`select added_by from people`);
    expect(row.rows[0].added_by).toBe("cli:claude");

    const list = await run(["list", "--target", "scratch"]);
    expect(list.out[1]).toMatch(
      /^susan@example\.com\tSusan\tstaff\tsession 1\t/,
    );

    const so = await run(
      [
        "sign-out-everywhere",
        "--target",
        "scratch",
        "--email",
        "susan@example.com",
      ],
      "susan@example.com",
    );
    expect(so.code).toBe(0);
    expect(so.out).toContain(
      "Signed susan@example.com out everywhere (session version is now 2).",
    );

    const rm = await run(
      ["remove", "--target", "scratch", "--email", "susan@example.com"],
      "SUSAN@example.com ",
    );
    expect(rm.code).toBe(0);
    expect(rm.out).toContain("Removed susan@example.com and their roles.");
    const left = await c.query(`select count(*)::int as n from person_scopes`);
    expect(left.rows[0].n).toBe(0);
  });

  it("changes nothing when the confirmation doesn't match", async () => {
    await run([
      "add",
      "--target",
      "scratch",
      "--email",
      "maria@example.com",
      "--name",
      "Maria",
    ]);
    const rm = await run(
      ["remove", "--target", "scratch", "--email", "maria@example.com"],
      "maria@example.org",
    );
    expect(rm.code).toBe(1);
    expect(rm.out).toContain("The addresses don't match. Nothing was changed.");
    const so = await run(
      [
        "sign-out-everywhere",
        "--target",
        "scratch",
        "--email",
        "maria@example.com",
      ],
      "",
    );
    expect(so.code).toBe(1);
    const r = await c.query(`select session_version from people`);
    expect(r.rows).toEqual([{ session_version: 1 }]);
  });

  it("refuses a shared mailbox with the plain-English reason", async () => {
    const add = await run([
      "add",
      "--target",
      "scratch",
      "--email",
      "admin@syroscats.com",
      "--name",
      "Shared",
    ]);
    expect(add.code).toBe(1);
    expect(add.out).toContain(
      "admin@ is a shared mailbox. Every person needs their own address, so we can tell who did what. A personal address is fine.",
    );
  });
});
