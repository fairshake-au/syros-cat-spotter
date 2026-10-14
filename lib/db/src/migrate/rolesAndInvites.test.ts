import crypto from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../schema";
import { PeopleError, peopleStore } from "../people";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
  rollbackLast,
} from "./runner";
import { schemaSignature, signatureDiff } from "./signature";
import { truncateWithGuardsOff } from "./truncatePeople";

// SYC-53 PR 0.3: the roles migration (roles-and-invites.md §10.1, §15.2) and
// what the database now refuses. Plan tests T17, the database half of T3,
// T29, T9 (part), the seeded-database rollback test (review M7) and spec
// test 29a's seeded half (`setRoles`; the CLI and db-ops halves are in
// src/people). On throwaway databases.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const suffix = crypto.randomBytes(4).toString("hex");
const name = `roles_invites_test_${suffix}`;
const seededName = `roles_invites_seeded_${suffix}`;
const adminObsName = `roles_invites_admin_${suffix}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
let store: ReturnType<typeof peopleStore>;

const migrations = readMigrations(defaultMigrationsFolder());
const sigDiff = (actual: string[], expected: string[]) =>
  signatureDiff(actual, expected, { actual: "now", expected: "expected" });
const mine = migrations.find((m) => m.tag.endsWith("_roles_and_invites"))!;

beforeAll(async () => {
  expect(mine).toBeDefined();
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
  await admin.query(`drop database if exists "${seededName}"`);
  await admin.query(`drop database if exists "${adminObsName}"`);
  await admin.end();
});

beforeEach(async () => {
  await truncateWithGuardsOff(c, "person_scopes, people");
});

const newColony = async (
  client: pg.Client,
  label = `Vaporia ${crypto.randomBytes(3).toString("hex")}`,
) =>
  (
    await client.query(
      `insert into colonies (name, normalised_name) values ($1, lower($1)) returning id`,
      [label],
    )
  ).rows[0].id as number;

const rawPerson = async (
  client: pg.Client,
  email: string,
  opts: { accepted?: boolean; left?: boolean } = {},
) =>
  (
    await client.query(
      `insert into people (email, name, added_by, accepted_at, left_at)
       values ($1, 'N', 'cli:test', $2, $3) returning id`,
      [
        email,
        opts.accepted === false ? null : new Date(),
        opts.left ? new Date() : null,
      ],
    )
  ).rows[0].id as string;

const insertScope = (
  person: string,
  role: string,
  reach: string,
  colony: number | null,
) =>
  c.query(
    `insert into person_scopes (person_id, role, reach, colony_id) values ($1, $2, $3, $4)`,
    [person, role, reach, colony],
  );

// ---------------------------------------------------------------------------

describe("T17 and T3 (database half): what person_scopes refuses", () => {
  // Each bad row is refused by exactly one check, so dropping that check
  // turns its test red (the mutation probes in the PR body).
  it("refuses an island-wide cat guardian (person_scopes_guardian_colony_ck)", async () => {
    const p = await rawPerson(c, "eleni@example.com");
    await expect(insertScope(p, "guardian", "island", null)).rejects.toThrow(
      /person_scopes_guardian_colony_ck/,
    );
  });

  it("refuses a cat guardian with no colony (person_scopes_reach_colony_ck)", async () => {
    const p = await rawPerson(c, "eleni@example.com");
    await expect(insertScope(p, "guardian", "colony", null)).rejects.toThrow(
      /person_scopes_reach_colony_ck/,
    );
  });

  it("refuses a staff or management row tied to a colony (person_scopes_team_island_ck)", async () => {
    const p = await rawPerson(c, "maria@example.com");
    const colony = await newColony(c);
    for (const role of ["staff", "management"]) {
      await expect(insertScope(p, role, "colony", colony)).rejects.toThrow(
        /person_scopes_team_island_ck/,
      );
    }
  });

  it("refuses an island reach that names a colony, and a reach that isn't one", async () => {
    const p = await rawPerson(c, "maria@example.com");
    const colony = await newColony(c);
    await expect(insertScope(p, "vet", "island", colony)).rejects.toThrow(
      /person_scopes_reach_colony_ck/,
    );
    await expect(insertScope(p, "vet", "everywhere", null)).rejects.toThrow(
      /person_scopes_reach_ck/,
    );
  });

  it("refuses any volunteer row, island-wide or placed (the role is retired)", async () => {
    const p = await rawPerson(c, "vera@example.com");
    const colony = await newColony(c);
    await expect(insertScope(p, "volunteer", "island", null)).rejects.toThrow(
      /person_scopes_role_ck/,
    );
    await expect(insertScope(p, "volunteer", "colony", colony)).rejects.toThrow(
      /person_scopes_role_ck/,
    );
  });

  it("refuses a row that doesn't say where it applies (reach has no default)", async () => {
    const p = await rawPerson(c, "maria@example.com");
    await expect(
      c.query(`insert into person_scopes (person_id, role) values ($1, 'staff')`, [p]),
    ).rejects.toThrow(/null value in column "reach"/);
  });

  it("accepts the rows that are allowed: team and management island-wide, a guardian on a colony, a vet either way", async () => {
    const p = await rawPerson(c, "maria@example.com");
    const colony = await newColony(c);
    await insertScope(p, "staff", "island", null);
    await insertScope(p, "management", "island", null);
    await insertScope(p, "guardian", "colony", colony);
    await insertScope(p, "vet", "island", null);
    await insertScope(p, "vet", "colony", colony);
    const n = await c.query(`select count(*)::int as n from person_scopes`);
    expect(n.rows[0].n).toBe(5);
  });

  it("refuses a relationship or a language off the list", async () => {
    const p = await rawPerson(c, "maria@example.com");
    const colony = await newColony(c);
    await expect(
      c.query(
        `insert into person_scopes (person_id, role, reach, colony_id, relationship) values ($1, 'guardian', 'colony', $2, 'friend')`,
        [p, colony],
      ),
    ).rejects.toThrow(/person_scopes_relationship_ck/);
    await expect(
      c.query(`update people set language = 'de' where id = $1`, [p]),
    ).rejects.toThrow(/people_language_ck/);
  });
});

describe("T9 (part): a pending person is found by neither finder", () => {
  it("someone with accepted_at null is not on the list, by address or by id", async () => {
    const pending = await rawPerson(c, "eleni@example.com", { accepted: false });
    await insertScope(pending, "staff", "island", null);
    expect(await store.findAllowedPerson("eleni@example.com")).toBeNull();
    expect(await store.findPersonById(pending)).toBeNull();
  });

  it("control: the same person once accepted is found by both, with reach and expiry", async () => {
    const joined = await rawPerson(c, "eleni@example.com");
    await insertScope(joined, "staff", "island", null);
    const expected = {
      id: joined,
      scopes: [{ role: "staff", colonyId: null, reach: "island", expiresAt: null }],
    };
    expect(await store.findAllowedPerson("eleni@example.com")).toMatchObject(expected);
    expect(await store.findPersonById(joined)).toMatchObject(expected);
  });

  it("addPerson adds someone directly, joined at once", async () => {
    const p = await store.addPerson({
      email: "maria@example.com",
      name: "Maria",
      addedBy: "cli:test",
    });
    const row = await c.query(`select accepted_at, language from people where id = $1`, [p.id]);
    expect(row.rows[0].accepted_at).toBeInstanceOf(Date);
    expect(row.rows[0].language).toBe("en");
    expect(await store.findPersonById(p.id)).not.toBeNull();
  });
});

describe("addPerson's rules (the `people add` command)", () => {
  it("places a cat guardian on her colony, and refuses one with no colony", async () => {
    const colony = await newColony(c);
    await expect(
      store.addPerson({ email: "eleni@example.com", name: "Eleni", addedBy: "cli:t", roles: ["guardian"] }),
    ).rejects.toThrow("A cat guardian needs a colony");
    const p = await store.addPerson({
      email: "eleni@example.com",
      name: "Eleni",
      addedBy: "cli:t",
      roles: ["guardian"],
      colonyId: colony,
      language: "el",
    });
    const rows = await c.query(
      `select role, reach, colony_id, granted_by from person_scopes where person_id = $1`,
      [p.id],
    );
    expect(rows.rows).toEqual([
      { role: "guardian", reach: "colony", colony_id: colony, granted_by: "cli:t" },
    ]);
    const lang = await c.query(`select language from people where id = $1`, [p.id]);
    expect(lang.rows[0].language).toBe("el");
  });

  it("refuses volunteer, management, a colony for a non-guardian, and an unknown language", async () => {
    const colony = await newColony(c);
    const base = { email: "x@example.com", name: "X", addedBy: "cli:t" };
    await expect(store.addPerson({ ...base, roles: ["volunteer"] })).rejects.toThrow(
      /"volunteer" isn't a role/,
    );
    await expect(store.addPerson({ ...base, roles: ["staff", "management"] })).rejects.toThrow(
      /Management can't be given when adding someone/,
    );
    await expect(store.addPerson({ ...base, roles: ["staff"], colonyId: colony })).rejects.toThrow(
      /Only a cat guardian is placed on a colony/,
    );
    await expect(store.addPerson({ ...base, language: "de" })).rejects.toThrow(/isn't a language/);
    expect((await c.query(`select count(*)::int as n from people`)).rows[0].n).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("spec test 29a, seeded half: setRoles is additive", () => {
  const SAMUEL = "samuel@example.com";
  const addStaff = (email = SAMUEL) =>
    store.addPerson({ email, name: "S", addedBy: "cli:t" });
  const rolesOf = async (id: string) =>
    (
      await c.query(
        `select role, colony_id from person_scopes where person_id = $1 order by role, colony_id`,
        [id],
      )
    ).rows.map((r) => (r.colony_id === null ? r.role : `${r.role}:${r.colony_id}`));
  const eventsOf = async (id: string) =>
    (
      await c.query(
        `select kind, by, detail from person_events where person_id = $1 order by id`,
        [id],
      )
    ).rows;

  it("adds management beside staff, keeps staff, and writes one roles_changed event with before and after", async () => {
    const p = await addStaff();
    const r = await store.setRoles({ email: SAMUEL, add: "management", by: "cli:claude" });
    expect(r).toEqual({ id: p.id, before: ["staff"], after: ["management", "staff"], droppedPlacements: [] });
    expect(await rolesOf(p.id)).toEqual(["management", "staff"]);
    const ev = await eventsOf(p.id);
    expect(ev.map((e) => e.kind)).toEqual(["added", "roles_changed"]);
    expect(ev[1]).toEqual({
      kind: "roles_changed",
      by: "cli:claude",
      detail: { before: ["staff"], after: ["management", "staff"] },
    });
    expect(JSON.stringify(ev[1].detail)).not.toMatch(/samuel|example/i);
  });

  it("exactly the people it is run for hold management; everyone else stays team-only", async () => {
    const three = ["samuel@example.com", "jacky@example.com", "susan@example.com"];
    const others = ["maria@example.com", "nikos@example.com"];
    for (const e of [...three, ...others]) await addStaff(e);
    for (const e of three) await store.setRoles({ email: e, add: "management", by: "cli:t" });
    const holders = await c.query(
      `select p.email from person_scopes s join people p on p.id = s.person_id
        where s.role = 'management' order by p.email`,
    );
    expect(holders.rows.map((r) => r.email)).toEqual([...three].sort());
    const staff = await c.query(`select count(*)::int as n from person_scopes where role = 'staff'`);
    expect(staff.rows[0].n).toBe(5);
  });

  it("a typo can't remove a manager: a misspelt role, a missing change or a wrong address changes nothing", async () => {
    const p = await addStaff();
    await store.setRoles({ email: SAMUEL, add: "management", by: "cli:t" });
    const before = await rolesOf(p.id);
    const eventsBefore = (await eventsOf(p.id)).length;
    await expect(
      store.setRoles({ email: SAMUEL, remove: "managment", by: "cli:t" }),
    ).rejects.toThrow(/"managment" isn't a role/);
    await expect(
      store.setRoles({ email: SAMUEL, remove: "vet", by: "cli:t" }),
    ).rejects.toThrow(/They don't hold vet/);
    await expect(store.setRoles({ email: SAMUEL, by: "cli:t" })).rejects.toThrow(
      /Give exactly one change/,
    );
    await expect(
      store.setRoles({ email: SAMUEL, add: "staff", remove: "management", by: "cli:t" }),
    ).rejects.toThrow(/Give exactly one change/);
    await expect(
      store.setRoles({ email: "samuel@exmaple.com", remove: "management", by: "cli:t" }),
    ).rejects.toThrow(/isn't on the list/);
    // Adding a role someone already holds is no change at all, not a reset.
    await expect(
      store.setRoles({ email: SAMUEL, add: "staff", by: "cli:t" }),
    ).rejects.toThrow(/already hold staff/);
    expect(await rolesOf(p.id)).toEqual(before);
    expect((await eventsOf(p.id)).length).toBe(eventsBefore);
  });

  it("never replaces by default: adding a role leaves every other role and placement in place", async () => {
    const colony = await newColony(c);
    const p = await addStaff();
    await store.setRoles({ email: SAMUEL, add: "guardian", colonyId: colony, by: "cli:t" });
    await store.setRoles({ email: SAMUEL, add: "management", by: "cli:t" });
    await store.setRoles({ email: SAMUEL, add: "vet", by: "cli:t" });
    expect(await rolesOf(p.id)).toEqual([`guardian:${colony}`, "management", "staff", "vet"]);
  });

  it("refuses a result with no island role (staff or management) unless forced", async () => {
    const p = await addStaff();
    await expect(
      store.setRoles({ email: SAMUEL, remove: "staff", by: "cli:t" }),
    ).rejects.toThrow(/no staff or management role/);
    await expect(
      store.setRoles({ email: SAMUEL, replace: ["vet"], by: "cli:t" }),
    ).rejects.toThrow(/no staff or management role/);
    expect(await rolesOf(p.id)).toEqual(["staff"]);
    const r = await store.setRoles({ email: SAMUEL, replace: ["vet"], force: true, by: "cli:t" });
    expect(r.after).toEqual(["vet"]);
    expect(await rolesOf(p.id)).toEqual(["vet"]);
  });

  it("review M1, relaxed by SYC-316: a manager keeps staff or management; with neither they'd be locked out, so it is refused unless forced", async () => {
    const p = await addStaff();
    await store.setRoles({ email: SAMUEL, add: "management", by: "cli:t" });
    await addStaff("jacky@example.com");
    await store.setRoles({ email: "jacky@example.com", add: "management", by: "cli:t" });
    // Since PR 0.5, management alone lets someone in: dropping staff is fine.
    const r1 = await store.setRoles({ email: SAMUEL, remove: "staff", by: "cli:t" });
    expect(r1.after).toEqual(["management"]);
    const eventsBefore = (await eventsOf(p.id)).length;
    await expect(
      store.setRoles({ email: SAMUEL, replace: ["vet"], by: "cli:t" }),
    ).rejects.toThrow(/no staff or management role/);
    expect(await rolesOf(p.id)).toEqual(["management"]);
    expect((await eventsOf(p.id)).length).toBe(eventsBefore);
    // Forced, it is allowed: the break-glass stays a break-glass.
    const r = await store.setRoles({ email: SAMUEL, replace: ["vet"], force: true, by: "cli:t" });
    expect(r.after).toEqual(["vet"]);
  });

  it("--replace reports the guardian placements it took away", async () => {
    const colony = await newColony(c);
    await addStaff();
    await store.setRoles({ email: SAMUEL, add: "guardian", colonyId: colony, by: "cli:t" });
    const r = await store.setRoles({ email: SAMUEL, replace: ["staff", "vet"], by: "cli:t" });
    expect(r.after).toEqual(["staff", "vet"]);
    expect(r.droppedPlacements).toEqual([`guardian:${colony}`]);
  });

  it("management can stand on its own since PR 0.5 (SYC-316), and a whole new list needs replace", async () => {
    const p = await store.addPerson({ email: SAMUEL, name: "S", addedBy: "cli:t", roles: ["vet"] });
    const added = await store.setRoles({ email: SAMUEL, add: "management", by: "cli:t" });
    expect(added).toEqual({ id: p.id, before: ["vet"], after: ["management", "vet"], droppedPlacements: [] });
    const r = await store.setRoles({ email: SAMUEL, replace: ["staff", "management"], by: "cli:t" });
    expect(r).toEqual({ id: p.id, before: ["management", "vet"], after: ["management", "staff"], droppedPlacements: [] });
  });

  // SYC-316, roles spec §9.5: the last manager can't be demoted unless forced.
  it("refuses to take management from the last person who holds it, by --remove or --replace, unless forced", async () => {
    const p = await addStaff();
    await store.setRoles({ email: SAMUEL, add: "management", by: "cli:t" });
    const eventsBefore = (await eventsOf(p.id)).length;
    await expect(
      store.setRoles({ email: SAMUEL, remove: "management", by: "cli:t" }),
    ).rejects.toThrow(/last person with management/);
    await expect(
      store.setRoles({ email: SAMUEL, replace: ["staff"], by: "cli:t" }),
    ).rejects.toThrow(/last person with management/);
    expect(await rolesOf(p.id)).toEqual(["management", "staff"]);
    expect((await eventsOf(p.id)).length).toBe(eventsBefore);
    const r = await store.setRoles({ email: SAMUEL, remove: "management", force: true, by: "cli:t" });
    expect(r.after).toEqual(["staff"]);
  });

  it("lets a manager be demoted while another remains, and counts only joined people still on the list", async () => {
    await addStaff();
    await addStaff("jacky@example.com");
    await store.setRoles({ email: SAMUEL, add: "management", by: "cli:t" });
    await store.setRoles({ email: "jacky@example.com", add: "management", by: "cli:t" });
    // Jacky leaves: her management row stays, but she no longer counts.
    await store.markLeft("jacky@example.com", "cli:t");
    await expect(
      store.setRoles({ email: SAMUEL, remove: "management", by: "cli:t" }),
    ).rejects.toThrow(/last person with management/);
    await addStaff("susan@example.com");
    await store.setRoles({ email: "susan@example.com", add: "management", by: "cli:t" });
    const r = await store.setRoles({ email: SAMUEL, remove: "management", by: "cli:t" });
    expect(r.after).toEqual(["staff"]);
    // Now Susan is the last one.
    await expect(
      store.setRoles({ email: "susan@example.com", remove: "management", by: "cli:t" }),
    ).rejects.toThrow(/last person with management/);
  });

  it("two managers demoting each other at the same moment can't both succeed", async () => {
    await addStaff();
    await addStaff("jacky@example.com");
    await store.setRoles({ email: SAMUEL, add: "management", by: "cli:t" });
    await store.setRoles({ email: "jacky@example.com", add: "management", by: "cli:t" });
    // Two connections, so the two transactions really overlap.
    const pool = new pg.Pool({ connectionString: url(name), max: 2 });
    try {
      const racing = peopleStore(drizzle(pool, { schema }));
      const results = await Promise.allSettled([
        racing.setRoles({ email: SAMUEL, remove: "management", by: "cli:t" }),
        racing.setRoles({ email: "jacky@example.com", remove: "management", by: "cli:t" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(PeopleError);
      expect(String(refused.reason.message)).toMatch(/last person with management/);
    } finally {
      await pool.end();
    }
    const left = await c.query(`select count(*)::int as n from person_scopes where role = 'management'`);
    expect(left.rows[0].n).toBe(1);
  });

  it("a guardian placement needs its colony, and only a guardian takes one", async () => {
    const colony = await newColony(c);
    await addStaff();
    await expect(
      store.setRoles({ email: SAMUEL, add: "guardian", by: "cli:t" }),
    ).rejects.toThrow(/give its number with --colony/);
    await expect(
      store.setRoles({ email: SAMUEL, add: "vet", colonyId: colony, by: "cli:t" }),
    ).rejects.toThrow(/Only a cat guardian is placed on a colony/);
    await store.setRoles({ email: SAMUEL, add: "guardian", colonyId: colony, by: "cli:t" });
    const r = await store.setRoles({ email: SAMUEL, remove: "guardian", colonyId: colony, by: "cli:t" });
    expect(r.after).toEqual(["staff"]);
  });

  it("refuses a person who has left", async () => {
    await addStaff();
    await store.markLeft(SAMUEL, "cli:t");
    await expect(
      store.setRoles({ email: SAMUEL, add: "management", by: "cli:t" }),
    ).rejects.toThrow(/has left/);
  });

  it("refusals are PeopleErrors, so the command prints them plainly", async () => {
    await expect(store.setRoles({ email: SAMUEL, by: "cli:t" })).rejects.toBeInstanceOf(PeopleError);
  });
});

// ---------------------------------------------------------------------------

describe("T29 and the seeded rollback (review M7), on a database seeded before the migration", () => {
  let s: pg.Client;

  beforeAll(async () => {
    await admin.query(`create database "${seededName}"`);
    s = new pg.Client({ connectionString: url(seededName) });
    await s.connect();
    await migrateUp(s, migrations, { throughIdx: mine.idx - 1 });
  });

  afterAll(async () => {
    await s.end();
  });

  const applied = async () =>
    (await s.query(`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows[0]
      .n as number;
  const seedPersonOn = async (client: pg.Client, email: string, left = false) =>
    (
      await client.query(
        `insert into people (email, name, added_by, added_at, left_at)
         values ($1, 'N', 'cli:test', '2026-05-01T10:00:00Z', $2) returning id`,
        [email, left ? new Date() : null],
      )
    ).rows[0].id as string;
  const seedPerson = (email: string, left = false) => seedPersonOn(s, email, left);

  it("stops and lists every row breaking a new rule, and an admin observation, changing nothing", async () => {
    const colony = await newColony(s);
    const vera = await seedPerson("vera@example.com");
    const eleni = await seedPerson("eleni@example.com");
    const maria = await seedPerson("maria@example.com");
    const ins = async (person: string, role: string, colonyId: number | null) =>
      (
        await s.query(
          `insert into person_scopes (person_id, role, colony_id) values ($1, $2, $3) returning id`,
          [person, role, colonyId],
        )
      ).rows[0].id as number;
    const volunteer = await ins(vera, "volunteer", null);
    const guardianNoColony = await ins(eleni, "guardian", null);
    const staffOnColony = await ins(maria, "staff", colony);
    const before = await schemaSignature(s, "public");
    const appliedBefore = await applied();

    let message = "";
    await migrateUp(s, migrations).catch((e: Error) => (message = e.message));
    expect(message).toContain("these person_scopes rows break the new rules");
    expect(message).toContain(`scope ${volunteer} (person ${vera}, volunteer)`);
    expect(message).toContain(`scope ${guardianNoColony} (person ${eleni}, guardian)`);
    expect(message).toContain(`scope ${staffOnColony} (person ${maria}, staff, colony ${colony})`);
    expect(message).not.toMatch(/example\.com/);
    expect(sigDiff(await schemaSignature(s, "public"), before)).toEqual([]);
    expect(await applied()).toBe(appliedBefore);
    // The rows are fixed by hand, as a person would, for the next test.
    await s.query(`delete from person_scopes`);
  });

  it("stops and lists an observation with the retired role_at_time = 'admin', changing nothing", async () => {
    // Its own database: observations are append-only, so the row can't be
    // taken back out of the shared seeded one.
    const a = new pg.Client({ connectionString: url("postgres") });
    await a.connect();
    await a.query(`create database "${adminObsName}"`);
    await a.end();
    const o = new pg.Client({ connectionString: url(adminObsName) });
    await o.connect();
    try {
      await migrateUp(o, migrations, { throughIdx: mine.idx - 1 });
      const person = await seedPersonOn(o, "maria@example.com");
      const cat = await o.query(
        `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id)
           values ('Agatha', 0, 37.44, 24.94, 'd') returning id`,
      );
      const obs = await o.query(
        `insert into observations
           (cat_id, kind, value, account_id, role_at_time, authority_scope, provenance, observed_at)
         values ($1, 'sterilised', '{"sterilised": true}', $2, 'admin', 'none', 'volunteered', now()) returning id`,
        [cat.rows[0].id, person],
      );
      const before = await schemaSignature(o, "public");
      let message = "";
      await migrateUp(o, migrations).catch((e: Error) => (message = e.message));
      expect(message).toContain(
        `these observations have role_at_time = 'admin', which is retired: ${obs.rows[0].id}.`,
      );
      expect(sigDiff(await schemaSignature(o, "public"), before)).toEqual([]);
    } finally {
      await o.end();
    }
  });

  it("on a clean database, every existing person gets accepted_at = added_at and every row its reach", async () => {
    const colony = (await s.query(`select id from colonies limit 1`)).rows[0].id as number;
    const ids = (await s.query(`select id from people order by email`)).rows.map((r) => r.id);
    const gone = await seedPerson("gone@example.com", true);
    await s.query(
      `insert into person_scopes (person_id, role, colony_id) values ($1, 'staff', null), ($2, 'guardian', $4), ($3, 'vet', $4), ($3, 'vet', null), ($5, 'staff', null)`,
      [ids[0], ids[1], ids[2], colony, gone],
    );
    await migrateUp(s, migrations);
    const people = await s.query(`select accepted_at, added_at, language from people`);
    expect(people.rows).toHaveLength(4);
    for (const p of people.rows) {
      expect(p.accepted_at).toEqual(p.added_at);
      expect(p.language).toBe("en");
    }
    const scopes = await s.query(
      `select s.role, s.reach, s.colony_id, s.granted_at, s.granted_by, p.added_at, p.added_by
         from person_scopes s join people p on p.id = s.person_id order by s.id`,
    );
    // Review m5: granted when, and by whoever, the person was added.
    for (const r of scopes.rows) {
      expect(r.granted_at).toEqual(r.added_at);
      expect(r.granted_by).toBe(r.added_by);
    }
    expect(scopes.rows.map((r) => [r.role, r.reach, r.colony_id])).toEqual([
      ["staff", "island", null],
      ["guardian", "colony", colony],
      ["vet", "colony", colony],
      ["vet", "island", null],
      ["staff", "island", null],
    ]);
    // No management rows: the migration adds none (Decision A1).
    expect(
      (await s.query(`select count(*)::int as n from person_scopes where role = 'management'`)).rows[0].n,
    ).toBe(0);
  });

  it("rolling back refuses and lists management rows, guardian rows granted since, and pending people, and changes nothing", async () => {
    const ids = (await s.query(`select id from people where left_at is null order by email`)).rows.map(
      (r) => r.id as string,
    );
    const mgmt = await s.query(
      `insert into person_scopes (person_id, role, reach) values ($1, 'management', 'island') returning id`,
      [ids[0]],
    );
    const pending = (
      await s.query(
        `insert into people (email, name, added_by) values ('new@example.com', 'N', 'cli:t') returning id`,
      )
    ).rows[0].id as string;
    // A guardian from before the migration (held fine by the old schema)
    // must not block the rollback (review m1); one granted since must.
    const oldGuardian = (await s.query(`select id, colony_id from person_scopes where role = 'guardian'`))
      .rows[0] as { id: number; colony_id: number };
    const guardian = (
      await s.query(
        `insert into person_scopes (person_id, role, reach, colony_id, granted_by) values ($1, 'guardian', 'colony', $2, 'cli:t') returning id`,
        [ids[0], oldGuardian.colony_id],
      )
    ).rows[0].id as number;
    const before = await schemaSignature(s, "public");
    const rowsBefore = (await s.query(`select count(*)::int as n from person_scopes`)).rows[0].n;

    await s.query(`reset catspotter.rollback_deletes`).catch(() => {});
    let message = "";
    await rollbackLast(s, migrations).catch((e: Error) => (message = e.message));
    expect(message).toContain("ROLLING BACK IS NOT SAFE");
    expect(message).toContain(`management rows: scope ${mgmt.rows[0].id} (person ${ids[0]})`);
    expect(message).toContain(`guardian rows: scope ${guardian} `);
    expect(message).not.toContain(`scope ${oldGuardian.id} `);
    expect(message).toContain(`pending people: ${pending}`);
    expect(message).toContain("Fix forward instead");
    expect(message).not.toMatch(/example\.com/);
    // Never half-completes: the schema, the rows and the record are as they were.
    expect(sigDiff(await schemaSignature(s, "public"), before)).toEqual([]);
    expect((await s.query(`select count(*)::int as n from person_scopes`)).rows[0].n).toBe(rowsBefore);
    expect(
      (await s.query(`select accepted_at from people where id = $1`, [pending])).rows[0].accepted_at,
    ).toBeNull();
  });

  it("the delete path also needs a roles_invites_* database: the setting alone still refuses (review m2)", async () => {
    const otherName = `rolesinv_other_${suffix}`;
    const a = new pg.Client({ connectionString: url("postgres") });
    await a.connect();
    await a.query(`create database "${otherName}"`);
    const o = new pg.Client({ connectionString: url(otherName) });
    await o.connect();
    try {
      await migrateUp(o, migrations);
      const p = await seedPersonOn(o, "maria@example.com");
      await o.query(
        `insert into person_scopes (person_id, role, reach) values ($1, 'staff', 'island'), ($1, 'management', 'island')`,
        [p],
      );
      await o.query(`set catspotter.rollback_deletes = 'on'`);
      let message = "";
      await rollbackLast(o, migrations).catch((e: Error) => (message = e.message));
      expect(message).toContain("ROLLING BACK IS NOT SAFE");
      expect(
        (await o.query(`select count(*)::int as n from person_scopes where role = 'management'`)).rows[0].n,
      ).toBe(1);
    } finally {
      await o.end();
      await a.query(`drop database if exists "${otherName}"`);
      await a.end();
    }
  });

  it("an old guardian placement alone doesn't block the rollback (review m1)", async () => {
    // Checked on its own database so the shared seeded one keeps its rows.
    const oName = `roles_invites_oldg_${suffix}`;
    const a = new pg.Client({ connectionString: url("postgres") });
    await a.connect();
    await a.query(`create database "${oName}"`);
    const o = new pg.Client({ connectionString: url(oName) });
    await o.connect();
    try {
      await migrateUp(o, migrations, { throughIdx: mine.idx - 1 });
      const colony = await newColony(o);
      const p = await seedPersonOn(o, "eleni@example.com");
      await o.query(
        `insert into person_scopes (person_id, role, colony_id) values ($1, 'guardian', $2)`,
        [p, colony],
      );
      await migrateUp(o, migrations);
      expect(await rollbackLast(o, migrations)).toBe(mine.tag);
      expect(
        (await o.query(`select role, colony_id from person_scopes`)).rows,
      ).toEqual([{ role: "guardian", colony_id: colony }]);
    } finally {
      await o.end();
      await a.query(`drop database if exists "${oName}"`);
      await a.end();
    }
  });

  it("on a throwaway database the harness may delete them instead, printing each count, then up again works", async () => {
    const after = await schemaSignature(s, "public");
    const fresh = new pg.Client({ connectionString: url(seededName) });
    // A second connection: the setting is the session's own.
    await fresh.connect();
    const freshNotices: string[] = [];
    fresh.on("notice", (n) => freshNotices.push(n.message ?? ""));
    try {
      await fresh.query(`set catspotter.rollback_deletes = 'on'`);
      expect(await rollbackLast(fresh, migrations)).toBe(mine.tag);
    } finally {
      await fresh.end();
    }
    expect(freshNotices.filter((n) => n.startsWith("roles_and_invites"))).toEqual([
      "roles_and_invites rollback: deleted 1 management rows",
      "roles_and_invites rollback: deleted 1 guardian rows",
      "roles_and_invites rollback: marked 1 pending people as left",
    ]);
    // The schema is exactly what it was before the migration.
    const pre = new pg.Client({ connectionString: url("postgres") });
    await pre.connect();
    const preName = `roles_invites_pre_${suffix}`;
    await pre.query(`create database "${preName}"`);
    const p2 = new pg.Client({ connectionString: url(preName) });
    await p2.connect();
    try {
      await migrateUp(p2, migrations, { throughIdx: mine.idx - 1 });
      expect(
        sigDiff(await schemaSignature(s, "public"), await schemaSignature(p2, "public")),
      ).toEqual([]);
    } finally {
      await p2.end();
      await pre.query(`drop database if exists "${preName}"`);
      await pre.end();
    }
    // The pending person is off the list in the old schema too.
    const left = await s.query(
      `select count(*)::int as n from people where left_by = 'system:rollback'`,
    );
    expect(left.rows[0].n).toBe(1);
    // And up again, on the seeded data.
    await migrateUp(s, migrations);
    expect(sigDiff(await schemaSignature(s, "public"), after)).toEqual([]);
  });
});
