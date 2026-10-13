import crypto from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../schema";
import { ROLE_MAILBOX_LOCAL_PARTS } from "../schema/people";
import { checkPersonEmail, peopleStore, PeopleError } from "../people";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
  rollbackLast,
} from "./runner";
import { schemaSignature, signatureDiff } from "./signature";

// The list of people as the migration builds it (team-access spec §2.8, §2.9,
// §7.3; SYC-43 part 1 plan tests 1–5), on a throwaway database.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const suffix = crypto.randomBytes(4).toString("hex");
const name = `people_test_${suffix}`;
const cycleName = `people_cycle_${suffix}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
let store: ReturnType<typeof peopleStore>;

const migrations = readMigrations(defaultMigrationsFolder());

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, migrations);
  store = peopleStore(drizzle(c, { schema }));
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.query(`drop database if exists "${cycleName}"`);
  await admin.end();
});

beforeEach(async () => {
  // PR 6: the cascade reaches photo_visibility_events, whose TRUNCATE guard
  // is switched off for this one statement, inside a transaction, as
  // dataSpine.test.ts does for sightings.
  await c.query("begin");
  await c.query(`alter table photo_visibility_events disable trigger photo_visibility_events_no_truncate`);
  await c.query(`alter table mapping_events disable trigger mapping_events_no_truncate`);
  await c.query(`alter table feeding_site_old_codes disable trigger feeding_site_old_codes_no_truncate`);
  await c.query(`truncate person_scopes, people, team_handoff_spent cascade`);
  await c.query(`alter table photo_visibility_events enable trigger photo_visibility_events_no_truncate`);
  await c.query(`alter table mapping_events enable trigger mapping_events_no_truncate`);
  await c.query(`alter table feeding_site_old_codes enable trigger feeding_site_old_codes_no_truncate`);
  await c.query("commit");
});

const rawInsert = (email: string) =>
  c.query(`insert into people (email, name) values ($1, 'Test')`, [email]);

describe("people: the database refuses shared mailboxes (§8.6 #10)", () => {
  const denied = [
    "admin@syroscats.com",
    "info@syroscats.com",
    "hello@syroscats.com",
    "contact@syroscats.com",
    "team@syroscats.com",
    "office@syroscats.com",
    "support@syroscats.com",
    "admin+x@syroscats.com",
  ];
  for (const email of denied) {
    it(`refuses a raw INSERT of ${email}`, async () => {
      await expect(rawInsert(email)).rejects.toThrow(
        /people_email_not_role_ck/,
      );
    });
  }
});

describe("people: normalised addresses", () => {
  it("refuses mixed case or padding in the database, and addPerson normalises it", async () => {
    await expect(rawInsert("Susan@Example.com")).rejects.toThrow(
      /people_email_lowercase_ck/,
    );
    await expect(rawInsert(" susan@example.com")).rejects.toThrow(
      /people_email_lowercase_ck/,
    );
    const p = await store.addPerson({
      email: "  Susan@Example.COM ",
      name: "Susan",
      addedBy: "cli:test",
    });
    expect(p.email).toBe("susan@example.com");
    expect(p.sessionVersion).toBe(1);
  });

  it("refuses a badly formed address in the database", async () => {
    for (const bad of ["susan", "susan@", "@example.com", "a@b@c"]) {
      await expect(rawInsert(bad)).rejects.toThrow(/people_email_shape_ck/);
    }
  });
});

describe("people: the TypeScript and database deny-lists agree", () => {
  it("every TypeScript entry is refused by the database, with and without +tag", async () => {
    expect(ROLE_MAILBOX_LOCAL_PARTS.length).toBe(7);
    for (const local of ROLE_MAILBOX_LOCAL_PARTS) {
      for (const email of [`${local}@example.com`, `${local}+x@example.com`]) {
        expect(checkPersonEmail(email).ok).toBe(false);
        await expect(rawInsert(email)).rejects.toThrow(
          /people_email_not_role_ck/,
        );
      }
    }
  });

  it("an address the TypeScript check allows is accepted by the database", async () => {
    expect(checkPersonEmail("susan@example.com")).toEqual({ ok: true });
    await expect(rawInsert("susan@example.com")).resolves.toBeDefined();
  });

  it("addPerson gives the plain-English reason", async () => {
    await expect(
      store.addPerson({
        email: "Admin@syroscats.com",
        name: "Shared",
        addedBy: "cli:test",
      }),
    ).rejects.toThrow(
      "admin@ is a shared mailbox. Every person needs their own address, so we can tell who did what. A personal address is fine.",
    );
  });
});

describe("person_scopes", () => {
  it("removing a person removes their scopes (cascade), even by raw delete", async () => {
    const p = await store.addPerson({
      email: "eleni@example.com",
      name: "Eleni",
      addedBy: "cli:test",
      roles: ["staff", "guardian"],
    });
    const before = await c.query(
      `select count(*)::int as n from person_scopes where person_id = $1`,
      [p.id],
    );
    expect(before.rows[0].n).toBe(2);
    await c.query(`delete from people where id = $1`, [p.id]);
    const after = await c.query(
      `select count(*)::int as n from person_scopes where person_id = $1`,
      [p.id],
    );
    expect(after.rows[0].n).toBe(0);
  });

  it("refuses the same role twice with no colony", async () => {
    const p = await store.addPerson({
      email: "maria@example.com",
      name: "Maria",
      addedBy: "cli:test",
    });
    await expect(
      c.query(
        `insert into person_scopes (person_id, role) values ($1, 'staff')`,
        [p.id],
      ),
    ).rejects.toThrow(/person_scopes_role_scope_unique/);
  });

  it("refuses a role that isn't one of the four", async () => {
    const p = await store.addPerson({
      email: "nikos@example.com",
      name: "Nikos",
      addedBy: "cli:test",
    });
    await expect(
      c.query(
        `insert into person_scopes (person_id, role) values ($1, 'admin')`,
        [p.id],
      ),
    ).rejects.toThrow(/person_scopes_role_ck/);
    await expect(
      store.addPerson({
        email: "other@example.com",
        name: "Other",
        addedBy: "cli:test",
        roles: ["admin"],
      }),
    ).rejects.toBeInstanceOf(PeopleError);
  });
});

describe("the people operations", () => {
  it("refuses a second person with the same address", async () => {
    await store.addPerson({
      email: "susan@example.com",
      name: "Susan",
      addedBy: "cli:test",
    });
    await expect(
      store.addPerson({
        email: "SUSAN@example.com",
        name: "Susan again",
        addedBy: "cli:test",
      }),
    ).rejects.toThrow("That address is already on the list.");
  });

  it("finds, signs out everywhere and removes by address", async () => {
    const { rejoined, ...p } = await store.addPerson({
      email: "susan@example.com",
      name: "Susan",
      addedBy: "cli:test",
    });
    expect(rejoined).toBe(false);
    // With their roles, so the caller can decide through can() (SYC-188).
    expect(await store.findAllowedPerson("SUSAN@example.com")).toEqual({
      ...p,
      scopes: [{ role: "staff", colonyId: null }],
    });
    expect(await store.signOutEverywhere("susan@example.com")).toBe(2);
    const byId = await store.findPersonById(p.id);
    expect(byId).toMatchObject({
      sessionVersion: 2,
      scopes: [{ role: "staff", colonyId: null }],
    });
    expect(await store.removePerson("susan@example.com")).toBe(true);
    expect(await store.findAllowedPerson("susan@example.com")).toBeNull();
    expect(await store.removePerson("susan@example.com")).toBe(false);
    expect(await store.signOutEverywhere("susan@example.com")).toBeNull();
  });

  it("treats a non-uuid id as not on the list, without a database error", async () => {
    expect(await store.findPersonById("not-a-uuid")).toBeNull();
    expect(await store.findPersonById("' or 1=1 --")).toBeNull();
  });
});

describe("this migration's rollback", () => {
  it("restores the schema from before it exactly, and up/down/up works", async () => {
    const mine = migrations.find((m) =>
      m.tag.endsWith("_people_and_staff_sign_in"),
    );
    expect(mine).toBeDefined();
    await admin.query(`create database "${cycleName}"`);
    const cc = new pg.Client({ connectionString: url(cycleName) });
    await cc.connect();
    try {
      await migrateUp(cc, migrations, { throughIdx: mine!.idx - 1 });
      const before = await schemaSignature(cc, "public");
      await migrateUp(cc, migrations, { throughIdx: mine!.idx });
      const after = await schemaSignature(cc, "public");
      expect(await rollbackLast(cc, migrations)).toBe(mine!.tag);
      expect(
        signatureDiff(await schemaSignature(cc, "public"), before, {
          actual: "after rollback",
          expected: "before",
        }),
      ).toEqual([]);
      await migrateUp(cc, migrations, { throughIdx: mine!.idx });
      expect(
        signatureDiff(await schemaSignature(cc, "public"), after, {
          actual: "second up",
          expected: "first up",
        }),
      ).toEqual([]);
    } finally {
      await cc.end();
    }
  });
});
