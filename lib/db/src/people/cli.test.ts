import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "../migrate/runner";
import { runPeopleCommand, type CliIo } from "./cli";
import { truncateWithGuardsOff } from "../migrate/truncatePeople";

// The `people` command against a throwaway database (SYC-43 part 1,
// Decision 4; SYC-121 plan H.1(b)). The target is checked against
// DATABASE_TARGET first, the address comes only from the target's own
// variable, and nothing personal or secret is printed.

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
  // SYC-53 PR 0.1: the cascade reaches guarded add-only tables (including
  // person_events); the helper switches their TRUNCATE guards off for
  // this one statement and back on.
  await truncateWithGuardsOff(c, "person_scopes, people");
});

/** A development run, as the db-ops development Environment sets it up. */
const devEnv = (): CliIo["env"] => ({
  DATABASE_TARGET: "development",
  NEON_DEV_URL: url(name),
  // Present but never used: the command must not fall back to it.
  DATABASE_URL: baseUrl,
});

const run = (args: string[], env: CliIo["env"] = devEnv(), answer = "") => {
  const lines: string[] = [];
  return runPeopleCommand(args, {
    env,
    out: (line) => lines.push(line),
    ask: async () => answer,
  }).then((code) => ({ code, out: lines }));
};

const countPeople = async () =>
  (await c.query(`select count(*)::int as n from people`)).rows[0].n as number;

describe("choosing the database", () => {
  it("refuses without --target", async () => {
    const r = await run(["list"]);
    expect(r.code).toBe(2);
    expect(r.out.join("\n")).toMatch(/Give --target exactly once/);
  });

  it("refuses when DATABASE_TARGET is unset or names another target, before connecting", async () => {
    for (const DATABASE_TARGET of [undefined, "production", "Development"]) {
      const r = await run(
        [
          "add",
          "--target",
          "development",
          "--email",
          "susan@example.com",
          "--name",
          "Susan",
        ],
        { ...devEnv(), DATABASE_TARGET },
      );
      expect(r.code).toBe(2);
      expect(r.out.join("\n")).toMatch(
        /DATABASE_TARGET .* doesn't match target 'development'/,
      );
    }
    expect(await countPeople()).toBe(0);
  });

  it("uses only the target's own variable: an empty NEON_PROD_URL never falls through", async () => {
    const r = await run(["list", "--target", "production"], {
      DATABASE_TARGET: "production",
      NEON_DEV_URL: url(name),
      NEON_REHEARSAL_URL: url(name),
      DATABASE_URL: url(name),
    });
    expect(r.code).toBe(2);
    expect(r.out).toEqual([
      "NEON_PROD_URL must be set for target 'production'.",
    ]);
  });

  it("refuses a target that isn't development, rehearsal or production", async () => {
    const r = await run(["list", "--target", "local"], {
      DATABASE_TARGET: "local",
      DATABASE_URL: url(name),
    });
    expect(r.code).toBe(2);
    expect(r.out.join("\n")).toMatch(/development, rehearsal or production/);
  });

  it("never prints the connection string or any part of it, even when connecting fails", async () => {
    const secretUrl =
      "postgres://neon_owner:s3cret-Pa55word@ep-secret-host-123456.invalid:5432/neondb";
    const r = await run(["list", "--target", "production"], {
      DATABASE_TARGET: "production",
      NEON_PROD_URL: secretUrl,
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
});

describe("people command", () => {
  it("adds from PEOPLE_EMAIL and PEOPLE_NAME, printing only the id and role", async () => {
    const r = await run(
      ["add", "--accepted", "--target", "development", "--role", "staff", "--by", "db-ops"],
      {
        ...devEnv(),
        PEOPLE_EMAIL: "Susan@Example.com",
        PEOPLE_NAME: "Susan Papadaki",
      },
    );
    expect(r.code).toBe(0);
    const row = await c.query(`select id, email, name, added_by from people`);
    expect(row.rows[0]).toMatchObject({
      email: "susan@example.com",
      name: "Susan Papadaki",
      added_by: "cli:db-ops",
    });
    expect(r.out).toEqual([
      "Target: development",
      `Added person ${row.rows[0].id} as staff.`,
    ]);
    const all = r.out.join("\n").toLowerCase();
    expect(all).not.toContain("susan");
    expect(all).not.toContain("example.com");
  });

  it("refuses add with no address or name given anywhere", async () => {
    const r = await run(["add", "--accepted", "--target", "development"]);
    expect(r.code).toBe(2);
    expect(r.out.join("\n")).toMatch(/Give --email, or set PEOPLE_EMAIL/);
    expect(await countPeople()).toBe(0);
  });

  it("lists ids, roles and versions, never an address or a name", async () => {
    await run([
      "add",
      "--accepted",
      "--target",
      "development",
      "--email",
      "susan@example.com",
      "--name",
      "Susan",
    ]);
    const list = await run(["list", "--target", "development"]);
    expect(list.code).toBe(0);
    expect(list.out[1]).toBe("1 person on the list.");
    expect(list.out[2]).toMatch(
      /^[0-9a-f-]{36}\tstaff\tsession 1\tadded \S+ by cli:\S+\tlanguage en\thistory added$/,
    );
    expect(list.out.join("\n").toLowerCase()).not.toMatch(/susan|example\.com/);
  });

  it("signs out everywhere after the address is typed again, and records who", async () => {
    await run([
      "add",
      "--accepted",
      "--target",
      "development",
      "--email",
      "susan@example.com",
      "--name",
      "Susan",
    ]);
    const so = await run(
      [
        "sign-out-everywhere",
        "--target",
        "development",
        "--email",
        "susan@example.com",
      ],
      devEnv(),
      "susan@example.com",
    );
    expect(so.code).toBe(0);
    expect(so.out).toContain(
      "Signed that person out everywhere (session version is now 2).",
    );
    const events = await c.query(
      `select kind, by from person_events order by id`,
    );
    expect(events.rows.map((r) => r.kind)).toEqual([
      "added",
      "signed_out_everywhere",
    ]);
    expect(events.rows[1].by).toMatch(/^cli:\S+$/);
    const list = await run(["list", "--target", "development"]);
    expect(list.out[2]).toMatch(/\tlanguage en\thistory added,signed_out_everywhere$/);
  });

  it("has no remove command: marking as left is the only way off the list", async () => {
    const rm = await run(
      ["remove", "--target", "development", "--email", "susan@example.com"],
      devEnv(),
      "susan@example.com",
    );
    expect(rm.code).toBe(2);
    expect(rm.out.join("\n")).toContain('Unknown command "remove".');
  });

  it("changes nothing when the confirmation doesn't match", async () => {
    await run([
      "add",
      "--accepted",
      "--target",
      "development",
      "--email",
      "maria@example.com",
      "--name",
      "Maria",
    ]);
    const rm = await run(
      [
        "sign-out-everywhere",
        "--target",
        "development",
        "--email",
        "maria@example.com",
      ],
      devEnv(),
      "maria@example.org",
    );
    expect(rm.code).toBe(1);
    expect(rm.out).toContain("The addresses don't match. Nothing was changed.");
    expect(await countPeople()).toBe(1);
  });

  it("refuses a shared mailbox with the plain-English reason", async () => {
    const add = await run([
      "add",
      "--accepted",
      "--target",
      "development",
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

describe("people who leave (SYC-43 part 2, Decision 7)", () => {
  const add = () =>
    run([
      "add",
      "--accepted",
      "--target",
      "development",
      "--email",
      "susan@example.com",
      "--name",
      "Susan",
    ]);
  const markLeft = (answer = "susan@example.com") =>
    run(
      [
        "mark-left",
        "--target",
        "development",
        "--email",
        "susan@example.com",
        "--by",
        "samuel",
      ],
      devEnv(),
      answer,
    );

  it("marks a person as left after the address is typed again, and list shows it", async () => {
    await add();
    const ml = await markLeft("SUSAN@example.com ");
    expect(ml.code).toBe(0);
    expect(ml.out[1]).toMatch(
      /^Marked person [0-9a-f-]{36} as left\. They're signed out everywhere and can't sign in\. Their history stays theirs\.$/,
    );
    const row = (
      await c.query(`select left_at, left_by, session_version from people`)
    ).rows[0];
    expect(row.left_at).toBeInstanceOf(Date);
    expect(row.left_by).toBe("cli:samuel");
    expect(row.session_version).toBe(2);

    const list = await run(["list", "--target", "development"]);
    expect(list.out[1]).toBe("0 people on the list, and 1 marked as left.");
    expect(list.out[2]).toMatch(
      /^[0-9a-f-]{36}\tstaff\tsession 2\tadded \S+ by cli:\S+\tLEFT \S+ by cli:samuel\tlanguage en\thistory added,left$/,
    );
    expect(list.out.join("\n").toLowerCase()).not.toMatch(/susan|example\.com/);
  });

  it("changes nothing when the confirmation doesn't match", async () => {
    await add();
    const ml = await markLeft("susan@example.org");
    expect(ml.code).toBe(1);
    expect(ml.out).toContain("The addresses don't match. Nothing was changed.");
    const row = (await c.query(`select left_at from people`)).rows[0];
    expect(row.left_at).toBeNull();
  });

  it("refuses an address that isn't on the list, or has already left", async () => {
    const none = await markLeft();
    expect(none.code).toBe(1);
    expect(none.out).toContain(
      "That address isn't on the list. Nothing was changed.",
    );
    await add();
    await markLeft();
    const again = await markLeft();
    expect(again.code).toBe(1);
    expect(again.out).toContain("That person is already marked as left.");
  });

  it("adding a left person's address again says they rejoined", async () => {
    await add();
    const id = (await c.query(`select id from people`)).rows[0].id;
    await markLeft();
    const back = await add();
    expect(back.code).toBe(0);
    expect(back.out[1]).toBe(
      `Rejoined person ${id} as staff. They had left; their history is still theirs.`,
    );
    expect(await countPeople()).toBe(1);
  });
});

describe("SYC-53 PR 0.3: add's rules, and set-roles", () => {
  const SAMUEL = "samuel@example.com";
  const add = (extra: string[] = []) =>
    run([
      "add",
      "--accepted",
      "--target",
      "development",
      "--email",
      SAMUEL,
      "--name",
      "Samuel",
      ...extra,
    ]);
  const setRoles = (args: string[], answer = SAMUEL) =>
    run(
      ["set-roles", "--target", "development", "--email", SAMUEL, "--by", "claude", ...args],
      devEnv(),
      answer,
    );
  const roles = async () =>
    (
      await c.query(
        `select role, colony_id from person_scopes order by role, colony_id`,
      )
    ).rows.map((r) => (r.colony_id === null ? r.role : `${r.role}:${r.colony_id}`));

  it("add without --accepted is refused: invitations come with the people screen", async () => {
    const r = await run([
      "add",
      "--target",
      "development",
      "--email",
      SAMUEL,
      "--name",
      "Samuel",
    ]);
    expect(r.code).toBe(2);
    expect(r.out.join("\n")).toMatch(/needs --accepted/);
    expect(await countPeople()).toBe(0);
  });

  it("add refuses volunteer and management, and a guardian with no colony", async () => {
    for (const [extra, reason] of [
      [["--role", "volunteer"], /"volunteer" isn't a role/],
      [["--role", "management"], /Management can't be given when adding someone/],
      [["--role", "guardian"], /A cat guardian needs a colony/],
    ] as const) {
      const r = await add([...extra]);
      expect(r.code).toBe(1);
      expect(r.out.join("\n")).toMatch(reason);
    }
    expect(await countPeople()).toBe(0);
  });

  it("add places a guardian with --colony and takes --language", async () => {
    const colony = (
      await c.query(
        `insert into colonies (name, normalised_name) values ('Kini cli', 'kini cli') returning id`,
      )
    ).rows[0].id;
    const r = await add(["--role", "guardian", "--colony", String(colony), "--language", "el"]);
    expect(r.code).toBe(0);
    expect(r.out[1]).toMatch(new RegExp(`as guardian on colony ${colony}\\.$`));
    expect(await roles()).toEqual([`guardian:${colony}`]);
    const p = await c.query(`select language, accepted_at from people`);
    expect(p.rows[0].language).toBe("el");
    expect(p.rows[0].accepted_at).toBeInstanceOf(Date);
    const bad = await run(["add", "--accepted", "--target", "development", "--email", "x@example.com", "--name", "X", "--role", "guardian", "--colony", "twelve"]);
    expect(bad.code).toBe(2);
    expect(bad.out.join("\n")).toMatch(/--colony is a colony's number/);
  });

  it("set-roles --add management keeps staff and prints before and after, ids only", async () => {
    await add();
    const id = (await c.query(`select id from people`)).rows[0].id;
    const r = await setRoles(["--add", "management"]);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([
      "Target: development",
      `Person ${id}`,
      "  before: staff",
      "  after:  management, staff",
    ]);
    expect(await roles()).toEqual(["management", "staff"]);
    const ev = await c.query(`select kind, by from person_events order by id`);
    expect(ev.rows.at(-1)).toEqual({ kind: "roles_changed", by: "cli:claude" });
    expect(r.out.join("\n").toLowerCase()).not.toMatch(/samuel|example\.com/);
  });

  it("a typo can't remove a manager: a bare --role, a misspelt role or a mistyped confirmation changes nothing", async () => {
    await add();
    await setRoles(["--add", "management"]);
    const before = await roles();
    const bare = await setRoles(["--role", "staff"]);
    expect(bare.code).toBe(2);
    expect(bare.out.join("\n")).toMatch(/one at a time; a whole new list needs --replace/);
    const misspelt = await setRoles(["--remove", "managment"]);
    expect(misspelt.code).toBe(1);
    expect(misspelt.out.join("\n")).toMatch(/"managment" isn't a role/);
    const retyped = await setRoles(["--remove", "management"], "samuel@exmaple.com");
    expect(retyped.code).toBe(1);
    expect(retyped.out).toContain("The addresses don't match. Nothing was changed.");
    const none = await setRoles([]);
    expect(none.code).toBe(1);
    expect(none.out.join("\n")).toMatch(/Give exactly one change/);
    expect(await roles()).toEqual(before);
  });

  it("set-roles refuses a result with no staff or management role unless --force", async () => {
    await add();
    const refused = await setRoles(["--replace", "vet"]);
    expect(refused.code).toBe(1);
    expect(refused.out.join("\n")).toMatch(/no staff or management role/);
    expect(await roles()).toEqual(["staff"]);
    const forced = await setRoles(["--replace", "vet", "--force"]);
    expect(forced.code).toBe(0);
    expect(forced.out.slice(2)).toEqual(["  before: staff", "  after:  vet"]);
    expect(await roles()).toEqual(["vet"]);
  });

  it("list marks a pending person and shows each person's language", async () => {
    await add();
    await c.query(
      `insert into people (email, name, added_by) values ('new@example.com', 'New', 'cli:t')`,
    );
    const list = await run(["list", "--target", "development"]);
    expect(list.out[1]).toBe("1 person on the list, and 1 invited and not yet joined.");
    const lines = list.out.slice(2);
    expect(lines.filter((l) => l.includes("\tPENDING"))).toHaveLength(1);
    expect(lines.every((l) => l.includes("\tlanguage en"))).toBe(true);
    expect(list.out.join("\n").toLowerCase()).not.toMatch(/samuel@|new@|example\.com/);
  });
});
