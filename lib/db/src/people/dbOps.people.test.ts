import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "../migrate/runner";
import { truncateWithGuardsOff } from "../migrate/truncatePeople";

// scripts/db-ops.sh's people-add and people-list (SYC-43 part 1; SYC-121
// plan H.1(b)), run for real against a throwaway local database standing in
// for a Neon branch. Each run starts pnpm, so allow CI some time.
vi.setConfig({ testTimeout: 60_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const SCRIPT = path.join(ROOT, "scripts/db-ops.sh");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `dbops_people_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

const EMAIL = "Jacky.Test@Example.com";
const PERSON_NAME = "Jacky Testperson";

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
  // SYC-53 PR 0.1: the cascade reaches guarded add-only tables (including
  // person_events); the helper switches their TRUNCATE guards off for
  // this one statement and back on.
  await truncateWithGuardsOff(c, "person_scopes, people");
});

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

/** Output as GitHub would show it: its own ::add-mask:: lines are consumed. */
const shown = (out: string) =>
  out
    .split("\n")
    .filter((l) => !l.startsWith("::add-mask::"))
    .join("\n");

const devAdd = (extra: Record<string, string | undefined> = {}) =>
  run({
    COMMAND: "people-add",
    TARGET: "development",
    DATABASE_TARGET: "development",
    NEON_DEV_URL: url(name),
    PEOPLE_EMAIL: EMAIL,
    PEOPLE_EMAIL_CONFIRM: EMAIL,
    PEOPLE_NAME: PERSON_NAME,
    PEOPLE_ROLE: "staff",
    GITHUB_ACTOR: "claude-bot",
    ...extra,
  });

const countPeople = async () =>
  (await c.query(`select count(*)::int as n from people`)).rows[0].n as number;

describe("db-ops people-add", () => {
  it("masks both secrets first, adds the person, and shows only the id and role", async () => {
    const r = devAdd();
    expect(r.code).toBe(0);
    const lines = r.out.split("\n");
    expect(lines[0]).toBe(`::add-mask::${EMAIL}`);
    expect(lines[1]).toBe(`::add-mask::${PERSON_NAME}`);
    expect(lines[2]).toBe(`::add-mask::${EMAIL}`);
    const row = await c.query(`select id, email, name, added_by from people`);
    expect(row.rows[0]).toMatchObject({
      email: "jacky.test@example.com",
      name: PERSON_NAME,
      added_by: "cli:db-ops:claude-bot",
    });
    const out = shown(r.out);
    expect(out).toContain(`Added person ${row.rows[0].id} as staff.`);
    expect(out.toLowerCase()).not.toContain("jacky");
    expect(out).not.toMatch(/postgres(ql)?:\/\//);
    expect(out).not.toContain(url(name));
  });

  it("refuses when DATABASE_TARGET is missing or doesn't match, and adds nobody", async () => {
    for (const DATABASE_TARGET of [undefined, "production"]) {
      const r = devAdd({ DATABASE_TARGET });
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(
        /DATABASE_TARGET .* doesn't match target 'development'/,
      );
    }
    expect(await countPeople()).toBe(0);
  });

  it("refuses target=production when only another branch's address is set", async () => {
    const r = devAdd({
      TARGET: "production",
      DATABASE_TARGET: "production",
      NEON_DEV_URL: url(name),
      NEON_REHEARSAL_URL: url(name),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/NEON_PROD_URL must be set/);
    expect(await countPeople()).toBe(0);
  });

  it("refuses target=rehearsal", async () => {
    const r = devAdd({
      TARGET: "rehearsal",
      DATABASE_TARGET: "rehearsal",
      NEON_REHEARSAL_URL: url(name),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(
      /only runs against target=development or target=production/,
    );
    expect(await countPeople()).toBe(0);
  });

  it("refuses a role that isn't on the fixed list, or a missing secret", async () => {
    for (const extra of [
      { PEOPLE_ROLE: "admin" },
      { PEOPLE_ROLE: undefined },
      { PEOPLE_ROLE: "staff --role vet" },
      { PEOPLE_EMAIL: undefined },
      { PEOPLE_NAME: undefined },
      { PEOPLE_EMAIL_CONFIRM: undefined },
    ]) {
      const r = devAdd(extra);
      expect(r.code).not.toBe(0);
    }
    expect(await countPeople()).toBe(0);
  });

  it("refuses when the confirmation doesn't match, showing neither address (SYC-131)", async () => {
    const r = devAdd({ PEOPLE_EMAIL_CONFIRM: "jacky.tset@example.com" });
    expect(r.code).not.toBe(0);
    const out = shown(r.out);
    expect(out).toContain(
      "db-ops: PEOPLE_EMAIL and PEOPLE_EMAIL_CONFIRM don't match. Nothing was changed.",
    );
    expect(out.toLowerCase()).not.toContain("jacky");
    expect(await countPeople()).toBe(0);
  });

  it("accepts a confirmation that differs only in case and spaces", async () => {
    const r = devAdd({ PEOPLE_EMAIL_CONFIRM: ` ${EMAIL.toUpperCase()} ` });
    expect(r.code).toBe(0);
    expect(await countPeople()).toBe(1);
  });

  it("refuses a shared mailbox, without showing the address", async () => {
    const r = devAdd({
      PEOPLE_EMAIL: "admin@syroscats.com",
      PEOPLE_EMAIL_CONFIRM: "admin@syroscats.com",
    });
    expect(r.code).not.toBe(0);
    const out = shown(r.out);
    expect(out).toContain("admin@ is a shared mailbox.");
    expect(out).not.toContain("admin@syroscats.com");
    expect(await countPeople()).toBe(0);
  });
});

describe("db-ops people-list", () => {
  it("lists ids and roles, with no address, name or connection details", async () => {
    expect(devAdd().code).toBe(0);
    const r = run({
      COMMAND: "people-list",
      TARGET: "development",
      DATABASE_TARGET: "development",
      NEON_DEV_URL: url(name),
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("1 person on the list.");
    expect(r.out).toMatch(/[0-9a-f-]{36}\tstaff\tsession 1\t/);
    expect(r.out.toLowerCase()).not.toContain("jacky");
    expect(r.out).not.toMatch(/postgres(ql)?:\/\//);
    expect(r.out).not.toContain("localhost");
  });

  it("refuses a mismatched target", () => {
    const r = run({
      COMMAND: "people-list",
      TARGET: "production",
      DATABASE_TARGET: "development",
      NEON_PROD_URL: url(name),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/DATABASE_TARGET/);
  });
});

// The CLI makes the same target check, so the tests above would stay green if
// db-ops.sh's own check were deleted. Here the CLI is replaced by a `pnpm`
// stub that would succeed and records that it ran, so only the shell layer
// can refuse.
describe("db-ops.sh's own target check, with the CLI stubbed out", () => {
  function stubbedRun(env: Record<string, string | undefined>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbops-pnpm-stub-"));
    const marker = path.join(dir, "called");
    fs.writeFileSync(
      path.join(dir, "pnpm"),
      `#!/bin/sh\ntouch "${marker}"\necho "stub: Added person 00000000-0000-4000-8000-000000000000 as staff."\nexit 0\n`,
      { mode: 0o755 },
    );
    try {
      const r = run({ PATH: `${dir}:${process.env.PATH ?? ""}`, ...env });
      return { ...r, called: fs.existsSync(marker) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const base = {
    COMMAND: "people-add",
    TARGET: "production",
    NEON_PROD_URL: "postgres://stub@stub.invalid/neondb",
    PEOPLE_EMAIL: EMAIL,
    PEOPLE_EMAIL_CONFIRM: EMAIL,
    PEOPLE_NAME: PERSON_NAME,
    PEOPLE_ROLE: "staff",
  };

  it("the stub stands in for the CLI when the target matches (control)", () => {
    const r = stubbedRun({ ...base, DATABASE_TARGET: "production" });
    expect(r.code).toBe(0);
    expect(r.called).toBe(true);
  });

  it("refuses mismatched addresses itself, before calling the CLI (SYC-131)", () => {
    for (const COMMAND of [
      "people-add",
      "people-mark-left",
      "people-sign-out-everywhere",
    ]) {
      for (const PEOPLE_EMAIL_CONFIRM of [
        undefined,
        "jacky.tset@example.com",
      ]) {
        const r = stubbedRun({
          ...base,
          COMMAND,
          DATABASE_TARGET: "production",
          PEOPLE_EMAIL_CONFIRM,
        });
        expect(r.code).not.toBe(0);
        expect(r.called).toBe(false);
      }
    }
  });

  it("refuses a missing or mismatched DATABASE_TARGET itself, before calling the CLI", () => {
    for (const DATABASE_TARGET of [undefined, "development", "rehearsal"]) {
      for (const COMMAND of [
        "people-add",
        "people-list",
        "people-mark-left",
          "people-sign-out-everywhere",
      ]) {
        const r = stubbedRun({ ...base, COMMAND, DATABASE_TARGET });
        expect(r.code).not.toBe(0);
        expect(r.called).toBe(false);
        expect(r.out).toMatch(
          /^db-ops: DATABASE_TARGET \('[^']*'\) doesn't match target 'production'\. Refusing\.$/m,
        );
      }
    }
  });
});

// SYC-131: the commands that end someone's access, run the way db-ops runs
// them: the address twice, from two secrets, in place of the CLI's retype.
describe("db-ops people-mark-left, people-sign-out-everywhere", () => {
  const devRun = (
    COMMAND: string,
    extra: Record<string, string | undefined> = {},
  ) =>
    run({
      COMMAND,
      TARGET: "development",
      DATABASE_TARGET: "development",
      NEON_DEV_URL: url(name),
      PEOPLE_EMAIL: EMAIL,
      PEOPLE_EMAIL_CONFIRM: EMAIL,
      // For people-set-roles, so only the confirmation can refuse it.
      PEOPLE_ROLE: "management",
      PEOPLE_CHANGE: "add",
      GITHUB_ACTOR: "claude-bot",
      ...extra,
    });
  const person = async () =>
    (await c.query(`select id, left_at, left_by, session_version from people`))
      .rows[0] as
      | {
          id: string;
          left_at: Date | null;
          left_by: string | null;
          session_version: number;
        }
      | undefined;

  it("mark-left marks the person as left, by the GitHub actor, and shows only the id", async () => {
    expect(devAdd().code).toBe(0);
    const r = devRun("people-mark-left");
    expect(r.code).toBe(0);
    const p = (await person())!;
    expect(p.left_at).toBeInstanceOf(Date);
    expect(p.left_by).toBe("cli:db-ops:claude-bot");
    expect(p.session_version).toBe(2);
    const out = shown(r.out);
    expect(out).toContain(`Marked person ${p.id} as left.`);
    expect(out.toLowerCase()).not.toContain("jacky");
    expect(out).not.toMatch(/postgres(ql)?:\/\//);
  });

  it("sign-out-everywhere raises the session version", async () => {
    expect(devAdd().code).toBe(0);
    const r = devRun("people-sign-out-everywhere");
    expect(r.code).toBe(0);
    expect(shown(r.out)).toContain(
      "Signed that person out everywhere (session version is now 2).",
    );
    expect((await person())!.session_version).toBe(2);
  });

  it("sign-out-everywhere records who did it, by the GitHub actor", async () => {
    expect(devAdd().code).toBe(0);
    expect(devRun("people-sign-out-everywhere").code).toBe(0);
    const ev = await c.query(
      `select kind, by from person_events order by id`,
    );
    expect(ev.rows).toEqual([
      { kind: "added", by: expect.stringMatching(/^cli:/) },
      { kind: "signed_out_everywhere", by: "cli:db-ops:claude-bot" },
    ]);
  });

  it("people-remove is gone: there is no way to delete a person (SYC-53 PR 0.1)", () => {
    expect(devAdd().code).toBe(0);
    const r = devRun("people-remove");
    expect(r.code).not.toBe(0);
    expect(countPeople()).resolves.toBe(1);
  });

  for (const COMMAND of [
    "people-mark-left",
    "people-sign-out-everywhere",
    "people-set-roles",
  ]) {
    it(`${COMMAND} changes nothing when the confirmation is missing or doesn't match`, async () => {
      expect(devAdd().code).toBe(0);
      const before = await person();
      for (const PEOPLE_EMAIL_CONFIRM of [
        undefined,
        "",
        "jacky.tset@example.com",
      ]) {
        const r = devRun(COMMAND, { PEOPLE_EMAIL_CONFIRM });
        expect(r.code).not.toBe(0);
        expect(shown(r.out).toLowerCase()).not.toContain("jacky");
      }
      expect(await person()).toEqual(before);
    });

    it(`${COMMAND} refuses target=rehearsal`, () => {
      const r = devRun(COMMAND, {
        TARGET: "rehearsal",
        DATABASE_TARGET: "rehearsal",
        NEON_REHEARSAL_URL: url(name),
      });
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(
        /only runs against target=development or target=production/,
      );
    });
  }

  it("says so, and exits non-zero, for an address that isn't on the list", () => {
    const r = devRun("people-mark-left");
    expect(r.code).not.toBe(0);
    expect(shown(r.out)).toContain(
      "That address isn't on the list. Nothing was changed.",
    );
  });
});

describe("db-ops people-set-roles and the new role list (SYC-53 PR 0.3)", () => {
  const devSetRoles = (extra: Record<string, string | undefined> = {}) =>
    run({
      COMMAND: "people-set-roles",
      TARGET: "development",
      DATABASE_TARGET: "development",
      NEON_DEV_URL: url(name),
      PEOPLE_EMAIL: EMAIL,
      PEOPLE_EMAIL_CONFIRM: EMAIL,
      PEOPLE_ROLE: "management",
      PEOPLE_CHANGE: "add",
      GITHUB_ACTOR: "claude-bot",
      ...extra,
    });
  const roles = async () =>
    (await c.query(`select role from person_scopes order by role`)).rows.map(
      (r) => r.role,
    );

  it("adds management beside staff, by the GitHub actor, printing before and after with no address", async () => {
    expect(devAdd().code).toBe(0);
    const r = devSetRoles();
    expect(r.code).toBe(0);
    const out = shown(r.out);
    expect(out).toContain("  before: staff");
    expect(out).toContain("  after:  management, staff");
    expect(out.toLowerCase()).not.toContain("jacky");
    expect(out).not.toMatch(/postgres(ql)?:\/\//);
    expect(await roles()).toEqual(["management", "staff"]);
    const ev = await c.query(`select kind, by from person_events order by id`);
    expect(ev.rows.at(-1)).toEqual({
      kind: "roles_changed",
      by: "cli:db-ops:claude-bot",
    });
  });

  it("removes one role, and refuses a result with no staff or management role unless CONFIRM=FORCE", async () => {
    expect(devAdd().code).toBe(0);
    const refused = devSetRoles({ PEOPLE_ROLE: "staff", PEOPLE_CHANGE: "remove" });
    expect(refused.code).not.toBe(0);
    expect(shown(refused.out)).toMatch(/no staff or management role/);
    expect(await roles()).toEqual(["staff"]);
    expect(devSetRoles({ PEOPLE_ROLE: "vet" }).code).toBe(0);
    const forced = devSetRoles({
      PEOPLE_ROLE: "staff",
      PEOPLE_CHANGE: "remove",
      CONFIRM: "FORCE",
    });
    expect(forced.code).toBe(0);
    expect(await roles()).toEqual(["vet"]);
  });

  it("refuses a role or change off the fixed lists, a bad colony, and a mismatched confirmation", async () => {
    expect(devAdd().code).toBe(0);
    for (const extra of [
      { PEOPLE_ROLE: "volunteer" },
      { PEOPLE_ROLE: "admin" },
      { PEOPLE_CHANGE: "replace" },
      { PEOPLE_CHANGE: undefined },
      { PEOPLE_ROLE: "guardian", PEOPLE_COLONY: "12; drop" },
      { PEOPLE_EMAIL_CONFIRM: "jacky.tset@example.com" },
    ]) {
      const r = devSetRoles(extra);
      expect(r.code).not.toBe(0);
      expect(shown(r.out).toLowerCase()).not.toContain("jacky");
    }
    expect(await roles()).toEqual(["staff"]);
  });

  it("people-add no longer offers volunteer, refuses management, and needs a colony for a guardian", async () => {
    const vol = devAdd({ PEOPLE_ROLE: "volunteer" });
    expect(vol.code).not.toBe(0);
    expect(vol.out).toMatch(/people_role must be staff, guardian or vet for people-add/);
    const mgmt = devAdd({ PEOPLE_ROLE: "management" });
    expect(mgmt.code).not.toBe(0);
    expect(mgmt.out).toMatch(/management isn't given by people-add/);
    const noColony = devAdd({ PEOPLE_ROLE: "guardian" });
    expect(noColony.code).not.toBe(0);
    expect(shown(noColony.out)).toMatch(/A cat guardian needs a colony/);
    expect(await countPeople()).toBe(0);
    const colony = (
      await c.query(
        `insert into colonies (name, normalised_name) values ('Kini dbops', 'kini dbops') returning id`,
      )
    ).rows[0].id;
    const ok = devAdd({ PEOPLE_ROLE: "guardian", PEOPLE_COLONY: String(colony) });
    expect(ok.code).toBe(0);
    expect(shown(ok.out)).toContain(`as guardian on colony ${colony}.`);
  });

  it("the workflow's people_role choices are the new role list", () => {
    const yml = fs.readFileSync(path.join(ROOT, ".github/workflows/db-ops.yml"), "utf8");
    expect(yml).toMatch(/options: \[staff, management, guardian, vet\]/);
    expect(yml).not.toMatch(/options: \[[^\]]*volunteer/);
    expect(yml).toMatch(/people-set-roles,/);
    expect(yml).toMatch(/PEOPLE_CHANGE: \$\{\{ inputs\.people_change \}\}/);
    expect(yml).toMatch(/PEOPLE_COLONY: \$\{\{ inputs\.people_colony \}\}/);
  });
});
